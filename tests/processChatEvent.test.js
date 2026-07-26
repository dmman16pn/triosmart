import { describe, it, expect, beforeEach } from 'vitest'
import { testPool, resetDb, seedConnection } from './helpers/db.js'
import { processChatEvent } from '../src/worker/processChatEvent.js'

describe('processChatEvent', () => {
  let conn
  beforeEach(async () => { await resetDb(); conn = await seedConnection('chat') })

  const messaging = {
    event_type: 'messaging',
    conversation: { id: 'page_1_psid_9', type: 'INBOX' },
    customer: { psid: 'psid_9', name: 'Khách Zalo', fb_id: null },
    message: { text: 'Cho hỏi giá', inserted_at: '2026-07-25T03:00:00Z' }
  }

  it('messaging: tạo customer (không phone) + conversation tóm tắt', async () => {
    await processChatEvent(conn, messaging)
    const c = (await testPool.query('SELECT * FROM customer')).rows[0]
    expect(c.name).toBe('Khách Zalo')
    expect(c.phone_normalized).toBeNull()
    const conv = (await testPool.query('SELECT * FROM conversation')).rows[0]
    expect(conv.customer_id).toBe(c.id)
    expect(conv.last_message_snippet).toBe('Cho hỏi giá')
  })

  it('messaging có phone trùng khách POS → tự ghép vào hồ sơ cũ', async () => {
    const pos = await seedConnection('pos')
    const { upsertCustomerFromPos } = await import('../src/core/upsert.js')
    await upsertCustomerFromPos(pos, { id: 'pos_c1', name: 'A', phone_numbers: ['0912345678'] })
    await processChatEvent(conn, {
      ...messaging,
      customer: { psid: 'psid_9', name: 'A Zalo', phone_number: '84912345678' }
    })
    const { rows } = await testPool.query('SELECT count(*) FROM customer')
    expect(Number(rows[0].count)).toBe(1)                       // đã ghép, không tạo mới
    const ids = await testPool.query('SELECT count(*) FROM customer_identity')
    expect(Number(ids.rows[0].count)).toBe(2)
  })

  it('messaging lặp lại → cập nhật conversation, không nhân đôi', async () => {
    await processChatEvent(conn, messaging)
    await processChatEvent(conn, { ...messaging,
      message: { text: 'Còn hàng không?', inserted_at: '2026-07-25T04:00:00Z' } })
    const { rows } = await testPool.query('SELECT * FROM conversation')
    expect(rows).toHaveLength(1)
    expect(rows[0].last_message_snippet).toBe('Còn hàng không?')
  })

  it('connect_status lỗi → connection chuyển error + last_error', async () => {
    await processChatEvent(conn, { event_type: 'connect_status',
      status: 'disconnected', message: 'Page token revoked' })
    const { rows } = await testPool.query('SELECT * FROM connection WHERE id=$1', [conn.id])
    expect(rows[0].status).toBe('error')
    expect(rows[0].last_error).toBe('Page token revoked')
  })
})
