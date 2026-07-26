import { describe, it, expect, beforeEach } from 'vitest'
import { testPool, resetDb, seedConnection } from './helpers/db.js'
import { upsertCustomerFromPos } from '../src/core/upsert.js'

describe('xung đột theo trường (spec 7.6)', () => {
  let conn
  beforeEach(async () => { await resetDb(); conn = await seedConnection('pos') })

  async function createBase() {
    await upsertCustomerFromPos(conn, { id: 'pc1', name: 'Tên POS', phone_numbers: ['0912345678'] })
    return (await testPool.query('SELECT * FROM customer')).rows[0]
  }

  it('mặc định POS thắng: webhook mới ghi đè name', async () => {
    await createBase()
    await upsertCustomerFromPos(conn, { id: 'pc1', name: 'Tên POS mới', phone_numbers: ['0912345678'] })
    const { rows } = await testPool.query('SELECT name FROM customer')
    expect(rows[0].name).toBe('Tên POS mới')
  })

  it('Trio vừa sửa name trong 60s → giữ giá trị Trio, ghi audit conflict', async () => {
    const c = await createBase()
    // giả lập user vừa sửa name qua TRIOSMART
    await testPool.query(
      `UPDATE customer SET name='Tên Trio' WHERE id=$1`, [c.id])
    await testPool.query(
      `INSERT INTO audit_log (customer_id, field, old_value, new_value, source)
       VALUES ($1, 'name', '"Tên POS"', '"Tên Trio"', 'user')`, [c.id])

    await upsertCustomerFromPos(conn, { id: 'pc1', name: 'Tên POS đè', phone_numbers: ['0912345678'] })

    const { rows } = await testPool.query('SELECT name FROM customer')
    expect(rows[0].name).toBe('Tên Trio')                    // Trio thắng trong 60s
    const audit = await testPool.query(
      `SELECT * FROM audit_log WHERE source='conflict' AND field='name'`)
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0].old_value).toBe('Tên Trio')         // giá trị hai bên đều được lưu
    expect(audit.rows[0].new_value).toBe('Tên POS đè')
  })

  it('sửa của Trio quá 60s → POS thắng trở lại', async () => {
    const c = await createBase()
    await testPool.query(`UPDATE customer SET name='Tên Trio' WHERE id=$1`, [c.id])
    await testPool.query(
      `INSERT INTO audit_log (customer_id, field, old_value, new_value, source, created_at)
       VALUES ($1, 'name', '"x"', '"Tên Trio"', 'user', now() - interval '2 minutes')`, [c.id])
    await upsertCustomerFromPos(conn, { id: 'pc1', name: 'Tên POS đè', phone_numbers: ['0912345678'] })
    const { rows } = await testPool.query('SELECT name FROM customer')
    expect(rows[0].name).toBe('Tên POS đè')
  })

  it('chỉ trường bị conflict được giữ — trường khác POS vẫn cập nhật', async () => {
    const c = await createBase()
    await testPool.query(`UPDATE customer SET name='Tên Trio' WHERE id=$1`, [c.id])
    await testPool.query(
      `INSERT INTO audit_log (customer_id, field, new_value, source)
       VALUES ($1, 'name', '"Tên Trio"', 'user')`, [c.id])
    await upsertCustomerFromPos(conn, {
      id: 'pc1', name: 'Tên POS đè', gender: 'male', phone_numbers: ['0912345678']
    })
    const { rows } = await testPool.query('SELECT name, gender FROM customer')
    expect(rows[0].name).toBe('Tên Trio')
    expect(rows[0].gender).toBe('male')                      // trường không conflict vẫn vào
  })

  it('số liệu POS (purchased_amount…) luôn cập nhật bất kể conflict', async () => {
    const c = await createBase()
    await testPool.query(
      `INSERT INTO audit_log (customer_id, field, new_value, source)
       VALUES ($1, 'name', '"Tên Trio"', 'user')`, [c.id])
    await upsertCustomerFromPos(conn, {
      id: 'pc1', name: 'X', phone_numbers: ['0912345678'], purchased_amount: 777
    })
    const { rows } = await testPool.query('SELECT pos_purchased_amount FROM customer')
    expect(Number(rows[0].pos_purchased_amount)).toBe(777)
  })
})
