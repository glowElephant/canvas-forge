// 한글 등 IME 입력 중의 Enter는 "조합 확정"이지 전송이 아니다 → isComposing이면 무시.
// 주의: keyCode 229까지 차단하면 안 됨 — Windows 한글 IME는 조합을 끝내는 "진짜 Enter"도
// keyCode 229(isComposing=false)로 보내는 경우가 있어, 그걸 막으면 순수 한글 입력은 전송 불가가 된다.
export function isImeComposingEnter(e: React.KeyboardEvent): boolean {
  return e.key === 'Enter' && e.nativeEvent.isComposing
}
