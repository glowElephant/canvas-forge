import { useCallback } from 'react'
import { Tldraw, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { connectBoard } from './ws-client'

// 보드앱: tldraw 무한 캔버스 + 서버 WS 연동. Claude 없이도 화이트보드로 완전히 동작한다.
export default function App() {
  const handleMount = useCallback((editor: Editor) => {
    // 디버그/검증용으로 editor를 전역 노출 (tldraw 앱 관행)
    ;(window as unknown as { editor: Editor }).editor = editor
    // onMount가 반환한 함수는 tldraw가 unmount 시 호출 (정리)
    return connectBoard(editor)
  }, [])

  return <Tldraw onMount={handleMount} />
}
