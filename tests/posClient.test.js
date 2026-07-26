import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import { PosClient } from '../src/pancake/posClient.js'

const client = new PosClient({ shopId: 'shop_1', apiKey: 'k1' })

describe('PosClient', () => {
  afterEach(() => nock.cleanAll())

  it('fetchAllCustomers phân trang bằng page_number tới khi hết', async () => {
    nock('https://pos.pages.fm')
      .get('/api/v1/shops/shop_1/customers')
      .query(q => q.page_number === '1' && q.api_key === 'k1')
      .reply(200, { success: true, data: [{ id: 'a' }, { id: 'b' }] })
    nock('https://pos.pages.fm')
      .get('/api/v1/shops/shop_1/customers')
      .query(q => q.page_number === '2')
      .reply(200, { success: true, data: [] })

    const out = []
    for await (const batch of client.fetchAllCustomers({ pageSize: 2 })) out.push(...batch)
    expect(out.map(c => c.id)).toEqual(['a', 'b'])
  })

  it('hỗ trợ start_time_updated_at cho nạp bù', async () => {
    const scope = nock('https://pos.pages.fm')
      .get('/api/v1/shops/shop_1/customers')
      .query(q => q.start_time_updated_at === '1753500000')
      .reply(200, { success: true, data: [] })
    for await (const _ of client.fetchAllCustomers({ sinceEpoch: 1753500000 })) { void _ }
    expect(scope.isDone()).toBe(true)
  })

  it('HTTP 500 → throw kèm status và body', async () => {
    nock('https://pos.pages.fm').get(/.*/).query(true).reply(500, 'boom')
    await expect(async () => {
      for await (const _ of client.fetchAllCustomers()) { void _ }
    }).rejects.toThrow(/500/)
  })
})
