import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import request from 'supertest'
import { testPool, resetDb, seedConnection } from './helpers/db.js'
import { encryptCredential } from '../src/core/credentials.js'
import { upsertCustomerFromPos } from '../src/core/upsert.js'
import { processChatEvent } from '../src/worker/processChatEvent.js'
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

async function seedData() {
  const pos = await seedConnection('pos')
  await testPool.query('UPDATE connection SET credential_encrypted=$2 WHERE id=$1',
    [pos.id, encryptCredential({ api_key: 'k1' })])
  const chat = await seedConnection('chat')
  await upsertCustomerFromPos(pos, {
    id: 'pc1', name: 'Nguyễn Văn An', phone_numbers: ['0912345678', '0987654321'],
    purchased_amount: 6000000, succeed_order_count: 5,
    last_order_at: new Date(Date.now() - 5 * 86400000).toISOString()
  })
  await processChatEvent(chat, {
    event_type: 'messaging', conversation: { id: 'cv1', type: 'INBOX' },
    customer: { psid: 'ps9', name: 'Trần Chat Riêng' },
    message: { text: 'hỏi giá', inserted_at: new Date().toISOString() }
  })
  return { pos, chat }
}

describe('API /customers', () => {
  beforeEach(async () => { await resetDb(); await seedData() })
  afterEach(() => nock.cleanAll())

  it('danh sách trả rows + total, có identities', async () => {
    const token = await seedUser('admin')
    const res = await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    const an = res.body.rows.find(r => r.name === 'Nguyễn Văn An')
    expect(an.identities.some(i => i.source_type === 'pos')).toBe(true)
  })

  it('tìm theo số phụ (alt_phones) vẫn ra khách', async () => {
    const token = await seedUser('admin')
    const res = await request(app).get('/api/customers?q=0987654321')
      .set('Authorization', `Bearer ${token}`)
    expect(res.body.total).toBe(1)
    expect(res.body.rows[0].name).toBe('Nguyễn Văn An')
  })

  it('tìm theo tên không dấu-một-phần', async () => {
    const token = await seedUser('admin')
    const res = await request(app).get('/api/customers?q=Văn An')
      .set('Authorization', `Bearer ${token}`)
    expect(res.body.total).toBe(1)
  })

  it('lọc theo segment', async () => {
    const token = await seedUser('admin')
    const res = await request(app).get('/api/customers?segment=Khách VIP')
      .set('Authorization', `Bearer ${token}`)
    expect(res.body.total).toBe(1)
    expect(res.body.rows[0].rfm_segment).toBe('Khách VIP')
  })

  it('staff bị giới hạn theo connection được gán (spec 3.2)', async () => {
    const { rows: conns } = await testPool.query(`SELECT id, type FROM connection`)
    const chatConn = conns.find(c => c.type === 'chat')
    const token = await seedUser('staff', [chatConn.id])
    const res = await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`)
    expect(res.body.total).toBe(1)                       // chỉ thấy khách chat
    expect(res.body.rows[0].name).toBe('Trần Chat Riêng')
  })

  it('staff mở hồ sơ khách ngoài phạm vi → 403', async () => {
    const { rows: conns } = await testPool.query(`SELECT id, type FROM connection`)
    const chatConn = conns.find(c => c.type === 'chat')
    const token = await seedUser('staff', [chatConn.id])
    const { rows } = await testPool.query(`SELECT id FROM customer WHERE name='Nguyễn Văn An'`)
    const res = await request(app).get(`/api/customers/${rows[0].id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  it('hồ sơ 360°: customer + identities + timeline', async () => {
    const token = await seedUser('admin')
    const { rows } = await testPool.query(`SELECT id FROM customer WHERE name='Trần Chat Riêng'`)
    const res = await request(app).get(`/api/customers/${rows[0].id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.customer.name).toBe('Trần Chat Riêng')
    expect(res.body.timeline.some(t => t.kind === 'chat')).toBe(true)
  })

  it('PATCH sửa tên: đẩy POS thành công → pushed true', async () => {
    nock('https://pos.pages.fm').put(/.*/).query(true).reply(200, { success: true })
    const token = await seedUser('admin')
    const { rows } = await testPool.query(`SELECT id FROM customer WHERE name='Nguyễn Văn An'`)
    const res = await request(app).patch(`/api/customers/${rows[0].id}`)
      .set('Authorization', `Bearer ${token}`).send({ name: 'Nguyễn Văn An Sửa' })
    expect(res.status).toBe(200)
    expect(res.body.pushed).toBe(true)
  })

  it('PATCH khi Pancake lỗi → pushed false kèm lý do (không nói dối thành công)', async () => {
    nock('https://pos.pages.fm').put(/.*/).query(true).reply(500, 'x')
    const token = await seedUser('admin')
    const { rows } = await testPool.query(`SELECT id FROM customer WHERE name='Nguyễn Văn An'`)
    const res = await request(app).patch(`/api/customers/${rows[0].id}`)
      .set('Authorization', `Bearer ${token}`).send({ name: 'Tên Lỗi' })
    expect(res.status).toBe(200)
    expect(res.body.pushed).toBe(false)
    expect(res.body.error).toBeTruthy()
  })

  it('segments: staff không thấy doanh số, admin thấy', async () => {
    const admin = await seedUser('admin')
    const staff = await seedUser('staff')
    const a = await request(app).get('/api/segments').set('Authorization', `Bearer ${admin}`)
    const s = await request(app).get('/api/segments').set('Authorization', `Bearer ${staff}`)
    const vipA = a.body.find(x => x.segment === 'Khách VIP')
    const vipS = s.body.find(x => x.segment === 'Khách VIP')
    expect(vipA.revenue).toBe(6000000)
    expect(vipS.revenue).toBeNull()
    expect(vipS.count).toBe(1)
  })

  it('my-customers: chỉ khách được gán cho mình', async () => {
    const token = await seedUser('staff')
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
    const { rows } = await testPool.query(`SELECT id FROM customer WHERE name='Nguyễn Văn An'`)
    await testPool.query('UPDATE customer SET assigned_user_id=$2 WHERE id=$1', [rows[0].id, me.body.id])
    const res = await request(app).get('/api/my-customers').set('Authorization', `Bearer ${token}`)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('Nguyễn Văn An')
  })
})
