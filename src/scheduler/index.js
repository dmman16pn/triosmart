import { PgBoss } from 'pg-boss'
import { config } from '../config.js'
import { query } from '../db.js'
import { backfillPos } from './backfill.js'
import { backfillChat } from './backfillChat.js'

const boss = new PgBoss(config.databaseUrl)
boss.on('error', e => console.error('[scheduler] pg-boss error', e))
await boss.start()

// pg-boss mặc định coi công việc quá 15 phút là hỏng rồi CHẠY LẠI. Đồng bộ chat mất
// ~19 phút (53k khách + 120k hội thoại ở 3 req/s), nên lần chạy sau chồng lên lần trước
// → gọi API Pancake gấp đôi và dễ đụng giới hạn tần suất. Cho hạn rộng và KHÔNG thử lại:
// lỡ một nhịp thì nhịp sau nạp bù đủ, không cần chạy đè.
const LONG_JOB = { expireInSeconds: 3300, retryLimit: 0, singletonKey: 'backfill' }

await boss.createQueue('backfill-hourly')
await boss.schedule('backfill-hourly', '15 * * * *', null, LONG_JOB)   // phút 15 mỗi giờ (spec §7.3)
await boss.createQueue('rfm-nightly')
await boss.schedule('rfm-nightly', '0 2 * * *', null, { expireInSeconds: 3300, retryLimit: 0 })
await boss.createQueue('retention-daily')
await boss.schedule('retention-daily', '30 2 * * *', null, { expireInSeconds: 900, retryLimit: 0 })

// Chốt chặn thứ hai: dù pg-boss có phát trùng thì tiến trình này cũng không chạy đè lên
// chính nó. Đồng bộ chồng nhau vừa tốn quota Pancake vừa sinh dữ liệu tranh chấp.
let backfillRunning = false

await boss.work('backfill-hourly', { pollingIntervalSeconds: 30 }, async () => {
  if (backfillRunning) {
    console.warn('[scheduler] lần nạp bù trước chưa xong — bỏ qua nhịp này')
    return
  }
  backfillRunning = true
  try {
    const { rows } = await query(
      `SELECT id, type FROM connection WHERE status <> 'disabled' AND credential_encrypted IS NOT NULL`)
    for (const { id, type } of rows) {
      try {
        if (type === 'pos') await backfillPos(id)
        else await backfillChat(id)
      } catch (e) { console.error(`[scheduler] backfill ${type} ${id} failed`, e.message) }
    }
  } finally { backfillRunning = false }
})
await boss.work('rfm-nightly', async () => {
  const { recomputeAll } = await import('../core/rfm.js')
  const n = await recomputeAll()
  console.log(`[scheduler] rfm-nightly: ${n} khách đổi phân khúc`)
})

await boss.work('retention-daily', async () => {
  const { runRetention } = await import('./retention.js')
  await runRetention()
})

console.log('[scheduler] started: backfill 15 * * * *, rfm 0 2 * * *, retention 30 2 * * *')
