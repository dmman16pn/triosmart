// Tạo tài khoản admin đầu tiên. BẮT BUỘC truyền qua env — không có giá trị mặc định:
// mật khẩu mặc định nằm trong repo đồng nghĩa với việc ai đọc repo cũng đăng nhập được.
// Dùng: ADMIN_EMAIL=... ADMIN_PASSWORD='...' node scripts/seedAdmin.js
import { query, pool } from '../src/db.js'
import { hashPassword, assertStrongPassword } from '../src/core/password.js'

const email = String(process.env.ADMIN_EMAIL ?? '').toLowerCase().trim()
const password = process.env.ADMIN_PASSWORD ?? ''
const name = process.env.ADMIN_NAME ?? 'Quản trị viên'

if (!email || !email.includes('@')) {
  console.error('Thiếu ADMIN_EMAIL hợp lệ'); process.exit(1)
}
try { assertStrongPassword(password) }
catch (e) { console.error(`ADMIN_PASSWORD: ${e.message}`); process.exit(1) }

// KHÔNG reset mật khẩu/kích hoạt lại tài khoản đã có: chạy nhầm lệnh này không được phép
// ghi đè mật khẩu admin thật hay mở lại tài khoản đã bị khoá.
const { rows } = await query(
  `INSERT INTO app_user (email, password_hash, name, role, must_change_password)
   VALUES ($1, $2, $3, 'admin', true)
   ON CONFLICT (email) DO NOTHING
   RETURNING id`,
  [email, hashPassword(password), name])

if (rows.length) console.log(`[seedAdmin] đã tạo admin: ${email} (id ${rows[0].id}) — đăng nhập xong phải đổi mật khẩu`)
else console.log(`[seedAdmin] ${email} đã tồn tại, không thay đổi gì (đổi mật khẩu qua giao diện Người dùng)`)
await pool.end()
