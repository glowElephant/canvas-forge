import { TLSocketRoom, type RoomSnapshot } from '@tldraw/sync-core'
import { createTLSchema, defaultShapeSchemas, defaultBindingSchemas } from '@tldraw/tlschema'
import { loadBoard, saveBoard } from './board.ts'

// 서버 권위 동기화 룸. board.json 영속(debounce+flush)과 마이그레이션 로드를 담당.
// board.json 형식 2종 겸용:
//  - 신규: RoomSnapshot { clock, documents: [...] }  (MVP2가 저장하는 형식)
//  - 레거시: TLEditorSnapshot { document: { store }, session }  (MVP1 형식 → document를 initialSnapshot으로)

export interface SyncRoomHandle {
  room: TLSocketRoom
  /** 대기 중인 저장을 즉시 디스크에 반영 (종료 전 호출 — 유실 방지) */
  flushSave(): Promise<void>
  /** flush 후 룸 종료 */
  close(): Promise<void>
}

/** RoomSnapshot → areas.ts가 받는 입력({ store: Record<id, rec> })으로 변환 */
export function roomToAreasInput(snap: RoomSnapshot): { store: Record<string, unknown> } {
  return {
    store: Object.fromEntries(snap.documents.map((d) => [(d.state as { id: string }).id, d.state])),
  }
}

function toInitialSnapshot(saved: unknown): RoomSnapshot | { store: never } | undefined {
  if (!saved || typeof saved !== 'object') return undefined
  const s = saved as Record<string, unknown>
  if ('clock' in s && Array.isArray(s.documents)) return s as unknown as RoomSnapshot
  if ('document' in s && s.document && typeof s.document === 'object') {
    // 레거시 TLEditorSnapshot — TLStoreSnapshot(document)을 그대로 넘기면 room이 받아준다
    return s.document as never
  }
  return undefined
}

export async function createSyncRoom(opts: { boardFile: string }): Promise<SyncRoomHandle> {
  const saved = await loadBoard(opts.boardFile)
  const initialSnapshot = toInitialSnapshot(saved)

  let saveTimer: NodeJS.Timeout | null = null
  let dirty = false

  const room: TLSocketRoom = new TLSocketRoom({
    schema: createTLSchema({ shapes: defaultShapeSchemas, bindings: defaultBindingSchemas }),
    ...(initialSnapshot ? { initialSnapshot: initialSnapshot as RoomSnapshot } : {}),
    onDataChange() {
      dirty = true
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => void flushSave(), 500)
    },
  })

  async function flushSave(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!dirty) return
    dirty = false
    try {
      await saveBoard(opts.boardFile, room.getCurrentSnapshot())
    } catch (e) {
      console.error('board 저장 실패:', e)
    }
  }

  return {
    room,
    flushSave,
    close: async () => {
      await flushSave()
      room.close()
    },
  }
}
