import { query } from '../db.js'
import { decryptCredential } from '../core/credentials.js'
import { computeCustomerHash, markSent } from '../core/echoGuard.js'
import { posShapeOf } from '../core/writeback.js'
import { PosClient } from '../pancake/posClient.js'

const MAX_ATTEMPTS = 8

// Thử lại các lần đẩy POS thất bại, backoff 2^attempts phút. Gọi định kỳ từ worker loop.
export async function drainPendingPush() {
  const { rows: tasks } = await query(
    `SELECT pp.*, c.shop_id, c.credential_encrypted FROM pending_push pp
     JOIN connection c ON c.id = pp.connection_id
     WHERE pp.status = 'pending' AND pp.next_at <= now()
     ORDER BY pp.id LIMIT 20`)

  for (const t of tasks) {
    try {
      if (!t.credential_encrypted) throw new Error('connection thiếu credential')
      const { api_key } = decryptCredential(t.credential_encrypted)
      const client = new PosClient({ shopId: t.shop_id, apiKey: api_key })

      // Chống ghi đè dữ liệu POS mới hơn (spec §7.6): rebuild payload từ trạng thái LOCAL HIỆN TẠI.
      // Nếu POS đã thắng field đó (webhook về sau 60s), local = giá trị POS → PUT thành no-op vô hại.
      const { rows: [cur] } = await query('SELECT * FROM customer WHERE id=$1', [t.customer_id])
      if (!cur) { await query(`UPDATE pending_push SET status='dead', last_error='customer đã bị xóa' WHERE id=$1`, [t.id]); continue }
      const shape = posShapeOf(cur)
      const payload = {}
      for (const k of Object.keys(t.payload)) if (shape[k] !== undefined) payload[k] = shape[k]
      if (Object.keys(payload).length === 0) {
        await query(`UPDATE pending_push SET status='done', last_error='không còn gì để đẩy' WHERE id=$1`, [t.id])
        continue
      }
      await markSent(computeCustomerHash({ ...shape, ...payload }))
      await client.updateCustomer(t.pos_customer_id, payload)
      await query(`UPDATE pending_push SET status='done', last_error=NULL WHERE id=$1`, [t.id])
      await query(
        `UPDATE audit_log SET pushed_to_pancake = true
         WHERE customer_id = $1 AND source='user' AND pushed_to_pancake = false
           AND field = ANY($2)`,
        [t.customer_id, Object.keys(t.payload)])
    } catch (e) {
      const attempts = t.attempts + 1
      const dead = attempts >= MAX_ATTEMPTS
      await query(
        `UPDATE pending_push SET attempts=$2::int, status=$3, last_error=$4,
           next_at = now() + (interval '1 minute' * power(2, $2::int))
         WHERE id=$1`,
        [t.id, attempts, dead ? 'dead' : 'pending', String(e.message).slice(0, 1000)])
      if (dead) console.error(`[pending_push] #${t.id} DEAD sau ${attempts} lần: ${e.message}`)
    }
  }
  return tasks.length
}
