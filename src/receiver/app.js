import express from 'express'
import { query } from '../db.js'
import { config } from '../config.js'

// Suy ra event_type để worker lọc nhanh; sai cũng không sao — worker đọc payload gốc.
function guessEventType(source, body) {
  if (source === 'pos') return body?.event || (body?.order ? 'orders' : body?.customer ? 'customers' : null)
  return body?.event_type || null
}

export function createApp() {
  const app = express()
  // verify giữ raw body: nếu JSON hỏng vẫn phải trả 200 (không để express trả 400)
  app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf } }))
  app.use((err, req, res, next) => {           // bắt lỗi parse JSON
    if (err.type === 'entity.parse.failed') {
      // Lưu ý: error handler chạy ngoài route matching nên req.params.token không có —
      // chat gửi JSON hỏng qua URL token sẽ bị đánh dấu skipped (raw body vẫn được giữ, có warn).
      req.parseFailed = true; req.body = { _unparsed: req.rawBody?.toString('utf8')?.slice(0, 10000) }
      return handleHook(req, res)
    }
    next(err)
  })

  async function handleHook(req, res) {
    const source = req.path.startsWith('/hooks/pos') ? 'pos' : 'chat'
    // POS xác thực bằng header (webhook_headers, spec §6.4);
    // Chat không cấu hình được header → secret nhúng trong URL đăng ký với Pancake.
    const authentic = req.get('X-Trio-Secret') === config.webhookSecret
      || req.params?.token === config.webhookSecret
    if (!authentic) console.warn(`[receiver] skipped: sai secret, source=${source}`)
    try {
      await query(
        `INSERT INTO webhook_event (source, event_type, payload, status) VALUES ($1,$2,$3,$4)`,
        [source, guessEventType(source, req.body), JSON.stringify(req.body ?? {}),
         authentic ? 'pending' : 'skipped']
      )
    } catch (e) {
      console.error('receiver insert failed', e)   // vẫn trả 200 — thà mất 1 sự kiện (nạp bù vá lại)
    }                                              // còn hơn Pancake treo toàn bộ webhook
    res.status(200).json(authentic ? { ok: true } : { ok: true, ignored: true })
  }

  app.post('/hooks/pos', handleHook)
  app.post('/hooks/chat', handleHook)
  app.post('/hooks/chat/:token', handleHook)
  app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }))
  return app
}
