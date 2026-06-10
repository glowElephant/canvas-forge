import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { extractAreaModalities, readUpload, fetchLinkText, unfurl, htmlToText } from '../modalities.ts'

// MVP3a: 영역 내 모달리티 추출(순수) + 디스크/URL 읽기(IO)

const FRAME = 'shape:f'
const store: Record<string, unknown> = {
  'page:p': { id: 'page:p', typeName: 'page' },
  [FRAME]: { id: FRAME, typeName: 'shape', type: 'frame', parentId: 'page:p', props: { name: '영역' } },
  // 업로드된 png
  'asset:img1': {
    id: 'asset:img1', typeName: 'asset', type: 'image',
    props: { src: '/uploads/pic1.png', mimeType: 'image/png', name: 'pic1.png' },
  },
  'shape:img1': { id: 'shape:img1', typeName: 'shape', type: 'image', parentId: FRAME, props: { assetId: 'asset:img1' } },
  // svg
  'asset:svg1': {
    id: 'asset:svg1', typeName: 'asset', type: 'image',
    props: { src: '/uploads/logo.svg', mimeType: 'image/svg+xml', name: 'logo.svg' },
  },
  'shape:svg1': { id: 'shape:svg1', typeName: 'shape', type: 'image', parentId: FRAME, props: { assetId: 'asset:svg1' } },
  // 외부 이미지
  'asset:ext': {
    id: 'asset:ext', typeName: 'asset', type: 'image',
    props: { src: 'https://example.com/x.png', mimeType: 'image/png', name: 'x.png' },
  },
  'shape:ext': { id: 'shape:ext', typeName: 'shape', type: 'image', parentId: FRAME, props: { assetId: 'asset:ext' } },
  // 텍스트 파일 카드 (meta.cfFile)
  'shape:file1': {
    id: 'shape:file1', typeName: 'shape', type: 'geo', parentId: FRAME,
    meta: { cfFile: { file: 'config.json', name: 'config.json', mime: 'application/json' } },
    props: {},
  },
  // 북마크
  'asset:bm': {
    id: 'asset:bm', typeName: 'asset', type: 'bookmark',
    props: { src: 'http://example.com/page', title: '예시 페이지' },
  },
  'shape:bm': { id: 'shape:bm', typeName: 'shape', type: 'bookmark', parentId: FRAME, props: { assetId: 'asset:bm' } },
  // 프레임 밖 이미지 — 제외돼야 함
  'shape:outside': { id: 'shape:outside', typeName: 'shape', type: 'image', parentId: 'page:p', props: { assetId: 'asset:img1' } },
}

describe('extractAreaModalities', () => {
  const m = extractAreaModalities({ store }, FRAME)

  it('업로드 이미지/svg/외부 이미지/파일/링크를 분류한다', () => {
    expect(m.images).toEqual([{ name: 'pic1.png', mime: 'image/png', file: 'pic1.png' }])
    expect(m.svgs).toEqual([{ name: 'logo.svg', file: 'logo.svg' }])
    expect(m.externalImages).toEqual([{ name: 'x.png', url: 'https://example.com/x.png' }])
    expect(m.files).toEqual([{ file: 'config.json', name: 'config.json', mime: 'application/json' }])
    expect(m.links).toEqual([{ url: 'http://example.com/page', title: '예시 페이지' }])
  })

  it('프레임 밖 shape는 제외', () => {
    const all = [...m.images, ...m.svgs, ...m.externalImages].length
    expect(all).toBe(3) // outside가 들어왔다면 4
  })
})

describe('readUpload', () => {
  it('uploads 안 파일을 읽고, 경로 탈출은 null', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-up-'))
    await fs.writeFile(path.join(dir, 'a.json'), '{"k":1}')
    expect((await readUpload(dir, 'a.json'))?.toString()).toBe('{"k":1}')
    expect(await readUpload(dir, '../a.json')).toBeNull()
    expect(await readUpload(dir, '없는파일.txt')).toBeNull()
    await fs.rm(dir, { recursive: true, force: true })
  })
})

describe('링크 읽기 (미니 HTTP 서버)', () => {
  let server: http.Server
  let base: string

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/page') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(`<html><head>
          <title>테스트 페이지</title>
          <meta property="og:title" content="OG 제목"/>
          <meta property="og:description" content="OG 설명"/>
          <script>ignore_me()</script>
          </head><body><h1>본문 머리말</h1><p>중요한 기획 내용.</p></body></html>`)
      } else {
        res.writeHead(404).end()
      }
    })
    await new Promise<void>((r) => server.listen(0, r))
    base = `http://localhost:${(server.address() as { port: number }).port}`
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  it('fetchLinkText가 태그 제거된 본문을 준다', async () => {
    const text = await fetchLinkText(`${base}/page`)
    expect(text).toContain('본문 머리말')
    expect(text).toContain('중요한 기획 내용')
    expect(text).not.toContain('ignore_me')
    expect(text).not.toContain('<h1>')
  })

  it('unfurl이 og 메타데이터를 파싱한다', async () => {
    const u = await unfurl(`${base}/page`)
    expect(u.title).toBe('OG 제목')
    expect(u.description).toBe('OG 설명')
  })

  it('404는 에러', async () => {
    await expect(fetchLinkText(`${base}/nope`)).rejects.toThrow('404')
  })
})

describe('htmlToText', () => {
  it('길면 자른다', () => {
    const t = htmlToText(`<p>${'가'.repeat(5000)}</p>`, 100)
    expect(t.length).toBeLessThan(120)
    expect(t).toContain('잘림')
  })
})
