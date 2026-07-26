let onUnauthorized = () => {}
export const setUnauthorizedHandler = fn => { onUnauthorized = fn }

export const getToken = () => localStorage.getItem('trio_token')
export const setToken = t => t ? localStorage.setItem('trio_token', t) : localStorage.removeItem('trio_token')

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  if (res.status === 401) { setToken(null); onUnauthorized() }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Lỗi ${res.status}`), { status: res.status, data })
  return data
}

export const fmtMoney = v => (Number(v) || 0).toLocaleString('vi-VN') + 'đ'
export const fmtDate = v => v ? new Date(v).toLocaleDateString('vi-VN') : '—'
export const fmtDateTime = v => v ? new Date(v).toLocaleString('vi-VN') : '—'

export const SEGMENT_COLORS = {
  'Khách VIP': 'b-brand', 'Trung thành': 'b-ok', 'Có nguy cơ rời bỏ': 'b-warn',
  'Đã rời bỏ': 'b-danger', 'Mua một lần': 'b-chat', 'Khách mới': 'b-pos',
  'Chưa mua': 'b-mute', 'Chưa phân loại': 'b-mute'
}
