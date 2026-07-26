import jwt from 'jsonwebtoken'
import { query } from '../db.js'
import { config } from '../config.js'

export function requireAuth(req, res, next) {
  const header = req.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' })
  try {
    req.user = jwt.verify(token, config.jwtSecret)
    next()
  } catch {
    res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn' })
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Không có quyền thực hiện thao tác này' })
    }
    next()
  }
}

// Phạm vi của staff (spec §3.2): giới hạn theo connection được gán.
// Đọc từ DB mỗi request (không tin connection_ids trong JWT 8h — đổi phân quyền có hiệu lực ngay).
export async function staffConnectionIds(req) {
  if (req.user.role !== 'staff') return null    // null = không giới hạn
  const { rows } = await query('SELECT connection_ids FROM app_user WHERE id=$1', [req.user.sub])
  const ids = rows[0]?.connection_ids ?? []
  return ids.length ? ids : null                // chưa gán nguồn nào → thấy tất cả (quyết định v1)
}

// Kiểm tra staff có được đụng vào khách này không (dùng cho GET /:id và PATCH /:id)
export async function assertCustomerInScope(req, customerId) {
  const scope = await staffConnectionIds(req)
  if (!scope) return true
  const { rows } = await query(
    `SELECT 1 FROM customer_identity WHERE customer_id=$1 AND connection_id = ANY($2) LIMIT 1`,
    [customerId, scope])
  return rows.length > 0
}
