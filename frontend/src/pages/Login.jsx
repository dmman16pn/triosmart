import { useState } from 'react'
import { api, setToken } from '../api.js'

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')   // ô này nhận TÊN ĐĂNG NHẬP hoặc email
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async e => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const res = await api('/auth/login', { method: 'POST', body: { email, password } })
      setToken(res.token)
      onLogin(res.user)
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="logo" style={{ textAlign: 'center', fontSize: 22 }}>TRIO<b>SMART</b></div>
        <p className="sub" style={{ textAlign: 'center', marginBottom: 18 }}>
          Lớp dữ liệu khách hàng hợp nhất trên Pancake
        </p>
        <div className="field">
          <label className="lbl">Tên đăng nhập</label>
          <input className="inp" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off"
            value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label className="lbl">Mật khẩu</label>
          <input className="inp" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </div>
        {error && <div className="badge b-danger" style={{ display: 'block', marginBottom: 12, padding: 9 }}>{error}</div>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  )
}
