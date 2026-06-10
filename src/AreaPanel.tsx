import { useEffect, useState } from 'react'
import { createShapeId, toRichText, useEditor, useValue, type TLShapeId } from 'tldraw'

// 영역(프레임) 내비게이션 패널 (MVP3b):
//  - 프레임 목록 클릭 → 해당 영역으로 카메라 이동
//  - 📍 버튼 → 뷰포트 중앙에 위치 핀(note + meta.cfGoto) 생성. 핀 클릭(드래그 아님) 시 대상 영역으로 점프.
// <Tldraw> 자식으로 렌더 (editor 컨텍스트 필요).

export function AreaPanel() {
  const editor = useEditor()
  const [open, setOpen] = useState(true)

  const frames = useValue(
    'frames',
    () =>
      editor
        .getCurrentPageShapes()
        .filter((s) => s.type === 'frame')
        .map((s) => ({ id: s.id, name: ((s.props as { name?: string }).name || '(제목 없음)') as string })),
    [editor],
  )

  // 핀 클릭 → 대상 영역으로 점프
  useEffect(() => {
    const onEvent = (info: { name: string }) => {
      if (info.name !== 'pointer_up' || editor.inputs.isDragging) return
      const shape = editor.getShapeAtPoint(editor.inputs.currentPagePoint, { hitInside: true })
      const targetId = (shape?.meta?.cfGoto as { targetId?: string } | undefined)?.targetId
      if (!targetId) return
      const bounds = editor.getShapePageBounds(targetId as TLShapeId)
      if (bounds) editor.zoomToBounds(bounds, { inset: 64, animation: { duration: 320 } })
    }
    editor.on('event', onEvent)
    return () => {
      editor.off('event', onEvent)
    }
  }, [editor])

  const goTo = (id: string) => {
    const bounds = editor.getShapePageBounds(id as TLShapeId)
    if (bounds) editor.zoomToBounds(bounds, { inset: 64, animation: { duration: 320 } })
  }

  const dropPin = (id: string, name: string) => {
    const center = editor.getViewportPageBounds().center
    editor.createShape({
      id: createShapeId(),
      type: 'note',
      x: center.x,
      y: center.y,
      meta: { cfGoto: { targetId: id } },
      props: { richText: toRichText(`📍 ${name}`), color: 'violet' },
    })
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 64,
        right: 8,
        zIndex: 1000,
        width: 180,
        borderRadius: 8,
        background: 'rgba(255,255,255,0.95)',
        boxShadow: '0 1px 6px rgba(0,0,0,0.15)',
        font: '12px/1.5 system-ui, sans-serif',
        color: '#111',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{ width: '100%', padding: '6px 10px', border: 'none', background: '#f1f3f5', cursor: 'pointer', textAlign: 'left', font: 'inherit', fontWeight: 600 }}
      >
        영역 {frames.length}개 {open ? '▾' : '▸'}
      </button>
      {open && (
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {frames.length === 0 && <div style={{ padding: '8px 10px', color: '#868e96' }}>프레임을 그려 영역을 만드세요</div>}
          {frames.map((f) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', borderTop: '1px solid #f1f3f5' }}>
              <button
                onClick={() => goTo(f.id)}
                title="이 영역으로 이동"
                style={{ flex: 1, padding: '6px 10px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {f.name}
              </button>
              <button
                onClick={() => dropPin(f.id, f.name)}
                title="현 위치에 이 영역으로 가는 핀 만들기"
                style={{ padding: '6px 8px', border: 'none', background: 'none', cursor: 'pointer', font: 'inherit' }}
              >
                📍
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
