import { useCallback, useRef, useState } from 'react'

// 패널 드래그 이동 훅: 헤더에 onPointerDown을 달면 패널 전체가 움직인다.
export function useDrag(initial: { x: number; y: number }) {
  const [pos, setPos] = useState(initial)
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      start.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y }
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
      const move = (ev: PointerEvent) => {
        if (!start.current) return
        setPos({ x: start.current.x + ev.clientX - start.current.px, y: start.current.y + ev.clientY - start.current.py })
      }
      const up = () => {
        start.current = null
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
    },
    [pos],
  )

  return { pos, onPointerDown }
}
