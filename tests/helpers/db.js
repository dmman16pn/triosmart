import pg from 'pg'

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  || 'postgres://trio:trio_test@localhost:5434/triosmart_test'
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test-secret'
process.env.CREDENTIAL_KEY = process.env.CREDENTIAL_KEY || 'test-key'

export const testPool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

export async function resetDb() {
  await testPool.query(`TRUNCATE webhook_event, sync_log, audit_log, merge_queue,
    echo_guard, conversation, "order", customer_identity, customer, connection CASCADE`)
}

export async function seedConnection(type = 'pos') {
  const { rows } = await testPool.query(
    `INSERT INTO connection (type, name, shop_id, page_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [type, `test-${type}`, type === 'pos' ? 'shop_1' : null, type === 'chat' ? 'page_1' : null]
  )
  return rows[0]
}
