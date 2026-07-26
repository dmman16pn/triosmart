import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import { testPool, resetDb, seedConnection } from './helpers/db.js'
import { encryptCredential } from '../src/core/credentials.js'
import { upsertCustomerFromPos } from '../src/core/upsert.js'
import { updateCustomerFields } from '../src/core/writeback.js'
import { drainPendingPush } from '../src/worker/drainPendingPush.js'

async function seedPosCustomer() {
  const conn = await seedConnection('pos')
  await testPool.query('UPDATE connection SET credential_encrypted=$2 WHERE id=$1',
    [conn.id, encryptCredential({ api_key: 'k1' })])
  await upsertCustomerFromPos(conn, { id: 'pc1', name: 'Gốc', phone_numbers: ['0912345678'] })
  const { rows } = await testPool.query('SELECT * FROM customer')
  return { conn, customer: rows[0] }
}

describe('updateCustomerFields', () => {
  beforeEach(resetDb)
  afterEach(() => nock.cleanAll())

  it('trường chỉ đọc bị từ chối, không đụng DB', async () => {
    const { customer } = await seedPosCustomer()
    const res = await updateCustomerFields(customer.id, { pos_purchased_amount: 999 }, {})
    expect(res.skipped).toContain('pos_purchased_amount')
    const { rows } = await testPool.query('SELECT pos_purchased_amount FROM customer')
    expect(Number(rows[0].pos_purchased_amount)).toBe(0)
  })

  it('trường trio-owned: update local, KHÔNG push, có audit', async () => {
    const { customer } = await seedPosCustomer()
    const res = await updateCustomerFields(customer.id, { internal_note: 'ghi chú' }, {})
    expect(res.pushed).toBe(false)
    const { rows } = await testPool.query('SELECT internal_note FROM customer')
    expect(rows[0].internal_note).toBe('ghi chú')
    const audit = await testPool.query(
      `SELECT * FROM audit_log WHERE field='internal_note' AND source='user'`)
    expect(audit.rows).toHaveLength(1)
    // trio-owned không tạo pending_push
    expect((await testPool.query('SELECT count(*) FROM pending_push')).rows[0].count).toBe('0')
  })

  it('trường writable: update local + PUT Pancake thành công → pushed true + echo_guard + audit', async () => {
    const { customer } = await seedPosCustomer()
    const scope = nock('https://pos.pages.fm')
      .put('/api/v1/shops/shop_1/customers/pc1', body => body.customer.name === 'Tên mới')
      .query(true)
      .reply(200, { success: true })
    const res = await updateCustomerFields(customer.id, { name: 'Tên mới' }, {})
    expect(res.pushed).toBe(true)
    expect(scope.isDone()).toBe(true)
    const { rows } = await testPool.query('SELECT name FROM customer')
    expect(rows[0].name).toBe('Tên mới')
    const audit = (await testPool.query(
      `SELECT * FROM audit_log WHERE field='name' AND source='user'`)).rows[0]
    expect(audit.pushed_to_pancake).toBe(true)
    expect(audit.old_value).toBe('Gốc')
    expect(audit.new_value).toBe('Tên mới')
    expect((await testPool.query('SELECT count(*) FROM echo_guard')).rows[0].count).toBe('1')
  })

  it('PUT lỗi → pushed false + vào pending_push, dữ liệu local vẫn lưu', async () => {
    const { customer } = await seedPosCustomer()
    nock('https://pos.pages.fm').put(/.*/).query(true).reply(500, 'boom')
    const res = await updateCustomerFields(customer.id, { name: 'Tên lỗi' }, {})
    expect(res.pushed).toBe(false)
    expect(res.error).toMatch(/500/)
    expect((await testPool.query('SELECT name FROM customer')).rows[0].name).toBe('Tên lỗi')
    const pp = (await testPool.query('SELECT * FROM pending_push')).rows
    expect(pp).toHaveLength(1)
    expect(pp[0].status).toBe('pending')
  })

  it('khách không có identity POS → pushed false kèm lý do, không pending_push', async () => {
    await resetDb()
    const chat = await seedConnection('chat')
    const { findOrCreateCustomer } = await import('../src/core/matcher.js')
    const c = await findOrCreateCustomer({
      phoneNormalized: null, name: 'Chat only',
      sourceType: 'chat', connectionId: chat.id, externalId: 'psid_x'
    })
    const res = await updateCustomerFields(c.id, { name: 'Đổi tên' }, {})
    expect(res.pushed).toBe(false)
    expect(res.error).toMatch(/POS/)
    expect((await testPool.query('SELECT count(*) FROM pending_push')).rows[0].count).toBe('0')
  })

  it('phone_numbers: chuẩn hóa trước khi lưu local', async () => {
    const { customer } = await seedPosCustomer()
    nock('https://pos.pages.fm').put(/.*/).query(true).reply(200, { success: true })
    await updateCustomerFields(customer.id, { phone_numbers: ['+84 987 654 321'] }, {})
    const { rows } = await testPool.query('SELECT phone_normalized FROM customer')
    expect(rows[0].phone_normalized).toBe('0987654321')
  })
})

describe('drainPendingPush', () => {
  beforeEach(resetDb)
  afterEach(() => nock.cleanAll())

  it('retry thành công → done + audit cập nhật pushed', async () => {
    const { customer } = await seedPosCustomer()
    nock('https://pos.pages.fm').put(/.*/).query(true).reply(500, 'x')
    await updateCustomerFields(customer.id, { name: 'Retry me' }, {})
    nock.cleanAll()
    nock('https://pos.pages.fm').put(/.*/).query(true).reply(200, { success: true })

    await drainPendingPush()

    const pp = (await testPool.query('SELECT status FROM pending_push')).rows[0]
    expect(pp.status).toBe('done')
    const audit = (await testPool.query(
      `SELECT pushed_to_pancake FROM audit_log WHERE field='name' ORDER BY id DESC LIMIT 1`)).rows[0]
    expect(audit.pushed_to_pancake).toBe(true)
  })

  it('retry tiếp tục lỗi → attempts tăng, next_at lùi ra sau', async () => {
    const { customer } = await seedPosCustomer()
    nock('https://pos.pages.fm').put(/.*/).query(true).reply(500, 'x').persist()
    await updateCustomerFields(customer.id, { name: 'Vẫn lỗi' }, {})
    await drainPendingPush()
    const pp = (await testPool.query('SELECT * FROM pending_push')).rows[0]
    expect(pp.status).toBe('pending')
    expect(pp.attempts).toBe(1)
    expect(new Date(pp.next_at).getTime()).toBeGreaterThan(Date.now())
  })

  it('quá 8 lần → dead', async () => {
    const { customer } = await seedPosCustomer()
    nock('https://pos.pages.fm').put(/.*/).query(true).reply(500, 'x').persist()
    await updateCustomerFields(customer.id, { name: 'Chết' }, {})
    await testPool.query(`UPDATE pending_push SET attempts = 8, next_at = now()`)
    await drainPendingPush()
    const pp = (await testPool.query('SELECT status FROM pending_push')).rows[0]
    expect(pp.status).toBe('dead')
  })
})
