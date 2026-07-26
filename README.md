# TRIOSMART — Backend

Lớp dữ liệu khách hàng hợp nhất đặt trên nền tảng Pancake (POS + Chat).
Đặc tả đầy đủ: `../TRIOSMART-Dac-ta-phan-mem-v1.0.md` · Kế hoạch: `../docs/plans/`

## Trạng thái

- ✅ **Plan 1 — Backend lõi** (hoàn thành): nhận webhook, đồng bộ chiều vào, ghép danh tính, nạp lịch sử + nạp bù
- ⬜ Plan 2 — Ghi ngược + chống tiếng vọng + audit log
- ⬜ Plan 3 — REST API + React UI + RFM + phân quyền

## Kiến trúc

Ba tiến trình độc lập, cùng codebase, PostgreSQL là kho duy nhất:

| Tiến trình | Lệnh | Vai trò |
|---|---|---|
| Receiver | `npm run receiver` | Nhận webhook Pancake — CHỈ ghi thô vào `webhook_event` rồi trả 200 (< 1s) |
| Worker | `npm run worker` | Poll `webhook_event` pending → chuẩn hóa → upsert customer/order/conversation → ghép danh tính |
| Scheduler | `npm run scheduler` | Nạp bù mỗi giờ (cron `15 * * * *`, pg-boss) từ mốc đồng bộ thành công gần nhất |

## Chạy dev

```bash
docker compose up -d            # Postgres dev (:5442) + test (:5434)
cp .env.example .env            # đổi WEBHOOK_SECRET, CREDENTIAL_KEY khi triển khai thật
set -a; source .env; set +a
npm install
npm run migrate                 # migrate DB dev
npm run migrate:test            # migrate DB test
npm test                        # 45 tests
```

## Seed connection (chưa có UI — Plan 3)

```bash
# 1. Mã hóa credential
node -e "
import('./src/core/credentials.js').then(m =>
  console.log(m.encryptCredential({ api_key: 'API_KEY_CUA_SHOP' })))
"
# 2. Chèn connection POS
docker compose exec -T postgres psql -U trio -d triosmart -c \
  "INSERT INTO connection (type, name, shop_id, credential_encrypted)
   VALUES ('pos', 'Shop chính', 'SHOP_ID', 'CHUOI_DA_MA_HOA');"
```

Connection chat tương tự với `type='chat'`, `page_id`, credential `{ page_access_token: '...' }`.

## Webhook đăng ký với Pancake

- **POS** (`PUT /shops/{SHOP_ID}` với `webhook_url`, `webhook_headers`):
  - URL: `https://<domain>/hooks/pos`
  - Header: `X-Trio-Secret: <WEBHOOK_SECRET>` — bắt buộc, sai secret sự kiện bị bỏ qua (vẫn trả 200)
- **Chat** (đội hỗ trợ Pancake bật hộ, không cấu hình được header):
  - URL: `https://<domain>/hooks/chat/<WEBHOOK_SECRET>` — secret nằm trong đường dẫn

## Nạp lịch sử ban đầu

```bash
node -e "
import('./src/scheduler/initialSync.js').then(async m => {
  await m.initialSyncPos('CONNECTION_UUID')
  process.exit(0)
})
"
```

Tiến trình ghi vào `sync_log` (count_ok / count_fail từng entity).

## Biến môi trường

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | Postgres chính |
| `TEST_DATABASE_URL` | Postgres test (vitest tự trỏ vào đây) |
| `RECEIVER_PORT` | Cổng receiver, mặc định 3001 |
| `WEBHOOK_SECRET` | Secret xác thực webhook (header POS / URL chat) |
| `CREDENTIAL_KEY` | Khóa AES-256-GCM mã hóa credential trong bảng `connection` |

## Nguyên tắc bất di bất dịch (từ đặc tả)

