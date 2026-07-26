import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { query } from '../db.js'
import { config } from '../config.js'
import { verifyPassword } from '../core/password.js'
import { requireAuth } from './middleware.js'

export const authRoutes = Router()

const publicUser = u => ({
  id: u.id, email: u.email, name: u.name, role: u.role,
  connection_ids: u.connection_ids, active: u.active
})

authRoutes.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  const { rows: [user] } = await query('SELECT * FROM app_user WHERE email=$1', [String(email ?? '').toLowerCase()])
  if (!user || !user.active || !verifyPassword(String(password ?? ''), user.password_hash)) {
    return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' })
  }
  const token = jwt.sign(
    { sub: user.id, role: user.role, name: user.name },
    config.jwtSecret, { expiresIn: '8h' })
  res.json({ token, user: publicUser(user) })
})

authRoutes.get('/me', requireAuth, async (req, res) => {
  const { rows: [user] } = await query('SELECT * FROM app_user WHERE id=$1', [req.user.sub])
  if (!user) return res.status(401).json({ error: 'Tài khoản không tồn tại' })
  res.json(publicUser(user))
})
