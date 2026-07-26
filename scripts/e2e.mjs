/* E2E smoke toàn hệ thống — chạy THẬT receiver + worker + API trên DB dev.
 * Luồng: reset DB → seed admin → login → tạo connection → bắn webhook thật
 * → worker xử lý → kiểm tra khách/đơn/ghép → PATCH (Pancake không reachable
 * → phải báo pushed:false trung thực) → dashboard → frontend index.
 * Dùng: node scripts/e2e.mjs   (cần docker compose postgres đang chạy + .env)
 */
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { pool, query } from '../src/db.js'
import { hashPassword } from '../src/core/password.js'

const API = 'http://localhost:3002'
const HOOK = 'http://localhost:3001'
const SECRET = process.env.WEBHOOK_SECRET
let failures = 0
const results = []

function check(name, cond, detail = '') {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

async function jfetch(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

// ---------- chuẩn bị ----------
console.log('[e2e] reset DB dev + seed admin')
await query(`TRUNCATE webhook_event, sync_log, audit_log, merge_queue, echo_guard, conversation,
  "order", customer_identity, customer, connection, pending_push, app_user, alert CASCADE`)
await query(
  `INSERT INTO app_user (email, password_hash, name, role) VALUES ($1,$2,'E2E Admin','admin')`,
  ['e2e@test.vn', hashPassword('e2e-mk-123')])

const procs = []
const start = (name, file) => {
  const p = spawn('node', [file], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  p.stderr.on('data', d => process.stderr.write(`[${name}] ${d}`))
  procs.push(p)
}
start('receiver', 'src/receiver/server.js')
start('worker', 'src/worker/index.js')
start('api', 'src/api/server.js')
await sleep(2000)

try {
  // ---------- 1. đăng nhập ----------
  const login = await jfetch('/api/auth/login', { method: 'POST', body: { email: 'e2e@test.vn', password: 'e2e-mk-123' } })
  check('Đăng nhập admin', login.status === 200 && !!login.body.token, JSON.stringify(login.body))
  const token = login.body.token

  // ---------- 2. tạo connection POS + Chat ----------
  const pos = await jfetch('/api/connections', {
    method: 'POST', token,
    body: { type: 'pos', name: 'Shop E2E', shop_id: 'shop_e2e', credential: { api_key: 'k-e2e' } }
  })
  check('Tạo connection POS (credential không lộ)', pos.status === 201 && pos.body.has_credential
    && !JSON.stringify(pos.body).includes('k-e2e'), JSON.stringify(pos.body))
  const chat = await jfetch('/api/connections', {
    method: 'POST', token,
    body: { type: 'chat', name: 'Page E2E', page_id: 'page_e2e', credential: { page_access_token: 't-e2e' } }
  })
  check('Tạo connection Chat', chat.status === 201, JSON.stringify(chat.body))

  // ---------- 3. bắn webhook POS customer + order ----------
  const hookHeaders = { 'Content-Type': 'application/json', 'X-Trio-Secret': SECRET }
  let r = await fetch(`${HOOK}/hooks/pos`, {
    method: 'POST', headers: hookHeaders,
    body: JSON.stringify({
      event: 'customers', shop_id: 'shop_e2e',
      customer: {
        id: 'e2e_c1', name: 'Khách E2E', phone_numbers: ['+84 909 000 111'],
        purchased_amount: 750000, order_count: 2, succeed_order_count: 2,
        last_order_at: new Date().toISOString()
      }
    })
  })
  check('Webhook POS customer trả 200', r.status === 200)
  r = await fetch(`${HOOK}/hooks/pos`, {
    method: 'POST', headers: hookHeaders,
    body: JSON.stringify({
      event: 'orders', shop_id: 'shop_e2e',
      order: { id: 5001, status: 3, total_price: 750000, inserted_at: new Date().toISOString(),
        customer: { id: 'e2e_c1', name: 'Khách E2E', phone_numbers: ['0909000111'] } }
    })
  })
  check('Webhook POS order trả 200', r.status === 200)

  // ---------- 4. bắn webhook Chat (secret trong URL) trùng SĐT → phải tự ghép ----------
  r = await fetch(`${HOOK}/hooks/chat/${SECRET}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_type: 'messaging', page_id: 'page_e2e',
      conversation: { id: 'cv_e2e_1', type: 'INBOX' },
      customer: { psid: 'psid_e2e', name: 'Khách E2E Zalo', phone_number: '84909000111' },
      message: { text: 'Chào shop, đơn em tới đâu rồi?', inserted_at: new Date().toISOString() }
    })
  })
  check('Webhook Chat (secret URL) trả 200', r.status === 200)

  console.log('[e2e] chờ worker xử lý…')
  await sleep(3500)

  // ---------- 5. kiểm tra dữ liệu hợp nhất ----------
  const events = await query(`SELECT status, count(*)::int AS n FROM webhook_event GROUP BY status`)
  const done = events.rows.find(e => e.status === 'done')?.n ?? 0
  check('Cả 3 sự kiện webhook đã xử lý done', done === 3, JSON.stringify(events.rows))

  const list = await jfetch('/api/customers', { token })
  check('CHỈ 1 hồ sơ khách (POS + Chat đã ghép qua SĐT)', list.body.total === 1, `total=${list.body.total}`)
  const cust = list.body.rows[0]
  check('Khách có đủ 2 danh tính pos + chat',
    cust?.identities?.length === 2
    && cust.identities.some(i => i.source_type === 'pos')
    && cust.identities.some(i => i.source_type === 'chat'),
    JSON.stringify(cust?.identities))
  check('Phân khúc RFM tự tính (2 đơn, mới mua → Chưa phân loại theo bảng spec)',
    cust?.rfm_segment != null, JSON.stringify(cust?.rfm_segment))

  const detail = await jfetch(`/api/customers/${cust.id}`, { token })
  check('Hồ sơ 360° có timeline cả đơn hàng lẫn hội thoại',
    detail.body.timeline?.some(t => t.kind === 'order') && detail.body.timeline?.some(t => t.kind === 'chat'),
    JSON.stringify(detail.body.timeline?.map(t => t.kind)))
  check('Đơn hàng gắn đúng khách, đúng số tiền',
    Number(detail.body.orders?.[0]?.total_amount) === 750000, JSON.stringify(detail.body.orders))

  // ---------- 6. sửa hồ sơ — Pancake KHÔNG reachable → phải trung thực pushed:false ----------
  const patch = await jfetch(`/api/customers/${cust.id}`, {
    method: 'PATCH', token, body: { name: 'Khách E2E Đã Sửa' }
  })
  check('PATCH lưu local + BÁO THẬT chưa đẩy được Pancake (pushed:false + lý do)',
    patch.status === 200 && patch.body.pushed === false && !!patch.body.error, JSON.stringify(patch.body))
  const after = await jfetch(`/api/customers/${cust.id}`, { token })
  check('Tên đã đổi tại TRIOSMART', after.body.customer.name === 'Khách E2E Đã Sửa')
  const pp = await query(`SELECT count(*)::int AS n FROM pending_push WHERE status='pending'`)
  check('Thay đổi vào pending_push chờ tự thử lại', pp.rows[0].n === 1)
  const audit = await query(`SELECT count(*)::int AS n FROM audit_log WHERE field='name' AND source='user'`)
  check('Audit log ghi lại lần sửa', audit.rows[0].n === 1)

  // ---------- 7. dashboard + phân quyền ----------
  const dash = await jfetch('/api/dashboard', { token })
  check('Dashboard: tổng khách=1, doanh số=750000, tỉ lệ SĐT hợp lệ=100%',
    dash.body.total_customers === 1 && dash.body.total_revenue === 750000 && dash.body.phone_valid_rate === 1,
    JSON.stringify({ t: dash.body.total_customers, r: dash.body.total_revenue, p: dash.body.phone_valid_rate }))

  const noAuth = await jfetch('/api/customers')
  check('Không token → 401', noAuth.status === 401)

  // ---------- 8. frontend được phục vụ ----------
  const fe = await fetch(`${API}/`)
  const html = await fe.text()
  check('Frontend index.html được API phục vụ', fe.status === 200 && html.includes('TRIOSMART'))
  const feDeep = await fetch(`${API}/customers`)
  check('SPA fallback cho đường dẫn sâu', feDeep.status === 200)

  // ---------- 9. sự kiện sai secret bị bỏ qua ----------
  r = await fetch(`${HOOK}/hooks/pos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trio-Secret': 'sai' },
    body: JSON.stringify({ event: 'customers', customer: { id: 'hacker', name: 'Giả mạo' } })
  })
  await sleep(1500)
  const skipped = await query(`SELECT count(*)::int AS n FROM webhook_event WHERE status='skipped'`)
  const hacker = await query(`SELECT count(*)::int AS n FROM customer WHERE name='Giả mạo'`)
  check('Webhook sai secret: 200 nhưng skipped, KHÔNG tạo dữ liệu',
    r.status === 200 && skipped.rows[0].n === 1 && hacker.rows[0].n === 0)
} catch (e) {
  check('E2E chạy trọn vẹn không văng lỗi', false, e.stack)
} finally {
  procs.forEach(p => p.kill())
  await pool.end()
}

console.log('\n===== KẾT QUẢ E2E =====')
results.forEach(r => console.log(r))
console.log(`\n${failures === 0 ? '🎉 TẤT CẢ PASS' : `💥 ${failures} kiểm tra FAIL`}`)
process.exit(failures === 0 ? 0 : 1)
