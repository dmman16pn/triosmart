import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmtMoney } from '../api.js'
import { SegmentBadge } from '../ui.jsx'
import { useIsMobile } from '../useIsMobile.js'

const HINTS = {
  'Khách VIP': 'Giữ chân bằng ưu đãi riêng',
  'Trung thành': 'Duy trì, mời giới thiệu bạn bè',
  'Có nguy cơ rời bỏ': 'Nhắn nhắc ngay — cần hành động gấp nhất',
  'Đã rời bỏ': 'Chiến dịch kéo lại',
  'Mua một lần': 'Kích lần mua thứ hai',
  'Khách mới': 'Chăm sóc sau bán',
  'Chưa mua': 'Có hội thoại nhưng chưa chuyển đổi',
  'Chưa phân loại': 'Thiếu dữ liệu hoặc ngoài bảng ngưỡng — kiểm tra cấu hình'
}

export default function Segments() {
  const [rows, setRows] = useState([])
  const nav = useNavigate()
  const isMobile = useIsMobile()
  useEffect(() => { api('/segments').then(setRows).catch(() => {}) }, [])

  if (isMobile) {
    return (
      <>
        <div className="m-dim" style={{ marginBottom: 12 }}>Chạm một nhóm để xem danh sách khách</div>
        <div className="m-list">
          {rows.map(r => (
            <button key={r.segment} className="m-card" style={{ textAlign: 'left', width: '100%' }}
              onClick={() => nav(`/customers?segment=${encodeURIComponent(r.segment)}`)}>
              <div className="m-card-top" style={{ marginBottom: 6 }}>
                <SegmentBadge s={r.segment} />
                <span style={{ marginLeft: 'auto', fontSize: 22, fontWeight: 800 }}>
                  {r.count.toLocaleString('vi-VN')}</span>
              </div>
              {r.revenue != null && <div className="m-card-meta"><b>{fmtMoney(r.revenue)}</b></div>}
              <div className="m-dim" style={{ marginTop: 5 }}>{HINTS[r.segment]}</div>
            </button>
          ))}
          {rows.length === 0 && <div className="empty">Đang tải…</div>}
        </div>
      </>
    )
  }

  return (
    <>
      <div className="page-h">
        <div><div className="page-t">Bảng phân khúc</div>
          <div className="sub">Bấm vào một nhóm để mở danh sách đã lọc sẵn</div></div>
      </div>
      <div className="grid seg-grid">
        {rows.map(r => (
          <div key={r.segment} className="card seg-card"
            onClick={() => nav(`/customers?segment=${encodeURIComponent(r.segment)}`)}>
            <SegmentBadge s={r.segment} />
            <div className="kpi-v">{r.count.toLocaleString('vi-VN')}</div>
            {r.revenue != null && <div className="sub">Doanh số: {fmtMoney(r.revenue)}</div>}
            <div className="hint" style={{ marginTop: 6 }}>{HINTS[r.segment]}</div>
          </div>
        ))}
      </div>
    </>
  )
}
