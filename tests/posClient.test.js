import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import { PosClient } from '../src/pancake/posClient.js'

const client = new PosClient({ shopId: 'shop_1', apiKey: 'k1' })
const PATH = '/api/v1/shops/shop_1/customers'

describe('PosClient — phân trang cửa sổ (Pancake lặp dữ liệu từ trang >100)', () => {
  afterEach(() => nock.cleanAll())

  it('full sync lọc theo inserted_at, phân trang trong cửa sổ tới hết', async () => {
    nock('https://pos.pages.fm').get(PATH)
      .query(q => q.page_number === '1' && q.api_key === 'k1' && q.start_time_inserted_at && q.end_time_inserted_at)
      .reply(200, { success: true, total_entries: 3, data: [{ id: 'a' }, { id: 'b' }] })
    nock('https://pos.pages.fm').get(PATH)
      .query(q => q.page_number === '2')
      .reply(200, { success: true, total_entries: 3, data: [{ id: 'c' }] })

    const out = []
    for await (const batch of client.fetchAllCustomers({ pageSize: 2 })) out.push(...batch)
    expect(out.map(c => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('cửa sổ vượt 10k dòng → tự chia đôi rồi lấy đủ từ hai nửa', async () => {
    const seen = []
    nock('https://pos.pages.fm').persist().get(PATH).query(true)
      .reply(200, function () {
        const u = new URL(this.req.path, 'https://x')
        const s = Number(u.searchParams.get('start_time_inserted_at'))
        const e = Number(u.searchParams.get('end_time_inserted_at'))
        seen.push([s, e])
        if (e - s > 200_000_000) return { success: true, total_entries: 20000, data: [{ id: 'đừng-lấy' }] }
        return { success: true, total_entries: 1, data: [{ id: `w${s}` }] }
      })

    const out = []
    for await (const batch of client.fetchAllCustomers({ pageSize: 100 })) out.push(...batch)
    expect(out.every(c => c.id.startsWith('w'))).toBe(true)     // không nuốt dữ liệu của cửa sổ quá to
    expect(out.length).toBeGreaterThanOrEqual(2)                 // đã chia thành nhiều cửa sổ con
  })

  it('server lặp lại trang (bug thật của Pancake) → dừng, không lặp vô hạn', async () => {
    nock('https://pos.pages.fm').get(PATH)
      .query(q => q.page_number === '1')
      .reply(200, { success: true, total_entries: 400, data: [{ id: 'x1' }, { id: 'x2' }] })
    nock('https://pos.pages.fm').persist().get(PATH)
      .query(q => Number(q.page_number) >= 2)
      .reply(200, { success: true, total_entries: 400, data: [{ id: 'x1' }, { id: 'x2' }] })  // lặp y hệt

    const out = []
    for await (const batch of client.fetchAllCustomers({ pageSize: 2 })) out.push(...batch)
    expect(out.length).toBe(2)                                   // chỉ lấy trang thật, rồi dừng
  })

  it('nạp bù (sinceEpoch) lọc theo updated_at', async () => {
    const scope = nock('https://pos.pages.fm').get(PATH)
      .query(q => q.start_time_updated_at === '1753500000' && q.end_time_updated_at)
      .reply(200, { success: true, total_entries: 0, data: [] })
    for await (const _ of client.fetchAllCustomers({ sinceEpoch: 1753500000 })) { void _ }
    expect(scope.isDone()).toBe(true)
  })

  it('HTTP 500 → throw kèm status (không retry 5xx)', async () => {
    nock('https://pos.pages.fm').get(/.*/).query(true).reply(500, 'boom')
    await expect(async () => {
      for await (const _ of client.fetchAllCustomers()) { void _ }
    }).rejects.toThrow(/500/)
  })
})
