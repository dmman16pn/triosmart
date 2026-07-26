import { describe, it, expect, beforeEach } from 'vitest'
import { testPool, resetDb } from './helpers/db.js'
import { runRetention } from '../src/scheduler/retention.js'
import { checkErrorRateAlert } from '../src/worker/alerts.js'

describe('runRetention (spec 5.6, 9)', () => {
  beforeEach(resetDb)

  it('xóa webhook_event > 90 ngày, giữ bản mới', async () => {
    await testPool.query(`INSERT INTO webhook_event (source, payload, received_at) VALUES
      ('pos', '{}', now() - interval '91 days'),
      ('pos', '{}', now() - interval '89 days')`)
    await runRetention()
    const { rows } = await testPool.query('SELECT count(*) FROM webhook_event')
    expect(rows[0].count).toBe('1')
  })

  it('xóa sync_log + merge_queue đã đóng > 12 tháng, KHÔNG đụng audit_log', async () => {
    await testPool.query(`INSERT INTO sync_log (direction, entity, started_at) VALUES
      ('in', 'customers', now() - interval '13 months'),
      ('in', 'customers', now())`)
    await testPool.query(`INSERT INTO audit_log (field, created_at) VALUES
      ('name', now() - interval '20 months')`)
    await runRetention()
    expect((await testPool.query('SELECT count(*) FROM sync_log')).rows[0].count).toBe('1')
    expect((await testPool.query('SELECT count(*) FROM audit_log')).rows[0].count).toBe('1')
  })
})

describe('checkErrorRateAlert (spec 9: >20% trong 5 phút)', () => {
  beforeEach(resetDb)

  it('tỉ lệ lỗi 50% trong 5 phút → sinh alert critical', async () => {
    await testPool.query(`INSERT INTO webhook_event (source, payload, status, received_at)
      SELECT 'pos', '{}', CASE WHEN i % 2 = 0 THEN 'error' ELSE 'done' END, now()
      FROM generate_series(1, 20) i`)
    await checkErrorRateAlert()
    const { rows } = await testPool.query(`SELECT * FROM alert WHERE open`)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('webhook_error_rate')
  })

  it('tỉ lệ lỗi thấp → không alert; alert cũ đang mở thì tự đóng', async () => {
    await testPool.query(`INSERT INTO alert (kind, message, open) VALUES
      ('webhook_error_rate', 'cũ', true)`)
    await testPool.query(`INSERT INTO webhook_event (source, payload, status, received_at)
      SELECT 'pos', '{}', 'done', now() FROM generate_series(1, 20)`)
    await checkErrorRateAlert()
    const { rows } = await testPool.query(`SELECT * FROM alert WHERE open`)
    expect(rows).toHaveLength(0)
  })

  it('không lặp alert khi đã có alert đang mở', async () => {
    await testPool.query(`INSERT INTO webhook_event (source, payload, status, received_at)
      SELECT 'pos', '{}', 'error', now() FROM generate_series(1, 10)`)
    await checkErrorRateAlert()
    await checkErrorRateAlert()
    const { rows } = await testPool.query(`SELECT count(*) FROM alert WHERE open`)
    expect(rows[0].count).toBe('1')
  })
})
