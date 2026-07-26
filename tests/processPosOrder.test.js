import { describe, it, expect, beforeEach } from 'vitest'
import { testPool, resetDb, seedConnection } from './helpers/db.js'
import { processPosOrder } from '../src/worker/processPosOrder.js'

const order = {
  id: 9001, status: 3, total_price: 450000, cod: 450000, prepaid: 0,
  inserted_at: '2026-07-12T08:00:00Z', updated_at: '2026-07-12T09:00:00Z',
  customer: { id: 'pos_c1', name: 'E', phone_numbers: ['0912345678'] }
}

describe('processPosOrder', () => {
  let conn
  beforeEach(async () => { await resetDb(); conn = await seedConnection('pos') })

  it('tạo order gắn đúng customer (tự tạo customer nếu chưa có)', async () => {
    await processPosOrder(conn, order)
    const o = (await testPool.query('SELECT * FROM "order"')).rows[0]
    expect(o.pos_order_id).toBe('9001')
    expect(Number(o.total_amount)).toBe(450000)
    const c = (await testPool.query('SELECT * FROM customer')).rows[0]
    expect(o.customer_id).toBe(c.id)
    expect(o.raw.customer.name).toBe('E')
  })

  it('cùng pos_order_id đến lần 2 (đổi trạng thái) → update, không nhân đôi', async () => {
    await processPosOrder(conn, order)
    await processPosOrder(conn, { ...order, status: 5 })
    const { rows } = await testPool.query('SELECT * FROM "order"')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('5')
  })

  it('đơn không có khách → order.customer_id NULL, vẫn lưu', async () => {
    await processPosOrder(conn, { ...order, id: 9002, customer: null })
    const { rows } = await testPool.query('SELECT * FROM "order" WHERE pos_order_id=$1', ['9002'])
    expect(rows).toHaveLength(1)
    expect(rows[0].customer_id).toBeNull()
  })

  it('payload không có id → throw', async () => {
    await expect(processPosOrder(conn, {})).rejects.toThrow(/thiếu id/)
  })
})
