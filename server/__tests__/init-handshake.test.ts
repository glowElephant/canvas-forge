import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startHost, type RunningHost } from '../host.ts'
import type { ServerMsg } from '../../shared/protocol.ts'

// 결함 회귀 방지: 저장된 보드가 있을 때 새 연결이 들어와도
// (1) 서버가 init으로 저장 상태를 먼저 내려주고
// (2) 빈 상태로 덮어쓰여 유실되지 않는다.

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

describe('init 핸드셰이크 (새 탭 클로버 방지)', () => {
  it('서버는 연결 직후 저장된 보드를 init으로 보낸다', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-init-'))
    const boardFile = path.join(dir, 'board.json')
    const saved = { document: { store: { 'shape:keep': { id: 'shape:keep', typeName: 'shape', type: 'frame', props: { name: '기존' } } } }, session: {} }
    await fs.writeFile(boardFile, JSON.stringify(saved), 'utf8')

    const host: RunningHost = await startHost({ port: 0, boardFile, exportsDir: path.join(dir, 'exports') })
    cleanups.push(async () => {
      await host.close()
      await fs.rm(dir, { recursive: true, force: true })
    })

    const ws = new WebSocket(`ws://localhost:${host.port}/ws`)
    const firstMsg = await new Promise<ServerMsg>((resolve, reject) => {
      ws.on('open', () => {})
      ws.on('message', (d) => resolve(JSON.parse(d.toString()) as ServerMsg))
      ws.on('error', reject)
    })

    expect(firstMsg.t).toBe('init')
    expect(firstMsg).toMatchObject({ t: 'init' })
    const snap = (firstMsg as { snapshot: typeof saved }).snapshot
    expect(snap.document.store['shape:keep'].props.name).toBe('기존')
    ws.close()
  })

  it('init을 받은(=빈 push 안 하는) 클라이언트가 붙었다 떠나도 저장 보드가 보존된다', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-init2-'))
    const boardFile = path.join(dir, 'board.json')
    const saved = { document: { store: { 'shape:keep': { id: 'shape:keep', x: 7 } } }, session: {} }
    await fs.writeFile(boardFile, JSON.stringify(saved), 'utf8')

    const host: RunningHost = await startHost({ port: 0, boardFile, exportsDir: path.join(dir, 'exports') })
    cleanups.push(async () => {
      await fs.rm(dir, { recursive: true, force: true })
    })

    // 새 탭이 붙어 init만 받고(아무것도 push 안 함) 떠난다 — 클로버 없어야 함
    const ws = new WebSocket(`ws://localhost:${host.port}/ws`)
    await new Promise<void>((resolve, reject) => {
      ws.on('message', () => resolve()) // init 수신
      ws.on('error', reject)
    })
    ws.close()
    await new Promise((r) => setTimeout(r, 50))
    await host.close()

    const raw = JSON.parse(await fs.readFile(boardFile, 'utf8'))
    expect(raw.document.store['shape:keep'].x).toBe(7)
  })
})
