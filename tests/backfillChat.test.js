import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import { testPool, resetDb, seedConnection } from './helpers/db.js'
import { encryptCredential } from '../src/core/credentials.js'
import { upsertCustomerFromPos } from '../src/core/upsert.js'
import { backfillChat } from '../src/scheduler/backfillChat.js'

describe('backfillChat', () => {
  let conn
  beforeEach(async () => {
    await resetDb()
    conn = await seedConnection('chat')
    await testPool.query('UPDATE connection SET credential_encrypted=$2 WHERE id=$1',
      [conn.id, encryptCredential({ page_access_token: 't1' })])
  })
  afterEach(() => nock.cleanAll())

  it('kéo page_customers + conversations, ghép phone với khách POS có sẵn, ghi sync_log', async () => {
    const pos = await seedConnection('pos')
    await upsertCustomerFromPos(pos, { id: 'pc1', name: 'Khách POS', phone_numbers: ['0912345678'] })

    // page_customers thực tế nằm ở v1, bắt buộc since/until, key trả về là "customers"
    nock('https://pages.fm')
      .get('/api/public_api/v1/pages/page_1/page_customers')
      .query(q => q.page_number === '1' && q.since && q.until)
      .reply(200, { success: true, customers: [
        { psid: 'ps1', name: 'Khách POS bên chat', phone_numbers: ['84912345678'] },
        { psid: 'ps2', name: 'Khách chat mới', phone_numbers: [] }
      ] })
    nock('https://pages.fm').persist()
      .get('/api/public_api/v1/pages/page_1/page_customers')
      .query(true)
      .reply(200, { success: true, customers: [] })
    nock('https://pages.fm')
      .get('/api/public_api/v2/pages/page_1/conversations')
      .query(q => !q.last_conversation_id)
      .reply(200, { success: true, conversations: [
        { id: 'cv1', type: 'INBOX', customers: [{ psid: 'ps1' }],
          updated_at: '2026-07-25T03:00:00Z', snippet: 'xin chào' }
      ] })
    nock('https://pages.fm')
      .get('/api/public_api/v2/pages/page_1/conversations')
      .query(q => q.last_conversation_id === 'cv1')
      .reply(200, { success: true, conversations: [] })

    await backfillChat(conn.id)

    // ps1 trùng phone → ghép vào khách POS, ps2 tạo mới → tổng 2 hồ sơ
    expect((await testPool.query('SELECT count(*) FROM customer')).rows[0].count).toBe('2')
    const idents = await testPool.query(
      `SELECT external_id FROM customer_identity WHERE source_type='chat' ORDER BY external_id`)
    expect(idents.rows.map(r => r.external_id)).toEqual(['ps1', 'ps2'])
    const conv = (await testPool.query('SELECT * FROM conversation')).rows
    expect(conv).toHaveLength(1)
    expect(conv[0].last_message_snippet).toBe('xin chào')
    const logs = await testPool.query(`SELECT entity FROM sync_log ORDER BY id`)
    expect(logs.rows.map(r => r.entity)).toEqual(['chat_customers', 'conversations'])
  })

  it('API lỗi → sync_log count_fail > 0, không throw', async () => {
    nock('https://pages.fm').get(/.*/).query(true).reply(500, 'x').persist()
    await backfillChat(conn.id)
    const logs = (await testPool.query('SELECT * FROM sync_log')).rows
    expect(logs.some(l => l.count_fail > 0)).toBe(true)
  })
})
