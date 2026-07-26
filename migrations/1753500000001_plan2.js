/* eslint-disable camelcase */
export const up = (pgm) => {
  pgm.createTable('pending_push', {
    id: { type: 'bigserial', primaryKey: true },
    customer_id: { type: 'uuid', notNull: true, references: 'customer', onDelete: 'CASCADE' },
    pos_customer_id: { type: 'text', notNull: true },
    connection_id: { type: 'uuid', notNull: true, references: 'connection' },
    payload: { type: 'jsonb', notNull: true },
    attempts: { type: 'int', notNull: true, default: 0 },
    next_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_error: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'pending',
      check: "status IN ('pending','done','dead')" },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  })
  pgm.createIndex('pending_push', ['status', 'next_at'])

  pgm.addColumns('audit_log', {
    source: { type: 'text', notNull: true, default: 'user' }
  })
}

export const down = () => { throw new Error('irreversible') }
