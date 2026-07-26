import { useEffect, useState } from 'react'
import { api, fmtDateTime } from '../api.js'

export default function AuditLog() {
  const [rows, setRows] = useState([])
  useEffect(() => { api('/audit-logs?limit=100').then(setRows).catch(() => {}) }, [])

  const srcBadge = s => ({
    user: ['b-brand', 'người dùng'], conflict: ['b-warn', 'xung đột'],
    merge: ['b-chat', 'gộp/tách'], system: ['b-mute', 'hệ thống']
  }[s] ?? ['b-mute', s])

  return (
    <>
      <div className="page-h">
        <div><div className="page-t">Nhật ký thao tác</div>
          <div className="sub">Chỉ đọc — không ai xóa được bản ghi nhật ký, kể cả quản trị viên</div></div>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Lúc</th><th>Ai</th><th>Khách</th><th>Trường</th><th>Cũ → Mới</th><th>Loại</th><th>Pancake</th></tr></thead>
          <tbody>
            {rows.map(a => (
              <tr key={a.id}>
                <td>{fmtDateTime(a.created_at)}</td>
                <td>{a.user_name ?? <span className="sub">hệ thống</span>}</td>
                <td>{a.customer_name ?? '—'}</td>
                <td className="mono">{a.field}</td>
                <td className="mono" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.field.startsWith('__') ? '(snapshot)' : `${JSON.stringify(a.old_value)} → ${JSON.stringify(a.new_value)}`}</td>
                <td><span className={`badge ${srcBadge(a.source)[0]}`}>{srcBadge(a.source)[1]}</span></td>
                <td>{a.source === 'user' && !a.field.startsWith('__') && (a.pushed_to_pancake
                  ? <span className="badge b-ok">đã đẩy</span>
                  : <span className="badge b-mute">chưa/không đẩy</span>)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="empty">Chưa có thao tác nào</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
