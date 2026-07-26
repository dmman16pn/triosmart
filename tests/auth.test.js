import { describe, it, expect, beforeEach } from 'vitest'
import { testPool, resetDb } from './helpers/db.js'
import request from 'supertest'
import { hashPassword, verifyPassword } from '../src/core/password.js'
import { createApiApp } from '../src/api/app.js'

const app = createApiApp()

export async function seedUser(role = 'admin', extra = {}) {
  const { rows } = await testPool.query(
    `INSERT INTO app_user (email, password_hash, name, role, connection_ids)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [extra.email ?? `${role}@test.vn`, hashPassword('matkhau123'),
     extra.name ?? `User ${role}`, role, extra.connection_ids ?? []])
  return rows[0]
}

export async function loginAs(role = 'admin', extra = {}) {
  await seedUser(role, extra)
  const res = await request(app).post('/api/auth/login')
    .send({ email: extra.email ?? `${role}@test.vn`, password: 'matkhau123' })
  return res.body.token
}

describe('password', () => {
  it('hash rồi verify đúng, sai mật khẩu trả false', () => {
    const h = hashPassword('abc123')
    expect(h).not.toContain('abc123')
    expect(verifyPassword('abc123', h)).toBe(true)
    expect(verifyPassword('abc124', h)).toBe(false)
  })
})

describe('auth API', () => {
  beforeEach(resetDb)

  it('login đúng → token + thông tin user, không lộ password_hash', async () => {
    await seedUser('admin')
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'admin@test.vn', password: 'matkhau123' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeTruthy()
    expect(res.body.user.role).toBe('admin')
    expect(res.body.user.password_hash).toBeUndefined()
  })

  it('login sai mật khẩu → 401', async () => {
    await seedUser('admin')
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'admin@test.vn', password: 'sai' })
    expect(res.status).toBe(401)
  })

  it('user bị khóa (active=false) → 401', async () => {
    const u = await seedUser('admin')
    await testPool.query('UPDATE app_user SET active=false WHERE id=$1', [u.id])
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'admin@test.vn', password: 'matkhau123' })
    expect(res.status).toBe(401)
  })

  it('route bảo vệ: không token → 401, token hợp lệ → 200', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401)
    const token = await loginAs('staff')
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.role).toBe('staff')
  })

  it('requireRole: staff gọi route admin → 403', async () => {
    const token = await loginAs('staff')
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})
