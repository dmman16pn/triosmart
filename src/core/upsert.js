import { query } from '../db.js'
import { normalizePhone } from './phone.js'
import { findOrCreateCustomer } from './matcher.js'

// Trường hai chiều có thể xung đột (spec §7.6). Số liệu pos_* luôn do POS thắng tuyệt đối.
const CONFLICT_FIELDS = ['name', 'email', 'gender', 'date_of_birth', 'address', 'tags', 'phone_numbers']

export async function upsertCustomerFromPos(connection, pc) {
  if (pc?.id == null) throw new Error('customer payload thiếu id')
  const phones = Array.isArray(pc.phone_numbers) ? pc.phone_numbers : []
  const primary = phones.length ? normalizePhone(phones[0]) : { normalized: null, valid: false }
  const altPhones = phones.slice(1).map(p => normalizePhone(p).normalized).filter(Boolean)

  const customer = await findOrCreateCustomer({
    phoneNormalized: primary.normalized, fbId: pc.fb_id ?? null, name: pc.name ?? null,
    sourceType: 'pos', connectionId: connection.id, externalId: String(pc.id)
  })

  // Xung đột theo TỪNG TRƯỜNG (spec §7.6): Trio vừa ghi trong 60 giây → Trio thắng trường đó.
  const { rows: recent } = await query(
    `SELECT DISTINCT field FROM audit_log
     WHERE customer_id=$1 AND source='user' AND created_at > now() - interval '60 seconds'`,
    [customer.id])
  const held = new Set(recent.map(r => r.field))

  if (held.size > 0) {
    const { rows: [cur] } = await query('SELECT * FROM customer WHERE id=$1', [customer.id])
    const incoming = {
      name: pc.name, email: pc.emails?.[0], gender: pc.gender,
      date_of_birth: pc.date_of_birth,
      address: pc.shop_customer_addresses ?? pc.address, tags: pc.tags,
      phone_numbers: phones.length ? phones : undefined
    }
    const currentOf = {
      name: cur.name, email: cur.email, gender: cur.gender,
      date_of_birth: cur.date_of_birth, address: cur.address, tags: cur.tags,
      phone_numbers: cur.phone_normalized ? [cur.phone_normalized] : []
    }
    for (const f of CONFLICT_FIELDS) {
      if (!held.has(f) || incoming[f] === undefined) continue
      const oldJ = JSON.stringify(currentOf[f] ?? null), newJ = JSON.stringify(incoming[f] ?? null)
      if (oldJ === newJ) continue   // giá trị giống nhau (echo lọt lưới) → không phải xung đột, đừng nhiễu log
      // Ghi lại cả hai giá trị (spec: "kèm giá trị của cả hai bên")
      await query(
        `INSERT INTO audit_log (customer_id, field, old_value, new_value, source)
         VALUES ($1, $2, $3, $4, 'conflict')`,
        [customer.id, f, oldJ, newJ])
    }
  }
  const keep = f => held.has(f)   // true → truyền NULL để COALESCE giữ giá trị Trio

  await query(
    `UPDATE customer SET
       name = COALESCE($2, name),
       email = COALESCE($3, email),
       gender = COALESCE($4, gender),
       date_of_birth = COALESCE($5, date_of_birth),
       phone_normalized = COALESCE($6, phone_normalized),
       phone_raw = CASE WHEN $7::text IS NULL THEN phone_raw ELSE $7 END,
       phone_invalid = COALESCE($8, phone_invalid),
       pos_purchased_amount = COALESCE($9, pos_purchased_amount),
       pos_order_count = COALESCE($10, pos_order_count),
       pos_succeed_order_count = COALESCE($11, pos_succeed_order_count),
       pos_last_order_at = COALESCE($12, pos_last_order_at),
       pos_reward_point = COALESCE($13, pos_reward_point),
       pos_level_id = COALESCE($14, pos_level_id),
       custom_fields = customer.custom_fields || $15::jsonb,
       address = COALESCE($16::jsonb, address),
       tags = COALESCE($17::jsonb, tags),
       updated_at = now(), last_synced_at = now()
     WHERE id = $1`,
    [customer.id,
     keep('name') ? null : (pc.name ?? null),
     keep('email') ? null : (pc.emails?.[0] ?? null),
     keep('gender') ? null : (pc.gender ?? null),
     keep('date_of_birth') ? null : (pc.date_of_birth ?? null),
     keep('phone_numbers') ? null : primary.normalized,
     keep('phone_numbers') ? null : (phones[0] ?? null),
     keep('phone_numbers') ? null : (phones.length > 0 ? !primary.valid : null),
     pc.purchased_amount ?? null, pc.order_count ?? null, pc.succeed_order_count ?? null,
     pc.last_order_at ?? null, pc.reward_point ?? null,
     pc.level_id != null ? String(pc.level_id) : null,
     JSON.stringify({ ...(pc.fb_id ? { fb_id: pc.fb_id } : {}), ...(altPhones.length ? { alt_phones: altPhones } : {}) }),
     keep('address') ? null : ((pc.shop_customer_addresses ?? pc.address) != null
       ? JSON.stringify(pc.shop_customer_addresses ?? pc.address) : null),
     keep('tags') ? null : (Array.isArray(pc.tags) ? JSON.stringify(pc.tags) : null)]
  )
  return customer.id
}
