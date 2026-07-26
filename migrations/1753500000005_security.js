/* eslint-disable camelcase */
// Gia cố đăng nhập trước khi đưa app ra internet: khoá tài khoản khi bị dò mật khẩu,
// vô hiệu hoá token cũ khi đổi mật khẩu/khoá tài khoản, và nhật ký đăng nhập để điều tra.
export const up = (pgm) => {
  pgm.addColumns('app_user', {
    failed_login_count: { type: 'int', notNull: true, default: 0 },
    locked_until: { type: 'timestamptz' },
    last_login_at: { type: 'timestamptz' },
    must_change_password: { type: 'boolean', notNull: true, default: false },
    // Mọi token phát hành trước mốc này bị từ chối (đổi mật khẩu / khoá tài khoản / thu hồi)
    token_valid_from: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  })

  pgm.createTable('login_attempt', {
    id: { type: 'bigserial', primaryKey: true },
    email: { type: 'text', notNull: true },
    ip: { type: 'text' },
    user_agent: { type: 'text' },
    success: { type: 'boolean', notNull: true },
    reason: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  })
  pgm.createIndex('login_attempt', ['created_at'])
  pgm.createIndex('login_attempt', ['email', 'created_at'])
}

export const down = () => { throw new Error('irreversible') }
