import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import { testPool, resetDb, seedConnection } from './helpers/db.js'
import { encryptCredential, decryptCredential } from '../src/core/credentials.js'
import { backfillPos } from '../src/scheduler/backfill.js'

describe('credentials', () => {
  it('mã hóa rồi giải mã ra đúng object', () => {
    const cred = { api_key: 'secret123' }
    const enc = encryptCredential(cred)
    expect(enc).not.toContain('secret123')
    expect(decryptCredential(enc)).toEqual(cred)
  })
})

describe('backfillPos', () => {
  let conn
  beforeEach(async () => {
    await resetDb()
    conn = await seedConnection('pos')
    await testPool.query('UPDATE connection SET credential_encrypted=$2 WHERE id=$1',
      [conn.id, encryptCredential({ api_key: 'k1' })])
  })
  afterEach(() => nock.cleanAll())

  it('kéo customers + orders từ mốc gần nhất, ghi sync_log', async () => {
    nock('https://pos.pages.fm').get('/api/v1/shops/shop_1/customers')
      .query(q => q.page_number === '1')
      .reply(200, { success: true, data: [{ id: 'c9', name: 'G', phone_numbers: ['0911111111'] }] })
    nock('https://pos.pages.fm').get('/api/v1/shops/shop_1/customers')
      .query(q => q.page_number === '2').reply(200, { success: true, data: [] })
    nock('https://pos.pages.fm').get('/api/v1/shops/shop_1/orders')
      .query(q => q.page_number === '1')
      .reply(200, { success: true, data: [{ id: 1, customer: { id: 'c9' }, total_price: 100 }] })
    nock('https://pos.pages.fm').get('/api/v1/shops/shop_1/orders')
      .query(q => q.page_number === '2').reply(200, { success: true, data: [] })

    await backfillPos(conn.id)

    expect((await testPool.query('SELECT count(*) FROM customer')).rows[0].count).toBe('1')
    expect((await testPool.query('SELECT count(*) FROM "order"')).rows[0].count).toBe('1')
    const logs = (await testPool.query('SELECT * FROM sync_log ORDER BY id')).rows
    expect(logs.length).toBeGreaterThanOrEqual(2)     // customers + orders
    expect(logs.every(l => l.finished_at !== null)).toBe(true)
  })

  it('API lỗi giữa chừng → sync_log ghi count_fail, không throw ra ngoài', async () => {
    nock('https://pos.pages.fm').get(/.*/).query(true).reply(500, 'x').persist()
    await backfillPos(conn.id)
    const logs = (await testPool.query('SELECT * FROM sync_log')).rows
    expect(logs.some(l => l.count_fail > 0)).toBe(true)
  })
})
