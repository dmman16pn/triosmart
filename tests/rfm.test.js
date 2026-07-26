import { describe, it, expect, beforeEach } from 'vitest'
import { testPool, resetDb, seedConnection } from './helpers/db.js'
import { computeSegment, recomputeCustomer, recomputeAll, DEFAULT_RFM } from '../src/core/rfm.js'
import { upsertCustomerFromPos } from '../src/core/upsert.js'

const daysAgo = n => new Date(Date.now() - n * 86400000)
const T = DEFAULT_RFM

describe('computeSegment (spec 7.7)', () => {
  const c = (succeed, amount, lastDays) => ({
    pos_succeed_order_count: succeed, pos_purchased_amount: amount,
    pos_last_order_at: lastDays == null ? null : daysAgo(lastDays)
  })

  it('succeed=0 → Chưa mua (kể cả không có last_order)', () => {
    expect(computeSegment(c(0, 0, null), T)).toBe('Chưa mua')
  })
  it('amount>=VIP và mua trong 30 ngày → Khách VIP', () => {
    expect(computeSegment(c(5, 6000000, 10), T)).toBe('Khách VIP')
  })
  it('succeed>=3 và mua trong 60 ngày → Trung thành', () => {
    expect(computeSegment(c(3, 900000, 45), T)).toBe('Trung thành')
  })
  it('succeed>=2 và 60<days<=120 → Có nguy cơ rời bỏ', () => {
    expect(computeSegment(c(2, 400000, 90), T)).toBe('Có nguy cơ rời bỏ')
  })
  it('days>120 → Đã rời bỏ', () => {
    expect(computeSegment(c(2, 400000, 200), T)).toBe('Đã rời bỏ')
    expect(computeSegment(c(1, 100000, 150), T)).toBe('Đã rời bỏ')
  })
  it('succeed=1 và days<=30 → Khách mới', () => {
    expect(computeSegment(c(1, 100000, 5), T)).toBe('Khách mới')
  })
  it('succeed=1 và days>30 → Mua một lần', () => {
    expect(computeSegment(c(1, 100000, 50), T)).toBe('Mua một lần')
  })
  it('lỗ hổng bảng spec (succeed=2, days<=60, chưa đủ loyal) → Chưa phân loại', () => {
    expect(computeSegment(c(2, 400000, 20), T)).toBe('Chưa phân loại')
  })
  it('succeed>0 nhưng thiếu last_order_at → Chưa phân loại', () => {
    expect(computeSegment(c(2, 400000, null), T)).toBe('Chưa phân loại')
  })
})

describe('recompute tích hợp', () => {
  beforeEach(resetDb)

  it('upsert từ POS tự gắn rfm_segment', async () => {
    const conn = await seedConnection('pos')
    await upsertCustomerFromPos(conn, {
      id: 'r1', name: 'RFM', phone_numbers: ['0911222333'],
      succeed_order_count: 1, purchased_amount: 100000,
      last_order_at: daysAgo(3).toISOString()
    })
    const { rows } = await testPool.query('SELECT rfm_segment FROM customer')
    expect(rows[0].rfm_segment).toBe('Khách mới')
  })

  it('recomputeAll cập nhật toàn bộ theo ngưỡng trong setting', async () => {
    const conn = await seedConnection('pos')
    await upsertCustomerFromPos(conn, {
      id: 'r2', name: 'VIP?', phone_numbers: ['0911222334'],
      succeed_order_count: 5, purchased_amount: 2000000,
      last_order_at: daysAgo(3).toISOString()
    })
    // ngưỡng mặc định 5tr → chưa VIP
    expect((await testPool.query('SELECT rfm_segment FROM customer')).rows[0].rfm_segment).toBe('Trung thành')
    // hạ ngưỡng VIP xuống 1tr → recomputeAll → thành VIP
    await testPool.query(`UPDATE setting SET value = value || '{"vip_amount":1000000}' WHERE key='rfm'`)
    await recomputeAll()
    expect((await testPool.query('SELECT rfm_segment FROM customer')).rows[0].rfm_segment).toBe('Khách VIP')
  })

  it('recomputeCustomer một khách', async () => {
    const conn = await seedConnection('pos')
    await upsertCustomerFromPos(conn, { id: 'r3', name: 'X', phone_numbers: ['0911222335'] })
    const { rows: [c] } = await testPool.query('SELECT id FROM customer')
    await testPool.query(
      `UPDATE customer SET pos_succeed_order_count=1, pos_last_order_at=$2 WHERE id=$1`,
      [c.id, daysAgo(100)])
    await recomputeCustomer(c.id)
    const { rows } = await testPool.query('SELECT rfm_segment FROM customer WHERE id=$1', [c.id])
    expect(rows[0].rfm_segment).toBe('Mua một lần')
  })
})
