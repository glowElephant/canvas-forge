// 한글 등 IME 입력 중의 Enter는 "조합 확정"이지 전송이 아니다.
// 이걸 일반 Enter로 처리하면 조합 중에 입력값이 지워지거나 전송이 꼬인다 (keyCode 229 / isComposing).
export function isImeComposingEnter(e: React.KeyboardEvent): boolean {
  return e.key === 'Enter' && (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)
}
