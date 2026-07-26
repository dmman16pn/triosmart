import crypto from 'node:crypto'

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
