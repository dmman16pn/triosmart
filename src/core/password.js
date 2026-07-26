import crypto from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(crypto.scrypt)

// scrypt — không cần native dependency, đủ mạnh cho nội bộ (spec §9)
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(plain, stored) {
  const [salt, hash] = String(stored).split(':')
  if (!salt || !hash) return false
  const check = crypto.scryptSync(plain, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return check.length === expected.length && crypto.timingSafeEqual(check, expected)
}

// Bản bất đồng bộ — BẮT BUỘC dùng ở /auth/login: scryptSync chiếm ~23ms CPU và
// chặn toàn bộ event loop, vài chục request đăng nhập/giây là treo cả API lẫn giao diện.
export async function verifyPasswordAsync(plain, stored) {
  const [salt, hash] = String(stored ?? '').split(':')
  if (!salt || !hash) return false
  const check = await scrypt(plain, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return check.length === expected.length && crypto.timingSafeEqual(check, expected)
}

// Hash giả để luôn tốn cùng lượng thời gian khi email không tồn tại
// (nếu không, thời gian phản hồi 1ms/23ms tố cáo email nào có thật).
const DUMMY_HASH = hashPassword(crypto.randomBytes(32).toString('hex'))
export const burnPasswordTime = () => verifyPasswordAsync('x', DUMMY_HASH).catch(() => false)

// Danh sách mật khẩu bị dùng nhiều nhất — chặn theo đúng chuỗi, không chặn theo "có chứa"
// (chặn "có chứa" sẽ loại oan cả những mật khẩu mạnh chỉ tình cờ mang một đoạn phổ biến).
const BANNED = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890', 'password', 'password1',
  'matkhau', 'matkhau123', 'doimatkhau', 'doimatkhau123', 'qwerty', 'qwerty123',
  'admin', 'admin123', 'administrator', 'iloveyou', 'abc123', 'letmein', 'welcome'
])

// Yêu cầu độ mạnh tối thiểu (áp dụng khi tạo/đổi mật khẩu): độ dài + đa dạng ký tự.
// Cách đo này theo hướng dẫn NIST — độ dài và số nhóm ký tự quyết định công sức dò,
// quan trọng hơn nhiều so với việc cấm một vài chuỗi con.
export function assertStrongPassword(plain) {
  const p = String(plain ?? '')
  if (p.length < 10) throw new Error('Mật khẩu phải từ 10 ký tự trở lên')
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(re => re.test(p)).length
  if (classes < 3) {
    throw new Error('Mật khẩu cần ít nhất 3 trong 4 nhóm: chữ thường, chữ HOA, chữ số, ký tự đặc biệt')
  }
  if (BANNED.has(p.toLowerCase().replace(/[^a-z0-9]/g, ''))) throw new Error('Mật khẩu quá phổ biến, dễ bị dò')
  return p
}
