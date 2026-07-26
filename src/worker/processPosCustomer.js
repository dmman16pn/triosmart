import { upsertCustomerFromPos } from '../core/upsert.js'

// Payload thực tế có thể bọc trong key khác — chỉnh MỘT chỗ này khi đối chiếu webhook thật.
export function extractPosCustomer(payload) {
  return payload.customer ?? payload.data ?? payload
}

export async function processPosCustomer(connection, posCustomer) {
  return upsertCustomerFromPos(connection, posCustomer)
}
