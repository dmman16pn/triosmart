import { query } from '../db.js'
import { upsertCustomerFromPos } from '../core/upsert.js'

export function extractPosOrder(payload) {
  return payload.order ?? payload.data ?? payload
}

export async function processPosOrder(connection, o) {
  if (o?.id == null) throw new Error('order payload thiếu id')
  let customerId = null
  const embedded = o.customer
  if (embedded?.id != null) {
    customerId = await upsertCustomerFromPos(connection, embedded)
  } else if (o.customer_id != null) {
    const r = await query(
      `SELECT customer_id FROM customer_identity
       WHERE source_type='pos' AND connection_id=$1 AND external_id=$2`,
      [connection.id, String(o.customer_id)])
    customerId = r.rows[0]?.customer_id ?? null
  }

  await query(
    `INSERT INTO "order" (pos_order_id, connection_id, customer_id, status,
       total_amount, cod, prepaid, inserted_at, updated_at, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (pos_order_id) DO UPDATE SET
       customer_id = COALESCE(EXCLUDED.customer_id, "order".customer_id),
       status = EXCLUDED.status, total_amount = EXCLUDED.total_amount,
       cod = EXCLUDED.cod, prepaid = EXCLUDED.prepaid,
       updated_at = EXCLUDED.updated_at, raw = EXCLUDED.raw`,
    [String(o.id), connection.id, customerId,
     o.status != null ? String(o.status) : null,
     o.total_price ?? o.total_amount ?? null, o.cod ?? null, o.prepaid ?? null,
     o.inserted_at ?? null, o.updated_at ?? null, JSON.stringify(o)])
}
