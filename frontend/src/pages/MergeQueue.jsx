import { useEffect, useState } from 'react'
import { api, fmtMoney, fmtDate } from '../api.js'
import { useToast } from '../ui.jsx'

const FIELDS = [
  ['name', 'Tên'], ['phone_normalized', 'SĐT'], ['email', 'Email'],
  ['pos_purchased_amount', 'Tổng mua', fmtMoney], ['pos_succeed_order_count', 'Đơn thành công'],
  ['pos_last_order_at', 'Mua gần nhất', fmtDate]
]

export default function MergeQueue() {
  const [rows, setRows] = useState(null)
  const [undoIds, setUndoIds] = useState({})   // itemId -> mergeAuditId (hoàn tác 24h)
  const toast = useToast()

  const load = () => api('/merge-queue').then(setRows).catch(e => toast(e.message, 'err'))
  useEffect(() => { load() }, [])   // không đưa thẳng load vào effect — nó trả Promise

  const resolve = async (item, action, keepId = null) => {
    try {
      const res = await api(`/merge-queue/${item.id}/resolve`, {
        method: 'POST', body: { action, keep_id: keepId }
      })
      if (action === 'merge') {
        setUndoIds(u => ({ ...u, [item.id]: res.mergeAuditId }))
        toast('Đã gộp hai hồ sơ — có thể hoàn tác trong 24 giờ')
      } else toast('Đã xử lý')
      load()
    } catch (e) { toast(e.message, 'err') }
  }

  const undo = async (itemId) => {
    try {
      await api(`/merge/undo/${undoIds[itemId]}`, { method: 'POST' })
      setUndoIds(u => { const n = { ...u }; delete n[itemId]; return n })
      toast('Đã hoàn tác gộp')
      load()
    } catch (e) { toast(e.message, 'err') }
  }

  if (!rows) return <div className="empty">Đang tải…</div>

  return (
    <>
      <div className="page-h">
        <div><div className="page-t">Hàng đợi gộp trùng</div>
          <div className="sub">Hai hồ sơ nghi trùng đặt cạnh nhau — điểm khác biệt được tô nổi</div></div>
      </div>

      {Object.entries(undoIds).map(([itemId]) => (
        <div key={itemId} className="card" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Vừa gộp một cặp hồ sơ.</span>
          <button className="btn sm danger" onClick={() => undo(itemId)}>↩️ Hoàn tác</button>
        </div>
      ))}

      {rows.length === 0 && <div className="card empty">✅ Không còn mục nào chờ duyệt</div>}

      <div className="grid">
        {rows.map(item => {
          const a = item.customer_a, b = item.customer_b
          if (!a || !b) return null
          return (
            <div key={item.id} className="card">
              <div className="sub" style={{ marginBottom: 10 }}>
                Lý do: {item.reason === 'same_name_no_phone' ? 'Trùng tên, cả hai chưa có SĐT' : item.reason} · độ tin {item.score}/100
              </div>
              <div className="split">
                {[a, b].map((c, i) => (
                  <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}>
                    <b>{c.name ?? '(chưa có tên)'}</b>
                    {FIELDS.map(([f, label, fmt]) => {
                      const other = i === 0 ? b : a
                      const differs = String(c[f] ?? '') !== String(other[f] ?? '')
                      return (
                        <div key={f} className="sub" style={{ marginTop: 5 }}>
                          {label}: <span className={differs ? 'diff' : ''}>{(fmt ?? (x => x ?? '—'))(c[f])}</span>
                        </div>
                      )
                    })}
                    <button className="btn sm" style={{ marginTop: 10 }}
                      onClick={() => resolve(item, 'merge', c.id)}>Giữ hồ sơ này khi gộp</button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn ok" onClick={() => resolve(item, 'merge')}>🔀 Gộp (tự chọn hồ sơ chính)</button>
                <button className="btn" onClick={() => resolve(item, 'keep_separate')}>Giữ riêng</button>
                <button className="btn" onClick={() => resolve(item, 'ignore')}>Bỏ qua</button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
