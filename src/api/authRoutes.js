import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { query } from '../db.js'
import { config } from '../config.js'
import { verifyPasswordAsync, burnPasswordTime, hashPassword, assertStrongPassword } from '../core/password.js'
import { requireAuth } from './middleware.js'
import { rateLimit, clientIp } from './rateLimit.js'

export const authRoutes = Router()

const publicUser = u => ({
  id: u.id, email: u.email, name: u.name, role: u.role,
  connection_ids: u.connection_ids, active: u.active,
  must_change_password: u.must_change_password ?? false
})

const MAX_FAILS = 8              // sai liên tiếp trước khi khoá
const LOCK_MINUTES = 15

function logAttempt(req, email, success, reason) {
  return query(
    `INSERT INTO login_attempt (email, ip, user_agent, success, reason) VALUES ($1,$2,$3,$4,$5)`,
    [email, clientIp(req), (req.get('User-Agent') ?? '').slice(0, 300), success, reason]
  ).catch(e => console.error('[auth] không ghi được login_attempt:', e.message))
}

// Chặn dò mật khẩu: theo IP và theo email. Không có lớp này thì với ~40 lần thử/giây
// kẻ tấn công quét được vài triệu mật khẩu mỗi ngày mà không để lại dấu vết.
const perIp = rateLimit({
  limit: 20, windowMs: 15 * 60 * 1000, keyFn: req => `ip:${clientIp(req)}`,
  message: 'Quá nhiều lần đăng nhập từ địa chỉ này, thử lại sau 15 phút'
})
const perEmail = rateLimit({
  limit: 10, windowMs: 15 * 60 * 1000,
  keyFn: req => `em:${String(req.body?.email ?? '').toLowerCase()}`,
  message: 'Quá nhiều lần đăng nhập cho tài khoản này, thử lại sau 15 phút'
})

authRoutes.post('/login', perIp, perEmail, async (req, res) => {
  const email = String(req.body?.email ?? '').toLowerCase().trim()
  const password = String(req.body?.password ?? '')
  const fail = async (reason) => {
    await logAttempt(req, email, false, reason)
    return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' })
  }

  const { rows: [user] } = await query('SELECT * FROM app_user WHERE email=$1', [email])
  if (!user) {
    await burnPasswordTime()          // tốn thời gian như trường hợp có thật → không lộ email nào tồn tại
    return fail('no_user')
  }
  if (!user.active) { await burnPasswordTime(); return fail('inactive') }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await logAttempt(req, email, false, 'locked')
    return res.status(429).json({ error: `Tài khoản tạm khoá do đăng nhập sai nhiều lần. Thử lại sau ${LOCK_MINUTES} phút.` })
  }

  if (!await verifyPasswordAsync(password, user.password_hash)) {
    const fails = (user.failed_login_count ?? 0) + 1
    await query(
      `UPDATE app_user SET failed_login_count=$2::int,
         locked_until = CASE WHEN $2::int >= $3::int
           THEN now() + make_interval(mins => $4::int) ELSE locked_until END
       WHERE id=$1`, [user.id, fails, MAX_FAILS, LOCK_MINUTES])
    return fail(fails >= MAX_FAILS ? 'wrong_password_locked' : 'wrong_password')
  }

  await query(
    `UPDATE app_user SET failed_login_count=0, locked_until=NULL, last_login_at=now() WHERE id=$1`,
    [user.id])
  await logAttempt(req, email, true, null)
  const token = jwt.sign(
    { sub: user.id, role: user.role, name: user.name },
    config.jwtSecret, { expiresIn: config.jwtExpiresIn })
  res.json({ token, user: publicUser(user) })
})

authRoutes.get('/me', requireAuth, async (req, res) => {
  const { rows: [user] } = await query('SELECT * FROM app_user WHERE id=$1', [req.user.sub])
  if (!user) return res.status(401).json({ error: 'Tài khoản không tồn tại' })
  res.json(publicUser(user))
})

// Tự đổi mật khẩu — bắt buộc với tài khoản admin khởi tạo (must_change_password).
// Đổi xong: mọi token cũ (kể cả token đã bị đánh cắp) hết hiệu lực ngay.
authRoutes.post('/change-password', requireAuth, rateLimit({
  limit: 10, windowMs: 15 * 60 * 1000, keyFn: req => `cp:${req.user.sub}`
}), async (req, res) => {
  const { current_password, new_password } = req.body ?? {}
  const { rows: [user] } = await query('SELECT * FROM app_user WHERE id=$1', [req.user.sub])
  if (!user || !user.active) return res.status(401).json({ error: 'Tài khoản không hợp lệ' })
  if (!await verifyPasswordAsync(String(current_password ?? ''), user.password_hash)) {
    await logAttempt(req, user.email, false, 'change_password_wrong_current')
    return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' })
  }
  try { assertStrongPassword(new_password) }
  catch (e) { return res.status(400).json({ error: e.message }) }

  await query(
    `UPDATE app_user SET password_hash=$2, must_change_password=false,
       token_valid_from = now() + interval '1 second' WHERE id=$1`,
    [user.id, hashPassword(String(new_password))])
  res.json({ ok: true, relogin: true })
})
