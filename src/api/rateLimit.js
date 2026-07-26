// Giới hạn tần suất trong bộ nhớ tiến trình — đủ cho triển khai 1 tiến trình API sau Nginx.
// (Nếu sau này chạy nhiều instance thì chuyển bộ đếm sang Postgres/Redis.)
const buckets = new Map()   // key -> { count, resetAt }

function hit(key, limit, windowMs) {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || now >= b.resetAt) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b) }
  b.count++
  if (buckets.size > 10000) {                         // chặn phình bộ nhớ khi bị quét hàng loạt IP
    for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k)
  }
  return { blocked: b.count > limit, retryAfter: Math.ceil((b.resetAt - now) / 1000) }
}

export function resetRateLimit() { buckets.clear() }

// IP thật lấy từ Cloudflare/Nginx; chỉ tin header khi đứng sau proxy của mình (TRUST_PROXY=1)
export function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const cf = req.get('CF-Connecting-IP')
    if (cf) return cf
    const xff = req.get('X-Forwarded-For')
    if (xff) return xff.split(',')[0].trim()
  }
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown'
}

export function rateLimit({ limit, windowMs, keyFn, message }) {
  return (req, res, next) => {
    const { blocked, retryAfter } = hit(keyFn(req), limit, windowMs)
    if (blocked) {
      res.setHeader('Retry-After', String(retryAfter))
      return res.status(429).json({ error: message ?? 'Quá nhiều yêu cầu, thử lại sau ít phút' })
    }
    next()
  }
}
