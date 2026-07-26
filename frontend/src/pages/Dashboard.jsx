import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtMoney, fmtDate, fmtDateTime } from '../api.js'
import { StatusDot, SourceBadge } from '../ui.jsx'
import { useIsMobile } from '../useIsMobile.js'

export default function Dashboard() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const isMobile = useIsMobile()

  const load = () => api('/dashboard').then(setD).catch(e => setErr(e.message))
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [])

  if (err) return <div className="empty">{err}</div>
  if (!d) return <div className="empty">Đang tải…</div>

  const maxH = Math.max(1, ...d.events_by_hour.map(e => e.n))

  // Trên điện thoại, chủ shop chỉ cần trả lời hai câu: hệ thống có chạy không,
  // và các con số chính là bao nhiêu. Biểu đồ theo giờ để dành cho màn hình lớn.
  if (isMobile) {
    const kpi = (label, value, note) => (
      <div className="m-kpi">
        <div className="m-kpi-l">{label}</div>
        <div className="m-kpi-v">{value}</div>
        {note && <div className="m-dim" style={{ marginTop: 4, fontSize: 11 }}>{note}</div>}
      </div>
    )
    return (
      <>
        <div className="m-list" style={{ marginBottom: 12 }}>
          {d.connections.map(c => (
            <div key={c.id} className="m-card" style={{ padding: '11px 13px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusDot s={c.status} /><b style={{ flex: 1 }}>{c.name}</b><SourceBadge type={c.type} />
              </div>
              <div className="m-dim" style={{ marginTop: 4 }}>Đồng bộ gần nhất: {fmtDateTime(c.last_ok_at)}</div>
              {c.last_error && <div className="badge b-danger" style={{ marginTop: 6 }}>{c.last_error}</div>}
            </div>
          ))}
          {d.connections.length === 0 &&
            <div className="m-card empty">Chưa có kết nối nào — <Link to="/connections">thiết lập ngay</Link></div>}
        </div>

        {d.alerts.length > 0 && (
          <div className="m-card" style={{ borderLeft: '3px solid var(--danger)', marginBottom: 12 }}>
            <b style={{ color: 'var(--danger)' }}>{d.alerts.length} cảnh báo đang mở</b>
            {d.alerts.slice(0, 3).map(a => (
              <div key={a.id} className="m-dim" style={{ marginTop: 5 }}>{a.message}</div>
            ))}
          </div>
        )}

        <div className="m-kpis">
          {kpi('Tổng khách hàng', d.total_customers.toLocaleString('vi-VN'))}
          {kpi('Tỉ lệ SĐT hợp lệ', `${(d.phone_valid_rate * 100).toFixed(0)}%`, 'Điều kiện gửi tin Zalo')}
          {kpi('Doanh số trọn đời', fmtMoney(d.total_revenue), 'Pancake cộng dồn, gồm lịch sử cũ')}
          {kpi('Doanh số đơn đã đồng bộ', fmtMoney(d.synced_orders_revenue ?? 0),
            `${(d.synced_orders ?? 0).toLocaleString('vi-VN')} đơn`)}
          {kpi('Tỉ lệ ghép POS ↔ Chat', `${(d.match_rate * 100).toFixed(0)}%`)}
          {kpi('Chờ duyệt gộp trùng', d.merge_queue_open.toLocaleString('vi-VN'))}
        </div>

        <Link to="/merge-queue" className="m-card" style={{ marginTop: 12, textAlign: 'center', fontWeight: 600 }}>
          Mở hàng đợi gộp trùng →
        </Link>
      </>
    )
  }

  return (
    <>
      <div className="page-h">
        <div><div className="page-t">Tổng quan</div>
          <div className="sub">Hệ thống có đang chạy tốt không — trả lời trong 5 giây</div></div>
      </div>

      {/* Dải trạng thái kết nối */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', marginBottom: 14 }}>
        {d.connections.map(c => (
          <div key={c.id} className="card">
            <StatusDot s={c.status} /> <b>{c.name}</b> <SourceBadge type={c.type} />
            <div className="sub">Đồng bộ OK gần nhất: {fmtDateTime(c.last_ok_at)}</div>
            {c.last_error && <div className="badge b-danger" style={{ marginTop: 6 }}>{c.last_error}</div>}
          </div>
        ))}
        {d.connections.length === 0 &&
          <div className="card empty">Chưa có kết nối nào — <Link to="/connections">thiết lập ngay</Link></div>}
      </div>

      {/* KPI */}
      <div className="grid kpis" style={{ marginBottom: 14 }}>
        <div className="card"><div className="kpi-l">Tổng khách hàng</div>
          <div className="kpi-v">{d.total_customers.toLocaleString('vi-VN')}</div></div>
        <div className="card"><div className="kpi-l">Khách mới 7 ngày</div>
          <div className="kpi-v">{d.new_customers_7d.toLocaleString('vi-VN')}</div></div>
        <div className="card"><div className="kpi-l">Doanh số trọn đời (Pancake ghi nhận)</div>
          <div className="kpi-v">{fmtMoney(d.total_revenue)}</div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Cộng dồn trên hồ sơ khách, gồm cả lịch sử cũ</div></div>
        <div className="card"><div className="kpi-l">Doanh số từ đơn đã đồng bộ</div>
          <div className="kpi-v">{fmtMoney(d.synced_orders_revenue ?? 0)}</div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
            {(d.synced_orders ?? 0).toLocaleString('vi-VN')} đơn API Pancake trả về
            {d.synced_orders_from ? ` (từ ${fmtDate(d.synced_orders_from)})` : ''}
          </div></div>
        <div className="card"><div className="kpi-l">Tỉ lệ ghép thành công</div>
          <div className="kpi-v">{(d.match_rate * 100).toFixed(0)}%</div></div>
        <div className="card"><div className="kpi-l">SĐT hợp lệ (điều kiện Zalo v2)</div>
          <div className="kpi-v" style={{ color: d.phone_valid_rate < 0.6 ? 'var(--danger)' : 'var(--ok)' }}>
            {(d.phone_valid_rate * 100).toFixed(0)}%</div></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '2fr 1fr' }}>
        {/* Biểu đồ webhook 24h */}
        <div className="card">
          <b>Sự kiện webhook theo giờ · 24 giờ qua</b>
          <div className="bars" style={{ marginTop: 14 }}>
            {d.events_by_hour.length === 0 && <div className="empty" style={{ flex: 1 }}>Chưa có sự kiện</div>}
            {d.events_by_hour.map((e, i) => (
              <div key={i} className="bar" style={{ height: `${(e.n / maxH) * 100}%` }}
                title={`${new Date(e.hour).getHours()}h: ${e.n} sự kiện`} />
            ))}
          </div>
          <div className="sub" style={{ marginTop: 8 }}>
            {d.events_by_status.map(s => `${s.status}: ${s.n}`).join(' · ') || '—'}
          </div>
        </div>

        {/* Cảnh báo + việc cần làm */}
        <div className="grid">
          <div className="card">
            <b>Cảnh báo đang mở</b>
            {d.alerts.length === 0 && <div className="sub" style={{ marginTop: 8 }}>✅ Không có cảnh báo nào</div>}
            {d.alerts.map(a => (
              <div key={a.id} className={`badge ${a.level === 'critical' ? 'b-danger' : 'b-warn'}`}
                style={{ display: 'block', marginTop: 8, whiteSpace: 'normal' }}>{a.message}</div>
            ))}
          </div>
          <div className="card">
            <b>Việc cần làm</b>
            <div style={{ marginTop: 8 }}>
              <Link to="/merge-queue">🔀 {d.merge_queue_open} mục chờ duyệt gộp trùng</Link>
            </div>
            {d.pending_push > 0 &&
              <div className="sub" style={{ marginTop: 6 }}>⏳ {d.pending_push} thay đổi đang chờ đẩy lên Pancake</div>}
          </div>
        </div>
      </div>
    </>
  )
}
