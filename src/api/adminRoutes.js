import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireRole, clearUserCache } from './middleware.js'
import { encryptCredential, decryptCredential } from '../core/credentials.js'
import { hashPassword, assertStrongPassword } from '../core/password.js'
import { PosClient } from '../pancake/posClient.js'
import { ChatClient } from '../pancake/chatClient.js'
import { initialSyncPos } from '../scheduler/initialSync.js'
import { backfillChat } from '../scheduler/backfillChat.js'
import { resolveMergeQueue, undoMerge } from '../core/merge.js'
import { recomputeAll, getRfmThresholds } from '../core/rfm.js'

export const adminRoutes = Router()
adminRoutes.use(requireAuth)

const maskConnection = c => { const { credential_encrypted, ...rest } = c; return { ...rest, has_credential: !!credential_encrypted } }

/* ---------- A2/A3 — Kết nối (admin) ---------- */
adminRoutes.get('/connections', requireRole('admin', 'manager'), async (_req, res) => {
  const { rows } = await query('SELECT * FROM connection ORDER BY created_at')
  res.json(rows.map(maskConnection))   // credential KHÔNG BAO GIỜ trả về trình duyệt (spec §9)
})

adminRoutes.post('/connections', requireRole('admin'), async (req, res) => {
  const { type, name, shop_id, page_id, credential } = req.body ?? {}
  if (!['pos', 'chat'].includes(type) || !name) return res.status(400).json({ error: 'Thiếu type/name' })
  if (type === 'pos' && (!shop_id || !credential?.api_key)) return res.status(400).json({ error: 'POS cần shop_id + api_key' })
  if (type === 'chat' && (!page_id || !credential?.page_access_token)) return res.status(400).json({ error: 'Chat cần page_id + page_access_token' })
  const { rows: [conn] } = await query(
    `INSERT INTO connection (type, name, shop_id, page_id, credential_encrypted)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [type, name, shop_id ?? null, page_id ?? null, encryptCredential(credential)])
  res.status(201).json(maskConnection(conn))
})

adminRoutes.patch('/connections/:id', requireRole('admin'), async (req, res) => {
  const { name, status, credential } = req.body ?? {}
  const { rows: [conn] } = await query(
    `UPDATE connection SET
       name = COALESCE($2, name), status = COALESCE($3, status),
       credential_encrypted = COALESCE($4, credential_encrypted)
     WHERE id=$1 RETURNING *`,
    [req.params.id, name ?? null, status ?? null, credential ? encryptCredential(credential) : null])
  if (!conn) return res.status(404).json({ error: 'Không tìm thấy' })
  res.json(maskConnection(conn))
})

// A2 — Kiểm tra kết nối: gọi thật một endpoint đọc, trả kết quả thật (spec A3 bước 2)
adminRoutes.post('/connections/:id/test', requireRole('admin', 'manager'), async (req, res) => {
  const { rows: [conn] } = await query('SELECT * FROM connection WHERE id=$1', [req.params.id])
  if (!conn) return res.status(404).json({ error: 'Không tìm thấy' })
  if (!conn.credential_encrypted) return res.status(400).json({ error: 'Chưa có credential' })
  try {
    const cred = decryptCredential(conn.credential_encrypted)
    let sample
    if (conn.type === 'pos') {
      const client = new PosClient({ shopId: conn.shop_id, apiKey: cred.api_key })
      const it = client.fetchAllCustomers({ pageSize: 1 })
      const first = await it.next()
      sample = { ok: true, sample_customer: first.value?.[0]?.name ?? null }
    } else {
      const client = new ChatClient({ pageId: conn.page_id, pageAccessToken: cred.page_access_token })
      const it = client.fetchConversations()
      const first = await it.next()
      sample = { ok: true, sample_conversations: first.value?.length ?? 0 }
    }
    await query(`UPDATE connection SET status='active', last_ok_at=now(), last_error=NULL WHERE id=$1`, [conn.id])
    res.json(sample)
  } catch (e) {
    await query(`UPDATE connection SET status='error', last_error=$2 WHERE id=$1`, [conn.id, String(e.message).slice(0, 500)])
    res.status(502).json({ ok: false, error: String(e.message).slice(0, 500) })
  }
})

// A3 bước 3 — nạp lịch sử, chạy nền
adminRoutes.post('/connections/:id/sync', requireRole('admin'), async (req, res) => {
  const { rows: [conn] } = await query('SELECT * FROM connection WHERE id=$1', [req.params.id])
  if (!conn) return res.status(404).json({ error: 'Không tìm thấy' })
  const job = conn.type === 'pos' ? initialSyncPos(conn.id) : backfillChat(conn.id)
  job.catch(e => console.error(`[api] initial sync ${conn.id} failed`, e.message))
  res.status(202).json({ started: true })   // theo dõi tiến trình qua /sync-logs
})

/* ---------- A4 — Nhật ký đồng bộ + sự kiện webhook ---------- */
adminRoutes.get('/sync-logs', requireRole('admin', 'manager'), async (req, res) => {
  const limit = Math.min(200, Math.max(1, Math.floor(Number(req.query.limit) || 50)))
  const params = [], where = []
  if (req.query.connection_id) { params.push(req.query.connection_id); where.push(`connection_id=$${params.length}`) }
  const { rows } = await query(
    `SELECT * FROM sync_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY id DESC LIMIT ${limit}`, params)
  res.json(rows)
})

adminRoutes.get('/webhook-events', requireRole('admin', 'manager'), async (req, res) => {
  const limit = Math.min(200, Math.max(1, Math.floor(Number(req.query.limit) || 50)))
  const params = [], where = []
  if (req.query.status) { params.push(req.query.status); where.push(`status=$${params.length}`) }
  if (req.query.source) { params.push(req.query.source); where.push(`source=$${params.length}`) }
  const { rows } = await query(
    `SELECT * FROM webhook_event ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY id DESC LIMIT ${limit}`, params)
  res.json(rows)
})

// A4 — chạy lại sự kiện lỗi
adminRoutes.post('/webhook-events/:id/retry', requireRole('admin', 'manager'), async (req, res) => {
  // CHỈ chạy lại sự kiện 'error' (đã qua xác thực secret). Không bao giờ chạy lại 'skipped':
  // đó là payload người lạ gửi vào, admin bấm nhầm là thi hành lệnh của kẻ tấn công.
  const { rows } = await query(
    `UPDATE webhook_event SET status='pending', error=NULL, processed_at=NULL
     WHERE id=$1 AND status='error' RETURNING id`, [req.params.id])
  if (!rows.length) return res.status(404).json({ error: 'Sự kiện không tồn tại hoặc không ở trạng thái lỗi' })
  res.json({ ok: true })
})

/* ---------- A5 — Hàng đợi gộp trùng (admin/manager — spec §3.2) ---------- */
adminRoutes.get('/merge-queue', requireRole('admin', 'manager'), async (req, res) => {
  const status = req.query.status ?? 'open'
  const { rows } = await query(
    `SELECT mq.*, ca.name AS name_a, ca.phone_normalized AS phone_a,
            cb.name AS name_b, cb.phone_normalized AS phone_b,
            row_to_json(ca) AS customer_a, row_to_json(cb) AS customer_b
     FROM merge_queue mq
     LEFT JOIN customer ca ON ca.id = mq.candidate_a
     LEFT JOIN customer cb ON cb.id = mq.candidate_b
     WHERE mq.status = $1 ORDER BY mq.id DESC LIMIT 100`, [status])
  res.json(rows)
})

adminRoutes.post('/merge-queue/:id/resolve', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { action, keep_id } = req.body ?? {}
    const result = await resolveMergeQueue(Number(req.params.id), action, {
      userId: req.user.sub, keepId: keep_id ?? null
    })
    res.json(result)
  } catch (e) { res.status(400).json({ error: String(e.message) }) }
})

// A5 — hoàn tác gộp trong 24 giờ
adminRoutes.post('/merge/undo/:auditId', requireRole('admin', 'manager'), async (req, res) => {
  try {
    await undoMerge(Number(req.params.auditId), { userId: req.user.sub })
    res.json({ ok: true })
  } catch (e) { res.status(400).json({ error: String(e.message) }) }
})

/* ---------- A7 — Nhật ký thao tác (CHỈ ĐỌC, không có DELETE — spec) ---------- */
adminRoutes.get('/audit-logs', requireRole('admin', 'manager'), async (req, res) => {
  const limit = Math.min(200, Math.max(1, Math.floor(Number(req.query.limit) || 50)))
  const params = [], where = []
  if (req.query.customer_id) { params.push(req.query.customer_id); where.push(`a.customer_id=$${params.length}`) }
  // Manager chỉ xem nhóm mình (spec §3.2) — v1 dùng proxy: user có connection_ids giao nhau.
  // Manager chưa được gán connection nào → xem tất cả (ghi nhận trong README, chờ chủ đầu tư chốt).
  if (req.user.role === 'manager') {
    const { rows: [me] } = await query('SELECT connection_ids FROM app_user WHERE id=$1', [req.user.sub])
    if (me?.connection_ids?.length) {
      params.push(me.connection_ids)
      where.push(`(a.user_id IS NULL OR a.user_id IN
        (SELECT id FROM app_user WHERE connection_ids && $${params.length}))`)
    }
  }
  const { rows } = await query(
    `SELECT a.*, u.name AS user_name, c.name AS customer_name
     FROM audit_log a
     LEFT JOIN app_user u ON u.id = a.user_id
     LEFT JOIN customer c ON c.id = a.customer_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY a.id DESC LIMIT ${limit}`, params)
  res.json(rows)
})

/* ---------- A6 — Người dùng (admin) ---------- */
const publicUser = u => ({
  id: u.id, email: u.email, name: u.name, role: u.role,
  connection_ids: u.connection_ids, active: u.active, created_at: u.created_at
})

adminRoutes.get('/users', requireRole('admin'), async (_req, res) => {
  const { rows } = await query('SELECT * FROM app_user ORDER BY created_at')
  res.json(rows.map(publicUser))
})

adminRoutes.post('/users', requireRole('admin'), async (req, res) => {
  const { email, password, name, role, connection_ids } = req.body ?? {}
  if (!email || !password || !name || !['admin', 'manager', 'staff'].includes(role)) {
    return res.status(400).json({ error: 'Thiếu email/password/name/role hợp lệ' })
  }
  try { assertStrongPassword(password) }
  catch (e) { return res.status(400).json({ error: e.message }) }
  try {
    const { rows: [u] } = await query(
      `INSERT INTO app_user (email, password_hash, name, role, connection_ids, must_change_password)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING *`,
      [String(email).toLowerCase(), hashPassword(String(password)), name, role, connection_ids ?? []])
    res.status(201).json(publicUser(u))
  } catch (e) {
    if (String(e.message).includes('duplicate')) return res.status(409).json({ error: 'Email đã tồn tại' })
    throw e
  }
})

adminRoutes.patch('/users/:id', requireRole('admin'), async (req, res) => {
  const { name, role, connection_ids, active, password } = req.body ?? {}
  if (role != null && !['admin', 'manager', 'staff'].includes(role)) {
    return res.status(400).json({ error: 'role không hợp lệ' })
  }
  if (password != null) {
    try { assertStrongPassword(password) }
    catch (e) { return res.status(400).json({ error: e.message }) }
  }
  // Không tự khoá/hạ quyền chính mình (tránh mất quyền do bấm nhầm)
  if (req.params.id === req.user.sub && (active === false || (role && role !== 'admin'))) {
    return res.status(400).json({ error: 'Không thể tự khoá hoặc tự hạ quyền tài khoản đang dùng' })
  }
  // Luôn giữ ít nhất 1 admin đang hoạt động, nếu không cả hệ thống không ai vào quản trị được
  if (active === false || (role && role !== 'admin')) {
    const { rows: [t] } = await query('SELECT role, active FROM app_user WHERE id=$1', [req.params.id])
    if (t?.role === 'admin' && t.active) {
      const { rows: [c] } = await query(
        `SELECT count(*)::int AS n FROM app_user WHERE role='admin' AND active=true`)
      if (c.n <= 1) return res.status(400).json({ error: 'Phải còn ít nhất một admin đang hoạt động' })
    }
  }
  const { rows: [u] } = await query(
    `UPDATE app_user SET
       name = COALESCE($2, name), role = COALESCE($3, role),
       connection_ids = COALESCE($4, connection_ids), active = COALESCE($5, active),
       password_hash = COALESCE($6, password_hash),
       must_change_password = CASE WHEN $6 IS NOT NULL THEN true ELSE must_change_password END,
       -- Đổi mật khẩu hoặc khoá tài khoản → thu hồi ngay mọi phiên đang mở
       token_valid_from = CASE WHEN $6 IS NOT NULL OR $5 = false
         THEN now() + interval '1 second' ELSE token_valid_from END
     WHERE id=$1 RETURNING *`,
    [req.params.id, name ?? null, role ?? null, connection_ids ?? null, active ?? null,
     password ? hashPassword(String(password)) : null])
  if (!u) return res.status(404).json({ error: 'Không tìm thấy' })
  clearUserCache()
  res.json(publicUser(u))
})

/* ---------- A8 — Cấu hình (admin) ---------- */
adminRoutes.get('/settings/:key', requireRole('admin'), async (req, res) => {
  if (req.params.key === 'rfm') return res.json(await getRfmThresholds())
  const { rows } = await query('SELECT value FROM setting WHERE key=$1', [req.params.key])
  if (!rows.length) return res.status(404).json({ error: 'Không có cấu hình này' })
  res.json(rows[0].value)
})

adminRoutes.put('/settings/:key', requireRole('admin'), async (req, res) => {
  const allowed = ['rfm', 'alert', 'backfill', 'custom_fields_def']
  if (!allowed.includes(req.params.key)) return res.status(400).json({ error: 'Key không hợp lệ' })
  await query(
    `INSERT INTO setting (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [req.params.key, JSON.stringify(req.body ?? {})])
  if (req.params.key === 'rfm') {
    recomputeAll().catch(e => console.error('[api] recomputeAll failed', e.message))
  }
  res.json({ ok: true })
})

/* ---------- A1 — Dashboard (admin/manager — chứa doanh số toàn hệ thống, spec §3.2) ---------- */
adminRoutes.get('/dashboard', requireRole('admin', 'manager'), async (_req, res) => {
  const [counts, phoneQuality, matched, events24h, eventStatus, mergeOpen, alerts, connections, deadPush, orderStats] =
    await Promise.all([
      query(`SELECT count(*)::int AS total,
               count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new_7d,
               coalesce(sum(pos_purchased_amount), 0)::numeric AS revenue
             FROM customer`),
      query(`SELECT count(*) FILTER (WHERE phone_normalized IS NOT NULL)::int AS valid,
               count(*)::int AS total FROM customer`),
      query(`SELECT count(DISTINCT customer_id)::int AS n FROM customer_identity
             WHERE customer_id IN (SELECT customer_id FROM customer_identity
                                   GROUP BY customer_id HAVING count(*) >= 2)`),
      query(`SELECT date_trunc('hour', received_at) AS hour, count(*)::int AS n
             FROM webhook_event WHERE received_at > now() - interval '24 hours'
             GROUP BY 1 ORDER BY 1`),
      query(`SELECT status, count(*)::int AS n FROM webhook_event
             WHERE received_at > now() - interval '24 hours' GROUP BY status`),
      query(`SELECT count(*)::int AS n FROM merge_queue WHERE status='open'`),
      query(`SELECT * FROM alert WHERE open ORDER BY created_at DESC LIMIT 20`),
      query(`SELECT id, name, type, status, webhook_status, last_ok_at, last_error FROM connection`),
      query(`SELECT count(*)::int AS n FROM pending_push WHERE status IN ('pending','dead')`),
      // Doanh số từ ĐƠN đồng bộ được. Khác tổng tích luỹ trên khách vì API Pancake chỉ
      // trả về đơn trong khoảng gần đây — lịch sử cũ chỉ còn ở dạng tổng trên hồ sơ khách.
      query(`SELECT count(*)::int AS n, coalesce(sum(total_amount),0)::numeric AS revenue,
               min(inserted_at) AS from_at, max(inserted_at) AS to_at FROM "order"`)
    ])
  const c = counts.rows[0], pq = phoneQuality.rows[0]
  res.json({
    total_customers: c.total,
    new_customers_7d: c.new_7d,
    total_revenue: Number(c.revenue),                        // trọn đời, theo số Pancake ghi trên hồ sơ khách
    synced_orders: orderStats.rows[0].n,                     // số đơn TRIOSMART lấy được qua API
    synced_orders_revenue: Number(orderStats.rows[0].revenue),
    synced_orders_from: orderStats.rows[0].from_at,
    synced_orders_to: orderStats.rows[0].to_at,
    match_rate: c.total ? matched.rows[0].n / c.total : 0,
    phone_valid_rate: pq.total ? pq.valid / pq.total : 0,    // spec §10.1 — điều kiện sống còn cho Zalo v2
    events_by_hour: events24h.rows,
    events_by_status: eventStatus.rows,
    merge_queue_open: mergeOpen.rows[0].n,
    pending_push: deadPush.rows[0].n,
    alerts: alerts.rows,
    connections: connections.rows
  })
})
