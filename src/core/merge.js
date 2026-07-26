import { pool, query } from '../db.js'

async function inTx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const r = await fn(client)
    await client.query('COMMIT')
    return r
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

// Các cột được snapshot/khôi phục khi gộp-tách (không gồm id, created_at)
const RESTORE_COLS = ['phone_normalized', 'phone_raw', 'phone_invalid', 'name', 'email', 'gender',
  'date_of_birth', 'address', 'tags', 'pos_purchased_amount', 'pos_order_count',
  'pos_succeed_order_count', 'pos_last_order_at', 'pos_reward_point', 'pos_level_id',
  'rfm_segment', 'internal_note', 'assigned_user_id', 'custom_fields', 'zalo_consent', 'merge_status']

const jsonbCols = new Set(['address', 'tags', 'custom_fields'])
const colVal = (row, c) => jsonbCols.has(c) && row[c] != null ? JSON.stringify(row[c]) : row[c]

// Gộp hai hồ sơ (spec §7.2). Trả id bản ghi audit __merge__ — dùng cho undo trong 24h (màn A5).
export async function mergeCustomers(keepId, otherId, { userId = null } = {}) {
  if (keepId === otherId) throw new Error('không thể tự gộp với chính mình')
  return inTx(async (c) => {
    const { rows: [keep] } = await c.query('SELECT * FROM customer WHERE id=$1 FOR UPDATE', [keepId])
    const { rows: [other] } = await c.query('SELECT * FROM customer WHERE id=$1 FOR UPDATE', [otherId])
    if (!keep || !other) throw new Error('hồ sơ không tồn tại')

    const snapshot = {
      keep_before: keep,
      other,
      identity_ids: (await c.query('SELECT id FROM customer_identity WHERE customer_id=$1', [otherId])).rows.map(r => r.id),
      order_ids: (await c.query('SELECT id FROM "order" WHERE customer_id=$1', [otherId])).rows.map(r => r.id),
      conversation_ids: (await c.query('SELECT id FROM conversation WHERE customer_id=$1', [otherId])).rows.map(r => r.id)
    }

    // Tránh vỡ UNIQUE(phone_normalized): bỏ phone của other TRƯỚC khi đụng tới keep
    await c.query('UPDATE customer SET phone_normalized=NULL WHERE id=$1', [otherId])

    await c.query('UPDATE customer_identity SET customer_id=$1 WHERE customer_id=$2', [keepId, otherId])
    await c.query('UPDATE "order" SET customer_id=$1 WHERE customer_id=$2', [keepId, otherId])
    await c.query('UPDATE conversation SET customer_id=$1 WHERE customer_id=$2', [keepId, otherId])

    // Trộn theo trường: keep thắng, chỗ trống lấy của other; phone thừa giữ vào alt_phones
    const altPhones = new Set([...(keep.custom_fields?.alt_phones ?? []), ...(other.custom_fields?.alt_phones ?? [])])
    if (other.phone_normalized && keep.phone_normalized && other.phone_normalized !== keep.phone_normalized) {
      altPhones.add(other.phone_normalized)
    }
    const mergedCustom = { ...other.custom_fields, ...keep.custom_fields }
    if (altPhones.size) mergedCustom.alt_phones = [...altPhones]

    const takePos = Number(keep.pos_order_count) === 0 && Number(other.pos_order_count) > 0
    await c.query(
      `UPDATE customer SET
         phone_normalized = COALESCE(phone_normalized, $2),
         phone_raw = COALESCE(phone_raw, $3),
         name = COALESCE(name, $4), email = COALESCE(email, $5),
         gender = COALESCE(gender, $6), date_of_birth = COALESCE(date_of_birth, $7),
         address = COALESCE(address, $8::jsonb),
         internal_note = COALESCE(internal_note, $9),
         custom_fields = $10::jsonb,
         pos_purchased_amount = CASE WHEN $11 THEN $12 ELSE pos_purchased_amount END,
         pos_order_count = CASE WHEN $11 THEN $13::int ELSE pos_order_count END,
         pos_succeed_order_count = CASE WHEN $11 THEN $14::int ELSE pos_succeed_order_count END,
         pos_last_order_at = CASE WHEN $11 THEN $15::timestamptz ELSE pos_last_order_at END,
         merge_status = 'manual', updated_at = now()
       WHERE id = $1`,
      [keepId, other.phone_normalized, other.phone_raw, other.name, other.email,
       other.gender, other.date_of_birth,
       other.address != null ? JSON.stringify(other.address) : null,
       other.internal_note, JSON.stringify(mergedCustom), takePos,
       other.pos_purchased_amount, other.pos_order_count, other.pos_succeed_order_count,
       other.pos_last_order_at])

    await c.query('DELETE FROM customer WHERE id=$1', [otherId])

    const { rows: [audit] } = await c.query(
      `INSERT INTO audit_log (user_id, customer_id, field, old_value, new_value, source)
       VALUES ($1, $2, '__merge__', $3, $4, 'merge') RETURNING id`,
      [userId, keepId, JSON.stringify(snapshot), JSON.stringify({ kept: keepId, removed: otherId })])
    return audit.id
  })
}

