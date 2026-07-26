import { PgBoss } from 'pg-boss'
import { config } from '../config.js'
import { query } from '../db.js'
import { backfillPos } from './backfill.js'
import { backfillChat } from './backfillChat.js'

const boss = new PgBoss(config.databaseUrl)
boss.on('error', e => console.error('[scheduler] pg-boss error', e))
await boss.start()
await boss.createQueue('backfill-hourly')
await boss.schedule('backfill-hourly', '15 * * * *')   // phút 15 mỗi giờ (spec §7.3)
await boss.createQueue('rfm-nightly')
await boss.schedule('rfm-nightly', '0 2 * * *')        // 2h sáng: tính lại toàn bộ RFM (spec §7.7)
await boss.createQueue('retention-daily')
await boss.schedule('retention-daily', '30 2 * * *')   // 2h30: dọn dữ liệu theo hạn giữ (spec §5.6)

await boss.work('backfill-hourly', async () => {
  const { rows } = await query(
    `SELECT id, type FROM connection WHERE status <> 'disabled' AND credential_encrypted IS NOT NULL`)
  for (const { id, type } of rows) {
    try {
      if (type === 'pos') await backfillPos(id)
      else await backfillChat(id)
    } catch (e) { console.error(`[scheduler] backfill ${type} ${id} failed`, e.message) }
  }
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
