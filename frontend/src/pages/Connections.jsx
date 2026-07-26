import { useEffect, useState } from 'react'
import { api, fmtDateTime } from '../api.js'
import { Modal, Field, SourceBadge, StatusDot, useToast } from '../ui.jsx'

export default function Connections() {
  const [rows, setRows] = useState([])
  const [wizard, setWizard] = useState(false)
  const toast = useToast()

  const load = () => api('/connections').then(setRows).catch(e => toast(e.message, 'err'))
  useEffect(() => { load() }, [])   // không đưa thẳng load vào effect — nó trả Promise

  const test = async c => {
    try {
      const res = await api(`/connections/${c.id}/test`, { method: 'POST' })
      toast(c.type === 'pos'
        ? `✅ Kết nối OK — khách mẫu: ${res.sample_customer ?? '(trống)'}`
        : `✅ Kết nối OK — ${res.sample_conversations} hội thoại`)
      load()
    } catch (e) { toast(`Kết nối lỗi: ${e.data?.error ?? e.message}`, 'err'); load() }
  }

  const sync = async c => {
    try {
      await api(`/connections/${c.id}/sync`, { method: 'POST' })
      toast('Đã bắt đầu nạp lịch sử nền — theo dõi ở Nhật ký đồng bộ')
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <>
      <div className="page-h">
        <div><div className="page-t">Quản lý kết nối</div>
          <div className="sub">Nguồn dữ liệu Pancake POS và Pancake Chat</div></div>
        <button className="btn primary" onClick={() => setWizard(true)}>+ Thêm kết nối</button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {rows.map(c => (
          <div key={c.id} className="card">
            <div className="page-h" style={{ marginBottom: 8 }}>
              <b><StatusDot s={c.status} />{c.name}</b> <SourceBadge type={c.type} />
            </div>
            <div className="sub mono">{c.type === 'pos' ? `shop_id: ${c.shop_id}` : `page_id: ${c.page_id}`}</div>
            <div className="sub">Webhook: {c.webhook_status} · OK gần nhất: {fmtDateTime(c.last_ok_at)}</div>
            {c.last_error && <div className="badge b-danger" style={{ marginTop: 6, whiteSpace: 'normal' }}>{c.last_error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn sm" onClick={() => test(c)}>🔍 Kiểm tra kết nối</button>
              <button className="btn sm" onClick={() => sync(c)}>⬇️ Nạp lại lịch sử</button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="card empty">Chưa có kết nối nào</div>}
      </div>

      {wizard && <Wizard onClose={() => { setWizard(false); load() }} />}
    </>
  )
}

function Wizard({ onClose }) {
  const [step, setStep] = useState(1)
  const [type, setType] = useState('pos')
  const [form, setForm] = useState({ name: '', shop_id: '', page_id: '', api_key: '', page_access_token: '' })
  const [created, setCreated] = useState(null)
  const [testResult, setTestResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const createConn = async () => {
    setBusy(true)
    try {
      const body = type === 'pos'
        ? { type, name: form.name, shop_id: form.shop_id, credential: { api_key: form.api_key } }
        : { type, name: form.name, page_id: form.page_id, credential: { page_access_token: form.page_access_token } }
      const c = await api('/connections', { method: 'POST', body })
      setCreated(c); setStep(2)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const runTest = async () => {
    setBusy(true); setTestResult(null)
    try {
      const res = await api(`/connections/${created.id}/test`, { method: 'POST' })
      setTestResult({ ok: true, ...res })
    } catch (e) {
      setTestResult({ ok: false, error: e.data?.error ?? e.message })
    } finally { setBusy(false) }
  }

  const startSync = async () => {
    setBusy(true)
    try {
      await api(`/connections/${created.id}/sync`, { method: 'POST' })
      toast('Đã bắt đầu nạp lịch sử — theo dõi tiến trình ở Nhật ký đồng bộ')
      onClose()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <Modal title={`Thêm kết nối — bước ${step}/3`} onClose={onClose}>
      {step === 1 && <>
        <Field label="Loại nguồn">
          <select className="inp" value={type} onChange={e => setType(e.target.value)}>
            <option value="pos">Pancake POS</option>
            <option value="chat">Pancake Chat (Facebook/Zalo)</option>
          </select>
        </Field>
        <Field label="Tên hiển thị"><input className="inp" value={form.name} onChange={e => set('name', e.target.value)} placeholder="VD: Shop chính" /></Field>
        {type === 'pos' ? <>
          <Field label="Shop ID" hint="Nằm trên thanh địa chỉ khi đang ở trong shop Pancake">
            <input className="inp" value={form.shop_id} onChange={e => set('shop_id', e.target.value)} /></Field>
          <Field label="API Key" hint="Cấu hình → Nâng cao → Kết nối bên thứ 3 → Webhook/API → tab API Key → Thêm mới">
            <input className="inp" value={form.api_key} onChange={e => set('api_key', e.target.value)} /></Field>
        </> : <>
          <Field label="Page ID" hint="Lấy từ API danh sách trang hoặc đội hỗ trợ Pancake">
            <input className="inp" value={form.page_id} onChange={e => set('page_id', e.target.value)} /></Field>
          <Field label="Page Access Token" hint="Cài đặt → Công cụ của từng trang. Lưu ý: webhook Chat phải nhờ đội Pancake bật hộ, tốn 1 slot gói cước">
            <input className="inp" value={form.page_access_token} onChange={e => set('page_access_token', e.target.value)} /></Field>
        </>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy || !form.name} onClick={createConn}>
          Tiếp tục → Kiểm tra</button>
      </>}

      {step === 2 && <>
        <p style={{ marginBottom: 12 }}>Gọi thử API thật để xác nhận đúng tài khoản:</p>
        {testResult && (testResult.ok
          ? <div className="badge b-ok" style={{ display: 'block', marginBottom: 12, padding: 10, whiteSpace: 'normal' }}>
              ✅ Kết nối OK{testResult.sample_customer ? ` — khách mẫu: ${testResult.sample_customer}` : ''}
              {testResult.sample_conversations != null ? ` — ${testResult.sample_conversations} hội thoại` : ''}
            </div>
          : <div className="badge b-danger" style={{ display: 'block', marginBottom: 12, padding: 10, whiteSpace: 'normal' }}>
              ❌ {testResult.error}</div>)}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={runTest} disabled={busy}>{busy ? 'Đang gọi…' : '🔍 Kiểm tra kết nối'}</button>
          <button className="btn primary" disabled={!testResult?.ok} onClick={() => setStep(3)}>Tiếp tục → Nạp lịch sử</button>
        </div>
      </>}

      {step === 3 && <>
        <p style={{ marginBottom: 12 }}>Nạp toàn bộ khách hàng{type === 'pos' ? ' và đơn hàng' : ' và hội thoại'} từ Pancake về.
          Việc này chạy nền — bạn có thể đóng cửa sổ và theo dõi ở <b>Nhật ký đồng bộ</b>.</p>
        <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={startSync}>
          ⬇️ Bắt đầu nạp lịch sử</button>
      </>}
    </Modal>
  )
}
