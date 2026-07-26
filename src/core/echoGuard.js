import crypto from 'node:crypto'
import { query } from '../db.js'

// Chỉ hash 7 trường ghi ngược được (spec §7.4) — số liệu POS không bao giờ do Trio gửi.
const HASH_FIELDS = ['name', 'phone_numbers', 'emails', 'gender', 'date_of_birth', 'address', 'tags']

export function computeCustomerHash(fields) {
  const norm = {}
  for (const k of HASH_FIELDS) {
    let v = fields?.[k]
    // POS gửi address trong shop_customer_addresses — quy về một key trước khi hash
    if (k === 'address' && v == null) v = fields?.shop_customer_addresses
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) {
      if (v.length === 0) continue                       // [] và thiếu trường coi như nhau
      v = k === 'phone_numbers' ? [...v].map(String).sort() : v
    }
    if (v instanceof Date) v = v.toISOString().slice(0, 10)
    if (k === 'date_of_birth' && typeof v === 'string') v = v.slice(0, 10)
    norm[k] = v
  }
  return crypto.createHash('sha256').update(stableStringify(norm)).digest('hex')
}

// JSON.stringify với replacer mảng lọc key ở MỌI cấp (làm rỗng object lồng nhau) — tự viết cho chuẩn.
function stableStringify(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o)
  if (Array.isArray(o)) return '[' + o.map(stableStringify).join(',') + ']'
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}'
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
