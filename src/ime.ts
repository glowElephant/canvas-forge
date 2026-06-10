import { useRef } from 'react'

// 한글 IME Enter 처리 — 플랫폼 변형이 많아 keydown 단독으로는 신뢰 불가:
//  - 조합 중 Enter: isComposing=true (무시해야 입력이 안 꼬임)
//  - Windows Chrome: 조합을 끝내는 Enter가 key='Process'/keyCode 229로 오고,
//    "진짜 Enter keydown"이 아예 안 오는 경우가 있다 → keydown만 보면 전송 불가.
// 해결: keydown(일반 경로) + keyup 폴백(값이 남아 있으면 전송). 일반 Enter는 keydown에서
// 전송 후 입력을 비우므로 keyup에서 중복 전송되지 않는다.

export interface ImeSafeEnterHandlers {
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onKeyUp: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onCompositionStart: () => void
  onCompositionEnd: () => void
}

/**
 * Enter 전송을 IME-안전하게 처리하는 핸들러 묶음.
 * @param submit 입력값을 받아 전송. true를 반환하면 입력을 비운다.
 * @param extraKeyDown Enter 외 키 처리(Escape 등) — keydown에서만 호출됨
 */
export function useImeSafeEnter(
  submit: (value: string) => boolean | void,
  extraKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void,
): ImeSafeEnterHandlers {
  const composing = useRef(false)

  const trySubmit = (input: HTMLInputElement) => {
    const value = input.value
    if (!value.trim()) return
    if (submit(value) !== false) input.value = ''
  }

  return {
    onCompositionStart: () => {
      composing.current = true
    },
    onCompositionEnd: () => {
      composing.current = false
    },
    onKeyDown: (e) => {
      if (e.key === 'Enter' && !e.nativeEvent.isComposing && !composing.current) {
        trySubmit(e.currentTarget)
      } else if (e.key !== 'Enter') {
        extraKeyDown?.(e)
      }
      e.stopPropagation()
    },
    onKeyUp: (e) => {
      // Windows IME가 keydown Enter를 삼킨 경우 — keyup 시점엔 조합이 끝나 있고 값이 남아 있다
      if (e.key === 'Enter' && !e.nativeEvent.isComposing && !composing.current) {
        trySubmit(e.currentTarget)
      }
      e.stopPropagation()
    },
  }
}

/** (구버전 호환) 조합 중 Enter 여부 — 새 코드는 useImeSafeEnter를 쓸 것 */
export function isImeComposingEnter(e: React.KeyboardEvent): boolean {
  return e.key === 'Enter' && e.nativeEvent.isComposing
}
