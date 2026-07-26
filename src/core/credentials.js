import crypto from 'node:crypto'
import { config } from '../config.js'

const key = () => crypto.createHash('sha256').update(config.credentialKey).digest()

export function encryptCredential(obj) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()])
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.')
}

export function decryptCredential(str) {
  const [iv, tag, data] = str.split('.').map(s => Buffer.from(s, 'base64'))
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv)
  d.setAuthTag(tag)
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'))
}
