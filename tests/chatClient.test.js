import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import { ChatClient } from '../src/pancake/chatClient.js'

const client = new ChatClient({ pageId: 'page_1', pageAccessToken: 't1' })

describe('ChatClient', () => {
  afterEach(() => nock.cleanAll())

  it('fetchConversations phân trang bằng last_conversation_id (con trỏ)', async () => {
    nock('https://pages.fm')
      .get('/api/public_api/v2/pages/page_1/conversations')
      .query(q => !q.last_conversation_id)
      .reply(200, { success: true, conversations: [{ id: 'cv1' }, { id: 'cv2' }] })
    nock('https://pages.fm')
      .get('/api/public_api/v2/pages/page_1/conversations')
      .query(q => q.last_conversation_id === 'cv2')
      .reply(200, { success: true, conversations: [] })

    const out = []
    for await (const batch of client.fetchConversations()) out.push(...batch)
    expect(out.map(c => c.id)).toEqual(['cv1', 'cv2'])
  })

  it('giới hạn 5 request/giây cho mỗi page', async () => {
    nock('https://pages.fm').get(/.*/).query(true).times(7)
      .reply(200, { success: true, conversations: [{ id: 'x' }] })
    const t0 = Date.now()
    for (let i = 0; i < 7; i++) await client.rawGet('/conversations')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000)   // request thứ 6-7 phải chờ sang giây sau
  })
})
