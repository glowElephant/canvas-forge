import { useEffect, useRef, useState } from 'react'
import { useEditor } from 'tldraw'
import { isImeComposingEnter } from './ime'
import type { BridgeHandle } from './ws-client'

// 커서 채팅 (요청 스펙):
//  - '/' 로 입력창이 커서 옆에 열림 → 엔터마다 한 줄이 로그처럼 커서 아래로 쌓임(연타하면 빠르게 늘어남)
//  - 각 줄은 일정 시간 후 페이드아웃되며 한 줄씩(시간순) 사라지고, 다 사라지면 원래대로
//  - 다른 참여자의 줄도 그 사람 커서 아래에 같은 방식으로 표시 (브리지 릴레이)

// 수명이 짧으면 다음 문장을 치는 동안 앞 줄이 사라져 "한 줄만 보이는" 체감이 됨 → 8초
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
  const [inputOpen, setInputOpen] = useState(false)
  const [stacks, setStacks] = useState<Record<string, UserStack>>({})
  const inputRef = useRef<HTMLInputElement>(null)
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

  // 원격 수신
  useEffect(() => {
    bridge.onCursorChat((m) => pushLine(m.userId, m.name, m.color, m.text))
    // eslint 류 의존성: bridge는 세션 동안 동일 인스턴스
  }, [bridge])

  // '/' 로 입력창 열기 (텍스트 편집 중이 아닐 때)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || inputOpen) return
      const tag = (document.activeElement?.tagName ?? '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || editor.getEditingShapeId()) return
      e.preventDefault()
      setInputOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor, inputOpen])

  useEffect(() => {
    if (inputOpen) inputRef.current?.focus()
  }, [inputOpen])

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

  const commit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    // 로컬 에코(onCursorChat)로 내 말풍선도 갱신되므로 여기서 직접 push하지 않는다
    bridge.sendCursorChat({ userId: user.id, name: user.name, color: user.color, text: trimmed })
  }

  const ownStack = stacks[user.id]
  const remoteIds = Object.keys(stacks).filter((id) => id !== user.id && stacks[id].lines.length > 0)

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2000, overflow: 'hidden' }}>
      <style>{`@keyframes cf-chatline { 0% { opacity: 1 } ${Math.round((LINE_LIFETIME_MS / (LINE_LIFETIME_MS + LINE_FADE_MS)) * 100)}% { opacity: 1 } 100% { opacity: 0 } }`}</style>

      {/* 내 커서 스택 (+입력창) */}
      <div ref={ownRef} style={{ position: 'absolute', top: 0, left: 0, willChange: 'transform' }}>
        {ownStack?.lines.map((l) => (
          <Line key={l.id} color={user.color} text={l.text} />
        ))}
        {inputOpen && (
          <input
            ref={inputRef}
            placeholder="채팅… (Enter 전송, Esc 닫기)"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isImeComposingEnter(e)) {
                commit((e.target as HTMLInputElement).value)
                ;(e.target as HTMLInputElement).value = ''
              } else if (e.key === 'Escape') {
                setInputOpen(false)
              }
              e.stopPropagation()
            }}
            onBlur={() => setInputOpen(false)}
            style={{
              pointerEvents: 'auto', marginTop: 2, padding: '3px 8px', width: 180,
              border: `2px solid ${user.color}`, borderRadius: 999, outline: 'none',
              font: '12px system-ui, sans-serif', background: 'rgba(255,255,255,0.95)',
            }}
          />
        )}
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
