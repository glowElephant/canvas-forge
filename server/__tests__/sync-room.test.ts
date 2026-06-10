import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createTLSchema, defaultShapeSchemas, defaultBindingSchemas } from '@tldraw/tlschema'
import { createSyncRoom, roomToAreasInput, type SyncRoomHandle } from '../sync-room.ts'
import { postCardToRoom } from '../cards.ts'
import { listAreas, readArea } from '../areas.ts'

// MVP2 서버 코어: 레거시 board.json 마이그레이션 / room 영속 / post_card 서버측 쓰기

function richText(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

// MVP1이 저장하던 레거시 TLEditorSnapshot (실제 tldraw가 만든 것과 동일 골격)
const legacyBoard = {
  document: {
    store: {
      'document:document': { gridSize: 10, name: '', meta: {}, id: 'document:document', typeName: 'document' },
      'page:p1': { meta: {}, id: 'page:p1', name: 'Page 1', index: 'a1', typeName: 'page' },
      'shape:frame1': {
        x: 100, y: 100, rotation: 0, isLocked: false, opacity: 1, meta: {},
        id: 'shape:frame1', type: 'frame', parentId: 'page:p1', index: 'a1',
        props: { w: 300, h: 200, name: '레거시 영역', color: 'black' },
        typeName: 'shape',
      },
      'shape:t1': {
        x: 120, y: 140, rotation: 0, isLocked: false, opacity: 1, meta: {},
        id: 'shape:t1', type: 'text', parentId: 'shape:frame1', index: 'a1',
        props: {
          color: 'black', size: 'm', w: 100, font: 'draw', textAlign: 'start',
          autoSize: true, scale: 1, richText: richText('레거시 텍스트'),
        },
        typeName: 'shape',
      },
    },
    // 실제 MVP1 board.json처럼 현재 버전의 정상 serialized schema를 포함해야 마이그레이션이 통과한다
    schema: createTLSchema({ shapes: defaultShapeSchemas, bindings: defaultBindingSchemas }).serialize(),
  },
  session: {},
}

const cleanups: Array<() => Promise<void>> = []
let handle: SyncRoomHandle | null = null
afterEach(async () => {
  await handle?.close()
  handle = null
  for (const c of cleanups.splice(0)) await c()
})

async function tmpBoardFile(content?: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-sync-'))
  cleanups.push(async () => fs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'board.json')
  if (content !== undefined) await fs.writeFile(file, JSON.stringify(content), 'utf8')
  return file
}

describe('sync-room', () => {
  it('레거시 TLEditorSnapshot board.json을 room으로 로드한다 (마이그레이션)', async () => {
    const boardFile = await tmpBoardFile(legacyBoard)
    handle = await createSyncRoom({ boardFile })
    const input = roomToAreasInput(handle.room.getCurrentSnapshot())
    expect(listAreas(input)).toEqual([{ id: 'shape:frame1', title: '레거시 영역', picked: false }])
    expect(readArea(input, 'shape:frame1')!.text).toContain('레거시 텍스트')
  })

  it('post_card가 브라우저 없이 note를 만들고, 영속 후 재로드(RoomSnapshot)에도 남는다', async () => {
    const boardFile = await tmpBoardFile(legacyBoard)
    handle = await createSyncRoom({ boardFile })

    await postCardToRoom(handle.room, 'shape:frame1', '# 정리\n서버측 카드')

    // room 안에 note 생성 확인 (스키마 검증 통과 여부도 여기서 드러남)
    const input = roomToAreasInput(handle.room.getCurrentSnapshot())
    const notes = Object.values(input.store).filter(
      (r) => (r as { type?: string }).type === 'note',
    )
    expect(notes).toHaveLength(1)

    // flush → 새 room으로 재로드 (이번엔 RoomSnapshot 형식) → note 유지
    await handle.close()
    handle = null
    const reloaded = await createSyncRoom({ boardFile })
    handle = reloaded
    const input2 = roomToAreasInput(reloaded.room.getCurrentSnapshot())
    const notes2 = Object.values(input2.store).filter(
      (r) => (r as { type?: string }).type === 'note',
    )
    expect(notes2).toHaveLength(1)
    expect(listAreas(input2)).toEqual([{ id: 'shape:frame1', title: '레거시 영역', picked: false }])
  })

  it('board.json이 없으면 빈 room으로 시작한다', async () => {
    const boardFile = await tmpBoardFile()
    handle = await createSyncRoom({ boardFile })
    expect(listAreas(roomToAreasInput(handle.room.getCurrentSnapshot()))).toEqual([])
  })
})
