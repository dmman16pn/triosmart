import { upsertCustomerFromPos } from '../core/upsert.js'
import { computeCustomerHash, isEcho } from '../core/echoGuard.js'

// Payload thực tế có thể bọc trong key khác — chỉnh MỘT chỗ này khi đối chiếu webhook thật.
export function extractPosCustomer(payload) {
  return payload.customer ?? payload.data ?? payload
}

export async function processPosCustomer(connection, posCustomer) {
  // Chống vòng lặp tiếng vọng (spec §7.5): webhook này là thay đổi chính Trio vừa gửi → dừng.
  if (await isEcho(computeCustomerHash(posCustomer))) return 'echo'
  return upsertCustomerFromPos(connection, posCustomer)
}
