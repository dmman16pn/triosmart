import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmtMoney } from '../api.js'
import { SegmentBadge } from '../ui.jsx'

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
  useEffect(() => { api('/segments').then(setRows).catch(() => {}) }, [])

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
