import { query } from '../db.js'

// Thứ tự ghép theo spec §7.2. KHÔNG BAO GIỜ tự gộp khi confidence < 90.
export async function findOrCreateCustomer({
  phoneNormalized = null, fbId = null, name = null, posCustomerId = null,
  sourceType, connectionId, externalId
}) {
  // 0. Identity đã tồn tại → trả hồ sơ chủ hiện có (idempotent)
  const existed = await query(
    `SELECT c.* FROM customer_identity i JOIN customer c ON c.id = i.customer_id
     WHERE i.source_type=$1 AND i.connection_id=$2 AND i.external_id=$3`,
    [sourceType, connectionId, externalId])
  if (existed.rows[0]) return existed.rows[0]

  let match = null, method = 'first_seen', confidence = 100

  // 0.5. Chat payload có customer_id trỏ thẳng khách POS (Pancake tự nối) → chắc chắn nhất
  if (posCustomerId) {
    const r = await query(
      `SELECT c.* FROM customer_identity i JOIN customer c ON c.id = i.customer_id
       WHERE i.source_type='pos' AND i.external_id = $1 LIMIT 1`, [String(posCustomerId)])
    if (r.rows[0]) { match = r.rows[0]; method = 'pos_link'; confidence = 100 }
  }
  // 1. Trùng phone_normalized → 100
  if (!match && phoneNormalized) {
    const r = await query('SELECT * FROM customer WHERE phone_normalized=$1', [phoneNormalized])
    if (r.rows[0]) { match = r.rows[0]; method = 'phone'; confidence = 100 }
  }
  // 2. Trùng fb_id ↔ fb_id/psid (spec §7.2: fb_id POS khớp psid HOẶC fb_id chat) → 95
  if (!match && fbId) {
    const r = await query(
      `SELECT c.* FROM customer c
       WHERE c.custom_fields->>'fb_id' = $1
          OR c.id IN (SELECT customer_id FROM customer_identity
                      WHERE source_type='chat' AND external_id = $1)
       LIMIT 1`, [fbId])
    if (r.rows[0]) { match = r.rows[0]; method = 'fb_id'; confidence = 95 }
  }
  // 2b. Chiều ngược: sự kiện chat mà psid trùng fb_id của khách POS đã có → 95
  if (!match && sourceType === 'chat') {
    const r = await query(
      `SELECT * FROM customer WHERE custom_fields->>'fb_id' = $1 LIMIT 1`, [externalId])
    if (r.rows[0]) { match = r.rows[0]; method = 'fb_id'; confidence = 95 }
  }

  let customer = match
  if (!customer) {
    const ins = await query(
      `INSERT INTO customer (phone_normalized, name, custom_fields)
       VALUES ($1, $2, $3) RETURNING *`,
      [phoneNormalized, name, JSON.stringify(fbId ? { fb_id: fbId } : {})])
    customer = ins.rows[0]

    // 3. Trùng tên đầy đủ, cả hai đều không có phone → merge_queue, score 40, KHÔNG gộp
    if (!phoneNormalized && name) {
      const dup = await query(
        `SELECT id FROM customer WHERE name = $1 AND phone_normalized IS NULL AND id <> $2`,
        [name, customer.id])
      for (const d of dup.rows) {
        await query(
          `INSERT INTO merge_queue (candidate_a, candidate_b, reason, score)
           VALUES ($1, $2, 'same_name_no_phone', 40)`, [d.id, customer.id])
      }
    }
  }

  await query(
    `INSERT INTO customer_identity (customer_id, source_type, connection_id, external_id, match_method, confidence)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT ON CONSTRAINT uq_identity DO NOTHING`,
    [customer.id, sourceType, connectionId, externalId, method, confidence])
  return customer
}
