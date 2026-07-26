import 'dotenv/config'

function required(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Thiếu biến môi trường ${name}`)
  return v
}

// Giá trị mẫu trong .env.example — nếu chạy production mà vẫn dùng thì bất kỳ ai đọc repo
// cũng ký được token admin / giải mã được credential Pancake. Chặn ngay lúc khởi động.
const PLACEHOLDERS = new Set([
  'doi-chuoi-nay-khi-trien-khai',
  '32-byte-hex-doi-khi-trien-khai',
  'doi-chuoi-nay-khi-trien-khai-jwt'
])

function secret(name, { minLength = 32 } = {}) {
  const v = required(name)
  if (PLACEHOLDERS.has(v)) {
    throw new Error(`${name} vẫn là giá trị mẫu — sinh khoá mới: openssl rand -hex 32`)
  }
  if (process.env.NODE_ENV === 'production' && v.length < minLength) {
    throw new Error(`${name} quá ngắn (cần ≥ ${minLength} ký tự) — sinh khoá mới: openssl rand -hex 32`)
  }
  return v
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  receiverPort: Number(process.env.RECEIVER_PORT || 3001),
  apiPort: Number(process.env.API_PORT || 3002),
  // Production: chỉ nghe trên loopback, mọi truy cập đi qua Nginx (nếu không thì gọi thẳng
  // http://<ip-vps>:3002 là bỏ qua toàn bộ lớp bảo vệ của Cloudflare/Nginx)
  bindHost: process.env.BIND_HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0'),
  webhookSecret: secret('WEBHOOK_SECRET'),
  // Secret của chat nằm trong URL → lọt vào access log; tách riêng để lộ nó không kéo theo POS.
  chatWebhookSecret: process.env.CHAT_WEBHOOK_SECRET || secret('WEBHOOK_SECRET'),
  // ĐỐI CHIẾU THỰC TẾ 26/07/2026: Pancake POS NHẬN webhook_headers khi cấu hình nhưng
  // KHÔNG gửi lại header đó — mọi request tới đều không có X-Trio-Secret. Buộc phải
  // xác thực POS bằng secret trong đường dẫn, dùng secret riêng cho từng nguồn.
  posUrlSecret: process.env.POS_URL_SECRET || null,
  // ...và KHÔNG cho đổi webhook_url sau lần đăng ký đầu (PUT trả success nhưng vẫn gọi URL cũ),
  // nên không có cách nào để Pancake mang secret theo. Phương án còn lại: chỉ chấp nhận
  // webhook POS đến từ đúng IP máy chủ Pancake (danh sách cấu hình được, có cảnh báo khi đổi).
  posWebhookIps: (process.env.POS_WEBHOOK_IPS ?? '').split(',').map(s => s.trim()).filter(Boolean),
  credentialKey: secret('CREDENTIAL_KEY'),
  // Khoá RIÊNG, không suy ra từ CREDENTIAL_KEY: lộ một khoá không được kéo theo khoá kia.
  jwtSecret: secret('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h'
}
