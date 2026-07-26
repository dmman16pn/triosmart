import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { authRoutes } from './authRoutes.js'
import { customerRoutes } from './customerRoutes.js'
import { adminRoutes } from './adminRoutes.js'
import { rateLimit, clientIp } from './rateLimit.js'

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist')

export function createApiApp() {
  const app = express()
  app.disable('x-powered-by')

  // Security headers (tự viết, không thêm dependency): CSP chặn script lạ nếu có XSS,
  // frame-ancestors chặn clickjacking lên các nút Gộp/Chạy lại của admin.
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; font-src 'self' data:; " +
      "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    next()
  })

  app.use(express.json({ limit: '1mb' }))

  // Dữ liệu khách không được nằm lại trong bất kỳ proxy/CDN nào (app chạy sau Cloudflare)
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })

  // Trần chung cho toàn API — chặn quét/rút dữ liệu hàng loạt bằng token hợp lệ
  app.use('/api', rateLimit({
    limit: 600, windowMs: 60_000,
    keyFn: req => `api:${clientIp(req)}`
  }))

  app.get('/api/healthz', (_req, res) => res.json({ ok: true }))
  app.use('/api/auth', authRoutes)
  app.use('/api', customerRoutes)
  app.use('/api', adminRoutes)

  // Phục vụ frontend đã build + fallback SPA.
  // index.html KHÔNG được cache (asset đổi hash sau mỗi lần build — HTML cũ trỏ file
  // đã xóa sẽ ra trang trắng); asset có hash thì cache dài vô tư.
  app.use(express.static(distDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache')
      else if (filePath.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    }
  }))
  app.get(/^\/(?!api|hooks).*/, (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(distDir, 'index.html'), err => err ? next() : undefined)
  })

  // Lỗi không bắt được → 500 gọn, không lộ stack
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[api] unhandled', err)
    res.status(500).json({ error: 'Lỗi hệ thống' })
  })
  return app
}
