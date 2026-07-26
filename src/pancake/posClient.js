const BASE = 'https://pos.pages.fm/api/v1'
const TIMEOUT_MS = 30000
const MAX_RETRY = 5
const sleep = ms => new Promise(r => setTimeout(r, ms))

export class PosClient {
  constructor({ shopId, apiKey, base = BASE }) {
    this.shopId = shopId; this.apiKey = apiKey; this.base = base
  }

  // Timeout bắt buộc (fetch mặc định treo vô hạn — sync 10k khách từng đứng im vì 1 request kẹt)
  // + tự thử lại khi 429/timeout/lỗi mạng.
  async #get(path, params = {}) {
    const url = new URL(`${this.base}/shops/${this.shopId}${path}`)
    url.searchParams.set('api_key', this.apiKey)
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v))
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
        if (res.status === 429 && attempt < MAX_RETRY) {   // 5xx KHÔNG retry — thường là lỗi vĩnh viễn, nạp bù giờ sau sẽ vá
          await sleep(3000 * (attempt + 1)); continue
        }
        if (!res.ok) throw new Error(`POS API ${res.status}: ${(await res.text()).slice(0, 500)}`)
        return res.json()
      } catch (e) {
        const transient = e.name === 'TimeoutError' || e.name === 'AbortError' || e.code === 'UND_ERR'
          || String(e.message).includes('fetch failed')
        if (transient && attempt < MAX_RETRY) { await sleep(3000 * (attempt + 1)); continue }
        throw e
      }
    }
  }

  // Phân trang page_number/page_size — ĐÚNG cho customers & orders; endpoint khác phải tra lại spec (§6.5).
  async *#paginate(path, extraParams = {}, pageSize = 100) {
    for (let page = 1; ; page++) {
      const body = await this.#get(path, { ...extraParams, page_number: page, page_size: pageSize })
      const rows = body.data ?? []
      if (rows.length === 0) return
      yield rows
      if (rows.length < pageSize) return
    }
  }

  fetchAllCustomers({ pageSize = 100, sinceEpoch = null } = {}) {
    return this.#paginate('/customers',
      sinceEpoch ? { start_time_updated_at: sinceEpoch } : {}, pageSize)
  }

  fetchAllOrders({ pageSize = 100, sinceEpoch = null } = {}) {
    return this.#paginate('/orders',
      sinceEpoch ? { updateStatus: 'updated_at', startDateTime: sinceEpoch } : {}, pageSize)
  }

  updateCustomer(customerId, fields) {           // dùng ở Plan 2 (ghi ngược)
    const url = new URL(`${this.base}/shops/${this.shopId}/customers/${customerId}`)
    url.searchParams.set('api_key', this.apiKey)
    return fetch(url, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer: fields })
    }).then(async res => {
      if (!res.ok) throw new Error(`POS PUT ${res.status}: ${(await res.text()).slice(0, 500)}`)
      return res.json()
    })
  }
}
