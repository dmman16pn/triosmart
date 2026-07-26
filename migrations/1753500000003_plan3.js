/* eslint-disable camelcase */
export const up = (pgm) => {
  pgm.createTable('app_user', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    name: { type: 'text', notNull: true },
    role: { type: 'text', notNull: true, check: "role IN ('admin','manager','staff')" },
    connection_ids: { type: 'uuid[]', notNull: true, default: '{}' },
    active: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  })

  pgm.createTable('setting', {
    key: { type: 'text', primaryKey: true },
    value: { type: 'jsonb', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  })
  pgm.sql(`INSERT INTO setting (key, value) VALUES
    ('rfm', '{"vip_amount":5000000,"vip_days":30,"loyal_orders":3,"loyal_days":60,"risk_days":120,"gone_days":120,"new_days":30}'),
    ('alert', '{"email":"","error_rate_pct":20,"window_minutes":5}'),
    ('backfill', '{"cron":"15 * * * *"}'),
    ('custom_fields_def', '[]')`)

  // Cảnh báo chủ động (spec §9: lỗi >20% trong 5 phút) — dashboard chỉ hiển thị, worker ghi
  pgm.createTable('alert', {
    id: { type: 'bigserial', primaryKey: true },
    kind: { type: 'text', notNull: true },
    message: { type: 'text', notNull: true },
    level: { type: 'text', notNull: true, default: 'warn', check: "level IN ('info','warn','critical')" },
    open: { type: 'boolean', notNull: true, default: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    resolved_at: { type: 'timestamptz' }
  })
  pgm.createIndex('alert', ['open', 'created_at'])

  // Tìm số phụ nhanh (spec §6.5, §9): expression index đúng biểu thức truy vấn ? operator
  pgm.sql(`CREATE INDEX idx_customer_alt_phones ON customer USING GIN ((custom_fields->'alt_phones'))`)
  pgm.createIndex('customer', 'rfm_segment')
  pgm.createIndex('customer', 'pos_last_order_at')
  pgm.createIndex('customer', 'assigned_user_id')
}

export const down = () => { throw new Error('irreversible') }
