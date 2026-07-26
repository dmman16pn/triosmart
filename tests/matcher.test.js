import { describe, it, expect, beforeEach } from 'vitest'
import { testPool, resetDb, seedConnection } from './helpers/db.js'
import { findOrCreateCustomer } from '../src/core/matcher.js'

describe('findOrCreateCustomer', () => {
  let conn
  beforeEach(async () => { await resetDb(); conn = await seedConnection('pos') })

  it('tạo hồ sơ mới khi chưa có gì trùng', async () => {
    const c = await findOrCreateCustomer({
      phoneNormalized: '0912345678', name: 'A',
      sourceType: 'pos', connectionId: conn.id, externalId: 'pos_1'
    })
    expect(c.phone_normalized).toBe('0912345678')
    const ids = await testPool.query('SELECT * FROM customer_identity')
    expect(ids.rows).toHaveLength(1)
    expect(ids.rows[0].match_method).toBe('first_seen')
  })

  it('trùng phone → gắn identity mới vào hồ sơ cũ, confidence 100', async () => {
    const first = await findOrCreateCustomer({
      phoneNormalized: '0912345678', name: 'A',
      sourceType: 'pos', connectionId: conn.id, externalId: 'pos_1'
    })
    const chat = await seedConnection('chat')
    const second = await findOrCreateCustomer({
      phoneNormalized: '0912345678', name: 'A Chat',
      sourceType: 'chat', connectionId: chat.id, externalId: 'psid_9'
    })
    expect(second.id).toBe(first.id)
    const ids = await testPool.query(
      'SELECT * FROM customer_identity WHERE customer_id=$1 ORDER BY linked_at', [first.id])
    expect(ids.rows).toHaveLength(2)
    const chatIdentity = ids.rows.find(r => r.source_type === 'chat')
    expect(chatIdentity.match_method).toBe('phone')
    expect(chatIdentity.confidence).toBe(100)
  })

  it('cùng external_id gọi lại lần 2 → không tạo identity trùng', async () => {
    const args = { phoneNormalized: '0912345678', name: 'A',
      sourceType: 'pos', connectionId: conn.id, externalId: 'pos_1' }
    const a = await findOrCreateCustomer(args)
    const b = await findOrCreateCustomer(args)
    expect(b.id).toBe(a.id)
    const ids = await testPool.query('SELECT * FROM customer_identity')
    expect(ids.rows).toHaveLength(1)
  })

  it('trùng fb_id (không có phone) → gộp, confidence 95', async () => {
    const chat = await seedConnection('chat')
    const a = await findOrCreateCustomer({
      phoneNormalized: null, fbId: 'fb_77', name: 'B',
      sourceType: 'chat', connectionId: chat.id, externalId: 'psid_1'
    })
    const b = await findOrCreateCustomer({
      phoneNormalized: null, fbId: 'fb_77', name: 'B Pos',
      sourceType: 'pos', connectionId: conn.id, externalId: 'pos_2'
    })
    expect(b.id).toBe(a.id)
    const { rows } = await testPool.query(
      "SELECT confidence FROM customer_identity WHERE external_id='pos_2'")
    expect(rows[0].confidence).toBe(95)
  })

  it('POS có fb_id trùng psid của khách chat đã có → gộp, confidence 95', async () => {
    const chat = await seedConnection('chat')
    const a = await findOrCreateCustomer({
      phoneNormalized: null, name: 'C1',
      sourceType: 'chat', connectionId: chat.id, externalId: 'psid_abc'
    })
    const b = await findOrCreateCustomer({
      phoneNormalized: null, fbId: 'psid_abc', name: 'C1 Pos',
      sourceType: 'pos', connectionId: conn.id, externalId: 'pos_9'
    })
    expect(b.id).toBe(a.id)
    const { rows } = await testPool.query(
      "SELECT confidence, match_method FROM customer_identity WHERE external_id='pos_9'")
    expect(rows[0]).toMatchObject({ confidence: 95, match_method: 'fb_id' })
  })

  it('chat psid trùng fb_id khách POS (payload chat không có fb_id) → gộp, confidence 95', async () => {
    const a = await findOrCreateCustomer({
      phoneNormalized: null, fbId: 'fb_555', name: 'D1',
      sourceType: 'pos', connectionId: conn.id, externalId: 'pos_10'
    })
    const chat = await seedConnection('chat')
    const b = await findOrCreateCustomer({
      phoneNormalized: null, name: 'D1 Chat',
      sourceType: 'chat', connectionId: chat.id, externalId: 'fb_555'
    })
    expect(b.id).toBe(a.id)
  })

  it('chat có customer_id trỏ thẳng khách POS → gộp pos_link, confidence 100', async () => {
    const a = await findOrCreateCustomer({
      phoneNormalized: null, name: 'PosLink', sourceType: 'pos',
      connectionId: conn.id, externalId: 'pos_uuid_1'
    })
    const chat = await seedConnection('chat')
    const b = await findOrCreateCustomer({
      phoneNormalized: null, name: 'PosLink Chat', posCustomerId: 'pos_uuid_1',
      sourceType: 'chat', connectionId: chat.id, externalId: 'psid_pl'
    })
    expect(b.id).toBe(a.id)
    const { rows } = await testPool.query(
      "SELECT match_method, confidence FROM customer_identity WHERE external_id='psid_pl'")
    expect(rows[0]).toMatchObject({ match_method: 'pos_link', confidence: 100 })
  })

  it('trùng tên, cả hai không có phone → KHÔNG gộp, vào merge_queue', async () => {
    const a = await findOrCreateCustomer({
      phoneNormalized: null, name: 'Nguyễn Văn C',
      sourceType: 'pos', connectionId: conn.id, externalId: 'pos_3'
    })
    const chat = await seedConnection('chat')
    const b = await findOrCreateCustomer({
      phoneNormalized: null, name: 'Nguyễn Văn C',
      sourceType: 'chat', connectionId: chat.id, externalId: 'psid_5'
    })
    expect(b.id).not.toBe(a.id)                       // spec: không tự gộp dưới 90 điểm
    const mq = await testPool.query('SELECT * FROM merge_queue')
    expect(mq.rows).toHaveLength(1)
    expect(mq.rows[0].score).toBe(40)
  })
})
