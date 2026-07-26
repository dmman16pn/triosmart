import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Connections from './pages/Connections.jsx'
import SyncLogs from './pages/SyncLogs.jsx'
import MergeQueue from './pages/MergeQueue.jsx'
import Users from './pages/Users.jsx'
import AuditLog from './pages/AuditLog.jsx'
import Settings from './pages/Settings.jsx'
import Customers from './pages/Customers.jsx'
import CustomerProfile from './pages/CustomerProfile.jsx'
import Segments from './pages/Segments.jsx'
import MyWork from './pages/MyWork.jsx'

export default function App() {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const nav = useNavigate()

  useEffect(() => {
    setUnauthorizedHandler(() => { setUser(null) })
    if (!getToken()) { setReady(true); return }
    api('/auth/me').then(setUser).catch(() => {}).finally(() => setReady(true))
  }, [])

  if (!ready) return null
  if (!user) return <Login onLogin={u => { setUser(u); nav('/') }} />

  const isAdmin = user.role === 'admin'
  const isManagerUp = ['admin', 'manager'].includes(user.role)
  const logout = () => { setToken(null); setUser(null) }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">TRIO<b>SMART</b></div>

        <div className="nav-group">Khách hàng</div>
        <NavLink to="/customers" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>👥 Danh sách khách</NavLink>
        <NavLink to="/segments" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>🧩 Phân khúc</NavLink>
        <NavLink to="/my-work" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>⭐ Việc của tôi</NavLink>

        {isManagerUp && <>
          <div className="nav-group">Vận hành</div>
          <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>📊 Tổng quan</NavLink>
          <NavLink to="/merge-queue" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>🔀 Hàng đợi gộp</NavLink>
          <NavLink to="/sync-logs" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>🔄 Nhật ký đồng bộ</NavLink>
          <NavLink to="/audit" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>📝 Nhật ký thao tác</NavLink>
        </>}

        {isAdmin && <>
          <div className="nav-group">Quản trị</div>
          <NavLink to="/connections" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>🔌 Kết nối</NavLink>
          <NavLink to="/users" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>👤 Người dùng</NavLink>
          <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>⚙️ Cấu hình</NavLink>
        </>}

        <div className="nav-group">Tài khoản</div>
        <div className="nav-item" style={{ fontSize: 12.5 }}>{user.name} · <span className="badge b-mute">{user.role}</span></div>
        <button className="nav-item btn" style={{ width: '100%', border: 'none', textAlign: 'left' }} onClick={logout}>🚪 Đăng xuất</button>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={isManagerUp ? <Dashboard /> : <Navigate to="/customers" />} />
          <Route path="/customers" element={<Customers user={user} />} />
          <Route path="/customers/:id" element={<CustomerProfile user={user} />} />
          <Route path="/segments" element={<Segments />} />
          <Route path="/my-work" element={<MyWork />} />
          <Route path="/merge-queue" element={<MergeQueue />} />
          <Route path="/sync-logs" element={<SyncLogs />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/connections" element={<Connections />} />
          <Route path="/users" element={<Users />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}
