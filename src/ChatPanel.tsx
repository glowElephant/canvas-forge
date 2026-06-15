import { useEffect, useRef, useState } from 'react'
import type { CursorChatMsg } from '../shared/protocol'
import { useImeSafeEnter } from './ime'
import type { BridgeHandle } from './ws-client'
import { useDrag } from './useDrag'
import { useT } from './i18n'

// 우측 채팅 패널: 커서 채팅과 같은 스트림 — 커서로 쓴 것도 여기 남고, 여기서 쓴 것도 커서 말풍선으로 뜬다.
// 서버가 히스토리를 보관(.board/chat.json)해 늦게 들어와도 이전 대화가 보인다. 접기/펼치기 가능.

function timeLabel(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function ChatPanel({ bridge, user }: { bridge: BridgeHandle; user: { id: string; name: string; color: string } }) {
  const t = useT()
  const [items, setItems] = useState<CursorChatMsg[]>([])
  const [open, setOpen] = useState(true)
  const [unread, setUnread] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(open)
  openRef.current = open
  const { pos, onPointerDown } = useDrag({ x: window.innerWidth - 248, y: 64 })

  useEffect(() => {
    bridge.onChatHistory((history) => {
      setItems(history)
    })
    bridge.onCursorChat((m) => {
      setItems((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m]))
      if (!openRef.current) setUnread((n) => n + 1)
    })
  }, [bridge])

  // 새 메시지 → 아래로 자동 스크롤
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items, open])

  const enterHandlers = useImeSafeEnter((value) => {
    bridge.sendCursorChat({ userId: user.id, name: user.name, color: user.color, text: value.trim() })
  })

  return (
    <div
      style={{
        position: 'absolute', left: pos.x, top: pos.y, zIndex: 1000, width: 240,
        borderRadius: 8, background: 'rgba(255,255,255,0.96)',
        boxShadow: '0 1px 6px rgba(0,0,0,0.18)', font: '12px/1.5 system-ui, sans-serif', color: '#111',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
    >
      <div
        onPointerDown={onPointerDown}
        style={{ display: 'flex', alignItems: 'center', background: '#f1f3f5', cursor: 'grab', touchAction: 'none' }}
      >
        <button
          onClick={() => {
            setOpen(!open)
            setUnread(0)
          }}
          style={{ flex: 1, padding: '6px 10px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', fontWeight: 600 }}
        >
          {t('chat.header')}{!open && unread > 0 ? ` (+${unread})` : ''} {open ? '▾' : '▸'}
        </button>
        <span style={{ padding: '0 8px', color: '#adb5bd', userSelect: 'none' }} title={t('drag.tooltip')}>⠿</span>
      </div>

      {open && (
        <>
          <div ref={listRef} style={{ height: 260, overflowY: 'auto', padding: '4px 0' }}>
            {items.length === 0 && (
              <div style={{ padding: '10px', color: '#868e96' }}>
                {t('chat.empty')}
              </div>
            )}
            {items.map((m) => (
              <div key={m.id} style={{ padding: '3px 10px', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ color: m.color, fontWeight: 700, whiteSpace: 'nowrap' }}>{m.name}</span>
                <span style={{ wordBreak: 'break-word', flex: 1 }}>{m.text}</span>
                <span style={{ color: '#adb5bd', fontSize: 10, whiteSpace: 'nowrap' }}>{timeLabel(m.ts)}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: 8, borderTop: '1px solid #e9ecef' }}>
            <input
              placeholder={t('chat.placeholder')}
              {...enterHandlers}
              style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', border: '1px solid #ced4da', borderRadius: 6, font: 'inherit' }}
            />
          </div>
        </>
      )}
    </div>
  )
}
