import { useState } from 'react'
import { useEditor, useValue, type TLShape } from 'tldraw'
import type { VideoComment } from '../server/modalities'

// 영상 댓글 패널 (MVP3c): 영상 shape를 선택하면 표시.
// 댓글은 shape.meta.cfComments에 저장 → sync로 전 참여자 실시간 공유.
// "⏱ 현재 시간" 체크 시 보드에서 재생 중인 시점을 시간 태그로 — Claude가 그 시점 프레임을 분석한다.

function fmt(t: number): string {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
}

/** 보드에 렌더된 해당 shape의 <video> DOM (재생 시점 읽기/seek용) */
function findVideoEl(shapeId: string): HTMLVideoElement | null {
  return document.querySelector(`[data-shape-id="${shapeId}"] video`)
}

export function VideoCommentPanel() {
  const editor = useEditor()
  const selected = useValue(
    'selected-video',
    () => {
      const s = editor.getOnlySelectedShape()
      return s?.type === 'video' ? s : null
    },
    [editor],
  )
  if (!selected) return null
  return <Panel key={selected.id} shape={selected} />
}

function Panel({ shape }: { shape: TLShape }) {
  const editor = useEditor()
  const [text, setText] = useState('')
  const [tagTime, setTagTime] = useState(true)

  const comments = useValue(
    'cf-comments',
    () => ((editor.getShape(shape.id)?.meta?.cfComments as VideoComment[] | undefined) ?? []),
    [editor, shape.id],
  )

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    const author = (() => {
      try {
        return (JSON.parse(localStorage.getItem('cf-user') ?? '{}') as { name?: string }).name ?? '익명'
      } catch {
        return '익명'
      }
    })()
    const videoEl = findVideoEl(shape.id)
    const comment: VideoComment = { author, text: trimmed }
    if (tagTime && videoEl) comment.t = Math.round(videoEl.currentTime * 10) / 10
    const cur = editor.getShape(shape.id)
    if (!cur) return
    // meta는 JsonValue 요구 — VideoComment는 평면 객체라 안전한 캐스트
    editor.updateShape({
      id: cur.id,
      type: cur.type,
      meta: { ...cur.meta, cfComments: [...comments, comment] as unknown as import('tldraw').JsonArray },
    })
    setText('')
  }

  const seekTo = (t: number) => {
    const videoEl = findVideoEl(shape.id)
    if (videoEl) videoEl.currentTime = t
  }

  return (
    <div
      style={{
        position: 'absolute', top: 64, left: 8, zIndex: 1000, width: 230,
        borderRadius: 8, background: 'rgba(255,255,255,0.96)',
        boxShadow: '0 1px 6px rgba(0,0,0,0.18)', font: '12px/1.5 system-ui, sans-serif', color: '#111',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
    >
      <div style={{ padding: '6px 10px', background: '#f1f3f5', fontWeight: 600 }}>
        🎬 영상 댓글 {comments.length ? `(${comments.length})` : ''}
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {comments.length === 0 && (
          <div style={{ padding: '8px 10px', color: '#868e96' }}>
            시간 태그 댓글을 달면 Claude가 그 시점 장면을 분석합니다
          </div>
        )}
        {comments.map((c, i) => (
          <div key={i} style={{ padding: '6px 10px', borderTop: '1px solid #f1f3f5' }}>
            <span style={{ fontWeight: 600 }}>{c.author ?? '익명'}</span>{' '}
            {typeof c.t === 'number' && (
              <button
                onClick={() => seekTo(c.t!)}
                title="이 시점으로 이동"
                style={{ border: 'none', background: '#e7f5ff', color: '#1971c2', borderRadius: 4, cursor: 'pointer', font: 'inherit', padding: '0 4px' }}
              >
                {fmt(c.t)}
              </button>
            )}
            <div>{c.text}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderTop: '1px solid #e9ecef' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="댓글 입력…"
          style={{ padding: '6px 8px', border: '1px solid #ced4da', borderRadius: 6, font: 'inherit' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#495057', cursor: 'pointer' }}>
          <input type="checkbox" checked={tagTime} onChange={(e) => setTagTime(e.target.checked)} />
          ⏱ 현재 재생 시점 태그
        </label>
        <button
          onClick={submit}
          disabled={!text.trim()}
          style={{ padding: '6px 8px', border: 'none', borderRadius: 6, background: '#1971c2', color: '#fff', cursor: 'pointer', font: 'inherit' }}
        >
          댓글 달기
        </button>
      </div>
    </div>
  )
}
