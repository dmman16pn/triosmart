// Tạo tài khoản admin đầu tiên: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME từ env
// Dùng: node scripts/seedAdmin.js
import { query, pool } from '../src/db.js'
import { hashPassword } from '../src/core/password.js'

const email = (process.env.ADMIN_EMAIL ?? 'admin@triosmart.local').toLowerCase()
const password = process.env.ADMIN_PASSWORD ?? 'doimatkhau123'
const name = process.env.ADMIN_NAME ?? 'Quản trị viên'

const { rows } = await query(
  `INSERT INTO app_user (email, password_hash, name, role)
   VALUES ($1, $2, $3, 'admin')
   ON CONFLICT (email) DO UPDATE SET password_hash = $2, active = true
   RETURNING id`,
  [email, hashPassword(password), name])
console.log(`[seedAdmin] admin sẵn sàng: ${email} (id ${rows[0].id})`)
await pool.end()
