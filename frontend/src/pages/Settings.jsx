import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Field, useToast } from '../ui.jsx'

const RFM_FIELDS = [
  ['vip_amount', 'Ngưỡng VIP (đồng)', 'Tổng mua từ mức này + mua trong số ngày VIP → Khách VIP'],
  ['vip_days', 'Số ngày VIP', ''],
  ['loyal_orders', 'Số đơn Trung thành', 'Từ N đơn thành công trở lên'],
  ['loyal_days', 'Số ngày Trung thành', ''],
  ['risk_days', 'Ngưỡng ngày Nguy cơ rời bỏ', 'Từ ngày Trung thành đến mốc này'],
  ['gone_days', 'Ngưỡng ngày Đã rời bỏ', 'Quá mốc này → Đã rời bỏ'],
  ['new_days', 'Số ngày Khách mới', '1 đơn + trong mốc này → Khách mới']
]

export default function Settings() {
  const [rfm, setRfm] = useState(null)
  const [alertCfg, setAlertCfg] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    api('/settings/rfm').then(setRfm).catch(() => {})
    api('/settings/alert').then(setAlertCfg).catch(() => {})
  }, [])

  const saveRfm = async () => {
    setBusy(true)
    try {
      await api('/settings/rfm', { method: 'PUT', body: rfm })
      toast('Đã lưu ngưỡng RFM — đang tính lại phân khúc toàn bộ khách ở nền')
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const saveAlert = async () => {
    setBusy(true)
    try {
      await api('/settings/alert', { method: 'PUT', body: alertCfg })
      toast('Đã lưu cấu hình cảnh báo')
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  if (!rfm || !alertCfg) return <div className="empty">Đang tải…</div>

  return (
    <>
      <div className="page-h">
        <div><div className="page-t">Cấu hình hệ thống</div>
          <div className="sub">Ngưỡng phân khúc · Cảnh báo · Chu kỳ nạp bù</div></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <div className="card">
          <b>Ngưỡng phân khúc RFM</b>
          <div className="hint" style={{ marginBottom: 12 }}>Lưu xong hệ thống tự tính lại toàn bộ phân khúc</div>
          {RFM_FIELDS.map(([k, label, hint]) => (
            <Field key={k} label={label} hint={hint}>
              <input className="inp" type="number" value={rfm[k] ?? ''}
                onChange={e => setRfm(r => ({ ...r, [k]: Number(e.target.value) }))} />
            </Field>
          ))}
          <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={saveRfm}>Lưu ngưỡng RFM</button>
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <b>Kênh nhận cảnh báo</b>
            <Field label="Email nhận cảnh báo" hint="Cảnh báo khi tỉ lệ lỗi webhook vượt ngưỡng — thấp hơn nhiều mức treo của Pancake">
              <input className="inp" value={alertCfg.email ?? ''}
                onChange={e => setAlertCfg(a => ({ ...a, email: e.target.value }))} />
            </Field>
            <Field label="Ngưỡng tỉ lệ lỗi (%)">
              <input className="inp" type="number" value={alertCfg.error_rate_pct ?? 20}
                onChange={e => setAlertCfg(a => ({ ...a, error_rate_pct: Number(e.target.value) }))} />
            </Field>
            <Field label="Cửa sổ theo dõi (phút)">
              <input className="inp" type="number" value={alertCfg.window_minutes ?? 5}
                onChange={e => setAlertCfg(a => ({ ...a, window_minutes: Number(e.target.value) }))} />
            </Field>
            <button className="btn primary" style={{ width: '100%' }} disabled={busy} onClick={saveAlert}>Lưu cảnh báo</button>
          </div>

          <div className="card">
            <b>Chu kỳ chạy nền</b>
            <div className="sub" style={{ marginTop: 8 }}>
              ⬇️ Nạp bù: phút 15 mỗi giờ<br />
              🧮 Tính lại RFM toàn bộ: 02:00 hằng đêm<br />
              🧹 Dọn dữ liệu hết hạn giữ: 02:30 hằng đêm
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
