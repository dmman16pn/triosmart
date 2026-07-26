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

// Yêu cầu độ mạnh tối thiểu cho mật khẩu người dùng (áp dụng khi tạo/đổi mật khẩu)
export function assertStrongPassword(plain) {
  const p = String(plain ?? '')
  if (p.length < 10) throw new Error('Mật khẩu phải từ 10 ký tự trở lên')
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) throw new Error('Mật khẩu phải có cả chữ và số')
  const weak = ['matkhau', 'password', '123456', 'admin', 'qwerty', 'doimatkhau']
  if (weak.some(w => p.toLowerCase().includes(w))) throw new Error('Mật khẩu quá dễ đoán')
  return p
}
