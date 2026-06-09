import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import WebSocket from 'ws'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startHost, type RunningHost } from '../host.ts'
import type { ClientMsg, ServerMsg } from '../../shared/protocol.ts'

// 1x1 투명 PNG (mock 브라우저가 export 응답으로 돌려줄 가짜 이미지)
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function richText(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

const snapshot = {
  document: {
    store: {
      'page:p1': { id: 'page:p1', typeName: 'page', name: 'Page 1' },
      'shape:frame1': {
        id: 'shape:frame1', typeName: 'shape', type: 'frame', parentId: 'page:p1',
        props: { name: '로그인 화면', w: 400, h: 300 },
      },
      'shape:t1': {
        id: 'shape:t1', typeName: 'shape', type: 'text', parentId: 'shape:frame1',
        props: { richText: richText('이메일과 비밀번호') },
      },
    },
  },
  session: {},
}

let host: RunningHost
let browser: WebSocket
let tmpDir: string
const postedCards: Array<{ areaId: string; markdown: string }> = []

beforeAll(async () => {
  // 실제 .board를 오염시키지 않도록 temp 디렉토리로 격리
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-e2e-'))
  host = await startHost({
    port: 0,
    boardFile: path.join(tmpDir, 'board.json'),
    exportsDir: path.join(tmpDir, 'exports'),
  })

  // mock 브라우저: WS 접속 → 스냅샷 전송 → requestExport에 PNG 응답, postCard 기록
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
    } else if (msg.t === 'postCard') {
      postedCards.push({ areaId: msg.areaId, markdown: msg.markdown })
    }
  })
  const snap: ClientMsg = { t: 'snapshot', snapshot }
  browser.send(JSON.stringify(snap))
  // 서버가 스냅샷을 처리할 시간
  await new Promise((r) => setTimeout(r, 200))
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

describe('MCP e2e (mock 브라우저 WS)', () => {
  it('tools/list에 3도구가 노출된다', async () => {
    const client = await mcpClient()
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['list_areas', 'post_card', 'read_area'])
    await client.close()
  })

  it('list_areas가 프레임 영역을 반환한다', async () => {
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

  it('post_card가 mock 브라우저에 카드를 push 한다', async () => {
    const client = await mcpClient()
    const res = await client.callTool({
      name: 'post_card',
      arguments: { area_id: 'shape:frame1', markdown: '# 정리\n- 이메일 로그인' },
    })
    expect(res.isError).toBeFalsy()
    // push는 비동기 — 잠깐 대기
    await new Promise((r) => setTimeout(r, 100))
    expect(postedCards.some((c) => c.areaId === 'shape:frame1' && c.markdown.includes('이메일 로그인'))).toBe(true)
    await client.close()
  })
})
