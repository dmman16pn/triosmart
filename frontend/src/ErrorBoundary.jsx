import { Component } from 'react'

// Không bao giờ để trắng trang câm lặng: crash ở bất kỳ trang nào → hiện lỗi rõ ràng + nút tải lại.
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error, info) {
    console.error('[TRIOSMART] UI crash:', error, info?.componentStack)
  }

  componentDidUpdate(prevProps) {
    // đổi trang thì cho render lại — lỗi có thể chỉ thuộc về trang trước
    if (this.state.error && prevProps.locationKey !== this.props.locationKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'var(--bg, #F6F7FC)', padding: 20 }}>
        <div className="card" style={{ maxWidth: 560, textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>😵</div>
          <h2 style={{ margin: '10px 0 6px' }}>Giao diện gặp lỗi</h2>
          <p className="sub" style={{ marginBottom: 10 }}>
            Đây thường là do phiên bản giao diện trong trình duyệt đã cũ. Bấm tải lại để lấy bản mới nhất.
          </p>
          <pre style={{ background: 'var(--line2, #F0F2F9)', borderRadius: 8, padding: 10,
            textAlign: 'left', fontSize: 12, overflowX: 'auto', marginBottom: 14 }}>
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <button className="btn primary" onClick={() => window.location.reload()}>⟳ Tải lại trang</button>
        </div>
      </div>
    )
  }
}
