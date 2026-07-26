import { query } from '../db.js'
import { normalizePhone } from './phone.js'
import { decryptCredential } from './credentials.js'
import { computeCustomerHash, markSent } from './echoGuard.js'
import { PosClient } from '../pancake/posClient.js'

// Phân loại trường theo spec §7.4
const WRITABLE = new Set(['name', 'phone_numbers', 'emails', 'gender', 'date_of_birth', 'address', 'tags'])
const TRIO_OWNED = new Set(['internal_note', 'rfm_segment', 'assigned_user_id', 'custom_fields', 'zalo_consent'])

// Trạng thái khách hiện tại theo "hình dạng POS" — dùng để tính hash echo guard
// (webhook dội về sẽ chứa toàn bộ khách, không chỉ trường vừa sửa).
export function posShapeOf(cur) {
  return {
    name: cur.name ?? undefined,
    phone_numbers: cur.phone_normalized
      ? [cur.phone_normalized, ...(cur.custom_fields?.alt_phones ?? [])] : undefined,
    emails: cur.email ? [cur.email] : undefined,
    gender: cur.gender ?? undefined,
    date_of_birth: cur.date_of_birth ?? undefined,
    address: cur.address ?? undefined,
    tags: cur.tags?.length ? cur.tags : undefined
  }
}

async function findPosLink(customerId) {
  const { rows } = await query(
    `SELECT i.external_id, c.* FROM customer_identity i
     JOIN connection c ON c.id = i.connection_id
     WHERE i.customer_id = $1 AND i.source_type = 'pos' AND c.status <> 'disabled'
     LIMIT 1`, [customerId])
  return rows[0] ?? null
}

// LỐI VÀO DUY NHẤT để sửa hồ sơ khách từ phía TRIOSMART (spec §7.4, §8-U2).
// Trả { pushed, error?, skipped: [] } — KHÔNG BAO GIỜ báo pushed:true khi chưa đẩy được.
export async function updateCustomerFields(customerId, changes, { userId = null } = {}) {
  const { rows: [cur] } = await query('SELECT * FROM customer WHERE id=$1', [customerId])
  if (!cur) throw new Error('customer không tồn tại')

  const skipped = [], writableChanges = {}, localSets = [], localParams = [customerId]
  const auditRows = []
  let p = 1
  const set = (col, val, cast = '') => { localParams.push(val); localSets.push(`${col} = $${++p}${cast}`) }

  for (const [key, value] of Object.entries(changes)) {
    if (WRITABLE.has(key)) {
      writableChanges[key] = value
      if (key === 'phone_numbers') {
        const phones = Array.isArray(value) ? value : [value]
        const prim = normalizePhone(phones[0])
        set('phone_normalized', prim.normalized)
        set('phone_raw', phones[0] ?? null)
        set('phone_invalid', phones.length > 0 && !prim.valid)
        auditRows.push([key, cur.phone_normalized, prim.normalized ?? phones[0]])
      } else if (key === 'emails') {
        const email = Array.isArray(value) ? value[0] : value
        set('email', email ?? null)
        auditRows.push(['email', cur.email, email])
      } else if (key === 'address' || key === 'tags') {
        set(key === 'address' ? 'address' : 'tags', JSON.stringify(value), '::jsonb')
        auditRows.push([key, cur[key], value])
      } else {
        set(key, value)
        auditRows.push([key, cur[key], value])
      }
    } else if (TRIO_OWNED.has(key)) {
      if (key === 'custom_fields') {
        // custom_fields do người dùng gửi KHÔNG được đụng khoá nhận diện: ghi đè fb_id/alt_phones
        // sẽ khiến matcher gắn nhầm danh tính chat của người khác vào hồ sơ này (§7.2).
        const IDENTITY_KEYS = ['fb_id', 'psid', 'alt_phones', 'pos_customer_id']
        const safe = Object.fromEntries(
          Object.entries(value ?? {}).filter(([k]) => !IDENTITY_KEYS.includes(k)))
        for (const k of Object.keys(value ?? {})) if (IDENTITY_KEYS.includes(k)) skipped.push(`custom_fields.${k}`)
        if (Object.keys(safe).length === 0) continue
        localParams.push(JSON.stringify(safe))
        localSets.push(`custom_fields = custom_fields || $${++p}::jsonb`)
        auditRows.push([key, cur[key], safe])
        continue
      } else set(key, value)
      auditRows.push([key, cur[key], value])
    } else {
      skipped.push(key)   // chỉ đọc (pos_*) hoặc không hợp lệ — từ chối
    }
  }

  if (localSets.length === 0) return { pushed: false, skipped, error: skipped.length ? 'Toàn trường chỉ đọc' : 'Không có gì để sửa' }

  await query(`UPDATE customer SET ${localSets.join(', ')}, updated_at = now() WHERE id = $1`, localParams)

  const auditIds = []
  for (const [field, oldV, newV] of auditRows) {
    const r = await query(
      `INSERT INTO audit_log (user_id, customer_id, field, old_value, new_value, source)
       VALUES ($1,$2,$3,$4,$5,'user') RETURNING id`,
      [userId, customerId, field, JSON.stringify(oldV ?? null), JSON.stringify(newV ?? null)])
    auditIds.push(r.rows[0].id)
  }

  // Chỉ đẩy về POS khi có trường writable thay đổi
  if (Object.keys(writableChanges).length === 0) return { pushed: false, skipped }

  const link = await findPosLink(customerId)
  if (!link) return { pushed: false, skipped, error: 'Khách chưa liên kết hồ sơ POS — chỉ lưu tại TRIOSMART' }
  if (!link.credential_encrypted) return { pushed: false, skipped, error: 'Connection POS thiếu credential' }

  // Payload gửi POS: chỉ các trường đổi, đúng key Pancake, bọc {customer:{...}} ở PosClient
  const posPayload = { ...writableChanges }
  if (posPayload.phone_numbers && !Array.isArray(posPayload.phone_numbers)) {
    posPayload.phone_numbers = [posPayload.phone_numbers]
  }
  if (posPayload.emails && !Array.isArray(posPayload.emails)) posPayload.emails = [posPayload.emails]

  // Echo guard: hash TRẠNG THÁI SAU KHI SỬA (webhook dội về chứa cả khách, không chỉ delta)
  const { rows: [after] } = await query('SELECT * FROM customer WHERE id=$1', [customerId])
  await markSent(computeCustomerHash({ ...posShapeOf(after), ...posPayload }))

  const { api_key } = decryptCredential(link.credential_encrypted)
  const client = new PosClient({ shopId: link.shop_id, apiKey: api_key })
  try {
    const resp = await client.updateCustomer(link.external_id, posPayload)
    await query(
      `UPDATE audit_log SET pushed_to_pancake = true, pancake_response = $2 WHERE id = ANY($1)`,
      [auditIds, JSON.stringify(resp ?? null)])
    return { pushed: true, skipped }
  } catch (e) {
    await query(
      `INSERT INTO pending_push (customer_id, pos_customer_id, connection_id, payload, last_error)
       VALUES ($1,$2,$3,$4,$5)`,
      [customerId, link.external_id, link.id, JSON.stringify(posPayload), String(e.message).slice(0, 1000)])
    return { pushed: false, skipped, error: String(e.message).slice(0, 500) }
  }
}
