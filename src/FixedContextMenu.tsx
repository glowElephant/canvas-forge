import { useEffect, useRef, useState } from 'react'
import { DefaultContextMenu, useEditor, useValue, type TLUiContextMenuProps } from 'tldraw'

// tldraw 3.15 컨텍스트 메뉴 버그 우회:
// 메뉴를 "바깥 클릭"으로 닫으면 tldraw가 콘텐츠를 먼저 언마운트해 Radix 내부 open 상태가
// true로 남는다(탈동기화) → 이후 우클릭이 no-op이 되어 메뉴가 다시 안 열린다.
// (Escape로 닫으면 Radix가 스스로 닫아서 정상.)
// 해결: 메뉴가 닫히는 transition마다 DefaultContextMenu를 리마운트(key 증가) →
// Radix 내부 상태가 함께 리셋되어 다음 우클릭이 항상 동작한다.
export function FixedContextMenu(props: TLUiContextMenuProps) {
  const editor = useEditor()
  const isOpen = useValue(
    'context-menu-open',
    () => editor.menus.isMenuOpen(`context menu-${editor.contextId}`),
    [editor],
  )
  const [resetKey, setResetKey] = useState(0)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (wasOpen.current && !isOpen) setResetKey((k) => k + 1)
    wasOpen.current = isOpen
  }, [isOpen])

  return <DefaultContextMenu key={resetKey} {...props} />
}
