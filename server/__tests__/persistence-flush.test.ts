import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startHost, type RunningHost } from '../host.ts'
import { legacyBoardFixture } from './fixtures.ts'

// 회귀 방지: host 종료 시 debounce(500ms) 대기 중이던 변경(post_card로 발생)이
// flush 되어 board.json에 저장돼야 한다 (유실되면 안 됨).

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

describe('종료 시 저장 flush (sync room 경로)', () => {
  it('debounce 시간 안에 close 해도 마지막 변경이 board.json에 저장된다', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-flush-'))
    cleanups.push(async () => fs.rm(dir, { recursive: true, force: true }))
    const boardFile = path.join(dir, 'board.json')
    await fs.writeFile(boardFile, JSON.stringify(legacyBoardFixture()), 'utf8')

    const host: RunningHost = await startHost({
      port: 0,
      boardFile,
      exportsDir: path.join(dir, 'exports'),
      assetsDir: path.join(dir, 'assets'),
    })

    // MCP post_card로 서버측 변경을 일으키고, debounce(500ms)보다 빨리 종료
    const client = new Client({ name: 'flush', version: '0.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${host.port}/mcp`)))
    await client.callTool({ name: 'post_card', arguments: { area_id: 'shape:frame1', markdown: '유실되면 안 되는 카드' } })
    await client.close()

    await host.close() // flush 없으면 note가 디스크에 없음

    const saved = JSON.parse(await fs.readFile(boardFile, 'utf8')) as {
      clock: number
      documents: Array<{ state: { typeName: string; type?: string } }>
    }
    // 새 형식(RoomSnapshot)으로 저장됐고 note가 포함돼야 한다
    expect(Array.isArray(saved.documents)).toBe(true)
    const notes = saved.documents.filter((d) => d.state.typeName === 'shape' && d.state.type === 'note')
    expect(notes).toHaveLength(1)
  })
})
