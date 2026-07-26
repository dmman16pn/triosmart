import { describe, it, expect, beforeEach } from 'vitest'
import { testPool, resetDb, seedConnection } from './helpers/db.js'
import { computeCustomerHash, markSent, isEcho, cleanupEchoGuard } from '../src/core/echoGuard.js'
import { processPosCustomer } from '../src/worker/processPosCustomer.js'

describe('echoGuard', () => {
  beforeEach(resetDb)

  it('hash ổn định: không phụ thuộc thứ tự key và thứ tự phone', () => {
    const a = computeCustomerHash({ name: 'A', phone_numbers: ['0902', '0901'] })
    const b = computeCustomerHash({ phone_numbers: ['0901', '0902'], name: 'A' })
    expect(a).toBe(b)
  })

  it('hash bỏ qua trường không thuộc nhóm ghi được', () => {
    const a = computeCustomerHash({ name: 'A', purchased_amount: 999 })
    const b = computeCustomerHash({ name: 'A' })
    expect(a).toBe(b)
  })

  it('markSent → isEcho true đúng 1 lần (dùng xong xóa)', async () => {
    const h = computeCustomerHash({ name: 'B' })
    await markSent(h)
    expect(await isEcho(h)).toBe(true)
    expect(await isEcho(h)).toBe(false)
  })

  it('hash quá 5 phút không còn là echo', async () => {
    const h = computeCustomerHash({ name: 'C' })
    await markSent(h)
    await testPool.query(`UPDATE echo_guard SET created_at = now() - interval '6 minutes'`)
    expect(await isEcho(h)).toBe(false)
  })

  it('cleanupEchoGuard xóa bản ghi quá hạn', async () => {
    await markSent('h1'); await markSent('h2')
    await testPool.query(`UPDATE echo_guard SET created_at = now() - interval '10 minutes' WHERE hash='h1'`)
    await cleanupEchoGuard()
    const { rows } = await testPool.query('SELECT hash FROM echo_guard')
    expect(rows.map(r => r.hash)).toEqual(['h2'])
  })

  it('processPosCustomer bỏ qua webhook là tiếng vọng của chính mình', async () => {
    const conn = await seedConnection('pos')
    const fields = { name: 'Echo Test', phone_numbers: ['0912345678'] }
    await markSent(computeCustomerHash(fields))
    const result = await processPosCustomer(conn, { id: 'pos_e1', ...fields })
    expect(result).toBe('echo')
    const { rows } = await testPool.query('SELECT count(*) FROM customer')
    expect(Number(rows[0].count)).toBe(0)          // không ghi lại → không vòng lặp
  })
})
