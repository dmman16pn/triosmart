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

  // ĐỐI CHIẾU THỰC TẾ 26/07/2026: POS trả LẶP LẠI cùng dữ liệu từ trang >100
  // (trần phân trang 10.000 dòng, vẫn echo đúng page_number) → phân trang phẳng
  // thành vòng lặp vô hạn với shop lớn. Bắt buộc quét theo CỬA SỔ THỜI GIAN,
  // dùng total_entries để tự chia đôi cửa sổ nào vượt trần.
  async *#paginateWindowed(path, { sinceKey, untilKey, since, until, pageSize = 100, extra = {} }) {
    const MIN_WINDOW = 3600                       // không chia nhỏ hơn 1 giờ
    const CAP = 10000
    const stack = [[since, until]]
    while (stack.length) {
      const [s, u] = stack.pop()
      const win = { ...extra, [sinceKey]: s, [untilKey]: u }
      const first = await this.#get(path, { ...win, page_number: 1, page_size: pageSize })
      const total = first.total_entries ?? null
      if (total != null && total > CAP && (u - s) > MIN_WINDOW) {
        const mid = Math.floor((s + u) / 2)
        stack.push([s, mid], [mid, u])
        continue
      }
      let rows = first.data ?? []
      if (rows.length === 0) continue
      yield rows
      let prevFirstId = rows[0]?.id
      const maxPages = total != null ? Math.ceil(total / pageSize) : 100
      for (let page = 2; page <= Math.min(maxPages, 100); page++) {
        const body = await this.#get(path, { ...win, page_number: page, page_size: pageSize })
        rows = body.data ?? []
        if (rows.length === 0) break
        if (rows[0]?.id != null && rows[0].id === prevFirstId) break   // server lặp trang → dừng
        prevFirstId = rows[0]?.id
        yield rows
        if (rows.length < pageSize) break
      }
    }
  }

  // FROM_EPOCH 2015; until = now + 3 năm vì dữ liệu POS thật có cả đơn ghi ngày tương lai
  static #range(sinceEpoch) {
    const now = Math.floor(Date.now() / 1000)
    return { since: sinceEpoch ?? Date.UTC(2015, 0, 1) / 1000, until: now + 3 * 365 * 86400 }
  }

  fetchAllCustomers({ pageSize = 100, sinceEpoch = null } = {}) {
    const { since, until } = PosClient.#range(sinceEpoch)
    // full sync lọc theo inserted_at; nạp bù lọc theo updated_at để bắt cả bản ghi sửa
    return sinceEpoch
      ? this.#paginateWindowed('/customers', { sinceKey: 'start_time_updated_at', untilKey: 'end_time_updated_at', since, until, pageSize })
      : this.#paginateWindowed('/customers', { sinceKey: 'start_time_inserted_at', untilKey: 'end_time_inserted_at', since, until, pageSize })
  }

  fetchAllOrders({ pageSize = 100, sinceEpoch = null } = {}) {
    const { since, until } = PosClient.#range(sinceEpoch)
    return this.#paginateWindowed('/orders', {
      sinceKey: 'startDateTime', untilKey: 'endDateTime', since, until, pageSize,
      extra: { updateStatus: sinceEpoch ? 'updated_at' : 'inserted_at' }
    })
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
