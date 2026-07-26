import { useEffect, useState } from 'react'

// Một nguồn sự thật duy nhất cho "đang ở điện thoại hay máy tính".
// Dùng matchMedia thay vì đo window.innerWidth để không phải nghe sự kiện resize,
// và để xoay ngang/dọc điện thoại là đổi giao diện ngay.
const QUERY = '(max-width: 768px)'

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches)

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const onChange = e => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    setIsMobile(mq.matches)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
