import { query } from '../db.js'
import { normalizePhone } from '../core/phone.js'
import { findOrCreateCustomer } from '../core/matcher.js'
import { recomputeCustomer } from '../core/rfm.js'

export async function processChatEvent(connection, payload) {
  const type = payload.event_type
  if (type === 'connect_status') return handleConnectStatus(connection, payload)
  if (type === 'messaging' || type === 'conversation') return handleConversation(connection, payload)
  // sự kiện khác (post, subscription...) — bỏ qua ở v1
}

async function handleConnectStatus(connection, p) {
  const ok = p.status === 'connected'
  await query(
    `UPDATE connection SET status=$2, last_error=$3,
       last_ok_at = CASE WHEN $2='active' THEN now() ELSE last_ok_at END
     WHERE id=$1`,
    [connection.id, ok ? 'active' : 'error', ok ? null : (p.message ?? String(p.status))])
}

async function handleConversation(connection, p) {
  const cust = p.customer ?? {}
  const psid = cust.psid ?? p.psid
  if (!psid) return
  const phone = normalizePhone(cust.phone_number ?? cust.phone ?? null)

  const customer = await findOrCreateCustomer({
    phoneNormalized: phone.normalized, fbId: cust.fb_id ?? null, name: cust.name ?? null,
    sourceType: 'chat', connectionId: connection.id, externalId: String(psid)
  })
  if (phone.normalized) {
    // khách chat về sau mới có SĐT: điền vào hồ sơ nếu đang trống
    await query(
      `UPDATE customer SET phone_normalized = COALESCE(phone_normalized, $2), updated_at = now()
       WHERE id = $1`, [customer.id, phone.normalized])
  }
  if (customer.rfm_segment == null) await recomputeCustomer(customer.id)   // khách chat mới → 'Chưa mua'

  const convId = p.conversation?.id
  if (!convId) return
  await query(
    `INSERT INTO conversation (pancake_conversation_id, connection_id, psid, customer_id,
       type, last_message_at, last_message_snippet, unread)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true)
     ON CONFLICT ON CONSTRAINT uq_conversation DO UPDATE SET
       customer_id = COALESCE(EXCLUDED.customer_id, conversation.customer_id),
       last_message_at = COALESCE(EXCLUDED.last_message_at, conversation.last_message_at),
       last_message_snippet = COALESCE(EXCLUDED.last_message_snippet, conversation.last_message_snippet),
       unread = true`,
    [String(convId), connection.id, String(psid), customer.id,
     p.conversation?.type ?? null, p.message?.inserted_at ?? null,
     p.message?.text?.slice(0, 500) ?? null])
}
