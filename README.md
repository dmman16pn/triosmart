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
