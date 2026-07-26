import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

// Vỏ ứng dụng cho điện thoại: thanh tiêu đề dính trên, nội dung ở giữa,
// điều hướng chính nằm dưới đáy trong tầm ngón cái. Các trang quản trị ít dùng
// gom vào ngăn kéo "Thêm" thay vì chen vào thanh đáy (4 mục là giới hạn đọc lướt).

const TITLES = [
  [/^\/customers\/[^/]+$/, 'Hồ sơ khách'],
  [/^\/customers$/, 'Khách hàng'],
  [/^\/segments$/, 'Phân khúc'],
  [/^\/my-work$/, 'Việc của tôi'],
  [/^\/$/, 'Tổng quan'],
  [/^\/merge-queue$/, 'Hàng đợi gộp'],
  [/^\/sync-logs$/, 'Nhật ký đồng bộ'],
  [/^\/audit$/, 'Nhật ký thao tác'],
  [/^\/connections$/, 'Kết nối'],
  [/^\/users$/, 'Người dùng'],
  [/^\/settings$/, 'Cấu hình'],
  [/^\/change-password$/, 'Đổi mật khẩu']
]
const titleFor = path => TITLES.find(([re]) => re.test(path))?.[1] ?? 'TRIOSMART'

function Sheet({ user, onClose, onLogout }) {
  const isAdmin = user.role === 'admin'
  const isManagerUp = ['admin', 'manager'].includes(user.role)
  const go = { onClick: onClose }
  return (
    <>
      <div className="m-sheet-bg" onClick={onClose} />
      <div className="m-sheet" role="dialog" aria-label="Menu">
        <div className="m-grab" />
        {isManagerUp && <>
          <div className="m-sheet-h">Vận hành</div>
          <NavLink to="/" end className="m-sheet-item" {...go}>📊 Tổng quan</NavLink>
          <NavLink to="/merge-queue" className="m-sheet-item" {...go}>🔀 Hàng đợi gộp</NavLink>
          <NavLink to="/sync-logs" className="m-sheet-item" {...go}>🔄 Nhật ký đồng bộ</NavLink>
          <NavLink to="/audit" className="m-sheet-item" {...go}>📝 Nhật ký thao tác</NavLink>
        </>}
        {isAdmin && <>
          <div className="m-sheet-h">Quản trị</div>
          <NavLink to="/connections" className="m-sheet-item" {...go}>🔌 Kết nối</NavLink>
          <NavLink to="/users" className="m-sheet-item" {...go}>👤 Người dùng</NavLink>
          <NavLink to="/settings" className="m-sheet-item" {...go}>⚙️ Cấu hình</NavLink>
        </>}
        <div className="m-sheet-h">{user.name} · {user.role}</div>
        <NavLink to="/change-password" className="m-sheet-item" {...go}>🔑 Đổi mật khẩu</NavLink>
        <button className="m-sheet-item" style={{ width: '100%', border: 'none', background: 'none', textAlign: 'left' }}
          onClick={() => { onClose(); onLogout() }}>🚪 Đăng xuất</button>
      </div>
    </>
  )
}

export default function MobileShell({ user, onLogout, children }) {
  const [sheet, setSheet] = useState(false)
  const { pathname } = useLocation()
  const nav = useNavigate()
  const isManagerUp = ['admin', 'manager'].includes(user.role)
  const onProfile = /^\/customers\/[^/]+$/.test(pathname)

  const tab = (to, icon, label, exact = false) => (
    <NavLink to={to} end={exact} className={({ isActive }) => `m-tab${isActive ? ' on' : ''}`}>
      <span className="m-tab-i" aria-hidden="true">{icon}</span>{label}
    </NavLink>
  )

  return (
    <div className="m-app">
      <header className="m-bar">
        {onProfile && (
          <button className="m-bar-btn" onClick={() => nav(-1)} aria-label="Quay lại">←</button>
        )}
        <div className="m-bar-t">{titleFor(pathname)}</div>
        <button className="m-bar-btn" onClick={() => setSheet(true)} aria-label="Mở menu">☰</button>
      </header>

      <main className="m-main">{children}</main>

      <nav className="m-tabs" aria-label="Điều hướng chính">
        {tab('/customers', '👥', 'Khách')}
        {tab('/my-work', '⭐', 'Việc của tôi')}
        {tab('/segments', '🧩', 'Phân khúc')}
        {isManagerUp
          ? tab('/', '📊', 'Tổng quan', true)
          : <button className="m-tab" onClick={() => setSheet(true)}>
              <span className="m-tab-i" aria-hidden="true">☰</span>Thêm</button>}
      </nav>

      {sheet && <Sheet user={user} onClose={() => setSheet(false)} onLogout={onLogout} />}
    </div>
  )
}
