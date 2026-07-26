import { query } from '../db.js'

// Giám sát chủ động (spec §9): cảnh báo khi tỉ lệ lỗi vượt 20% trong 5 phút —
// đặt thấp hơn nhiều ngưỡng treo webhook của Pancake (80% + 300 request/30 phút)
// để còn thời gian xử lý trước khi Pancake ngắt.
export async function checkErrorRateAlert() {
  const { rows: [cfg] } = await query(`SELECT value FROM setting WHERE key='alert'`)
  const threshold = (cfg?.value?.error_rate_pct ?? 20) / 100
  const windowMin = cfg?.value?.window_minutes ?? 5

  const { rows: [stat] } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'error')::int AS errors
     FROM webhook_event WHERE received_at > now() - ($1 || ' minutes')::interval`,
    [windowMin])

  const rate = stat.total > 0 ? stat.errors / stat.total : 0
  const { rows: openAlerts } = await query(
    `SELECT id FROM alert WHERE kind='webhook_error_rate' AND open`)

  if (stat.total >= 5 && rate > threshold) {
    if (openAlerts.length === 0) {
      await query(
        `INSERT INTO alert (kind, message, level) VALUES ('webhook_error_rate', $1, 'critical')`,
        [`Tỉ lệ lỗi webhook ${(rate * 100).toFixed(0)}% trong ${windowMin} phút gần nhất `
          + `(${stat.errors}/${stat.total}) — vượt ngưỡng ${threshold * 100}%. `
          + `Nguy cơ Pancake treo webhook, cần xử lý ngay.`])
    }
  } else if (openAlerts.length > 0) {
    await query(
      `UPDATE alert SET open=false, resolved_at=now() WHERE kind='webhook_error_rate' AND open`)
  }
}