1. Handler webhook chỉ làm 3 việc: nhận → ghi thô → trả 200. Mọi nghiệp vụ ở worker.
2. POS là nguồn sự thật; số liệu POS (`purchased_amount`…) lấy nguyên payload, không tự cộng.
3. Không bao giờ tự gộp hồ sơ khi confidence < 90 — trùng tên không SĐT vào `merge_queue`.
4. SĐT không hợp lệ vẫn giữ (`phone_raw` + `phone_invalid`), không vứt.
5. Credential mã hóa khi lưu, không ghi log, không bao giờ trả về trình duyệt.

## Cập nhật trạng thái (Plan 2 + Plan 3 hoàn thành)

- ✅ Plan 2: ghi ngược POS (writeback), echo guard, xung đột theo trường 60s, gộp/tách + hoàn tác 24h, backfill Chat, retry pending_push
- ✅ Plan 3: API + JWT + phân quyền 3 vai trò, RFM engine cấu hình được, retention, cảnh báo lỗi 20%/5phút, frontend React 12 màn hình

### Chạy đầy đủ hệ thống

```bash
docker compose up -d && set -a; source .env; set +a
npm run migrate
ADMIN_EMAIL=admin@cty.vn ADMIN_PASSWORD=matkhau node scripts/seedAdmin.js
(cd frontend && npm install && npm run build)
npm run receiver &   # :3001 — nhận webhook Pancake
npm run worker &     # xử lý sự kiện + retry push + cảnh báo
npm run scheduler &  # nạp bù mỗi giờ + RFM đêm + dọn dữ liệu
npm run api &        # :3002 — API + giao diện web
```

Mở http://localhost:3002 và đăng nhập.

### Kiểm thử

```bash
npm test              # 140 unit/integration test (DB test riêng :5434), gồm tests/security.test.js
node scripts/e2e.mjs  # 22 kiểm tra đầu-cuối — TỪ CHỐI chạy nếu CSDL có >100 khách (nó TRUNCATE)
python3 scripts/uiTest.py    # quét 12 trang bằng Playwright
python3 scripts/uiStress.py  # 60 lượt điều hướng loạn xạ, bắt lỗi trắng trang
```

### Ghi chú nghiệp vụ cần chủ đầu tư chốt (đã ghi nhận khi build)

1. RFM: bảng spec §7.7 không phủ trường hợp `succeed>=2` nhưng mua gần (<60 ngày, chưa đủ 3 đơn) → hệ tạm gán "Chưa phân loại" (hiển thị trung thực). Chốt lại ngưỡng ở màn Cấu hình.
2. Manager xem audit "chỉ nhóm mình": v1 dùng proxy connection_ids giao nhau; manager chưa gán nguồn → thấy tất cả.
3. Webhook Chat xác thực bằng secret trong URL đăng ký (`/hooks/chat/<secret>`) vì Pancake Chat không hỗ trợ custom header.


---

## Triển khai production (trio.shinsulab.com)

Chạy trên VPS `152.53.211.170`, Cloudflare đứng trước làm HTTPS/CDN/chống DDoS.

| Thành phần | Vị trí |
|---|---|
| Mã nguồn | `/root/triosmart/app` (bản trước: `app_old`) |
| Cấu hình bí mật | `/root/triosmart/app/.env` (chmod 600) |
| PostgreSQL | container `trio-postgres`, chỉ mở `127.0.0.1:5441`, volume `trio_pgdata` |
| Tiến trình | pm2: `trio-api` :3002, `trio-receiver` :3011, `trio-worker`, `trio-scheduler` |
| Nginx | `/etc/nginx/sites-available/trio.shinsulab.com` |
| Dải IP Cloudflare | `/etc/nginx/conf.d/cloudflare-realip.conf` + `/etc/nginx/snippets/trio-cloudflare-allow.inc` |
| Backup | `/usr/local/bin/trio-backup-r2.sh`, cron 02:10 → `r2/ksss-backups/triosmart/`, giữ 30 ngày |

### Quy trình cập nhật

