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

  // Phục vụ frontend đã build + fallback SPA
  app.use(express.static(distDir))
  app.get(/^\/(?!api|hooks).*/, (_req, res, next) => {
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
