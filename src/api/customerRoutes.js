import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth, requireRole, staffConnectionIds, assertCustomerInScope, intersectScope } from './middleware.js'
import { updateCustomerFields } from '../core/writeback.js'
import { normalizePhone } from '../core/phone.js'
import { SEGMENTS } from '../core/rfm.js'

export const customerRoutes = Router()
customerRoutes.use(requireAuth)

// U1 — danh sách khách: tìm kiếm (tên, SĐT chính + số phụ), lọc, phân trang server
customerRoutes.get('/customers', async (req, res) => {
  const { q, segment, assigned, connection_id } = req.query
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.page_size) || 25)))
  const SORTS = {
    name: 'name', purchased: 'pos_purchased_amount', orders: 'pos_succeed_order_count',
    last_order: 'pos_last_order_at', created: 'created_at'
  }
  // hasOwn: nếu không, ?sort=constructor lấy trúng key kế thừa từ Object.prototype → SQL rác, 500
  const sortCol = Object.hasOwn(SORTS, String(req.query.sort ?? '')) ? SORTS[req.query.sort] : 'updated_at'
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC'

  const where = [], params = []
  const p = v => { params.push(v); return `$${params.length}` }

  if (q) {
    const phone = normalizePhone(q)
    if (phone.valid) {
      where.push(`(phone_normalized = ${p(phone.normalized)} OR custom_fields->'alt_phones' ? ${p(phone.normalized)})`)
    } else {
      where.push(`(name ILIKE ${p('%' + q + '%')} OR phone_normalized LIKE ${p(q.replace(/\D/g, '') + '%')})`)
    }
  }
  if (segment) where.push(`rfm_segment = ${p(segment)}`)
  if (assigned === 'me') where.push(`assigned_user_id = ${p(req.user.sub)}`)
  else if (assigned) where.push(`assigned_user_id = ${p(assigned)}`)

  const scope = await staffConnectionIds(req)
  // GIAO phạm vi, không thay thế: trước đây ?connection_id= của client ghi đè phạm vi staff
  // → nhân viên xem được trọn danh sách khách của nguồn không được gán.
  const scopeIds = intersectScope(scope, connection_id)
  if (scopeIds) {
    where.push(`id IN (SELECT customer_id FROM customer_identity WHERE connection_id = ANY(${p(scopeIds)}))`)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = await query(`SELECT count(*)::int AS n FROM customer ${whereSql}`, params)
  const rows = await query(
    `SELECT id, name, phone_normalized, phone_invalid, rfm_segment, assigned_user_id,
            pos_purchased_amount, pos_succeed_order_count, pos_order_count, pos_last_order_at,
            (SELECT json_agg(json_build_object('source_type', source_type, 'connection_id', connection_id))
             FROM customer_identity i WHERE i.customer_id = customer.id
               ${scopeIds ? `AND i.connection_id = ANY(${p(scopeIds)})` : ''}) AS identities
     FROM customer ${whereSql}
     ORDER BY ${sortCol} ${dir} NULLS LAST LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params)
  res.json({ rows: rows.rows, total: total.rows[0].n, page, page_size: pageSize })
})

// U4 — bảng phân khúc. Doanh số chỉ cho admin/manager (spec §3.2).
customerRoutes.get('/segments', async (req, res) => {
  const showRevenue = ['admin', 'manager'].includes(req.user.role)
  const { rows } = await query(
    `SELECT coalesce(rfm_segment, 'Chưa phân loại') AS segment, count(*)::int AS n,
            sum(pos_purchased_amount)::numeric AS revenue
     FROM customer GROUP BY 1`)
  const byName = Object.fromEntries(rows.map(r => [r.segment, r]))
  res.json(SEGMENTS.map(s => ({
    segment: s,
    count: byName[s]?.n ?? 0,
    revenue: showRevenue ? Number(byName[s]?.revenue ?? 0) : null
  })))
})

// U5 — việc của tôi: khách được gán, nhóm nguy cơ lên đầu
customerRoutes.get('/my-customers', async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, phone_normalized, rfm_segment, pos_purchased_amount, pos_last_order_at
     FROM customer WHERE assigned_user_id = $1
     ORDER BY (rfm_segment = 'Có nguy cơ rời bỏ') DESC, pos_last_order_at ASC NULLS LAST
     LIMIT 200`, [req.user.sub])
  res.json(rows)
})

