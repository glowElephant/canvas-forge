import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startHost, type RunningHost } from '../host.ts'
import { legacyBoardFixture } from './fixtures.ts'

// MVP3a e2e: 보드에 이미지·파일 카드·북마크가 있을 때 read_area가
// 개별 이미지 원본 + 파일 내용 + 링크 본문을 멀티모달로 반환한다. (+/api/unfurl)

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

let host: RunningHost
let tmpDir: string
let pageServer: http.Server
let pageBase: string

beforeAll(async () => {
  // 링크 본문용 미니 페이지 서버
  pageServer = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<html><head><title>참고 자료</title><meta property="og:title" content="참고 자료"/></head><body>경쟁사 분석 핵심 요점.</body></html>')
  })
  await new Promise<void>((r) => pageServer.listen(0, r))
  pageBase = `http://localhost:${(pageServer.address() as { port: number }).port}`

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-mod-e2e-'))
  const assetsDir = path.join(tmpDir, 'uploads')
  await fs.mkdir(assetsDir, { recursive: true })
  await fs.writeFile(path.join(assetsDir, 'pic1.png'), Buffer.from(TINY_PNG_B64, 'base64'))
  await fs.writeFile(path.join(assetsDir, 'config.json'), '{"feature": "login", "enabled": true}')

  const noteProps = {
    color: 'yellow', labelColor: 'black', size: 'm', font: 'draw', fontSizeAdjustment: 0,
    align: 'middle', verticalAlign: 'middle', growY: 0, url: '',
    richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'config.json' }] }] },
    scale: 1,
  }
  const extraStore = {
    'asset:img1': {
      id: 'asset:img1', typeName: 'asset', type: 'image', meta: {},
      props: { w: 1, h: 1, name: 'pic1.png', isAnimated: false, mimeType: 'image/png', src: '/uploads/pic1.png' },
    },
    'shape:img1': {
      id: 'shape:img1', typeName: 'shape', type: 'image', parentId: 'shape:frame1', index: 'a2',
      x: 10, y: 10, rotation: 0, isLocked: false, opacity: 1, meta: {},
      props: { w: 100, h: 100, playing: true, url: '', assetId: 'asset:img1', crop: null, flipX: false, flipY: false, altText: '' },
    },
    'asset:bm1': {
      id: 'asset:bm1', typeName: 'asset', type: 'bookmark', meta: {},
      props: { src: `${pageBase}/ref`, title: '참고 자료', description: '', image: '', favicon: '' },
    },
    'shape:bm1': {
      id: 'shape:bm1', typeName: 'shape', type: 'bookmark', parentId: 'shape:frame1', index: 'a3',
      x: 20, y: 20, rotation: 0, isLocked: false, opacity: 1, meta: {},
      props: { w: 300, h: 320, assetId: 'asset:bm1', url: `${pageBase}/ref` },
    },
    'shape:file1': {
      id: 'shape:file1', typeName: 'shape', type: 'note', parentId: 'shape:frame1', index: 'a4',
      x: 30, y: 30, rotation: 0, isLocked: false, opacity: 1,
      meta: { cfFile: { file: 'config.json', name: 'config.json', mime: 'application/json' } },
      props: noteProps,
    },
  }

  const boardFile = path.join(tmpDir, 'board.json')
  await fs.writeFile(boardFile, JSON.stringify(legacyBoardFixture({ extraStore })), 'utf8')

  host = await startHost({
    port: 0,
    boardFile,
    exportsDir: path.join(tmpDir, 'exports'),
    assetsDir,
  })
})

afterAll(async () => {
  await host?.close()
  await new Promise<void>((r) => pageServer.close(() => r()))
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('read_area 멀티모달 (MVP3a)', () => {
  it('이미지 원본 + 파일 내용 + 링크 본문을 함께 반환한다', async () => {
    const client = new Client({ name: 'mod-e2e', version: '0.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${host.port}/mcp`)))

    const res = await client.callTool({ name: 'read_area', arguments: { area_id: 'shape:frame1' } })
    const content = res.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>
    const allText = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')

    // 개별 이미지 원본 (브라우저 미연결이라 스크린샷은 생략 — 그래도 원본은 디스크에서)
    const image = content.find((c) => c.type === 'image')
    expect(image).toBeDefined()
    expect(image!.data).toBe(TINY_PNG_B64)
    expect(allText).toContain('[이미지 원본: pic1.png]')

    // 파일 카드 내용
    expect(allText).toContain('[파일: config.json (application/json)]')
    expect(allText).toContain('"feature": "login"')

    // 링크 본문
    expect(allText).toContain('[링크:')
    expect(allText).toContain('경쟁사 분석 핵심 요점')

    await client.close()
  })

  it('/api/unfurl이 og 메타데이터를 반환한다', async () => {
    const res = await fetch(`http://localhost:${host.port}/api/unfurl?url=${encodeURIComponent(`${pageBase}/x`)}`)
    const meta = (await res.json()) as { title: string }
    expect(meta.title).toBe('참고 자료')
  })
})
