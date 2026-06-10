// 진단용 순정 tldraw 페이지 — 우리 코드(useSync/패널/핸들러) 없이 컨텍스트 메뉴 버그 재현 비교용.
import { createRoot } from 'react-dom/client'
import { Tldraw, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'

function Stock() {
  return (
    <Tldraw
      onMount={(editor: Editor) => {
        ;(window as unknown as { editor: Editor }).editor = editor
      }}
    />
  )
}

createRoot(document.getElementById('root')!).render(<Stock />)
