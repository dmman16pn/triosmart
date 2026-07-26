// Mã hoá lại credential Pancake khi đổi CREDENTIAL_KEY.
// Dùng: OLD_CREDENTIAL_KEY='<khoá cũ>' node scripts/rotateCredentialKey.js
// (CREDENTIAL_KEY trong .env đã là khoá MỚI khi chạy lệnh này)
import crypto from 'node:crypto'
import { query, pool } from '../src/db.js'
import { config } from '../src/config.js'
import { encryptCredential } from '../src/core/credentials.js'

const oldKeyRaw = process.env.OLD_CREDENTIAL_KEY
if (!oldKeyRaw) { console.error('Thiếu OLD_CREDENTIAL_KEY'); process.exit(1) }
if (oldKeyRaw === config.credentialKey) { console.error('Khoá cũ trùng khoá mới — không cần xoay'); process.exit(1) }

const oldKey = crypto.createHash('sha256').update(oldKeyRaw).digest()
function decryptWithOld(str) {
  const [iv, tag, data] = str.split('.').map(s => Buffer.from(s, 'base64'))
  const d = crypto.createDecipheriv('aes-256-gcm', oldKey, iv)
  d.setAuthTag(tag)
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'))
}

const { rows } = await query('SELECT id, name, credential_encrypted FROM connection WHERE credential_encrypted IS NOT NULL')
let ok = 0
for (const r of rows) {
  try {
    const cred = decryptWithOld(r.credential_encrypted)          // giải bằng khoá cũ
    await query('UPDATE connection SET credential_encrypted=$2 WHERE id=$1',
      [r.id, encryptCredential(cred)])                            // mã hoá lại bằng khoá mới
    ok++
    console.log(`  ✓ ${r.name}`)
  } catch (e) {
    console.error(`  ✗ ${r.name}: ${e.message} (có thể đã mã hoá bằng khoá mới rồi)`)
  }
}
console.log(`[rotate] xong ${ok}/${rows.length} connection`)
await pool.end()
