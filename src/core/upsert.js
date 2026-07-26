import { query } from '../db.js'
import { normalizePhone } from './phone.js'
import { findOrCreateCustomer } from './matcher.js'

export async function upsertCustomerFromPos(connection, pc) {
  const phones = Array.isArray(pc.phone_numbers) ? pc.phone_numbers : []
  const primary = phones.length ? normalizePhone(phones[0]) : { normalized: null, valid: false }
  const altPhones = phones.slice(1).map(p => normalizePhone(p).normalized).filter(Boolean)

  const customer = await findOrCreateCustomer({
    phoneNormalized: primary.normalized, fbId: pc.fb_id ?? null, name: pc.name ?? null,
    sourceType: 'pos', connectionId: connection.id, externalId: String(pc.id)
  })

  await query(
    `UPDATE customer SET
       name = COALESCE($2, name),
       email = COALESCE($3, email),
       gender = COALESCE($4, gender),
       date_of_birth = COALESCE($5, date_of_birth),
       phone_normalized = COALESCE($6, phone_normalized),
       phone_raw = $7,
       phone_invalid = $8,
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
    [customer.id, pc.name ?? null, pc.emails?.[0] ?? null, pc.gender ?? null,
     pc.date_of_birth ?? null, primary.normalized,
     phones[0] ?? null, phones.length > 0 && !primary.valid,
     pc.purchased_amount ?? null, pc.order_count ?? null, pc.succeed_order_count ?? null,
     pc.last_order_at ?? null, pc.reward_point ?? null,
     pc.level_id != null ? String(pc.level_id) : null,
     JSON.stringify({ ...(pc.fb_id ? { fb_id: pc.fb_id } : {}), ...(altPhones.length ? { alt_phones: altPhones } : {}) }),
     (pc.shop_customer_addresses ?? pc.address) != null
       ? JSON.stringify(pc.shop_customer_addresses ?? pc.address) : null,
     Array.isArray(pc.tags) ? JSON.stringify(pc.tags) : null]
  )
  return customer.id
}
