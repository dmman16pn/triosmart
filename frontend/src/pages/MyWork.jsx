import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney, fmtDate } from '../api.js'
import { SegmentBadge } from '../ui.jsx'

export default function MyWork() {
  const [rows, setRows] = useState(null)
  useEffect(() => { api('/my-customers').then(setRows).catch(() => setRows([])) }, [])
  if (!rows) return <div className="empty">Đang tải…</div>

  return (
    <>
      <div className="page-h">
        <div><div className="page-t">Việc của tôi</div>
          <div className="sub">Khách được gán cho bạn — nhóm Có nguy cơ rời bỏ xếp trước</div></div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Tên</th><th>SĐT</th><th>Phân khúc</th><th>Đã mua</th><th>Mua gần nhất</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="clickable">
                <td><Link to={`/customers/${r.id}`}><b>{r.name ?? '(chưa có tên)'}</b></Link></td>
                <td className="mono">{r.phone_normalized ?? '—'}</td>
                <td><SegmentBadge s={r.rfm_segment} /></td>
                <td>{fmtMoney(r.pos_purchased_amount)}</td>
                <td>{fmtDate(r.pos_last_order_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="empty">
              Chưa có khách nào được gán cho bạn</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
