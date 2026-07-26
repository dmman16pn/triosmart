const BASE = 'https://pages.fm/api/public_api/v2'
const RATE = 5            // spec §6.5: 5 req/s cho MỖI page_id

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

export class ChatClient {
  constructor({ pageId, pageAccessToken, base = BASE }) {
    this.pageId = pageId; this.token = pageAccessToken; this.base = base
  }

  async rawGet(path, params = {}) {
    await throttle(this.pageId)
    const url = new URL(`${this.base}/pages/${this.pageId}${path}`)
    url.searchParams.set('page_access_token', this.token)
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v))
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Chat API ${res.status}: ${(await res.text()).slice(0, 500)}`)
    return res.json()
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

  async *fetchPageCustomers({ pageSize = 100 } = {}) {
    for (let page = 1; ; page++) {
      const body = await this.rawGet('/page_customers', { page_number: page, page_size: pageSize })
      const rows = body.data ?? body.customers ?? []
      if (rows.length === 0) return
      yield rows
      if (rows.length < pageSize) return
    }
  }
}
