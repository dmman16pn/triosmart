// Chạy TRƯỚC mọi module trong test (vitest setupFiles): config.js đọc env ngay lúc import,
// và từ chối khởi động nếu khoá còn là giá trị mẫu → phải đặt khoá test ở đây.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  || 'postgres://trio:trio_test@localhost:5434/triosmart_test'
process.env.WEBHOOK_SECRET = 'test-secret-pos-only-for-tests'
process.env.CHAT_WEBHOOK_SECRET = 'test-secret-chat-only-for-tests'
process.env.CREDENTIAL_KEY = 'test-key-only-for-tests'
process.env.POS_URL_SECRET = 'test-secret-pos-url-only-for-tests'
process.env.POS_WEBHOOK_IPS = '203.0.113.9'
process.env.JWT_SECRET = 'test-jwt-secret-only-for-tests'
