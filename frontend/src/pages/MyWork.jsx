import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney, fmtDate } from '../api.js'
import { SegmentBadge } from '../ui.jsx'
import { useIsMobile } from '../useIsMobile.js'

export default function MyWork() {
  const [rows, setRows] = useState(null)
  const isMobile = useIsMobile()
  useEffect(() => { api('/my-customers').then(setRows).catch(() => setRows([])) }, [])
  if (!rows) return <div className="empty">Đang tải…</div>

  // Trên điện thoại đây là danh sách việc cần làm: khách nguy cơ rời bỏ lên đầu,
  // nút gọi nằm ngay trên thẻ để bấm một chạm.
  if (isMobile) {
    if (rows.length === 0) {
      return <div className="empty">Chưa có khách nào được giao cho bạn.<br />
        Quản lý sẽ gán khách từ màn Danh sách khách.</div>
    }
    return (
      <>
        <div className="m-dim" style={{ marginBottom: 10 }}>
          {rows.length} khách được giao · nhóm có nguy cơ rời bỏ xếp trước
        </div>
        <div className="m-list">
          {rows.map(r => (
            <div key={r.id} className="m-card">
              <Link to={`/customers/${r.id}`} style={{ color: 'inherit', display: 'block' }}>
                <div className="m-card-top">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="m-card-name">{r.name ?? '(chưa có tên)'}</div>
                    <div className="mono m-dim" style={{ marginTop: 2 }}>{r.phone_normalized ?? 'chưa có SĐT'}</div>
                  </div>
                  <SegmentBadge s={r.rfm_segment} />
                </div>
                <div className="m-card-meta">
                  <span><b>{fmtMoney(r.pos_purchased_amount)}</b></span>
                  <span className="m-dim">{r.pos_last_order_at ? `mua ${fmtDate(r.pos_last_order_at)}` : 'chưa mua'}</span>
                </div>
              </Link>
              {r.phone_normalized && (
                <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
                  <a className="btn primary" style={{ flex: 1, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    href={`tel:${r.phone_normalized}`}>📞 Gọi</a>
                  <a className="btn" style={{ flex: 1, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    href={`sms:${r.phone_normalized}`}>💬 Nhắn tin</a>
                </div>
              )}
            </div>
          ))}
        </div>
      </>
    )
  }

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
