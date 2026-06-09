import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startHost, type RunningHost } from '../host.ts'
import type { ClientMsg } from '../../shared/protocol.ts'

// 결함 A 회귀 방지: host 종료 시 debounce(500ms) 대기 중이던 마지막 편집이
// flush 되어 board.json에 저장돼야 한다 (유실되면 안 됨).

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

describe('종료 시 저장 flush', () => {
  it('debounce 시간 안에 close 해도 마지막 스냅샷이 저장된다', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-flush-'))
    const boardFile = path.join(dir, 'board.json')
    const host: RunningHost = await startHost({
      port: 0,
      boardFile,
      exportsDir: path.join(dir, 'exports'),
    })
    cleanups.push(async () => {
      await fs.rm(dir, { recursive: true, force: true })
    })

    const ws = new WebSocket(`ws://localhost:${host.port}/ws`)
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('error', reject)
    })

    const snap: ClientMsg = {
      t: 'snapshot',
      snapshot: { document: { store: { 'shape:keep': { id: 'shape:keep', x: 42 } } }, session: {} },
    }
    ws.send(JSON.stringify(snap))

    // debounce(500ms)보다 짧게 대기한 뒤 바로 종료 — flush 없으면 파일이 안 생김
    await new Promise((r) => setTimeout(r, 80))
    ws.close()
    await host.close()

    const raw = await fs.readFile(boardFile, 'utf8')
    const saved = JSON.parse(raw)
    expect(saved.document.store['shape:keep'].x).toBe(42)
  })
})