```bash
# máy local
COPYFILE_DISABLE=1 tar czf trio-app.tgz --exclude=node_modules --exclude=.git \
  --exclude=backups --exclude=.env --exclude='frontend/node_modules' -C .. triosmart
scp trio-app.tgz root@152.53.211.170:/root/triosmart/

# trên VPS
cd /root/triosmart && rm -rf app_new && mkdir app_new
tar xzf trio-app.tgz --strip-components=1 -C app_new && find app_new -name '._*' -delete
cp -r app/node_modules app_new/node_modules && cp app/.env app_new/.env && chmod 600 app_new/.env
find app_new/src app_new/scripts -name '*.js' -print0 | xargs -0 -n1 node --check   # BẮT BUỘC
rm -rf app_old && mv app app_old && mv app_new app
pm2 restart trio-api trio-worker trio-receiver trio-scheduler --update-env
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3002/api/healthz    # phải 200
```

### Lưu ý bảo mật đã cài đặt

- App **từ chối khởi động** nếu `JWT_SECRET`/`CREDENTIAL_KEY`/`WEBHOOK_SECRET` còn là giá trị mẫu.
- Nginx chỉ nhận kết nối **từ dải IP Cloudflare** (kiểm bằng `$realip_remote_addr`, không phải header).
- Node chỉ nghe `127.0.0.1` khi `NODE_ENV=production`; Postgres không mở ra ngoài.
- `/hooks/` **tắt access log** vì secret webhook chat nằm trong URL.
- Đổi `CREDENTIAL_KEY` phải chạy `OLD_CREDENTIAL_KEY=<khoá cũ> node scripts/rotateCredentialKey.js`,
  nếu không toàn bộ credential Pancake trong CSDL không giải mã được nữa.

### Điểm cần chủ đầu tư quyết định thêm (cấu hình Cloudflare cấp zone shinsulab.com)

Ba thiết lập dưới đây áp cho **toàn bộ** tên miền shinsulab.com nên chưa tự đổi:
`SSL mode = Full` (nên chuyển **Full (strict)**), `Always Use HTTPS = off` (nên **on**),
`Minimum TLS = 1.0` (nên **1.2**).

### Webhook thời gian thực — giới hạn thật của Pancake POS (26/07/2026)

Đặc tả §6.4 nói xác thực bằng `webhook_headers`, nhưng thực tế:

| Điều đặc tả nói | Thực tế đo được |
|---|---|
| `webhook_headers` để xác thực | Pancake nhận cấu hình nhưng **không bao giờ gửi lại header** |
| `webhook_url` cấu hình qua PUT | **Chỉ nhận lần đầu**; PUT sau trả `success:true` nhưng vẫn gọi URL cũ |
| URL gọi đúng như đăng ký | Pancake **nối thêm loại sự kiện**: `/hooks/pos` → `/hooks/pos/customers` |

⇒ Không có cách nào để Pancake mang secret theo. Hệ đang xác thực webhook POS bằng
**IP máy chủ gửi của Pancake** (`POS_WEBHOOK_IPS`, hiện `203.171.22.6` — cùng dải CMC
Telecom với `pages.fm`). Ba lớp khiến IP này không giả mạo được:
Nginx chỉ nhận từ dải Cloudflare → Nginx ghi đè `CF-Connecting-IP` bằng IP thật của kết nối
→ Cloudflare cũng luôn ghi đè header đó. Đã kiểm chứng: gửi IP giả trả 403/401.

**Nếu Pancake đổi máy chủ gửi**, hệ sinh alert `critical` trên dashboard kèm IP mới; thêm IP
vào `POS_WEBHOOK_IPS` trong `.env` rồi `pm2 restart trio-receiver --update-env`.

Webhook Chat cần liên hệ Pancake bật cho `page_id` (chưa bật). Trong lúc chờ, dữ liệu chat
vẫn về qua nạp bù mỗi giờ.

### Giới hạn dữ liệu Pancake đã xác minh (26/07/2026)

API POS `/orders` **chỉ trả về đơn từ ~31/03/2026 trở đi** (17.134 đơn) — lịch sử cũ hơn không lấy
được qua API. Tổng doanh số trọn đời chỉ còn ở dạng cộng dồn `purchased_amount` trên hồ sơ khách
(42,2 tỉ / 91.747 đơn). Dashboard hiển thị **cả hai** con số, có chú thích nguồn gốc.
