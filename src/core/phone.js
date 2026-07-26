// Chuẩn hóa SĐT Việt Nam theo spec §7.1 — 6 bước, đúng thứ tự.
// Trả { normalized, valid }. Số không hợp lệ KHÔNG bị vứt: caller lưu bản gốc
// vào customer.phone_raw và gắn phone_invalid = true.
export function normalizePhone(input) {
  if (input == null) return { normalized: null, valid: false }
  let digits = String(input).replace(/\D/g, '')          // Bước 1 (+84 → còn "84...", đã gộp bước 3)
  if (digits.startsWith('84') && digits.length >= 11 && digits.length <= 12) {
    digits = '0' + digits.slice(2)                        // Bước 2
  }
  if (!digits.startsWith('0') && digits.length === 9) {
    digits = '0' + digits                                 // Bước 4
  }
  const valid = digits.length === 10 && digits.startsWith('0')  // Bước 5
  return valid ? { normalized: digits, valid: true } : { normalized: null, valid: false }  // Bước 6
}
