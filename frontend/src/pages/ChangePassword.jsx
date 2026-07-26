import { useState } from 'react'
import { api, setToken } from '../api.js'

// Đổi mật khẩu. Bắt buộc hiện ngay sau lần đăng nhập đầu (must_change_password)
// để tài khoản admin khởi tạo không tồn tại lâu với mật khẩu do người khác đặt.
export default function ChangePassword({ forced = false, onDone }) {
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (next !== again) return setErr('Hai ô mật khẩu mới không giống nhau')
    setBusy(true)
    try {
      await api('/auth/change-password', { method: 'POST', body: { current_password: cur, new_password: next } })
      // Đổi xong mọi phiên cũ bị thu hồi — buộc đăng nhập lại bằng mật khẩu mới
      setToken(null)
      onDone?.()
    } catch (e2) {
      setErr(e2.message)
    } finally { setBusy(false) }
  }

  return (
    <div className={forced ? 'login-wrap' : ''}>
      <form className="card" style={{ maxWidth: 420, margin: forced ? '80px auto' : 0 }} onSubmit={submit}>
        <h2 style={{ marginTop: 0 }}>Đổi mật khẩu</h2>
        {forced && <p className="muted">Tài khoản đang dùng mật khẩu khởi tạo. Hãy đặt mật khẩu riêng trước khi tiếp tục.</p>}
        <label>Mật khẩu hiện tại</label>
        <input type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} required />
        <label>Mật khẩu mới</label>
        <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} required />
        <div className="muted" style={{ fontSize: 12.5, margin: '4px 0 10px' }}>
          Tối thiểu 10 ký tự, có cả chữ và số, không chứa từ dễ đoán.
        </div>
        <label>Nhập lại mật khẩu mới</label>
        <input type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} required />
        {err && <div className="badge b-danger" style={{ marginTop: 10 }}>{err}</div>}
        <button className="btn primary" style={{ marginTop: 14, width: '100%' }} disabled={busy}>
          {busy ? 'Đang lưu…' : 'Đổi mật khẩu'}
        </button>
      </form>
    </div>
  )
}
