import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtMoney, fmtDate } from '../api.js'
import { SegmentBadge, SourceBadge, useToast } from '../ui.jsx'
import { useIsMobile } from '../useIsMobile.js'

const SEGMENTS = ['Khách VIP', 'Trung thành', 'Có nguy cơ rời bỏ', 'Đã rời bỏ', 'Mua một lần', 'Khách mới', 'Chưa mua']

export default function Customers({ user }) {
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState({ rows: [], total: 0 })
  const [q, setQ] = useState(params.get('q') ?? '')
  const [selected, setSelected] = useState([])
  const [users, setUsers] = useState([])
  const toast = useToast()

  const segment = params.get('segment') ?? ''
  const page = Number(params.get('page') ?? 1)
  const sort = params.get('sort') ?? ''
  const dir = params.get('dir') ?? 'desc'
  const isManagerUp = ['admin', 'manager'].includes(user.role)
  const isMobile = useIsMobile()

  const load = () => {
    const qs = new URLSearchParams()
    if (params.get('q')) qs.set('q', params.get('q'))
    if (segment) qs.set('segment', segment)
    if (sort) { qs.set('sort', sort); qs.set('dir', dir) }
    qs.set('page', page)
    api(`/customers?${qs}`).then(setData).catch(e => toast(e.message, 'err'))
  }
  useEffect(() => { load() }, [params])
  useEffect(() => {
    if (user.role === 'admin') api('/users').then(setUsers).catch(() => {})
  }, [])

  const setParam = (k, v) => {
    const next = new URLSearchParams(params)
    v ? next.set(k, v) : next.delete(k)
    if (k !== 'page') next.delete('page')
    setParams(next)
  }

  const sortBy = col => {
    if (sort === col) setParam('dir', dir === 'desc' ? 'asc' : 'desc')
    else { const n = new URLSearchParams(params); n.set('sort', col); n.set('dir', 'desc'); n.delete('page'); setParams(n) }
  }

  const bulkAssign = async userId => {
    try {
      await api('/customers/bulk-assign', { method: 'POST', body: { customer_ids: selected, user_id: userId || null } })
      toast(`Đã gán ${selected.length} khách`)
      setSelected([]); load()
    } catch (e) { toast(e.message, 'err') }
  }

  const pages = Math.max(1, Math.ceil(data.total / (data.page_size || 25)))

  const searchForm = (
    <form className="m-search" onSubmit={e => { e.preventDefault(); setParam('q', q) }}>
      <input className="inp" type="search" inputMode="search" enterKeyHint="search"
        placeholder="Tên hoặc số điện thoại…" value={q} onChange={e => setQ(e.target.value)} />
      <button className="btn primary">Tìm</button>
    </form>
  )

  const chips = (
    <div className="m-chips chips">
      <button className={`chip${!segment ? ' on' : ''}`} onClick={() => setParam('segment', '')}>Tất cả</button>
      {SEGMENTS.map(s2 => (
        <button key={s2} className={`chip${segment === s2 ? ' on' : ''}`}
          onClick={() => setParam('segment', segment === s2 ? '' : s2)}>{s2}</button>
      ))}
    </div>
  )

  // --- Giao diện điện thoại: tra cứu là chính, mỗi khách một thẻ, gọi được ngay ---
  if (isMobile) {
    return (
      <>
        {searchForm}
        {chips}
        <div className="m-dim" style={{ marginBottom: 10 }}>
          {data.total.toLocaleString('vi-VN')} khách{segment ? ` · ${segment}` : ''}
        </div>

        <div className="m-list">
          {data.rows.map(r => (
            <div key={r.id} className="m-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Link to={`/customers/${r.id}`} style={{ color: 'inherit', flex: 1, minWidth: 0 }}>
                <div className="m-card-top" style={{ marginBottom: 6 }}>
                  <div className="m-card-name">{r.name ?? '(chưa có tên)'}</div>
                  <SegmentBadge s={r.rfm_segment} />
                </div>
                <div className="mono m-dim">
                  {r.phone_normalized ?? (r.phone_invalid ? '⚠️ SĐT lỗi' : 'chưa có SĐT')}
                </div>
                <div className="m-card-meta" style={{ marginTop: 5 }}>
                  {/* Khách chưa mua thì không lặp lại "0đ · 0 đơn · chưa mua" ba lần */}
                  {Number(r.pos_succeed_order_count) > 0 ? (
                    <>
                      {isManagerUp && <span><b>{fmtMoney(r.pos_purchased_amount)}</b></span>}
                      <span>{Number(r.pos_succeed_order_count)} đơn</span>
                      {r.pos_last_order_at && <span className="m-dim">{fmtDate(r.pos_last_order_at)}</span>}
                    </>
                  ) : r.rfm_segment !== 'Chưa mua' ? (
                    <span className="m-dim">Chưa phát sinh đơn</span>
                  ) : null}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    {(r.identities ?? []).map((i, idx) => <SourceBadge key={idx} type={i.source_type} />)}
                  </span>
                </div>
              </Link>
              {r.phone_normalized && (
                <a className="m-call" href={`tel:${r.phone_normalized}`}
                  aria-label={`Gọi ${r.name ?? 'khách'}`}>📞</a>
              )}
            </div>
          ))}
          {data.rows.length === 0 && (
            <div className="empty">
              {params.get('q') || segment
                ? 'Không có khách nào khớp. Thử tìm bằng số điện thoại.'
                : 'Nhập tên hoặc số điện thoại để tìm khách.'}
            </div>
          )}
        </div>

        {pages > 1 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
            <button className="btn" style={{ flex: 1, minHeight: 44 }} disabled={page <= 1}
              onClick={() => { setParam('page', page - 1); window.scrollTo(0, 0) }}>← Trước</button>
            <span className="m-dim">{page}/{pages}</span>
            <button className="btn" style={{ flex: 1, minHeight: 44 }} disabled={page >= pages}
              onClick={() => { setParam('page', page + 1); window.scrollTo(0, 0) }}>Sau →</button>
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <div className="page-h">
        <div><div className="page-t">Danh sách khách hàng</div>
          <div className="sub">{data.total.toLocaleString('vi-VN')} khách</div></div>
        <form onSubmit={e => { e.preventDefault(); setParam('q', q) }} style={{ display: 'flex', gap: 8 }}>
          <input className="inp" style={{ width: 260 }} placeholder="Tìm tên hoặc SĐT (cả số phụ)…"
            value={q} onChange={e => setQ(e.target.value)} />
          <button className="btn primary">Tìm</button>
        </form>
      </div>

      <div className="chips" style={{ marginBottom: 14 }}>
        <button className={`chip${!segment ? ' on' : ''}`} onClick={() => setParam('segment', '')}>Tất cả</button>
        {SEGMENTS.map(s => (
          <button key={s} className={`chip${segment === s ? ' on' : ''}`}
            onClick={() => setParam('segment', segment === s ? '' : s)}>{s}</button>
        ))}
      </div>

      {selected.length > 0 && user.role === 'admin' && (
        <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
          <b>{selected.length} khách đã chọn</b>
          <select className="inp" style={{ width: 220 }} defaultValue=""
            onChange={e => e.target.value !== '' && bulkAssign(e.target.value)}>
            <option value="" disabled>Gán người phụ trách…</option>
            <option value="">(Bỏ gán)</option>
            {users.filter(u => u.active).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead><tr>
            {user.role === 'admin' && <th style={{ width: 30 }}>
              <input type="checkbox" checked={selected.length === data.rows.length && data.rows.length > 0}
                onChange={e => setSelected(e.target.checked ? data.rows.map(r => r.id) : [])} /></th>}
            <th onClick={() => sortBy('name')} style={{ cursor: 'pointer' }}>Tên {sort === 'name' && (dir === 'desc' ? '↓' : '↑')}</th>
            <th>Số điện thoại</th>
            <th>Phân khúc</th>
            {isManagerUp && <th onClick={() => sortBy('purchased')} style={{ cursor: 'pointer' }}>Tổng đã mua {sort === 'purchased' && (dir === 'desc' ? '↓' : '↑')}</th>}
            <th onClick={() => sortBy('orders')} style={{ cursor: 'pointer' }}
              title="Tổng số đơn khách đã mua thành công, tính từ trước đến nay (theo số Pancake ghi trên hồ sơ khách)">
              Đơn thành công {sort === 'orders' && (dir === 'desc' ? '↓' : '↑')}</th>
            <th onClick={() => sortBy('last_order')} style={{ cursor: 'pointer' }}>Mua gần nhất {sort === 'last_order' && (dir === 'desc' ? '↓' : '↑')}</th>
            <th>Nguồn</th>
          </tr></thead>
          <tbody>
            {data.rows.map(r => (
              <tr key={r.id} className="clickable">
                {user.role === 'admin' && <td onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.includes(r.id)}
                    onChange={e => setSelected(s => e.target.checked ? [...s, r.id] : s.filter(x => x !== r.id))} /></td>}
                <td><Link to={`/customers/${r.id}`}><b>{r.name ?? '(chưa có tên)'}</b></Link></td>
                <td className="mono">{r.phone_normalized ?? (r.phone_invalid ? '⚠️ SĐT lỗi' : '—')}</td>
                <td><SegmentBadge s={r.rfm_segment} /></td>
                {isManagerUp && <td>{fmtMoney(r.pos_purchased_amount)}</td>}
                {/* Chỉ hiện số đơn THÀNH CÔNG trọn đời. Số đơn Pancake còn trả về được
                    (giới hạn kỹ thuật, không phải thông tin kinh doanh) nằm trong hồ sơ chi tiết. */}
                <td>{Number(r.pos_succeed_order_count) || 0}</td>
                <td>{fmtDate(r.pos_last_order_at)}</td>
                <td>{(r.identities ?? []).map((i, idx) => <SourceBadge key={idx} type={i.source_type} />)}</td>
              </tr>
            ))}
            {data.rows.length === 0 && <tr><td colSpan={8} className="empty">Không có khách nào khớp bộ lọc</td></tr>}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'center' }}>
          <button className="btn sm" disabled={page <= 1} onClick={() => setParam('page', page - 1)}>← Trước</button>
          <span className="sub" style={{ alignSelf: 'center' }}>Trang {page}/{pages}</span>
          <button className="btn sm" disabled={page >= pages} onClick={() => setParam('page', page + 1)}>Sau →</button>
        </div>
      )}
    </>
  )
}
