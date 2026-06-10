import { useEffect, useRef, useState } from 'react'
import { useEditor } from 'tldraw'
import type { BridgeHandle } from './ws-client'

// 커서 말풍선 (표시 전용):
// 채팅 패널에서 보낸 메시지가 보낸 사람 커서 위치에 말풍선으로 쌓였다가 시간순으로 페이드아웃된다.
// '/' 커서 입력은 제거됨 — 실환경에서 입력 신뢰성 문제가 반복되어 입력은 패널로 일원화 (사용자 결정).

const LINE_LIFETIME_MS = 8000
const LINE_FADE_MS = 1000
/** 유저당 최대 표시 줄 수 (연타 폭주 시 오래된 줄부터 즉시 제거) */
const MAX_LINES = 6

interface ChatLine {
  id: number
  text: string
}

interface UserStack {
  name: string
  color: string
  lines: ChatLine[]
}

let lineSeq = 0

export function CursorChat({ bridge, user }: { bridge: BridgeHandle; user: { id: string; name: string; color: string } }) {
  const editor = useEditor()
  const [stacks, setStacks] = useState<Record<string, UserStack>>({})
  const ownRef = useRef<HTMLDivElement>(null)
  const remoteRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // 줄 추가 + 수명 타이머 (시간순으로 한 줄씩 빠짐)
  const pushLine = (userId: string, name: string, color: string, text: string) => {
    const id = ++lineSeq
    setStacks((prev) => {
      const cur = prev[userId] ?? { name, color, lines: [] }
      const lines = [...cur.lines, { id, text }].slice(-MAX_LINES)
      return { ...prev, [userId]: { name, color, lines } }
    })
    setTimeout(() => {
      setStacks((prev) => {
        const cur = prev[userId]
        if (!cur) return prev
        const lines = cur.lines.filter((l) => l.id !== id)
        return { ...prev, [userId]: { ...cur, lines } }
      })
    }, LINE_LIFETIME_MS + LINE_FADE_MS)
  }

  // 라이브 채팅 수신(로컬 에코 포함) → 말풍선
  useEffect(() => {
    bridge.onCursorChat((m) => pushLine(m.userId, m.name, m.color, m.text))
  }, [bridge])

  // 위치 갱신: 내 스택은 내 포인터, 원격 스택은 협업자 커서 (rAF, 직접 DOM — 리렌더 없이)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const own = ownRef.current
      if (own) {
        const p = editor.inputs.currentScreenPoint
        own.style.transform = `translate(${p.x + 14}px, ${p.y + 18}px)`
      }
      for (const c of editor.getCollaborators()) {
        const el = remoteRefs.current[c.userId]
        if (!el || !c.cursor) continue
        const s = editor.pageToScreen({ x: c.cursor.x, y: c.cursor.y })
        el.style.transform = `translate(${s.x + 14}px, ${s.y + 18}px)`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [editor])

  const ownStack = stacks[user.id]
  const remoteIds = Object.keys(stacks).filter((id) => id !== user.id && stacks[id].lines.length > 0)

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2000, overflow: 'hidden' }}>
      <style>{`@keyframes cf-chatline { 0% { opacity: 1 } ${Math.round((LINE_LIFETIME_MS / (LINE_LIFETIME_MS + LINE_FADE_MS)) * 100)}% { opacity: 1 } 100% { opacity: 0 } }`}</style>

      {/* 내 커서 스택 */}
      <div ref={ownRef} style={{ position: 'absolute', top: 0, left: 0, willChange: 'transform' }}>
        {ownStack?.lines.map((l) => (
          <Line key={l.id} color={user.color} text={l.text} />
        ))}
      </div>

      {/* 원격 커서 스택 */}
      {remoteIds.map((id) => (
        <div
          key={id}
          ref={(el) => {
            remoteRefs.current[id] = el
          }}
          style={{ position: 'absolute', top: 0, left: 0, willChange: 'transform' }}
        >
          {stacks[id].lines.map((l) => (
            <Line key={l.id} color={stacks[id].color} text={l.text} />
          ))}
        </div>
      ))}
    </div>
  )
}

function Line({ color, text }: { color: string; text: string }) {
  return (
    <div
      style={{
        animation: `cf-chatline ${LINE_LIFETIME_MS + LINE_FADE_MS}ms forwards`,
        background: color, color: '#fff', borderRadius: 999,
        padding: '3px 10px', marginTop: 3, width: 'fit-content', maxWidth: 280,
        font: '12px/1.4 system-ui, sans-serif', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      }}
    >
      {text}
    </div>
  )
}
