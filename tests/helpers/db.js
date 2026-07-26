import pg from 'pg'

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  || 'postgres://trio:trio_test@localhost:5434/triosmart_test'
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test-secret'
process.env.CREDENTIAL_KEY = process.env.CREDENTIAL_KEY || 'test-key'

export const testPool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

export async function resetDb() {
  await testPool.query(`TRUNCATE webhook_event, sync_log, audit_log, merge_queue,
    echo_guard, conversation, "order", customer_identity, customer, connection,
    pending_push, app_user, alert, setting CASCADE`)
  await testPool.query(`INSERT INTO setting (key, value) VALUES
    ('rfm', '{"vip_amount":5000000,"vip_days":30,"loyal_orders":3,"loyal_days":60,"risk_days":120,"gone_days":120,"new_days":30}'),
    ('alert', '{"email":"","error_rate_pct":20,"window_minutes":5}'),
    ('backfill', '{"cron":"15 * * * *"}'),
    ('custom_fields_def', '[]')`)
}

export async function seedConnection(type = 'pos') {
  const { rows } = await testPool.query(
    `INSERT INTO connection (type, name, shop_id, page_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [type, `test-${type}`, type === 'pos' ? 'shop_1' : null, type === 'chat' ? 'page_1' : null]
  )
  return rows[0]
}
