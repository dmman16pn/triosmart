import jwt from 'jsonwebtoken'
import { query } from '../db.js'
import { config } from '../config.js'

// Cache ngắn để không phải truy vấn app_user ở MỌI request mà vẫn phản ứng nhanh
// khi admin khoá tài khoản / đổi vai trò (tối đa trễ 30 giây).
const userCache = new Map()   // id -> { at, row }
const USER_TTL_MS = 30_000
export function clearUserCache() { userCache.clear() }

async function loadUser(id) {
  const hit = userCache.get(id)
  if (hit && Date.now() - hit.at < USER_TTL_MS) return hit.row
  const { rows } = await query(
    'SELECT id, role, active, connection_ids, token_valid_from FROM app_user WHERE id=$1', [id])
  const row = rows[0] ?? null
  userCache.set(id, { at: Date.now(), row })
  return row
}

export async function requireAuth(req, res, next) {
  const header = req.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' })
  let claims
  try {
    claims = jwt.verify(token, config.jwtSecret)
  } catch {
    return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn' })
  }
  try {
    // Vai trò và trạng thái LẤY TỪ DB, không tin claim trong token: sa thải nhân viên hoặc
    // hạ quyền admin phải có hiệu lực ngay, không đợi token 8h hết hạn.
    const user = await loadUser(claims.sub)
    if (!user || !user.active) {
      return res.status(401).json({ error: 'Tài khoản đã bị vô hiệu hoá' })
    }
    // Đổi mật khẩu / thu hồi phiên → mọi token phát hành trước mốc này hết hiệu lực
    if (user.token_valid_from && claims.iat != null &&
        claims.iat < Math.floor(new Date(user.token_valid_from).getTime() / 1000)) {
      return res.status(401).json({ error: 'Phiên đã bị thu hồi, hãy đăng nhập lại' })
    }
    req.user = { ...claims, role: user.role }
    next()
  } catch (e) {
    console.error('[auth] không kiểm tra được tài khoản:', e.message)
    res.status(503).json({ error: 'Hệ thống bận, thử lại sau' })
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
  // FAIL-CLOSED: staff chưa được gán nguồn nào thì KHÔNG thấy khách nào.
  // (v1 từng cho thấy tất cả — sai lầm khi app ra internet: mọi tài khoản mới tạo,
  //  chưa kịp cấu hình, mặc định xem được toàn bộ dữ liệu khách.)
  return rows[0]?.connection_ids ?? []
}

// Giao phạm vi cho phép với bộ lọc do client gửi — client KHÔNG được mở rộng phạm vi
export function intersectScope(scope, requestedConnectionId) {
  if (scope === null) return requestedConnectionId ? [requestedConnectionId] : null
  if (!requestedConnectionId) return scope
  return scope.includes(requestedConnectionId) ? [requestedConnectionId] : []
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
