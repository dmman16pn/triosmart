import { query } from '../db.js'
import { decryptCredential } from '../core/credentials.js'
import { PosClient } from '../pancake/posClient.js'
import { upsertCustomerFromPos } from '../core/upsert.js'
import { processPosOrder } from '../worker/processPosOrder.js'

async function lastSyncEpoch(connectionId, entity) {
  const { rows } = await query(
    `SELECT extract(epoch FROM max(started_at))::bigint AS e FROM sync_log
     WHERE connection_id=$1 AND entity=$2 AND direction='in' AND count_fail=0 AND finished_at IS NOT NULL`,
    [connectionId, entity])
  return rows[0]?.e ?? null
}

async function runEntity(conn, entity, iterator, handler) {
  const log = await query(
    `INSERT INTO sync_log (connection_id, direction, entity) VALUES ($1,'in',$2) RETURNING id`,
    [conn.id, entity])
  const logId = log.rows[0].id
  let ok = 0, fail = 0
  try {
    for await (const batch of iterator) {
      for (const row of batch) {
        try { await handler(conn, row); ok++ } catch (e) { fail++; console.error(`[backfill] ${entity} row failed:`, e.message) }
      }
    }
  } catch (e) { fail++; console.error(`[backfill] ${entity} aborted:`, e.message) }
  await query(`UPDATE sync_log SET count_ok=$2, count_fail=$3, finished_at=now() WHERE id=$1`, [logId, ok, fail])
  await query(`UPDATE connection SET last_ok_at = CASE WHEN $2=0 THEN now() ELSE last_ok_at END,
    last_error = CASE WHEN $2>0 THEN 'backfill có lỗi, xem sync_log' ELSE NULL END WHERE id=$1`, [conn.id, fail])
}

// full=true: nạp lịch sử ban đầu (bỏ mốc thời gian). Mặc định: nạp bù từ lần thành công gần nhất.
export async function backfillPos(connectionId, { full = false } = {}) {
  const { rows } = await query(`SELECT * FROM connection WHERE id=$1`, [connectionId])
  const conn = rows[0]
  if (!conn?.credential_encrypted) throw new Error('connection thiếu credential')
  const { api_key } = decryptCredential(conn.credential_encrypted)
  const client = new PosClient({ shopId: conn.shop_id, apiKey: api_key })

  const custSince = full ? null : await lastSyncEpoch(conn.id, 'customers')
  await runEntity(conn, 'customers',
    client.fetchAllCustomers({ sinceEpoch: custSince }),
    (c, row) => upsertCustomerFromPos(c, row))

  const orderSince = full ? null : await lastSyncEpoch(conn.id, 'orders')
  await runEntity(conn, 'orders',
    client.fetchAllOrders({ sinceEpoch: orderSince }),
    (c, row) => processPosOrder(c, row))
}
