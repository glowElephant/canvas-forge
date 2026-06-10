// tldraw 스냅샷(JSON) → 영역/텍스트 추출. 순수 함수 — editor/브라우저 의존 없음.
// 스냅샷 구조: TLEditorSnapshot { document: { store: Record<id, record> }, session }
//            또는 TLStoreSnapshot { store: Record<id, record> } 둘 다 허용.

interface ShapeRecord {
  id: string
  typeName?: string
  type?: string
  parentId?: string
  meta?: Record<string, unknown>
  props?: Record<string, unknown>
}

export interface AreaInfo {
  id: string
  title: string
  /** 사용자가 "Claude가 볼 영역"으로 지정(★)했는지 (frame meta.cfClaudePick) */
  picked?: boolean
}

export interface AreaShape {
  id: string
  type: string
  text: string
  /** 작성 시각 (epoch ms, 클라이언트 getInitialMetaForShape가 기록) */
  createdAt?: number
  createdBy?: string
}

export interface AreaContent {
  id: string
  title: string
  shapes: AreaShape[]
  /** 영역 내 모든 텍스트를 합친 문자열 */
  text: string
}

/** 스냅샷에서 레코드 맵을 꺼낸다 (editor/store 스냅샷 양쪽 대응) */
function getStore(snapshot: unknown): Record<string, ShapeRecord> {
  const s = snapshot as { document?: { store?: unknown }; store?: unknown } | null
  if (!s || typeof s !== 'object') return {}
  const store = (s.document?.store ?? s.store) as Record<string, ShapeRecord> | undefined
  return store ?? {}
}

function isShape(r: ShapeRecord): boolean {
  return r?.typeName === 'shape'
}

/** ProseMirror richText(JSON)에서 평문 추출 — text 노드를 모으고 블록 경계에서 줄바꿈 */
function extractRichText(richText: unknown): string {
  const out: string[] = []
  const blockTypes = new Set(['paragraph', 'heading', 'bullet_list', 'list_item', 'code_block'])
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; text?: string; content?: unknown[] }
    if (typeof n.text === 'string') out.push(n.text)
    if (Array.isArray(n.content)) {
      n.content.forEach(walk)
      if (n.type && blockTypes.has(n.type)) out.push('\n')
    }
  }
  walk(richText)
  return out.join('').replace(/\n+/g, '\n').trim()
}

/** 한 shape에서 사람이 읽을 텍스트를 뽑는다 (text/note/geo의 richText 또는 props.text) */
function shapeText(r: ShapeRecord): string {
  const props = r.props ?? {}
  if (props.richText) return extractRichText(props.richText)
  if (typeof props.text === 'string') return props.text
  if (typeof props.name === 'string') return props.name
  return ''
}

/** 프레임(영역) 목록 — typeName=shape && type=frame 만. 제목은 props.name */
export function listAreas(snapshot: unknown): AreaInfo[] {
  const store = getStore(snapshot)
  return Object.values(store)
    .filter((r) => isShape(r) && r.type === 'frame')
    .map((r) => ({
      id: r.id,
      title: (r.props?.name as string) || '(제목 없음)',
      picked: !!r.meta?.cfClaudePick,
    }))
}

function timeLabel(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 한 영역의 내용 — 프레임의 직속 자식 shape들에서 텍스트 추출, **작성 시간순 정렬** */
export function readArea(snapshot: unknown, areaId: string): AreaContent | null {
  const store = getStore(snapshot)
  const frame = store[areaId]
  if (!frame || !isShape(frame) || frame.type !== 'frame') return null

  const shapes: AreaShape[] = Object.values(store)
    .filter((r) => isShape(r) && r.parentId === areaId)
    .map((r) => ({
      id: r.id,
      type: r.type ?? 'unknown',
      text: shapeText(r),
      createdAt: typeof r.meta?.createdAt === 'number' ? (r.meta.createdAt as number) : undefined,
      createdBy: typeof r.meta?.createdBy === 'string' ? (r.meta.createdBy as string) : undefined,
    }))
    // 작성 시간순 — 논의 흐름(나중 항목이 앞 항목을 수정/반박)을 따라 읽을 수 있게.
    // createdAt 없는 레거시 shape는 맨 앞(가장 오래된 것으로 간주).
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))

  const text = shapes
    .filter((s) => s.text.length > 0)
    .map((s) => (s.createdAt ? `[${timeLabel(s.createdAt)}${s.createdBy ? ` ${s.createdBy}` : ''}] ${s.text}` : s.text))
    .join('\n\n')

  return {
    id: areaId,
    title: (frame.props?.name as string) || '(제목 없음)',
    shapes,
    text,
  }
}
