import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import request from 'supertest'
import { testPool, resetDb, seedConnection } from './helpers/db.js'
import { upsertCustomerFromPos } from '../src/core/upsert.js'
import { findOrCreateCustomer } from '../src/core/matcher.js'
import { createApiApp } from '../src/api/app.js'
import { hashPassword } from '../src/core/password.js'

const app = createApiApp()

async function seedUser(role, connectionIds = []) {
  const email = `${role}-${Math.random().toString(36).slice(2, 8)}@t.vn`
  await testPool.query(
    `INSERT INTO app_user (email, password_hash, name, role, connection_ids)
     VALUES ($1,$2,$3,$4,$5)`,
    [email, hashPassword('mk123456'), role, role, connectionIds])
  const res = await request(app).post('/api/auth/login').send({ email, password: 'mk123456' })
  return res.body.token
}

describe('API admin', () => {
  beforeEach(resetDb)
  afterEach(() => nock.cleanAll())

  it('POST /connections mã hóa credential, response không lộ credential', async () => {
    const token = await seedUser('admin')
    const res = await request(app).post('/api/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'pos', name: 'Shop A', shop_id: 's1', credential: { api_key: 'bimat123' } })
    expect(res.status).toBe(201)
    expect(JSON.stringify(res.body)).not.toContain('bimat123')
    expect(res.body.has_credential).toBe(true)
    const { rows } = await testPool.query('SELECT credential_encrypted FROM connection')
    expect(rows[0].credential_encrypted).not.toContain('bimat123')
  })

  it('POST /connections/:id/test gọi thật API POS, trả kết quả thật', async () => {
    const token = await seedUser('admin')
    const created = await request(app).post('/api/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'pos', name: 'Shop A', shop_id: 'shop_1', credential: { api_key: 'k1' } })
    nock('https://pos.pages.fm').get('/api/v1/shops/shop_1/customers').query(true)
      .reply(200, { success: true, data: [{ id: 'x', name: 'Khách Test' }] })
    const res = await request(app).post(`/api/connections/${created.body.id}/test`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.sample_customer).toBe('Khách Test')
  })

  it('test kết nối lỗi → 502 + connection chuyển error', async () => {
    const token = await seedUser('admin')
    const created = await request(app).post('/api/connections')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'pos', name: 'Shop A', shop_id: 'shop_1', credential: { api_key: 'k1' } })
    nock('https://pos.pages.fm').get(/.*/).query(true).reply(401, 'invalid key')
    const res = await request(app).post(`/api/connections/${created.body.id}/test`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(502)
    const { rows } = await testPool.query('SELECT status FROM connection')
    expect(rows[0].status).toBe('error')
  })

  it('staff không được xem connections → 403', async () => {
    const token = await seedUser('staff')
    const res = await request(app).get('/api/connections').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  it('merge-queue: list + resolve merge, hàng đợi giữ nguyên sau khi hồ sơ bị xóa', async () => {
    const token = await seedUser('manager')
    const pos = await seedConnection('pos')
    const chat = await seedConnection('chat')
    await findOrCreateCustomer({ phoneNormalized: null, name: 'Trùng', sourceType: 'pos', connectionId: pos.id, externalId: 'p1' })
    await findOrCreateCustomer({ phoneNormalized: null, name: 'Trùng', sourceType: 'chat', connectionId: chat.id, externalId: 'c1' })

    const list = await request(app).get('/api/merge-queue').set('Authorization', `Bearer ${token}`)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].name_a).toBe('Trùng')

    const res = await request(app).post(`/api/merge-queue/${list.body[0].id}/resolve`)
      .set('Authorization', `Bearer ${token}`).send({ action: 'merge' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('merged')
    expect(res.body.mergeAuditId).toBeTruthy()
    expect((await testPool.query('SELECT count(*) FROM customer')).rows[0].count).toBe('1')

    // undo trong 24h
    const undo = await request(app).post(`/api/merge/undo/${res.body.mergeAuditId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(undo.status).toBe(200)
    expect((await testPool.query('SELECT count(*) FROM customer')).rows[0].count).toBe('2')
  })

  it('webhook-events retry: error → pending', async () => {
    const token = await seedUser('admin')
    await testPool.query(
      `INSERT INTO webhook_event (source, event_type, payload, status, error)
       VALUES ('pos','orders','{}','error','x')`)
    const { rows } = await testPool.query('SELECT id FROM webhook_event')
    const res = await request(app).post(`/api/webhook-events/${rows[0].id}/retry`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect((await testPool.query('SELECT status FROM webhook_event')).rows[0].status).toBe('pending')
  })

  it('users CRUD: tạo, trùng email 409, khóa tài khoản', async () => {
    const token = await seedUser('admin')
    const create = await request(app).post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'nv1@t.vn', password: 'mk123456', name: 'NV1', role: 'staff' })
    expect(create.status).toBe(201)
    expect(create.body.password_hash).toBeUndefined()

    const dup = await request(app).post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'nv1@t.vn', password: 'mk123456', name: 'NV1', role: 'staff' })
    expect(dup.status).toBe(409)

    const lock = await request(app).patch(`/api/users/${create.body.id}`)
      .set('Authorization', `Bearer ${token}`).send({ active: false })
    expect(lock.body.active).toBe(false)
  })

  it('settings rfm: GET trả ngưỡng, PUT cập nhật + kích hoạt recompute', async () => {
    const token = await seedUser('admin')
    const get = await request(app).get('/api/settings/rfm').set('Authorization', `Bearer ${token}`)
    expect(get.body.vip_amount).toBe(5000000)
    const put = await request(app).put('/api/settings/rfm')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...get.body, vip_amount: 1000000 })
    expect(put.status).toBe(200)
    const { rows } = await testPool.query(`SELECT value FROM setting WHERE key='rfm'`)
    expect(rows[0].value.vip_amount).toBe(1000000)
  })

  it('dashboard: staff bị chặn 403, manager thấy đủ chỉ số kể cả phone_valid_rate', async () => {
    const pos = await seedConnection('pos')
    await upsertCustomerFromPos(pos, { id: 'd1', name: 'A', phone_numbers: ['0911111111'], purchased_amount: 100 })
    await upsertCustomerFromPos(pos, { id: 'd2', name: 'B', phone_numbers: ['xyz'] })

    const staff = await seedUser('staff')
    expect((await request(app).get('/api/dashboard').set('Authorization', `Bearer ${staff}`)).status).toBe(403)

    const manager = await seedUser('manager')
    const res = await request(app).get('/api/dashboard').set('Authorization', `Bearer ${manager}`)
    expect(res.status).toBe(200)
    expect(res.body.total_customers).toBe(2)
    expect(res.body.phone_valid_rate).toBe(0.5)          // spec §10.1
    expect(res.body.total_revenue).toBe(100)
    expect(Array.isArray(res.body.connections)).toBe(true)
  })

  it('audit-logs chỉ đọc: không tồn tại DELETE endpoint', async () => {
    const token = await seedUser('admin')
    const res = await request(app).delete('/api/audit-logs/1').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
})
