/* eslint-disable camelcase */
export const up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true })

  pgm.createTable('connection', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    type: { type: 'text', notNull: true, check: "type IN ('pos','chat')" },
    name: { type: 'text', notNull: true },
    shop_id: { type: 'text' },
    page_id: { type: 'text' },
    credential_encrypted: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'active',
      check: "status IN ('active','error','disabled')" },
    webhook_status: { type: 'text', notNull: true, default: 'not_configured',
      check: "webhook_status IN ('active','suspended','not_configured')" },
    last_ok_at: { type: 'timestamptz' },
    last_error: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  })

  pgm.createTable('customer', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    phone_normalized: { type: 'text', unique: true },
    phone_raw: { type: 'text' },
    phone_invalid: { type: 'boolean', notNull: true, default: false },
    name: { type: 'text' },
    email: { type: 'text' },
    gender: { type: 'text' },
    date_of_birth: { type: 'date' },
    address: { type: 'jsonb' },
    tags: { type: 'jsonb', notNull: true, default: '[]' },
    pos_purchased_amount: { type: 'numeric', notNull: true, default: 0 },
    pos_order_count: { type: 'int', notNull: true, default: 0 },
    pos_succeed_order_count: { type: 'int', notNull: true, default: 0 },
    pos_last_order_at: { type: 'timestamptz' },
    pos_reward_point: { type: 'numeric', notNull: true, default: 0 },
    pos_level_id: { type: 'text' },
    rfm_segment: { type: 'text' },
    internal_note: { type: 'text' },
    assigned_user_id: { type: 'uuid' },
    custom_fields: { type: 'jsonb', notNull: true, default: '{}' },
    zalo_consent: { type: 'boolean', notNull: true, default: false },
    merge_status: { type: 'text', notNull: true, default: 'auto',
      check: "merge_status IN ('auto','manual','pending')" },
    confidence: { type: 'int' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_synced_at: { type: 'timestamptz' }
  })
  pgm.createIndex('customer', 'name')

  pgm.createTable('customer_identity', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    customer_id: { type: 'uuid', notNull: true, references: 'customer', onDelete: 'CASCADE' },
    source_type: { type: 'text', notNull: true, check: "source_type IN ('pos','chat')" },
    connection_id: { type: 'uuid', notNull: true, references: 'connection' },
    external_id: { type: 'text', notNull: true },
    match_method: { type: 'text', notNull: true, check: "match_method IN ('phone','fb_id','manual','first_seen')" },
    confidence: { type: 'int', notNull: true },
    linked_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  })
  pgm.addConstraint('customer_identity', 'uq_identity', {
    unique: ['source_type', 'connection_id', 'external_id']
  })

  pgm.createTable('order', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    pos_order_id: { type: 'text', notNull: true, unique: true },
    connection_id: { type: 'uuid', notNull: true, references: 'connection' },
    customer_id: { type: 'uuid', references: 'customer' },
    status: { type: 'text' },
    total_amount: { type: 'numeric' },
    cod: { type: 'numeric' },
    prepaid: { type: 'numeric' },
    inserted_at: { type: 'timestamptz' },
    updated_at: { type: 'timestamptz' },
    raw: { type: 'jsonb', notNull: true }
  })
  pgm.createIndex('order', 'customer_id')

  pgm.createTable('conversation', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    pancake_conversation_id: { type: 'text', notNull: true },
    connection_id: { type: 'uuid', notNull: true, references: 'connection' },
    psid: { type: 'text' },
    customer_id: { type: 'uuid', references: 'customer' },
    type: { type: 'text' },
    last_message_at: { type: 'timestamptz' },
    last_message_snippet: { type: 'text' },
    unread: { type: 'boolean', notNull: true, default: false },
    assigned_user_id: { type: 'uuid' }
  })
  pgm.addConstraint('conversation', 'uq_conversation', {
    unique: ['connection_id', 'pancake_conversation_id']
  })
  pgm.createIndex('conversation', 'customer_id')

  pgm.createTable('webhook_event', {
    id: { type: 'bigserial', primaryKey: true },
    source: { type: 'text', notNull: true, check: "source IN ('pos','chat')" },
    event_type: { type: 'text' },
    payload: { type: 'jsonb', notNull: true },
    received_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    processed_at: { type: 'timestamptz' },
    status: { type: 'text', notNull: true, default: 'pending',
      check: "status IN ('pending','done','error','skipped')" },
    error: { type: 'text' }
  })
  pgm.createIndex('webhook_event', ['status', 'received_at'])

  pgm.createTable('sync_log', {
    id: { type: 'bigserial', primaryKey: true },
    connection_id: { type: 'uuid', references: 'connection' },
    direction: { type: 'text', notNull: true, check: "direction IN ('in','out')" },
    entity: { type: 'text', notNull: true },
    count_ok: { type: 'int', notNull: true, default: 0 },
    count_fail: { type: 'int', notNull: true, default: 0 },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    finished_at: { type: 'timestamptz' }
  })

  pgm.createTable('audit_log', {
    id: { type: 'bigserial', primaryKey: true },
    user_id: { type: 'uuid' },
    customer_id: { type: 'uuid' },
    field: { type: 'text', notNull: true },
    old_value: { type: 'jsonb' },
    new_value: { type: 'jsonb' },
    pushed_to_pancake: { type: 'boolean', notNull: true, default: false },
    pancake_response: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  })

  pgm.createTable('merge_queue', {
    id: { type: 'bigserial', primaryKey: true },
    candidate_a: { type: 'uuid', notNull: true, references: 'customer', onDelete: 'CASCADE' },
    candidate_b: { type: 'uuid', notNull: true, references: 'customer', onDelete: 'CASCADE' },
    reason: { type: 'text', notNull: true },
    score: { type: 'int', notNull: true },
    status: { type: 'text', notNull: true, default: 'open',
      check: "status IN ('open','merged','kept_separate','ignored')" },
    resolved_by: { type: 'uuid' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  })

  pgm.createTable('echo_guard', {
    hash: { type: 'text', primaryKey: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  })
}

export const down = () => { throw new Error('irreversible') }
