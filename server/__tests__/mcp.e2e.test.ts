import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import WebSocket from 'ws'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startHost, type RunningHost } from '../host.ts'
import type { ClientMsg, ServerMsg } from '../../shared/protocol.ts'
import { legacyBoardFixture } from './fixtures.ts'

// MCP 전체 루프 e2e (MVP2):
// 보드는 board.json(레거시 형식 마이그레이션 포함)으로 시드 → room이 진실의 출처.
// mock 브라우저는 /ws에 붙어 export 요청에만 PNG로 응답한다 (동기화는 /sync 몫 — 여기선 불필요).

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

let host: RunningHost
let browser: WebSocket
let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-e2e-'))
  const boardFile = path.join(tmpDir, 'board.json')
  await fs.writeFile(boardFile, JSON.stringify(legacyBoardFixture()), 'utf8')

  host = await startHost({
    port: 0,
    boardFile,
    exportsDir: path.join(tmpDir, 'exports'),
    assetsDir: path.join(tmpDir, 'assets'),
  })

  // mock 브라우저: /ws 접속 → requestExport에 PNG 응답
  browser = new WebSocket(`ws://localhost:${host.port}/ws`)
  await new Promise<void>((resolve, reject) => {
    browser.on('open', resolve)
    browser.on('error', reject)
  })
  browser.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as ServerMsg
    if (msg.t === 'requestExport') {
      const reply: ClientMsg = { t: 'exportResult', reqId: msg.reqId, pngBase64: TINY_PNG_B64 }
      browser.send(JSON.stringify(reply))
    }
  })
})

afterAll(async () => {
  browser?.close()
  await host?.close()
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
})

async function mcpClient(): Promise<Client> {
  const client = new Client({ name: 'e2e', version: '0.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${host.port}/mcp`)))
  return client
}

describe('MCP e2e (room 기반)', () => {
  it('tools/list에 3도구가 노출된다', async () => {
    const client = await mcpClient()
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['list_areas', 'post_card', 'read_area'])
    await client.close()
  })

  it('list_areas가 시드된 프레임 영역을 반환한다 (레거시 마이그레이션 경유)', async () => {
    const client = await mcpClient()
    const res = await client.callTool({ name: 'list_areas', arguments: {} })
    const text = (res.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text').map((c) => c.text).join('\n')
    expect(text).toContain('shape:frame1')
    expect(text).toContain('로그인 화면')
    await client.close()
  })

  it('read_area가 텍스트 + 이미지(PNG)를 멀티모달로 반환한다', async () => {
    const client = await mcpClient()
    const res = await client.callTool({ name: 'read_area', arguments: { area_id: 'shape:frame1' } })
    const content = res.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>
    const text = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
    const image = content.find((c) => c.type === 'image')
    expect(text).toContain('이메일과 비밀번호')
    expect(image).toBeDefined()
    expect(image!.mimeType).toBe('image/png')
    expect(image!.data).toBe(TINY_PNG_B64)
    await client.close()
  })

  it('post_card가 서버측 쓰기로 성공한다 (sync로 전 클라이언트 전파)', async () => {
    const client = await mcpClient()
    const res = await client.callTool({
      name: 'post_card',
      arguments: { area_id: 'shape:frame1', markdown: '# 정리\n- 이메일 로그인' },
    })
    expect(res.isError).toBeFalsy()
    await client.close()
  })
})
