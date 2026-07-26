import { useEffect, useState } from 'react'
import { api, fmtDateTime } from '../api.js'
import { SourceBadge, useToast } from '../ui.jsx'

export default function SyncLogs() {
  const [tab, setTab] = useState('events')
  const [events, setEvents] = useState([])
  const [logs, setLogs] = useState([])
  const [status, setStatus] = useState('')
  const toast = useToast()

  const load = () => {
    api(`/webhook-events?limit=100${status ? `&status=${status}` : ''}`).then(setEvents).catch(() => {})
    api('/sync-logs?limit=100').then(setLogs).catch(() => {})
  }
  useEffect(load, [status])

  const retry = async id => {
    try { await api(`/webhook-events/${id}/retry`, { method: 'POST' }); toast('Đã đặt lại — worker sẽ xử lý trong vài giây'); load() }
    catch (e) { toast(e.message, 'err') }
  }

  const badge = s => ({ done: 'b-ok', pending: 'b-warn', error: 'b-danger', skipped: 'b-mute' }[s] ?? 'b-mute')

  return (
    <>
      <div className="page-h">
        <div><div className="page-t">Nhật ký đồng bộ</div>
          <div className="sub">Màn hình cứu hộ: "sao thiếu khách này" — trả lời trong 30 giây</div></div>
        <div className="chips">
          <button className={`chip${tab === 'events' ? ' on' : ''}`} onClick={() => setTab('events')}>Sự kiện webhook</button>
          <button className={`chip${tab === 'syncs' ? ' on' : ''}`} onClick={() => setTab('syncs')}>Đợt đồng bộ</button>
        </div>
      </div>

      {tab === 'events' && <>
        <div className="chips" style={{ marginBottom: 12 }}>
          {['', 'pending', 'done', 'error', 'skipped'].map(s => (
            <button key={s} className={`chip${status === s ? ' on' : ''}`} onClick={() => setStatus(s)}>
              {s === '' ? 'Tất cả' : s}</button>
          ))}
        </div>
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead><tr><th>#</th><th>Nguồn</th><th>Loại</th><th>Nhận lúc</th><th>Trạng thái</th><th>Payload</th><th></th></tr></thead>
            <tbody>
              {events.map(e => (
                <tr key={e.id}>
                  <td className="mono">{e.id}</td>
                  <td><SourceBadge type={e.source} /></td>
                  <td>{e.event_type ?? '—'}</td>
                  <td>{fmtDateTime(e.received_at)}</td>
                  <td><span className={`badge ${badge(e.status)}`}>{e.status}</span>
                    {e.error && <div className="hint">{e.error}</div>}</td>
                  <td><details className="payload"><summary>xem thô</summary>
                    <pre>{JSON.stringify(e.payload, null, 2)}</pre></details></td>
                  <td>{['error', 'skipped'].includes(e.status) &&
                    <button className="btn sm" onClick={() => retry(e.id)}>Chạy lại</button>}</td>
                </tr>
              ))}
              {events.length === 0 && <tr><td colSpan={7} className="empty">Không có sự kiện</td></tr>}
            </tbody>
          </table>
        </div>
      </>}

      {tab === 'syncs' && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead><tr><th>#</th><th>Chiều</th><th>Đối tượng</th><th>OK</th><th>Lỗi</th><th>Bắt đầu</th><th>Kết thúc</th></tr></thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id}>
                  <td className="mono">{l.id}</td>
                  <td>{l.direction === 'in' ? '⬇️ vào' : '⬆️ ra'}</td>
                  <td>{l.entity}</td>
                  <td><span className="badge b-ok">{l.count_ok}</span></td>
                  <td>{l.count_fail > 0
                    ? <span className="badge b-danger">{l.count_fail}</span>
                    : <span className="badge b-mute">0</span>}</td>
                  <td>{fmtDateTime(l.started_at)}</td>
                  <td>{fmtDateTime(l.finished_at)}</td>
                </tr>
              ))}
              {logs.length === 0 && <tr><td colSpan={7} className="empty">Chưa có đợt đồng bộ nào</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
