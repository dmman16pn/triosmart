import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { authRoutes } from './authRoutes.js'
import { customerRoutes } from './customerRoutes.js'
import { adminRoutes } from './adminRoutes.js'

const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist')

export function createApiApp() {
  const app = express()
  app.use(express.json({ limit: '1mb' }))

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
