import { query } from '../db.js'

// Dọn dữ liệu theo hạn giữ (spec §5.6, §9). TUYỆT ĐỐI không đụng audit_log —
// spec yêu cầu giữ tối thiểu 12 tháng, v1 quyết định giữ vĩnh viễn.
export async function runRetention() {
  const r1 = await query(`DELETE FROM webhook_event WHERE received_at < now() - interval '90 days'`)
  const r2 = await query(`DELETE FROM sync_log WHERE started_at < now() - interval '12 months'`)
  const r3 = await query(
    `DELETE FROM merge_queue WHERE status <> 'open' AND created_at < now() - interval '12 months'`)
  const r4 = await query(`DELETE FROM echo_guard WHERE created_at < now() - interval '1 hour'`)
  const r5 = await query(
    `DELETE FROM pending_push WHERE status = 'done' AND created_at < now() - interval '30 days'`)
  const r6 = await query(
    `DELETE FROM alert WHERE NOT open AND created_at < now() - interval '3 months'`)
  console.log(`[retention] webhook_event=${r1.rowCount} sync_log=${r2.rowCount} merge_queue=${r3.rowCount}`
    + ` echo_guard=${r4.rowCount} pending_push=${r5.rowCount} alert=${r6.rowCount}`)
}