// Hoàn tác gộp trong 24 giờ (A5) — khôi phục ĐÚNG trạng thái trước gộp từ snapshot (spec §7.2).
export async function undoMerge(mergeAuditId, { userId = null } = {}) {
  const { rows: [audit] } = await query(
    `SELECT * FROM audit_log WHERE id=$1 AND field='__merge__'`, [mergeAuditId])
  if (!audit) throw new Error('không tìm thấy bản ghi gộp')
  if (new Date(audit.created_at).getTime() < Date.now() - 24 * 3600 * 1000) {
    throw new Error('quá 24 giờ — không thể hoàn tác')
  }
  const snap = audit.old_value
  const keepId = snap.keep_before.id, other = snap.other

  return inTx(async (c) => {
    // 1. Trả keep về trạng thái cũ (trước — để nhả phone của other nếu đã lấy)
    const sets = RESTORE_COLS.map((col, i) => `${col} = $${i + 2}${jsonbCols.has(col) ? '::jsonb' : ''}`)
    await c.query(`UPDATE customer SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
      [keepId, ...RESTORE_COLS.map(col => colVal(snap.keep_before, col))])

    // 2. Dựng lại other với đúng uuid cũ
    const cols = ['id', ...RESTORE_COLS]
    await c.query(
      `INSERT INTO customer (${cols.join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}${jsonbCols.has(cols[i]) ? '::jsonb' : ''}`).join(', ')})`,
      cols.map(col => colVal(other, col)))

    // 3. Trả con cái về chủ cũ theo đúng id đã snapshot
    if (snap.identity_ids.length) await c.query(
      'UPDATE customer_identity SET customer_id=$1 WHERE id = ANY($2)', [other.id, snap.identity_ids])
    if (snap.order_ids.length) await c.query(
      'UPDATE "order" SET customer_id=$1 WHERE id = ANY($2)', [other.id, snap.order_ids])
    if (snap.conversation_ids.length) await c.query(
      'UPDATE conversation SET customer_id=$1 WHERE id = ANY($2)', [other.id, snap.conversation_ids])

    await c.query(
      `INSERT INTO audit_log (user_id, customer_id, field, old_value, new_value, source)
       VALUES ($1, $2, '__unmerge__', $3, $4, 'merge')`,
      [userId, keepId, JSON.stringify({ merge_audit_id: mergeAuditId }),
       JSON.stringify({ restored: other.id })])
    return true
  })
}

// Tách một danh tính khỏi hồ sơ: hồ sơ mới + hội thoại (chat) / đơn hàng (pos) đi theo danh tính đó.
export async function splitIdentity(identityId, { userId = null } = {}) {
  return inTx(async (c) => {
    const { rows: [ident] } = await c.query(
      'SELECT * FROM customer_identity WHERE id=$1 FOR UPDATE', [identityId])
    if (!ident) throw new Error('danh tính không tồn tại')
    const fromId = ident.customer_id

    const { rows: [nc] } = await c.query(
      `INSERT INTO customer (merge_status) VALUES ('manual') RETURNING *`)
    await c.query('UPDATE customer_identity SET customer_id=$1 WHERE id=$2', [nc.id, identityId])

    if (ident.source_type === 'chat') {
      await c.query(
        `UPDATE conversation SET customer_id=$1 WHERE connection_id=$2 AND psid=$3`,
        [nc.id, ident.connection_id, ident.external_id])
    } else {
      await c.query(
        `UPDATE "order" SET customer_id=$1
         WHERE connection_id=$2 AND (raw->'customer'->>'id') = $3`,
        [nc.id, ident.connection_id, ident.external_id])
    }

    await c.query(
      `INSERT INTO audit_log (user_id, customer_id, field, old_value, new_value, source)
       VALUES ($1, $2, '__split__', $3, $4, 'merge')`,
      [userId, fromId, JSON.stringify({ identity: ident }), JSON.stringify({ to: nc.id })])
    return nc
  })
}

// Duyệt hàng đợi gộp trùng (A5). action: merge | keep_separate | ignore.
// keepId tùy chọn — mặc định ưu tiên hồ sơ có danh tính POS, rồi hồ sơ nhiều đơn hơn.
export async function resolveMergeQueue(itemId, action, { userId = null, keepId = null } = {}) {
  const { rows: [item] } = await query('SELECT * FROM merge_queue WHERE id=$1', [itemId])
  if (!item) throw new Error('mục hàng đợi không tồn tại')
  if (item.status !== 'open') throw new Error('mục này đã được xử lý')

  let mergeAuditId = null
  if (action === 'merge') {
    let keep = keepId
    if (!keep) {
      const { rows } = await query(
        `SELECT c.id,
           (SELECT count(*) FROM customer_identity i WHERE i.customer_id=c.id AND i.source_type='pos') AS pos_ids,
           (SELECT count(*) FROM "order" o WHERE o.customer_id=c.id) AS orders
         FROM customer c WHERE c.id = ANY($1)`, [[item.candidate_a, item.candidate_b]])
      rows.sort((a, b) => (b.pos_ids - a.pos_ids) || (b.orders - a.orders))
      keep = rows[0]?.id
      if (!keep) throw new Error('cả hai hồ sơ đều không còn tồn tại')
    }
    const other = keep === item.candidate_a ? item.candidate_b : item.candidate_a
    mergeAuditId = await mergeCustomers(keep, other, { userId })
  }

  const status = { merge: 'merged', keep_separate: 'kept_separate', ignore: 'ignored' }[action]
  if (!status) throw new Error(`action không hợp lệ: ${action}`)
  await query(
    `UPDATE merge_queue SET status=$2, resolved_by=$3 WHERE id=$1`, [itemId, status, userId])
  return { status, mergeAuditId }
}
