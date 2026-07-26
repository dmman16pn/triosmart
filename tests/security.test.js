import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { testPool, resetDb, seedConnection } from './helpers/db.js'
import { createApiApp } from '../src/api/app.js'
import { hashPassword } from '../src/core/password.js'
import { config } from '../src/config.js'

const app = createApiApp()

async function mkUser(role, { email, connection_ids = [], password = 'Trio2026xyz' } = {}) {
  const { rows } = await testPool.query(
    `INSERT INTO app_user (email, password_hash, name, role, connection_ids)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [email ?? `${role}-sec@test.vn`, hashPassword(password), `U ${role}`, role, connection_ids])
  return rows[0]
}
async function login(email, password = 'Trio2026xyz') {
  const res = await request(app).post('/api/auth/login').send({ email, password })
  return res.body.token
}

describe('bảo mật — không tái phát các lỗ hổng đã vá', () => {
  beforeEach(resetDb)

  it('token ký bằng khoá đoán được (CREDENTIAL_KEY + "-jwt") KHÔNG vào được', async () => {
    const forged = jwt.sign({ sub: '00000000-0000-0000-0000-000000000001', role: 'admin' },
      `${config.credentialKey}-jwt`, { expiresIn: '1h' })
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${forged}`)
    expect(res.status).toBe(401)
  })

  it('token ký đúng khoá nhưng user không tồn tại → 401 (không tin claim trong token)', async () => {
    const forged = jwt.sign({ sub: '00000000-0000-0000-0000-000000000002', role: 'admin' },
      config.jwtSecret, { expiresIn: '1h' })
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${forged}`)
    expect(res.status).toBe(401)
  })

  it('hạ quyền admin → token cũ mất quyền admin ngay, không đợi hết hạn 8h', async () => {
    const u = await mkUser('admin', { email: 'demote@test.vn' })
    const token = await login('demote@test.vn')
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${token}`)).status).toBe(200)

    await request(app).patch(`/api/users/${u.id}`).set('Authorization', `Bearer ${token}`)
      .send({ role: 'staff' })   // tự hạ quyền bị chặn
    await testPool.query(`UPDATE app_user SET role='staff' WHERE id=$1`, [u.id])
    const { clearUserCache } = await import('../src/api/middleware.js')
    clearUserCache()
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${token}`)).status).toBe(403)
  })

  it('khoá tài khoản → token đang cầm hết hiệu lực ngay', async () => {
    const u = await mkUser('staff', { email: 'fired@test.vn' })
    const token = await login('fired@test.vn')
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200)
    await testPool.query('UPDATE app_user SET active=false WHERE id=$1', [u.id])
    const { clearUserCache } = await import('../src/api/middleware.js')
    clearUserCache()
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401)
  })

  it('sai mật khẩu nhiều lần → khoá tạm 429, đúng mật khẩu cũng không vào được', async () => {
    await mkUser('admin', { email: 'brute@test.vn' })
    for (let i = 0; i < 8; i++) {
      await request(app).post('/api/auth/login').send({ email: 'brute@test.vn', password: 'sai' })
    }
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'brute@test.vn', password: 'Trio2026xyz' })
    expect(res.status).toBe(429)
    const { rows } = await testPool.query(
      `SELECT count(*)::int n FROM login_attempt WHERE email='brute@test.vn' AND success=false`)
    expect(rows[0].n).toBeGreaterThanOrEqual(8)      // mọi lần thử đều để lại dấu vết
  })

  it('nhân viên KHÔNG vượt được phạm vi bằng ?connection_id=', async () => {
    const a = await seedConnection('pos')
    const b = await seedConnection('chat')
    const { rows: [cust] } = await testPool.query(
      `INSERT INTO customer (name, phone_normalized) VALUES ('Khách nguồn B','0900000001') RETURNING *`)
    await testPool.query(
      `INSERT INTO customer_identity (customer_id, source_type, connection_id, external_id, match_method, confidence)
       VALUES ($1,'chat',$2,'psid-1','phone',100)`, [cust.id, b.id])

    await mkUser('staff', { email: 'scope@test.vn', connection_ids: [a.id] })
    const token = await login('scope@test.vn')
    const res = await request(app).get(`/api/customers?connection_id=${b.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.rows).toHaveLength(0)            // không thấy khách của nguồn không được gán
  })

  it('nhân viên chưa được gán nguồn nào → không thấy khách nào (fail-closed)', async () => {
    const c = await seedConnection('pos')
    const { rows: [cust] } = await testPool.query(
      `INSERT INTO customer (name) VALUES ('Khách bất kỳ') RETURNING *`)
    await testPool.query(
      `INSERT INTO customer_identity (customer_id, source_type, connection_id, external_id, match_method, confidence)
       VALUES ($1,'pos',$2,'pos-1','phone',100)`, [cust.id, c.id])
    await mkUser('staff', { email: 'noscope@test.vn', connection_ids: [] })
    const token = await login('noscope@test.vn')
    const res = await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`)
    expect(res.body.rows).toHaveLength(0)
    expect((await request(app).get(`/api/customers/${cust.id}`)
      .set('Authorization', `Bearer ${token}`)).status).toBe(403)
  })

  it('nhân viên không tự gán khách cho mình / không sửa được phân khúc', async () => {
    const c = await seedConnection('pos')
    const { rows: [cust] } = await testPool.query(
      `INSERT INTO customer (name) VALUES ('Khách của tôi?') RETURNING *`)
    await testPool.query(
      `INSERT INTO customer_identity (customer_id, source_type, connection_id, external_id, match_method, confidence)
       VALUES ($1,'pos',$2,'pos-2','phone',100)`, [cust.id, c.id])
    const u = await mkUser('staff', { email: 'grab@test.vn', connection_ids: [c.id] })
    const token = await login('grab@test.vn')

    const grab = await request(app).patch(`/api/customers/${cust.id}`)
      .set('Authorization', `Bearer ${token}`).send({ assigned_user_id: u.id })
    expect(grab.status).toBe(403)
    const seg = await request(app).patch(`/api/customers/${cust.id}`)
      .set('Authorization', `Bearer ${token}`).send({ rfm_segment: 'VIP' })
    expect(seg.status).toBe(403)

    const { rows } = await testPool.query('SELECT assigned_user_id, rfm_segment FROM customer WHERE id=$1', [cust.id])
    expect(rows[0].assigned_user_id).toBeNull()
  })

  it('custom_fields do người dùng gửi không ghi đè được khoá nhận diện', async () => {
    const { rows: [cust] } = await testPool.query(
      `INSERT INTO customer (name, custom_fields) VALUES ('K', '{"fb_id":"that"}'::jsonb) RETURNING *`)
    await mkUser('admin', { email: 'cf@test.vn' })
    const token = await login('cf@test.vn')
    await request(app).patch(`/api/customers/${cust.id}`).set('Authorization', `Bearer ${token}`)
      .send({ custom_fields: { fb_id: 'gia-mao', ghi_chu: 'ok' } })
    const { rows } = await testPool.query('SELECT custom_fields FROM customer WHERE id=$1', [cust.id])
    expect(rows[0].custom_fields.fb_id).toBe('that')     // không bị ghi đè
    expect(rows[0].custom_fields.ghi_chu).toBe('ok')     // trường thường vẫn ghi được
  })

  it('API trả security header và không cho cache dữ liệu khách', async () => {
    const res = await request(app).get('/api/healthz')
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('?sort= và ?page_size= giá trị lạ không làm sập API', async () => {
    await mkUser('admin', { email: 'q@test.vn' })
    const token = await login('q@test.vn')
    for (const qs of ['sort=constructor', 'page_size=-1', 'page=0', 'page_size=abc', 'sort=__proto__']) {
      const res = await request(app).get(`/api/customers?${qs}`).set('Authorization', `Bearer ${token}`)
      expect(res.status).toBe(200)
    }
  })

  it('lỗi khi sửa khách không lộ thông tin cấu trúc CSDL', async () => {
    const { rows: [cust] } = await testPool.query(`INSERT INTO customer (name) VALUES ('K') RETURNING *`)
    await mkUser('admin', { email: 'err@test.vn' })
    const token = await login('err@test.vn')
    const res = await request(app).patch(`/api/customers/${cust.id}`)
      .set('Authorization', `Bearer ${token}`).send({ date_of_birth: { xấu: true } })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(JSON.stringify(res.body)).not.toMatch(/column|relation|invalid input syntax|customer\./i)
  })

  it('đổi mật khẩu → token cũ bị thu hồi', async () => {
    await mkUser('admin', { email: 'chg@test.vn' })
    const token = await login('chg@test.vn')
    const res = await request(app).post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ current_password: 'Trio2026xyz', new_password: 'KhoaMoi2026abc' })
    expect(res.status).toBe(200)
    const { clearUserCache } = await import('../src/api/middleware.js')
    clearUserCache()
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401)
    expect(await login('chg@test.vn', 'KhoaMoi2026abc')).toBeTruthy()
  })

  it('không được khoá admin cuối cùng', async () => {
    const u = await mkUser('admin', { email: 'last@test.vn' })
    const token = await login('last@test.vn')
    const other = await mkUser('admin', { email: 'other@test.vn' })
    const res = await request(app).patch(`/api/users/${other.id}`)
      .set('Authorization', `Bearer ${token}`).send({ active: false })
    expect(res.status).toBe(200)                       // còn 1 admin khác (chính mình) → cho phép
    const self = await request(app).patch(`/api/users/${u.id}`)
      .set('Authorization', `Bearer ${token}`).send({ active: false })
    expect(self.status).toBe(400)                      // tự khoá mình khi là admin cuối → chặn
  })

  it('không chạy lại được sự kiện webhook do người lạ gửi', async () => {
    await testPool.query(
      `INSERT INTO webhook_event (source, event_type, payload, status)
       VALUES ('pos','customers','{"customer":{"id":"gia-mao"}}'::jsonb,'skipped')`)
    const { rows } = await testPool.query('SELECT id FROM webhook_event')
    await mkUser('admin', { email: 'retry@test.vn' })
    const token = await login('retry@test.vn')
    const res = await request(app).post(`/api/webhook-events/${rows[0].id}/retry`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
    const { rows: after } = await testPool.query('SELECT status FROM webhook_event')
    expect(after[0].status).toBe('skipped')
  })
})
