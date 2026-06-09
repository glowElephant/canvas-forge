import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { saveBoard, loadBoard } from '../board.ts'

const tmpDirs: string[] = []
async function tmpFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-board-'))
  tmpDirs.push(dir)
  return path.join(dir, 'board.json')
}

afterEach(async () => {
  for (const d of tmpDirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true })
  }
})

describe('board 영속', () => {
  it('save 후 load 하면 동일 스냅샷을 반환한다 (라운드트립)', async () => {
    const file = await tmpFile()
    const snapshot = { document: { store: { 'shape:a': { id: 'shape:a', x: 1 } } }, session: { v: 2 } }
    await saveBoard(file, snapshot)
    const loaded = await loadBoard(file)
    expect(loaded).toEqual(snapshot)
  })

  it('파일이 없으면 null을 반환한다', async () => {
    const file = await tmpFile() // 아직 안 만듦
    expect(await loadBoard(file)).toBeNull()
  })

  it('save는 없는 디렉토리를 자동 생성한다', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-board-'))
    tmpDirs.push(dir)
    const file = path.join(dir, 'nested', 'deep', 'board.json')
    await saveBoard(file, { ok: true })
    expect(await loadBoard(file)).toEqual({ ok: true })
  })
})
