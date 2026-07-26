import { describe, it, expect, beforeEach } from 'vitest'
import { testPool, resetDb, seedConnection } from './helpers/db.js'
import { processPosCustomer } from '../src/worker/processPosCustomer.js'

const base = {
  id: 'pos_c1', name: 'Trần Thị D',
  phone_numbers: ['+84 912 345 678', '0987654321'],
  emails: ['d@example.com'], gender: 'female',
  purchased_amount: 1500000, order_count: 4, succeed_order_count: 3,
  last_order_at: '2026-07-01T10:00:00Z', reward_point: 150, level_id: 'lv2',
  fb_id: 'fb_123', tags: ['vip'], updated_at: '2026-07-20T09:00:00Z'
}

describe('processPosCustomer', () => {
  let conn
  beforeEach(async () => { await resetDb(); conn = await seedConnection('pos') })

  it('tạo customer: SĐT đầu là chính, số phụ vào custom_fields.alt_phones', async () => {
    await processPosCustomer(conn, base)
    const { rows } = await testPool.query('SELECT * FROM customer')
    expect(rows).toHaveLength(1)
    const c = rows[0]
    expect(c.phone_normalized).toBe('0912345678')
    expect(c.custom_fields.alt_phones).toEqual(['0987654321'])
    expect(c.tags).toEqual(['vip'])
    expect(Number(c.pos_purchased_amount)).toBe(1500000)
    expect(c.pos_succeed_order_count).toBe(3)
  })

  it('chạy lại cùng payload → không nhân đôi (idempotent)', async () => {
    await processPosCustomer(conn, base)
    await processPosCustomer(conn, { ...base, name: 'Trần Thị D updated' })
    const { rows } = await testPool.query('SELECT * FROM customer')
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Trần Thị D updated')
  })

  it('SĐT không hợp lệ → phone_normalized NULL, giữ bản gốc, gắn cờ', async () => {
    await processPosCustomer(conn, { ...base, id: 'pos_c2', phone_numbers: ['12345'] })
    const { rows } = await testPool.query('SELECT * FROM customer')
    expect(rows[0].phone_normalized).toBeNull()
    expect(rows[0].phone_raw).toBe('12345')
    expect(rows[0].phone_invalid).toBe(true)
  })

  it('payload không có id → throw', async () => {
    await expect(processPosCustomer(conn, { name: 'X' })).rejects.toThrow(/thiếu id/)
  })

  it('không có phone_numbers → vẫn tạo hồ sơ (chờ gộp sau)', async () => {
    await processPosCustomer(conn, { ...base, id: 'pos_c3', phone_numbers: [] })
    const { rows } = await testPool.query('SELECT count(*) FROM customer')
    expect(Number(rows[0].count)).toBe(1)
  })
})
