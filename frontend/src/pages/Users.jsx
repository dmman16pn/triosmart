import { useEffect, useState } from 'react'
import { api, fmtDate } from '../api.js'
import { Modal, Field, useToast } from '../ui.jsx'

export default function Users() {
  const [rows, setRows] = useState([])
  const [conns, setConns] = useState([])
  const [modal, setModal] = useState(null)   // null | 'new' | user object
  const toast = useToast()

  const load = () => api('/users').then(setRows).catch(e => toast(e.message, 'err'))
  useEffect(() => { load(); api('/connections').then(setConns).catch(() => {}) }, [])

  const toggleActive = async u => {
    try { await api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); load() }
    catch (e) { toast(e.message, 'err') }
  }

  return (
    <>
      <div className="page-h">
        <div><div className="page-t">Người dùng và phân quyền</div>
          <div className="sub">Admin toàn quyền · Manager duyệt gộp + xem doanh số · Staff giới hạn theo nguồn được gán</div></div>
        <button className="btn primary" onClick={() => setModal('new')}>+ Thêm người dùng</button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Tên</th><th>Email</th><th>Vai trò</th><th>Nguồn được gán</th><th>Trạng thái</th><th>Tạo lúc</th><th></th></tr></thead>
          <tbody>
            {rows.map(u => (
              <tr key={u.id}>
                <td><b>{u.name}</b></td>
                <td className="mono">{u.email}</td>
                <td><span className="badge b-brand">{u.role}</span></td>
                <td>{u.connection_ids.length === 0 ? <span className="sub">tất cả</span>
                  : u.connection_ids.map(id => conns.find(c => c.id === id)?.name ?? '?').join(', ')}</td>
                <td>{u.active ? <span className="badge b-ok">hoạt động</span> : <span className="badge b-danger">đã khóa</span>}</td>
                <td>{fmtDate(u.created_at)}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="btn sm" onClick={() => setModal(u)}>Sửa</button>
                  <button className="btn sm" onClick={() => toggleActive(u)}>{u.active ? 'Khóa' : 'Mở khóa'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && <UserModal user={modal === 'new' ? null : modal} conns={conns}
        onClose={() => { setModal(null); load() }} />}
    </>
  )
}

function UserModal({ user, conns, onClose }) {
  const [form, setForm] = useState({
    email: user?.email ?? '', name: user?.name ?? '', role: user?.role ?? 'staff',
    password: '', connection_ids: user?.connection_ids ?? []
  })
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    setBusy(true)
    try {
      if (user) {
        const body = { name: form.name, role: form.role, connection_ids: form.connection_ids }
        if (form.password) body.password = form.password
        await api(`/users/${user.id}`, { method: 'PATCH', body })
      } else {
        await api('/users', { method: 'POST', body: form })
      }
      toast('Đã lưu'); onClose()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <Modal title={user ? `Sửa: ${user.name}` : 'Thêm người dùng'} onClose={onClose}>
      <Field label="Email"><input className="inp" value={form.email} disabled={!!user}
        onChange={e => set('email', e.target.value)} /></Field>
      <Field label="Tên"><input className="inp" value={form.name} onChange={e => set('name', e.target.value)} /></Field>
      <Field label={user ? 'Mật khẩu mới (bỏ trống nếu giữ nguyên)' : 'Mật khẩu'}>
        <input className="inp" type="password" value={form.password} onChange={e => set('password', e.target.value)} /></Field>
      <Field label="Vai trò">
        <select className="inp" value={form.role} onChange={e => set('role', e.target.value)}>
          <option value="staff">Nhân viên</option>
          <option value="manager">Quản lý</option>
          <option value="admin">Quản trị viên</option>
        </select></Field>
      {form.role === 'staff' && (
        <Field label="Giới hạn theo nguồn (bỏ trống = thấy tất cả)">
          {conns.map(c => (
            <label key={c.id} style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input type="checkbox" checked={form.connection_ids.includes(c.id)}
                onChange={e => set('connection_ids', e.target.checked
                  ? [...form.connection_ids, c.id]
                  : form.connection_ids.filter(x => x !== c.id))} />
              {c.name} ({c.type})
            </label>
          ))}
        </Field>
      )}
      <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={save}>Lưu</button>
    </Modal>
  )
}
