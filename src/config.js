import 'dotenv/config'

function required(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Thiếu biến môi trường ${name}`)
  return v
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  receiverPort: Number(process.env.RECEIVER_PORT || 3001),
  webhookSecret: required('WEBHOOK_SECRET'),
  credentialKey: required('CREDENTIAL_KEY')
}
