import { describe, it, expect, beforeEach } from 'vitest'
import { testPool, resetDb, seedConnection } from './helpers/db.js'
import { upsertCustomerFromPos } from '../src/core/upsert.js'
import { findOrCreateCustomer } from '../src/core/matcher.js'
import { processPosOrder } from '../src/worker/processPosOrder.js'
import { processChatEvent } from '../src/worker/processChatEvent.js'
import { mergeCustomers, undoMerge, splitIdentity, resolveMergeQueue } from '../src/core/merge.js'

async function seedTwo() {
  const pos = await seedConnection('pos')
  const chat = await seedConnection('chat')
  // Khách POS có đơn hàng
  await upsertCustomerFromPos(pos, {
    id: 'pc1', name: 'Khách POS', phone_numbers: ['0912345678'],
    purchased_amount: 500000, succeed_order_count: 2
  })
  await processPosOrder(pos, { id: 111, customer: { id: 'pc1', name: 'Khách POS', phone_numbers: ['0912345678'] }, total_price: 500000 })
  // Khách chat không phone, tên khác → hồ sơ riêng
  await processChatEvent(chat, {
    event_type: 'messaging',
    conversation: { id: 'cv1', type: 'INBOX' },
    customer: { psid: 'psid_1', name: 'Khách Chat' },
    message: { text: 'hello', inserted_at: '2026-07-25T03:00:00Z' }
  })
  const { rows } = await testPool.query('SELECT * FROM customer ORDER BY created_at')
  const keep = rows.find(r => r.name === 'Khách POS')
  const other = rows.find(r => r.name === 'Khách Chat')
  return { pos, chat, keep, other }
}

describe('mergeCustomers + undoMerge', () => {
  beforeEach(resetDb)

  it('gộp: identities/orders/conversations dồn về keep, other bị xóa, có audit __merge__', async () => {
    const { keep, other } = await seedTwo()
    const auditId = await mergeCustomers(keep.id, other.id, {})
    expect(auditId).toBeTruthy()

    expect((await testPool.query('SELECT count(*) FROM customer')).rows[0].count).toBe('1')
    const ids = await testPool.query('SELECT source_type FROM customer_identity WHERE customer_id=$1', [keep.id])
    expect(ids.rows.map(r => r.source_type).sort()).toEqual(['chat', 'pos'])
    const conv = await testPool.query('SELECT customer_id FROM conversation')
    expect(conv.rows[0].customer_id).toBe(keep.id)
    const audit = await testPool.query(`SELECT * FROM audit_log WHERE field='__merge__'`)
    expect(audit.rows).toHaveLength(1)
  })

  it('gộp hai khách cùng có phone: không vỡ UNIQUE (phone other bỏ, giữ phone keep)', async () => {
    const pos = await seedConnection('pos')
    await upsertCustomerFromPos(pos, { id: 'a1', name: 'A', phone_numbers: ['0911111111'] })
    await upsertCustomerFromPos(pos, { id: 'a2', name: 'B', phone_numbers: ['0922222222'] })
    const { rows } = await testPool.query('SELECT * FROM customer ORDER BY phone_normalized')
    await mergeCustomers(rows[0].id, rows[1].id, {})
    const after = await testPool.query('SELECT phone_normalized, custom_fields FROM customer')
    expect(after.rows).toHaveLength(1)
    expect(after.rows[0].phone_normalized).toBe('0911111111')
    expect(after.rows[0].custom_fields.alt_phones).toContain('0922222222')  // số kia không mất
  })

  it('undoMerge trong 24h: khôi phục ĐÚNG trạng thái trước gộp (spec 7.2)', async () => {
    const { keep, other } = await seedTwo()
    const auditId = await mergeCustomers(keep.id, other.id, {})
    const undone = await undoMerge(auditId, {})
    expect(undone).toBe(true)

    const { rows } = await testPool.query('SELECT * FROM customer ORDER BY name')
    expect(rows).toHaveLength(2)
    const restored = rows.find(r => r.name === 'Khách Chat')
    expect(restored.id).toBe(other.id)                       // giữ nguyên uuid cũ
    const conv = await testPool.query('SELECT customer_id FROM conversation')
    expect(conv.rows[0].customer_id).toBe(other.id)          // hội thoại về lại chủ cũ
    const ident = await testPool.query(
      `SELECT customer_id FROM customer_identity WHERE source_type='chat'`)
    expect(ident.rows[0].customer_id).toBe(other.id)
  })

  it('undoMerge quá 24h → từ chối', async () => {
    const { keep, other } = await seedTwo()
    const auditId = await mergeCustomers(keep.id, other.id, {})
    await testPool.query(`UPDATE audit_log SET created_at = now() - interval '25 hours' WHERE id=$1`, [auditId])
    await expect(undoMerge(auditId, {})).rejects.toThrow(/24/)
  })
})

describe('splitIdentity', () => {
  beforeEach(resetDb)

  it('tách identity chat khỏi hồ sơ gộp: hội thoại đi theo, hồ sơ mới độc lập', async () => {
    const { keep, other } = await seedTwo()
    await mergeCustomers(keep.id, other.id, {})
    const { rows: [chatIdent] } = await testPool.query(
      `SELECT * FROM customer_identity WHERE source_type='chat'`)
    const newCustomer = await splitIdentity(chatIdent.id, {})
    expect(newCustomer.id).not.toBe(keep.id)
    const conv = await testPool.query('SELECT customer_id FROM conversation')
    expect(conv.rows[0].customer_id).toBe(newCustomer.id)
    const audit = await testPool.query(`SELECT * FROM audit_log WHERE field='__split__'`)
    expect(audit.rows).toHaveLength(1)
  })
})

describe('resolveMergeQueue', () => {
  beforeEach(resetDb)

  async function seedQueue() {
    const pos = await seedConnection('pos')
    const chat = await seedConnection('chat')
    const a = await findOrCreateCustomer({
      phoneNormalized: null, name: 'Trùng Tên', sourceType: 'pos',
      connectionId: pos.id, externalId: 'p1'
    })
    const b = await findOrCreateCustomer({
      phoneNormalized: null, name: 'Trùng Tên', sourceType: 'chat',
      connectionId: chat.id, externalId: 'ps1'
    })
    const { rows } = await testPool.query('SELECT * FROM merge_queue')
    return { a, b, item: rows[0] }
  }

  it('action merge → gộp (mặc định giữ hồ sơ có identity POS), status merged', async () => {
    const { a, item } = await seedQueue()
    await resolveMergeQueue(item.id, 'merge', {})
    expect((await testPool.query('SELECT count(*) FROM customer')).rows[0].count).toBe('1')
    expect((await testPool.query('SELECT id FROM customer')).rows[0].id).toBe(a.id)
    expect((await testPool.query('SELECT status FROM merge_queue')).rows[0].status).toBe('merged')
  })

  it('action keep_separate → giữ nguyên 2 hồ sơ', async () => {
    const { item } = await seedQueue()
    await resolveMergeQueue(item.id, 'keep_separate', {})
    expect((await testPool.query('SELECT count(*) FROM customer')).rows[0].count).toBe('2')
    expect((await testPool.query('SELECT status FROM merge_queue')).rows[0].status).toBe('kept_separate')
  })
})
