// crypto.randomUUID는 보안 컨텍스트(https/localhost) 전용 —
// 초대 링크(http://192.168.x.x)에서는 undefined라 호출 즉시 throw된다 (실제 겪은 버그:
// IP로 연 창에서 입장·채팅 전송이 전부 조용히 죽음). 반드시 이 폴백을 쓸 것.
export function uid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
  )
}
