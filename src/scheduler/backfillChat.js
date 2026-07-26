import { query } from '../db.js'
import { decryptCredential } from '../core/credentials.js'
import { ChatClient } from '../pancake/chatClient.js'
import { normalizePhone } from '../core/phone.js'
import { findOrCreateCustomer } from '../core/matcher.js'

async function runEntity(conn, entity, iterator, handler) {
  const log = await query(
    `INSERT INTO sync_log (connection_id, direction, entity) VALUES ($1,'in',$2) RETURNING id`,
    [conn.id, entity])
  let ok = 0, fail = 0
  try {
    for await (const batch of iterator) {
      for (const row of batch) {
        try { await handler(row); ok++ } catch (e) { fail++; console.error(`[backfillChat] ${entity} row failed:`, e.message) }
      }
    }
  } catch (e) { fail++; console.error(`[backfillChat] ${entity} aborted:`, e.message) }
  await query(`UPDATE sync_log SET count_ok=$2, count_fail=$3, finished_at=now() WHERE id=$1`,
    [log.rows[0].id, ok, fail])
  return fail
}

// Nạp lịch sử / nạp bù nguồn Chat: khách của trang + tóm tắt hội thoại (spec §5.5, §7.3).
export async function backfillChat(connectionId) {
  const { rows: [conn] } = await query('SELECT * FROM connection WHERE id=$1', [connectionId])
  if (!conn?.credential_encrypted) throw new Error('connection thiếu credential')
  const { page_access_token } = decryptCredential(conn.credential_encrypted)
  const client = new ChatClient({ pageId: conn.page_id, pageAccessToken: page_access_token })

  let totalFail = 0
  totalFail += await runEntity(conn, 'chat_customers', client.fetchPageCustomers(), async (pc) => {
    const psid = pc.psid ?? pc.id
    if (!psid) throw new Error('page_customer thiếu psid')
    const phone = normalizePhone(pc.phone_number ?? pc.phone ?? null)
    const customer = await findOrCreateCustomer({
      phoneNormalized: phone.normalized, fbId: pc.fb_id ?? null, name: pc.name ?? null,
      sourceType: 'chat', connectionId: conn.id, externalId: String(psid)
    })
    if (phone.normalized) {
      await query(
        `UPDATE customer SET phone_normalized = COALESCE(phone_normalized, $2), updated_at=now() WHERE id=$1`,
        [customer.id, phone.normalized])
    }
  })

  totalFail += await runEntity(conn, 'conversations', client.fetchConversations(), async (cv) => {
    if (!cv?.id) throw new Error('conversation thiếu id')
    const psid = cv.customers?.[0]?.psid ?? cv.psid ?? null
    let customerId = null
    if (psid) {
      const { rows } = await query(
        `SELECT customer_id FROM customer_identity
         WHERE source_type='chat' AND connection_id=$1 AND external_id=$2`,
        [conn.id, String(psid)])
      customerId = rows[0]?.customer_id ?? null
    }
    await query(
      `INSERT INTO conversation (pancake_conversation_id, connection_id, psid, customer_id,
         type, last_message_at, last_message_snippet)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT ON CONSTRAINT uq_conversation DO UPDATE SET
         customer_id = COALESCE(EXCLUDED.customer_id, conversation.customer_id),
         last_message_at = COALESCE(EXCLUDED.last_message_at, conversation.last_message_at),
         last_message_snippet = COALESCE(EXCLUDED.last_message_snippet, conversation.last_message_snippet)`,
      [String(cv.id), conn.id, psid != null ? String(psid) : null, customerId,
       cv.type ?? null, cv.updated_at ?? null, cv.snippet?.slice(0, 500) ?? null])
  })

  await query(
    `UPDATE connection SET last_ok_at = CASE WHEN $2=0 THEN now() ELSE last_ok_at END,
       last_error = CASE WHEN $2>0 THEN 'backfill chat có lỗi, xem sync_log' ELSE NULL END
     WHERE id=$1`, [conn.id, totalFail])
}
