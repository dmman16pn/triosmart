# Chỉ chấp nhận kết nối đến TỪ Cloudflare (chặn gọi thẳng IP máy chủ để né WAF/rate-limit)
if ($trio_from_cloudflare = 0) { return 403; }