// U2 — hồ sơ 360°
customerRoutes.get('/customers/:id', async (req, res) => {
  if (!await assertCustomerInScope(req, req.params.id)) {
    return res.status(403).json({ error: 'Khách này ngoài phạm vi nguồn được gán' })
  }
  const { rows: [customer] } = await query('SELECT * FROM customer WHERE id=$1', [req.params.id])
  if (!customer) return res.status(404).json({ error: 'Không tìm thấy khách' })

  const [identities, orders, conversations, audit] = await Promise.all([
    query(`SELECT i.*, c.name AS connection_name, c.type AS connection_type
           FROM customer_identity i JOIN connection c ON c.id=i.connection_id
           WHERE i.customer_id=$1 ORDER BY i.linked_at`, [req.params.id]),
    query(`SELECT id, pos_order_id, status, total_amount, inserted_at, updated_at
           FROM "order" WHERE customer_id=$1 ORDER BY inserted_at DESC NULLS LAST LIMIT 20`, [req.params.id]),
    query(`SELECT id, pancake_conversation_id, type, last_message_at, last_message_snippet, psid
           FROM conversation WHERE customer_id=$1 ORDER BY last_message_at DESC NULLS LAST LIMIT 20`, [req.params.id]),
    query(`SELECT field, old_value, new_value, source, pushed_to_pancake, created_at
           FROM audit_log WHERE customer_id=$1 AND source IN ('user','conflict')
           ORDER BY created_at DESC LIMIT 20`, [req.params.id])
  ])

  // Dòng thời gian trộn 2 nguồn (điểm nhận diện của sản phẩm — xanh POS, tím Chat)
  const timeline = [
    ...orders.rows.map(o => ({ kind: 'order', at: o.inserted_at, data: o })),
    ...conversations.rows.map(c => ({ kind: 'chat', at: c.last_message_at, data: c }))
  ].sort((a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0))

  res.json({
    customer, identities: identities.rows, orders: orders.rows,
    conversations: conversations.rows, timeline, recent_audit: audit.rows
  })
})

// U2 — sửa hồ sơ: qua writeback (Plan 2), trả kết quả TRUNG THỰC pushed/không
customerRoutes.patch('/customers/:id', async (req, res) => {
  if (!await assertCustomerInScope(req, req.params.id)) {
    return res.status(403).json({ error: 'Khách này ngoài phạm vi nguồn được gán' })
  }
  // Nhân viên KHÔNG được tự gán khách cho mình hay sửa phân khúc RFM
  // (nếu không, chốt chặn requireRole ở bulk-assign thành vô nghĩa — sửa lẻ từng khách là xong).
  const MANAGER_ONLY = ['assigned_user_id', 'rfm_segment']
  const body = { ...(req.body ?? {}) }
  if (!['admin', 'manager'].includes(req.user.role)) {
    const denied = MANAGER_ONLY.filter(f => f in body)
    if (denied.length) {
      return res.status(403).json({ error: `Chỉ quản lý mới được sửa: ${denied.join(', ')}` })
    }
  }
  try {
    const result = await updateCustomerFields(req.params.id, body, { userId: req.user.sub })
    res.json(result)
  } catch (e) {
    // Không trả nguyên văn lỗi Postgres ra ngoài (lộ tên bảng/cột/ràng buộc cho kẻ dò)
    console.error('[api] PATCH customer lỗi:', e.message)
    res.status(400).json({ error: e.safeMessage ?? 'Dữ liệu không hợp lệ' })
  }
})

// U1 — gán người phụ trách hàng loạt
customerRoutes.post('/customers/bulk-assign', requireRole('admin', 'manager'), async (req, res) => {
  const { customer_ids, user_id } = req.body ?? {}
  if (!Array.isArray(customer_ids) || customer_ids.length === 0) {
    return res.status(400).json({ error: 'customer_ids trống' })
  }
  await query('UPDATE customer SET assigned_user_id=$2 WHERE id = ANY($1)', [customer_ids, user_id ?? null])
  for (const id of customer_ids) {
    await query(
      `INSERT INTO audit_log (user_id, customer_id, field, new_value, source)
       VALUES ($1,$2,'assigned_user_id',$3,'user')`,
      [req.user.sub, id, JSON.stringify(user_id ?? null)])
  }
  res.json({ ok: true, count: customer_ids.length })
})
