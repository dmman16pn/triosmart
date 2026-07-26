const BASE_V2 = 'https://pages.fm/api/public_api/v2'
const BASE_V1 = 'https://pages.fm/api/public_api/v1'
const RATE = 3            // spec nói 5 req/s nhưng thực tế Pancake trả 429 sớm hơn — chạy 3 cho an toàn
const MAX_429_RETRY = 6

const buckets = new Map() // pageId -> { windowStart, count }
async function throttle(pageId) {
  for (;;) {
    const now = Date.now()
    let b = buckets.get(pageId)
    if (!b || now - b.windowStart >= 1000) { b = { windowStart: now, count: 0 }; buckets.set(pageId, b) }
    if (b.count < RATE) { b.count++; return }
    await new Promise(r => setTimeout(r, b.windowStart + 1000 - now))
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

export class ChatClient {
  constructor({ pageId, pageAccessToken, base = BASE_V2, baseV1 = BASE_V1 }) {
    this.pageId = pageId; this.token = pageAccessToken; this.base = base; this.baseV1 = baseV1
  }

  async rawGet(path, params = {}, { v1 = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      await throttle(this.pageId)
      const url = new URL(`${v1 ? this.baseV1 : this.base}/pages/${this.pageId}${path}`)
      url.searchParams.set('page_access_token', this.token)
      for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v))
      let res
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(30000) })
      } catch (e) {
        if (attempt < MAX_429_RETRY) { await sleep(3000 * (attempt + 1)); continue }
        throw e
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_429_RETRY) {
        // Pancake rate limit / lỗi tạm — lùi lại rồi thử tiếp thay vì bỏ dở cả đợt đồng bộ
        await sleep(3000 * (attempt + 1))
        continue
      }
      if (!res.ok) throw new Error(`Chat API ${res.status}: ${(await res.text()).slice(0, 500)}`)
      const body = await res.json()
      if (body?.success === false) throw new Error(`Chat API lỗi: ${JSON.stringify(body).slice(0, 300)}`)
      return body
    }
  }

  // Con trỏ last_conversation_id, tối đa 60 bản/lần (spec §6.5)
  async *fetchConversations() {
    let cursor = null
    for (;;) {
      const body = await this.rawGet('/conversations', cursor ? { last_conversation_id: cursor } : {})
      const rows = body.conversations ?? []
      if (rows.length === 0) return
      yield rows
      cursor = rows[rows.length - 1].id
    }
  }

  // page_customers CHỈ có ở v1 và BẮT BUỘC since/until (đối chiếu thực tế 26/07/2026:
  // v2 trả HTML, since=0 trả 500 — phải quét theo cửa sổ 1 năm từ 2015 tới nay).
  async *fetchPageCustomers({ pageSize = 100, fromYear = 2015 } = {}) {
    const now = Math.floor(Date.now() / 1000)
    const YEAR = 365 * 86400
    for (let since = Date.UTC(fromYear, 0, 1) / 1000; since < now; since += YEAR) {
      const until = Math.min(since + YEAR, now)
      for (let page = 1; ; page++) {
        const body = await this.rawGet('/page_customers',
          { since, until, page_number: page, page_size: pageSize }, { v1: true })
        const rows = body.customers ?? body.data ?? []
        if (rows.length === 0) break
        yield rows
        if (rows.length < pageSize) break
      }
    }
  }
}
