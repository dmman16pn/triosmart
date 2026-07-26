import { describe, it, expect, beforeEach } from 'vitest'
import { testPool, resetDb } from './helpers/db.js'
import request from 'supertest'
import { createApp } from '../src/receiver/app.js'

const app = createApp()
const SECRET = process.env.WEBHOOK_SECRET

describe('webhook receiver', () => {
  beforeEach(resetDb)

  it('POST /hooks/pos ghi thô và trả 200', async () => {
    const payload = { event: 'customers', data: { id: 'c1' } }
    const res = await request(app).post('/hooks/pos')
      .set('X-Trio-Secret', SECRET).send(payload)
    expect(res.status).toBe(200)
    const { rows } = await testPool.query('SELECT * FROM webhook_event')
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('pos')
    expect(rows[0].status).toBe('pending')
    expect(rows[0].payload).toEqual(payload)
  })

  it('POST /hooks/chat ghi source=chat', async () => {
    const res = await request(app).post('/hooks/chat')
      .set('X-Trio-Secret', SECRET).send({ event_type: 'messaging' })
    expect(res.status).toBe(200)
    const { rows } = await testPool.query("SELECT * FROM webhook_event WHERE source='chat'")
    expect(rows).toHaveLength(1)
  })

  it('sai secret: vẫn 200 nhưng đánh dấu skipped, không xử lý', async () => {
    const res = await request(app).post('/hooks/pos')
      .set('X-Trio-Secret', 'sai').send({ a: 1 })
    expect(res.status).toBe(200)
    expect(res.body.ignored).toBe(true)
    const { rows } = await testPool.query('SELECT status FROM webhook_event')
    expect(rows[0].status).toBe('skipped')
  })

  it('chat: secret nằm trong URL (không có header) vẫn hợp lệ', async () => {
    const res = await request(app).post(`/hooks/chat/${SECRET}`).send({ event_type: 'messaging' })
    expect(res.status).toBe(200)
    expect(res.body.ignored).toBeUndefined()
    const { rows } = await testPool.query('SELECT source, status FROM webhook_event')
    expect(rows[0]).toMatchObject({ source: 'chat', status: 'pending' })
  })

  it('payload không phải JSON hợp lệ: vẫn trả 200', async () => {
    const res = await request(app).post('/hooks/pos')
      .set('X-Trio-Secret', SECRET)
      .set('Content-Type', 'application/json').send('{{{')
    expect(res.status).toBe(200)
  })

  it('GET /healthz trả 200', async () => {
    const res = await request(app).get('/healthz')
    expect(res.status).toBe(200)
  })
})
