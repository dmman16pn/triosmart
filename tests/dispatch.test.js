import { describe, it, expect, beforeEach } from 'vitest'
import { testPool, resetDb, seedConnection } from './helpers/db.js'
import { drainOnce } from '../src/worker/dispatch.js'

describe('worker dispatch', () => {
  beforeEach(resetDb)

  it('xử lý sự kiện pos customers pending → done, tạo customer', async () => {
    await seedConnection('pos')
    await testPool.query(
      `INSERT INTO webhook_event (source, event_type, payload) VALUES
       ('pos', 'customers', $1)`,
      [JSON.stringify({ event: 'customers', customer: { id: 'c1', name: 'F', phone_numbers: ['0912345678'] } })])
    const n = await drainOnce()
    expect(n).toBe(1)
    const ev = (await testPool.query('SELECT * FROM webhook_event')).rows[0]
    expect(ev.status).toBe('done')
    expect(ev.processed_at).not.toBeNull()
    expect((await testPool.query('SELECT count(*) FROM customer')).rows[0].count).toBe('1')
  })

  it('payload hỏng (order không có id) → status=error kèm message, không throw', async () => {
    await seedConnection('pos')
    await testPool.query(
      `INSERT INTO webhook_event (source, event_type, payload) VALUES ('pos','orders','{}')`)
    await drainOnce()
    const ev = (await testPool.query('SELECT * FROM webhook_event')).rows[0]
    expect(ev.status).toBe('error')
    expect(ev.error).toMatch(/thiếu id/)
  })

  it('không có connection tương ứng → error, không crash', async () => {
    await testPool.query(
      `INSERT INTO webhook_event (source, event_type, payload) VALUES
       ('chat','messaging','{"event_type":"messaging"}')`)
    await drainOnce()
    const ev = (await testPool.query('SELECT * FROM webhook_event')).rows[0]
    expect(ev.status).toBe('error')
  })
})
