import { useEffect, useState } from 'react'

// 조용히 죽는 런타임 에러를 화면에 노출 — "아무 일도 안 일어나는" 버그를 즉시 진단 가능하게.
// (실례: 비보안 컨텍스트에서 crypto.randomUUID throw → 채팅 전송이 무반응이었음)
export function ErrorRibbon() {
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    const onError = (e: ErrorEvent) => setMsg(e.message)
    const onReject = (e: PromiseRejectionEvent) => setMsg(String(e.reason?.message ?? e.reason))
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onReject)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onReject)
    }
  }, [])

  if (!msg) return null
  return (
    <div
      onClick={() => setMsg(null)}
      style={{
        position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
        zIndex: 3000, maxWidth: '80%', padding: '6px 12px', borderRadius: 8,
        background: '#c92a2a', color: '#fff', font: '12px/1.5 system-ui, sans-serif',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)', cursor: 'pointer',
      }}
      title="클릭하면 닫힘"
    >
      ⚠ 오류: {msg} — 이 메시지를 캡처해서 알려주세요
    </div>
  )
}
