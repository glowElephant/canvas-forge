import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startHost, type RunningHost } from '../host.ts'

// 브라우저 탭이 안 열린 상태(저하 모드)에서도 안전하게 동작해야 한다:
// - list_areas/read_area는 디스크 board.json으로 동작(텍스트만, 스크린샷은 생략)
// - post_card는 크래시 없이 "연결 안 됨" 안내

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

const saved = {
  document: {
    store: {
      'page:p': { id: 'page:p', typeName: 'page', name: 'P' },
      'shape:f': { id: 'shape:f', typeName: 'shape', type: 'frame', parentId: 'page:p', props: { name: '오프라인 영역', w: 200, h: 100 } },
      'shape:tx': { id: 'shape:tx', typeName: 'shape', type: 'text', parentId: 'shape:f', props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '디스크에서 읽힘' }] }] } } },
    },
  },
  session: {},
}

async function mcpClient(port: number): Promise<Client> {
  const client = new Client({ name: 'degraded', version: '0.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`)))
  return client
}

describe('브라우저 미연결(저하 모드)', () => {
  it('read_area는 텍스트를 주고 스크린샷은 생략, post_card는 안내 에러', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-degraded-'))
    const boardFile = path.join(dir, 'board.json')
    await fs.writeFile(boardFile, JSON.stringify(saved), 'utf8')
    const host: RunningHost = await startHost({ port: 0, boardFile, exportsDir: path.join(dir, 'exports') })
    cleanups.push(async () => {
      await host.close()
      await fs.rm(dir, { recursive: true, force: true })
    })

    const client = await mcpClient(host.port)

    // list_areas — 디스크에서
    const la = await client.callTool({ name: 'list_areas', arguments: {} })
    const laText = (la.content as Array<{ type: string; text?: string }>).map((c) => c.text).join('\n')
    expect(laText).toContain('오프라인 영역')

    // read_area — 텍스트 있음, 이미지 없음, 스크린샷 생략 안내
    const ra = await client.callTool({ name: 'read_area', arguments: { area_id: 'shape:f' } })
    const raContent = ra.content as Array<{ type: string; text?: string }>
    expect(raContent.some((c) => c.type === 'image')).toBe(false)
    const raText = raContent.map((c) => c.text ?? '').join('\n')
    expect(raText).toContain('디스크에서 읽힘')
    expect(raText).toContain('스크린샷 생략')

    // post_card — 브라우저 없으니 isError
    const pc = await client.callTool({ name: 'post_card', arguments: { area_id: 'shape:f', markdown: '메모' } })
    expect(pc.isError).toBe(true)

    await client.close()
  })
})
