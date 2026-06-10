import { createShapeId, toRichText } from '@tldraw/tlschema'
import { getIndexAbove, type IndexKey } from '@tldraw/utils'
import type { BoardRoom } from './sync-room.ts'

// post_card 서버측 구현: room store에 note shape를 직접 put.
// 브라우저 연결이 없어도 동작하고, 연결된 모든 클라이언트에 sync로 자동 전파된다.

interface AnyRecord {
  id: string
  typeName: string
  type?: string
  parentId?: string
  index?: IndexKey
  x?: number
  y?: number
  props?: Record<string, unknown>
}

/** 영역(frame) 오른쪽에 note 카드를 추가. frame이 없으면 페이지 원점 근처. */
export async function postCardToRoom(room: BoardRoom, areaId: string, markdown: string): Promise<void> {
  await room.updateStore((store) => {
    const all = store.getAll() as AnyRecord[]
    const frame = all.find((r) => r.typeName === 'shape' && r.type === 'frame' && r.id === areaId)

    const pageId = frame?.parentId ?? all.find((r) => r.typeName === 'page')?.id
    if (!pageId) throw new Error('보드에 페이지가 없습니다')

    // 페이지 직속 shape 중 최상위 index 위에 얹는다
    const siblings = all.filter((r) => r.typeName === 'shape' && r.parentId === pageId)
    const topIndex = siblings.map((s) => s.index).filter(Boolean).sort().at(-1) as IndexKey | undefined

    let x = 100
    let y = 100
    if (frame) {
      const w = (frame.props?.w as number) ?? 0
      x = (frame.x ?? 0) + w + 40
      y = frame.y ?? 0
    }

    store.put({
      id: createShapeId(),
      typeName: 'shape',
      type: 'note',
      parentId: pageId,
      index: getIndexAbove(topIndex),
      x,
      y,
      rotation: 0,
      isLocked: false,
      opacity: 1,
      meta: {},
      props: {
        color: 'yellow',
        labelColor: 'black',
        size: 'm',
        font: 'draw',
        fontSizeAdjustment: 0,
        align: 'middle',
        verticalAlign: 'middle',
        growY: 0,
        url: '',
        richText: toRichText(markdown),
        scale: 1,
      },
    } as never)
  })
}
