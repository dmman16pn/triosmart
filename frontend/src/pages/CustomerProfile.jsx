import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, fmtMoney, fmtDate, fmtDateTime } from '../api.js'
import { SegmentBadge, SourceBadge, Field, useToast } from '../ui.jsx'

export default function CustomerProfile({ user }) {
  const { id } = useParams()
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('all')
  const toast = useToast()

  const load = () => api(`/customers/${id}`).then(setD).catch(e => setErr(e.message))
  // Bọc trong {} — effect trả về Promise sẽ bị React gọi như hàm cleanup khi rời trang → crash
  useEffect(() => { load() }, [id])

  if (err) return <div className="empty">{err} — <Link to="/customers">quay lại danh sách</Link></div>
  if (!d) return <div className="empty">Đang tải…</div>
  const c = d.customer

  const startEdit = () => {
    setForm({
      name: c.name ?? '', phone: c.phone_normalized ?? c.phone_raw ?? '',
      email: c.email ?? '', gender: c.gender ?? '',
      internal_note: c.internal_note ?? '', zalo_consent: c.zalo_consent
    })
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const changes = {}
      if (form.name !== (c.name ?? '')) changes.name = form.name
      if (form.phone !== (c.phone_normalized ?? c.phone_raw ?? '')) changes.phone_numbers = [form.phone]
      if (form.email !== (c.email ?? '')) changes.emails = [form.email]
      if (form.gender !== (c.gender ?? '')) changes.gender = form.gender
      if (form.internal_note !== (c.internal_note ?? '')) changes.internal_note = form.internal_note
      if (form.zalo_consent !== c.zalo_consent) changes.zalo_consent = form.zalo_consent
      if (Object.keys(changes).length === 0) {
        toast('Không có thay đổi nào để lưu'); setEditing(false); return
      }

      const res = await api(`/customers/${id}`, { method: 'PATCH', body: changes })
      // Thông báo TRUNG THỰC (spec U2): không nói "thành công" khi chưa đẩy được
      if (res.pushed) toast('Đã lưu và cập nhật lên Pancake ✓')
      else if (res.error) toast(`Đã lưu tại TRIOSMART. Chưa đẩy lên Pancake được: ${res.error}. Hệ thống sẽ tự thử lại.`, 'warn')
      else toast('Đã lưu tại TRIOSMART')
      setEditing(false); load()
    } catch (e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  const timeline = d.timeline.filter(t =>
    filter === 'all' ? true : filter === 'order' ? t.kind === 'order' : t.kind === 'chat')

  return (
    <>
      {/* Đầu trang */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="page-h" style={{ marginBottom: 10 }}>
          <div>
            <div className="page-t">{c.name ?? '(chưa có tên)'} <SegmentBadge s={c.rfm_segment} /></div>
            <div className="sub mono">{c.phone_normalized ?? c.phone_raw ?? 'chưa có SĐT'}
              {c.phone_invalid && ' · ⚠️ SĐT không hợp lệ, cần sửa tay'}</div>
          </div>
          <Link to="/customers" className="btn sm">← Danh sách</Link>
        </div>
        <div className="grid kpis">
          <div><div className="kpi-l">Tổng đã mua</div><div className="kpi-v" style={{ fontSize: 17 }}>{fmtMoney(c.pos_purchased_amount)}</div></div>
          <div><div className="kpi-l">Số đơn (thành công/tổng)</div><div className="kpi-v" style={{ fontSize: 17 }}>{c.pos_succeed_order_count}/{c.pos_order_count}</div></div>
          <div><div className="kpi-l">Mua gần nhất</div><div className="kpi-v" style={{ fontSize: 17 }}>{fmtDate(c.pos_last_order_at)}</div></div>
          <div><div className="kpi-l">Điểm thưởng</div><div className="kpi-v" style={{ fontSize: 17 }}>{Number(c.pos_reward_point)}</div></div>
          <div><div className="kpi-l">Hạng</div><div className="kpi-v" style={{ fontSize: 17 }}>{c.pos_level_id ?? '—'}</div></div>
        </div>
      </div>

      <div className="row-2">
        {/* Cột trái — nhập liệu */}
        <div className="grid">
          <div className="card">
            <div className="page-h" style={{ marginBottom: 10 }}>
              <b>Thông tin cơ bản</b>
              {!editing
                ? <button className="btn sm" onClick={startEdit}>✏️ Sửa</button>
                : <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn sm" onClick={() => setEditing(false)}>Hủy</button>
                    <button className="btn sm primary" onClick={save} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu'}</button>
                  </div>}
            </div>
            {!editing ? (
              <div>
                <div className="field"><span className="lbl">Email</span>{c.email ?? '—'}</div>
                <div className="field"><span className="lbl">Giới tính</span>{c.gender ?? '—'}</div>
                <div className="field"><span className="lbl">Ngày sinh</span>{fmtDate(c.date_of_birth)}</div>
                <div className="field"><span className="lbl">Đồng ý nhận tin Zalo</span>{c.zalo_consent ? '✅ Có' : '— Chưa'}</div>
                <div className="hint">↳ Lưu thông tin cơ bản sẽ ghi ngược về Pancake</div>
              </div>
            ) : (
              <div>
                <Field label="Tên"><input className="inp" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></Field>
                <Field label="Số điện thoại"><input className="inp" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></Field>
                <Field label="Email"><input className="inp" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></Field>
                <Field label="Giới tính">
                  <select className="inp" value={form.gender} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
                    <option value="">—</option><option value="male">Nam</option><option value="female">Nữ</option>
                  </select></Field>
                <Field label="Ghi chú nội bộ (chỉ TRIOSMART)">
                  <textarea className="inp" rows={3} value={form.internal_note}
                    onChange={e => setForm(f => ({ ...f, internal_note: e.target.value }))} /></Field>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={form.zalo_consent}
                    onChange={e => setForm(f => ({ ...f, zalo_consent: e.target.checked }))} />
                  Khách đồng ý nhận tin Zalo (chuẩn bị giai đoạn 2)
                </label>
              </div>
            )}
          </div>

          <div className="card">
            <b>Thẻ (tag)</b>
            <div style={{ marginTop: 8 }}>
              {(c.tags ?? []).length ? c.tags.map((t, i) => <span key={i} className="badge b-brand" style={{ marginRight: 6 }}>{t}</span>) : <span className="sub">Chưa có thẻ</span>}
            </div>
          </div>

          <div className="card">
            <b>Danh tính đã ghép</b>
            {d.identities.map(i => (
              <div key={i.id} style={{ marginTop: 8 }}>
                <SourceBadge type={i.source_type} /> <span className="mono">{i.external_id}</span>
                <div className="sub">{i.connection_name} · ghép bằng {i.match_method} · tin cậy {i.confidence}</div>
              </div>
            ))}
            {d.identities.length === 0 && <div className="sub" style={{ marginTop: 8 }}>Chưa ghép nguồn nào</div>}
          </div>

          {d.recent_audit.length > 0 && (
            <div className="card">
              <b>Thay đổi gần đây</b>
              {d.recent_audit.slice(0, 6).map((a, i) => (
                <div key={i} className="sub" style={{ marginTop: 7 }}>
                  <b>{a.field}</b>: {JSON.stringify(a.old_value)} → {JSON.stringify(a.new_value)}
                  {a.source === 'conflict' && <span className="badge b-warn" style={{ marginLeft: 5 }}>xung đột</span>}
                  {a.source === 'user' && (a.pushed_to_pancake
                    ? <span className="badge b-ok" style={{ marginLeft: 5 }}>đã đẩy Pancake</span>
                    : <span className="badge b-mute" style={{ marginLeft: 5 }}>chưa đẩy</span>)}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cột phải — dòng thời gian 2 nguồn */}
        <div className="card">
          <div className="page-h" style={{ marginBottom: 12 }}>
            <b>Dòng thời gian</b>
            <div className="chips">
              {[['all', 'Tất cả'], ['order', 'Đơn hàng'], ['chat', 'Hội thoại']].map(([k, l]) => (
                <button key={k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="timeline">
            {timeline.map((t, i) => (
              <div key={i} className="tl-item">
                <span className={`tl-dot ${t.kind === 'order' ? 'pos' : 'chat'}`} />
                {t.kind === 'order' ? (
                  <>
                    <div className="tl-t">Đơn #{t.data.pos_order_id} · {fmtMoney(t.data.total_amount)}</div>
                    <div className="tl-d">{fmtDateTime(t.at)} · trạng thái {t.data.status ?? '—'}</div>
                  </>
                ) : (
                  <>
                    <div className="tl-t">💬 {t.data.last_message_snippet ?? 'Hội thoại'}</div>
                    <div className="tl-d">{fmtDateTime(t.at)} · {t.data.type ?? 'INBOX'}</div>
                  </>
                )}
              </div>
            ))}
            {timeline.length === 0 && <div className="empty">Chưa có hoạt động</div>}
          </div>
        </div>
      </div>
    </>
  )
}
