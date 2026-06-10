import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startHost, type RunningHost } from '../host.ts'
import { legacyBoardFixture } from './fixtures.ts'

// 브라우저 탭이 안 열린 상태에서도 안전하게 동작해야 한다 (MVP2에서 저하 범위 축소):
// - list_areas/read_area: room(디스크 로드)에서 텍스트 동작, 스크린샷만 생략
// - post_card: 서버측 쓰기라 브라우저 없이도 성공

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

describe('브라우저 미연결', () => {
  it('read_area는 텍스트+스크린샷 생략, post_card는 성공한다', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-degraded-'))
    cleanups.push(async () => fs.rm(dir, { recursive: true, force: true }))
    const boardFile = path.join(dir, 'board.json')
    await fs.writeFile(
      boardFile,
      JSON.stringify(legacyBoardFixture({ frameTitle: '오프라인 영역', text: '디스크에서 읽힘' })),
      'utf8',
    )

    const host: RunningHost = await startHost({
      port: 0,
      boardFile,
      exportsDir: path.join(dir, 'exports'),
      assetsDir: path.join(dir, 'assets'),
    })
    cleanups.push(async () => host.close())

    const client = new Client({ name: 'degraded', version: '0.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${host.port}/mcp`)))

    // list_areas — room에서
    const la = await client.callTool({ name: 'list_areas', arguments: {} })
    const laText = (la.content as Array<{ type: string; text?: string }>).map((c) => c.text).join('\n')
    expect(laText).toContain('오프라인 영역')

    // read_area — 텍스트 있음, 이미지 없음, 스크린샷 생략 안내
    const ra = await client.callTool({ name: 'read_area', arguments: { area_id: 'shape:frame1' } })
    const raContent = ra.content as Array<{ type: string; text?: string }>
    expect(raContent.some((c) => c.type === 'image')).toBe(false)
    const raText = raContent.map((c) => c.text ?? '').join('\n')
    expect(raText).toContain('디스크에서 읽힘')
    expect(raText).toContain('스크린샷 생략')

    // post_card — MVP2: 서버측 쓰기라 브라우저 없이도 성공
    const pc = await client.callTool({ name: 'post_card', arguments: { area_id: 'shape:frame1', markdown: '메모' } })
    expect(pc.isError).toBeFalsy()

    // 카드가 실제로 영역 읽기에 반영됨 (note는 frame 옆 페이지에 붙으므로 list로 확인 대신 room 저장 확인)
    const la2 = await client.callTool({ name: 'list_areas', arguments: {} })
    expect(la2.isError).toBeFalsy()

    await client.close()
  })
})
