import { query } from '../db.js'
import { processPosCustomer, extractPosCustomer } from './processPosCustomer.js'
import { processPosOrder, extractPosOrder } from './processPosOrder.js'
import { processChatEvent } from './processChatEvent.js'

async function findConnection(source, payload) {
  if (source === 'pos') {
    const shopId = payload.shop_id ?? payload.shopId ?? null
    const r = shopId
      ? await query(`SELECT * FROM connection WHERE type='pos' AND shop_id=$1`, [String(shopId)])
      : await query(`SELECT * FROM connection WHERE type='pos' AND status <> 'disabled' LIMIT 2`)
    if (!shopId && r.rows.length > 1) throw new Error('Nhiều connection POS nhưng payload không có shop_id')
    return r.rows[0] ?? null
  }
  const pageId = payload.page_id ?? payload.pageId ?? null
  const r = pageId
    ? await query(`SELECT * FROM connection WHERE type='chat' AND page_id=$1`, [String(pageId)])
    : await query(`SELECT * FROM connection WHERE type='chat' AND status <> 'disabled' LIMIT 2`)
  if (!pageId && r.rows.length > 1) throw new Error('Nhiều connection Chat nhưng payload không có page_id')
  return r.rows[0] ?? null
}

async function processOne(ev) {
  const conn = await findConnection(ev.source, ev.payload)
  if (!conn) throw new Error(`Không tìm thấy connection cho sự kiện ${ev.source}#${ev.id}`)
  if (ev.source === 'pos') {
    const isOrder = ev.event_type === 'orders' || ev.payload.order
    if (isOrder) await processPosOrder(conn, extractPosOrder(ev.payload))
    else await processPosCustomer(conn, extractPosCustomer(ev.payload))
  } else {
    await processChatEvent(conn, ev.payload)
  }
}

// Nhặt tối đa 100 sự kiện pending, xử lý tuần tự. Trả số sự kiện đã nhặt.
// v1 chạy MỘT worker duy nhất nên chỉ cần SELECT thường. Khi scale nhiều worker,
// đổi sang: UPDATE webhook_event SET status='processing'
//           WHERE id IN (SELECT id FROM webhook_event WHERE status='pending'
//                        ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED) RETURNING *
export async function drainOnce() {
  const { rows: events } = await query(
    `SELECT id FROM webhook_event WHERE status='pending' ORDER BY id LIMIT 100`)

  for (const { id } of events) {
    const { rows } = await query('SELECT * FROM webhook_event WHERE id=$1 AND status=$2', [id, 'pending'])
    const ev = rows[0]
    if (!ev) continue
    try {
      await processOne(ev)
      await query(`UPDATE webhook_event SET status='done', processed_at=now() WHERE id=$1`, [ev.id])
    } catch (e) {
      await query(`UPDATE webhook_event SET status='error', processed_at=now(), error=$2 WHERE id=$1`,
        [ev.id, String(e.message).slice(0, 2000)])
    }
  }
  return events.length
}
