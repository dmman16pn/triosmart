import crypto from 'node:crypto'
import { query } from '../db.js'

// Chỉ hash 7 trường ghi ngược được (spec §7.4) — số liệu POS không bao giờ do Trio gửi.
const HASH_FIELDS = ['name', 'phone_numbers', 'emails', 'gender', 'date_of_birth', 'address', 'tags']

export function computeCustomerHash(fields) {
  const norm = {}
  for (const k of HASH_FIELDS) {
    if (fields?.[k] === undefined || fields?.[k] === null) continue
    norm[k] = Array.isArray(fields[k]) && k === 'phone_numbers'
      ? [...fields[k]].map(String).sort()
      : fields[k]
  }
  return crypto.createHash('sha256').update(JSON.stringify(norm, Object.keys(norm).sort())).digest('hex')
}

export async function markSent(hash) {
  await query(
    `INSERT INTO echo_guard (hash) VALUES ($1)
     ON CONFLICT (hash) DO UPDATE SET created_at = now()`, [hash])
}

// Dùng một lần: khớp là xóa luôn để webhook thật sự tiếp theo (nếu trùng nội dung) vẫn được xử lý.
export async function isEcho(hash) {
  const { rows } = await query(
    `DELETE FROM echo_guard WHERE hash = $1 AND created_at > now() - interval '5 minutes'
     RETURNING hash`, [hash])
  return rows.length > 0
}

export async function cleanupEchoGuard() {
  await query(`DELETE FROM echo_guard WHERE created_at < now() - interval '5 minutes'`)
}
