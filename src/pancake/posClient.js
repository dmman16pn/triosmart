const BASE = 'https://pos.pages.fm/api/v1'

export class PosClient {
  constructor({ shopId, apiKey, base = BASE }) {
    this.shopId = shopId; this.apiKey = apiKey; this.base = base
  }

  async #get(path, params = {}) {
    const url = new URL(`${this.base}/shops/${this.shopId}${path}`)
    url.searchParams.set('api_key', this.apiKey)
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v))
    const res = await fetch(url)
    if (!res.ok) throw new Error(`POS API ${res.status}: ${(await res.text()).slice(0, 500)}`)
    return res.json()
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
