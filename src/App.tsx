import { useCallback, useState } from 'react'
import { Tldraw, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { connectBoard, type ConnStatus } from './ws-client'

// 보드앱: tldraw 무한 캔버스 + 서버 WS 연동. Claude 없이도 화이트보드로 완전히 동작한다.
export default function App() {
  const [status, setStatus] = useState<ConnStatus>('connecting')

  const handleMount = useCallback((editor: Editor) => {
    // 디버그/검증용으로 editor를 전역 노출 (tldraw 앱 관행)
    ;(window as unknown as { editor: Editor }).editor = editor
    // onMount가 반환한 함수는 tldraw가 unmount 시 호출 (정리)
    return connectBoard(editor, setStatus)
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw onMount={handleMount} />
      <ConnectionBadge status={status} />
    </div>
  )
}

const BADGE: Record<ConnStatus, { label: string; color: string }> = {
  open: { label: '보드 연결됨', color: '#16a34a' },
  connecting: { label: '연결 중…', color: '#d97706' },
  closed: { label: '연결 끊김 — 재연결 시도 중', color: '#dc2626' },
}

function ConnectionBadge({ status }: { status: ConnStatus }) {
  const { label, color } = BADGE[status]
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        background: 'rgba(255,255,255,0.92)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        font: '12px/1.4 system-ui, sans-serif',
        color: '#111',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
      {label}
    </div>
  )
}
