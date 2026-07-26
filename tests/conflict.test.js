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

// Lỗi THẬT gặp trên production 26/07/2026: webhook POS báo khách đổi sang số điện thoại
// đang thuộc hồ sơ khác → vỡ ràng buộc UNIQUE, sự kiện webhook chết và mất dữ liệu.
describe('SĐT chuyển sang hồ sơ khác (spec §7.2 — cùng số là cùng người)', () => {
  beforeEach(resetDb)

  it('gộp hai hồ sơ thay vì ném lỗi trùng khoá', async () => {
    const conn = await seedConnection('pos')

    // Hồ sơ A: khách chat, đã có số 0912345678
    const { rows: [a] } = await testPool.query(
      `INSERT INTO customer (name, phone_normalized) VALUES ('Khách Chat','0912345678') RETURNING *`)
    await testPool.query(
      `INSERT INTO customer_identity (customer_id, source_type, connection_id, external_id, match_method, confidence)
       VALUES ($1,'chat',$2,'psid-x','phone',100)`, [a.id, conn.id])

    // Hồ sơ B: khách POS pos-9, ban đầu chưa có số
    await upsertCustomerFromPos(conn, { id: 'pos-9', name: 'Khách POS' })
    const before = await testPool.query('SELECT count(*)::int n FROM customer')
    expect(before.rows[0].n).toBe(2)

    // POS cập nhật: khách pos-9 nay dùng đúng số của hồ sơ A
    await upsertCustomerFromPos(conn, { id: 'pos-9', name: 'Khách POS', phone_numbers: ['0912345678'] })

    const after = await testPool.query('SELECT id, name, phone_normalized FROM customer')
    expect(after.rows).toHaveLength(1)                       // đã gộp, không còn 2 hồ sơ
    expect(after.rows[0].phone_normalized).toBe('0912345678')

    // Cả hai danh tính đều nằm trên hồ sơ còn lại
    const ids = await testPool.query(
      'SELECT source_type, external_id FROM customer_identity WHERE customer_id=$1 ORDER BY external_id',
      [after.rows[0].id])
    expect(ids.rows.map(r => r.external_id)).toEqual(['pos-9', 'psid-x'])
  })

  it('số điện thoại của chính hồ sơ đó thì cập nhật bình thường, không gộp', async () => {
    const conn = await seedConnection('pos')
    await upsertCustomerFromPos(conn, { id: 'pos-10', name: 'A', phone_numbers: ['0912345670'] })
    await upsertCustomerFromPos(conn, { id: 'pos-10', name: 'A sửa', phone_numbers: ['0912345670'] })
    const { rows } = await testPool.query('SELECT name, phone_normalized FROM customer')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'A sửa', phone_normalized: '0912345670' })
  })
})
