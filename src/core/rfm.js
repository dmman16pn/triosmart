import { query } from '../db.js'

export const DEFAULT_RFM = {
  vip_amount: 5000000, vip_days: 30, loyal_orders: 3, loyal_days: 60,
  risk_days: 120, gone_days: 120, new_days: 30
}

export const SEGMENTS = ['Khách VIP', 'Trung thành', 'Có nguy cơ rời bỏ', 'Đã rời bỏ',
  'Mua một lần', 'Khách mới', 'Chưa mua', 'Chưa phân loại']

export async function getRfmThresholds() {
  const { rows } = await query(`SELECT value FROM setting WHERE key='rfm'`)
  return { ...DEFAULT_RFM, ...(rows[0]?.value ?? {}) }
}

// Đánh giá đúng bảng spec §7.7 theo thứ tự ưu tiên. Trường hợp bảng spec không phủ
// (vd succeed=2 nhưng days<=loyal_days, hoặc thiếu last_order_at) → 'Chưa phân loại'
// — hiển thị trung thực thay vì dán nhãn sai, chờ chủ đầu tư chốt nghiệp vụ.
export function computeSegment(c, t) {
  const succeed = Number(c.pos_succeed_order_count) || 0
  const amount = Number(c.pos_purchased_amount) || 0
  if (succeed === 0) return 'Chưa mua'
  if (!c.pos_last_order_at) return 'Chưa phân loại'
  const days = (Date.now() - new Date(c.pos_last_order_at).getTime()) / 86400000

  if (amount >= t.vip_amount && days <= t.vip_days) return 'Khách VIP'
  if (succeed >= t.loyal_orders && days <= t.loyal_days) return 'Trung thành'
  if (succeed >= 2 && days > t.loyal_days && days <= t.risk_days) return 'Có nguy cơ rời bỏ'
  if (days > t.gone_days) return 'Đã rời bỏ'
  if (succeed === 1 && days <= t.new_days) return 'Khách mới'
  if (succeed === 1) return 'Mua một lần'
  return 'Chưa phân loại'
}

export async function recomputeCustomer(customerId, thresholds = null) {
  const t = thresholds ?? await getRfmThresholds()
  const { rows: [c] } = await query(
    `SELECT pos_succeed_order_count, pos_purchased_amount, pos_last_order_at FROM customer WHERE id=$1`,
    [customerId])
  if (!c) return null
  const seg = computeSegment(c, t)
  await query(
    `UPDATE customer SET rfm_segment=$2 WHERE id=$1 AND rfm_segment IS DISTINCT FROM $2`,
    [customerId, seg])
  return seg
}

// Chạy hằng đêm (spec §7.7). Duyệt theo lô để không giữ bộ nhớ với 50k+ khách.
export async function recomputeAll() {
  const t = await getRfmThresholds()
  let lastId = '00000000-0000-0000-0000-000000000000', updated = 0
  for (;;) {
    const { rows } = await query(
      `SELECT id, rfm_segment, pos_succeed_order_count, pos_purchased_amount, pos_last_order_at
       FROM customer WHERE id > $1 ORDER BY id LIMIT 500`, [lastId])
    if (rows.length === 0) break
    for (const c of rows) {
      const seg = computeSegment(c, t)
      if (seg !== c.rfm_segment) {
        await query('UPDATE customer SET rfm_segment=$2 WHERE id=$1', [c.id, seg])
        updated++
      }
    }
    lastId = rows[rows.length - 1].id
  }
  return updated
}
