import { createContext, useCallback, useContext, useState } from 'react'
import { SEGMENT_COLORS } from './api.js'

/* ---- Toast ---- */
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random()
    setToasts(t => [...t, { id, msg, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---- Modal ---- */
export function Modal({ title, onClose, children }) {
  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="page-h"><div className="page-t" style={{ fontSize: 17 }}>{title}</div>
          <button className="btn sm" onClick={onClose}>Đóng</button></div>
        {children}
      </div>
    </div>
  )
}

export const SegmentBadge = ({ s }) =>
  <span className={`badge ${SEGMENT_COLORS[s] ?? 'b-mute'}`}>{s ?? 'Chưa phân loại'}</span>

export const SourceBadge = ({ type }) =>
  <span className={`badge ${type === 'pos' ? 'b-pos' : 'b-chat'}`}>{type === 'pos' ? 'POS' : 'Chat'}</span>

export const StatusDot = ({ s }) => {
  const cls = s === 'active' ? 'sd-ok' : s === 'error' ? 'sd-err' : 'sd-warn'
  return <span className={`status-dot ${cls}`} />
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      <label className="lbl">{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}
