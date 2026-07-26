import { PgBoss } from 'pg-boss'
import { config } from '../config.js'
import { query } from '../db.js'
import { backfillPos } from './backfill.js'

const boss = new PgBoss(config.databaseUrl)
boss.on('error', e => console.error('[scheduler] pg-boss error', e))
await boss.start()
await boss.createQueue('backfill-hourly')
await boss.schedule('backfill-hourly', '15 * * * *')   // phút 15 mỗi giờ (spec §7.3)

await boss.work('backfill-hourly', async () => {
  const { rows } = await query(`SELECT id FROM connection WHERE type='pos' AND status <> 'disabled'`)
  for (const { id } of rows) {
    try { await backfillPos(id) } catch (e) { console.error(`[scheduler] backfill ${id} failed`, e.message) }
  }
})
console.log('[scheduler] started, backfill cron 15 * * * *')
