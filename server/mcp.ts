import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { listAreas, readArea } from './areas.ts'
import { extractAreaModalities, readUpload, fetchLinkText, extractPdfText } from './modalities.ts'
import type { WsBridge } from './ws-bridge.ts'

// MCP 서버: Claude가 붙는 3도구. 보드 읽기·쓰기까지만 — 실제 빌드는 Claude Code 기본 도구로.
// MVP2: 텍스트 읽기·카드 쓰기는 서버 권위 room에서 직접(브라우저 불필요),
//       PNG 스크린샷만 브라우저 브리지에 위임(tldraw 렌더는 브라우저 전용).

export interface McpDeps {
  /** PNG export 브리지 (브라우저 위임) */
  bridge: WsBridge
  /** 현재 보드 상태 — room 스냅샷을 areas.ts 입력 형태로 */
  getSnapshot: () => { store: Record<string, unknown> }
  /** 카드 추가 — room store에 서버측 직접 쓰기 */
  postCard: (areaId: string, markdown: string) => Promise<void>
  /** read_area PNG 저장 루트 (.board/exports) */
  exportsDir: string
  /** 업로드 파일 루트 (.board/uploads) — 이미지 원본·파일 카드 읽기용 */
  assetsDir: string
}

/** area_id(예: "shape:frame1")를 파일시스템 안전 폴더명으로 변환 (Windows ':' 금지 대응) */
function safeName(areaId: string): string {
  return areaId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

// 붙는 Claude에게 전달되는 사용 규칙 (initialize 시 클라이언트 시스템 컨텍스트에 노출됨)
const INSTRUCTIONS = `canvas-forge: 무한 캔버스 협업 기획 보드. 사람들(호스트+초대자)이 tldraw 보드에 텍스트·그림·이미지·파일·링크로 기획하고, 너(Claude)는 이 MCP로 보드를 읽고 정리 카드를 게시한다.

개념: '영역' = 보드의 프레임 1개. 사람이 프레임으로 주제를 묶는다. area_id = 프레임 shape id.

기본 루프(중요):
1) list_areas로 영역 목록 확인
2) read_area(area_id)로 영역을 읽는다
3) 읽은 내용을 기획으로 구조화해 post_card(area_id, markdown)로 "이해한 내용 + 확인 질문" 카드를 게시한다
4) 사람이 보드에서 카드를 보고 수정하거나 승인한다 (수정되면 다시 read_area로 확인)
5) 승인받은 뒤의 실제 산출물(파일 생성·빌드)은 이 MCP가 아니라 Claude Code 기본 도구로 만든다

read_area 응답 해석: 텍스트 요약 → 프레임 스크린샷(이미지) → [이미지 원본: …], [SVG 소스: …], [파일: …], [PDF: …], [링크: …] 파트가 이어진다. 각 헤더가 출처 구분이다. [위치 북마크 → '제목' (id)]를 만나면 다른 영역이 참조된 것 — 필요하면 그 id로 read_area를 추가 호출해 따라가 읽어라. [스크린샷 생략]이 보이면 보드 탭이 안 열린 상태다(텍스트만으로 판단하되 그 사실을 언급).

post_card 규칙: markdown으로 간결하게. 단정하지 말고 "이렇게 이해했는데 맞나요?" 형태의 확인 질문을 포함하라. 카드는 모든 참여자 화면에 실시간 표시된다. 요청받지 않은 카드 도배 금지 — 보드 수정 수단은 post_card뿐이다.`

export function buildMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: 'canvas-forge', version: '0.3.0' }, { instructions: INSTRUCTIONS })

  server.registerTool(
    'list_areas',
    {
      title: '영역 목록',
      description: '방장이 프레임으로 묶어둔 보드의 구역(영역) 목록을 반환한다. 각 영역은 id와 제목을 가진다.',
      inputSchema: {},
    },
    async () => {
      const areas = listAreas(deps.getSnapshot())
      if (areas.length === 0) {
        return { content: [{ type: 'text', text: '영역(프레임)이 없습니다. 보드에서 프레임을 그리고 제목을 달아 주세요.' }] }
      }
      const lines = areas.map((a) => `- ${a.id}: ${a.title}`).join('\n')
      return { content: [{ type: 'text', text: `영역 ${areas.length}개:\n${lines}` }] }
    },
  )

  server.registerTool(
    'read_area',
    {
      title: '영역 읽기',
      description:
        '지정한 영역(프레임)의 내용을 읽는다. 텍스트 객체는 텍스트로, 시각 맥락은 프레임 영역 PNG 스크린샷으로 묶어 멀티모달로 반환한다.',
      inputSchema: { area_id: z.string().describe('list_areas가 반환한 영역 id (프레임 shape id)') },
    },
    async ({ area_id }) => {
      const content = readArea(deps.getSnapshot(), area_id)
      if (!content) {
        return { content: [{ type: 'text', text: `영역을 찾을 수 없습니다: ${area_id}` }], isError: true }
      }

      const textPart =
        `# 영역: ${content.title} (${content.id})\n` +
        `shape ${content.shapes.length}개\n\n` +
        (content.text || '(텍스트 없음)')

      const parts: Array<
        { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
      > = [{ type: 'text', text: textPart }]

      // 브라우저에 프레임 PNG export 요청. 실패해도 텍스트는 반환.
      try {
        const png = await deps.bridge.requestExport(area_id)
        const dir = path.join(deps.exportsDir, safeName(area_id))
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(path.join(dir, 'area.png'), png)
        parts.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' })
      } catch (err) {
        parts.push({
          type: 'text',
          text: `\n[스크린샷 생략: ${(err as Error).message}]`,
        })
      }

      // MVP3a 멀티모달: 개별 이미지 원본 + SVG 소스 + 파일 카드 내용 + 링크 본문
      const mods = extractAreaModalities(deps.getSnapshot(), area_id)

      for (const img of mods.images.slice(0, 8)) {
        const buf = await readUpload(deps.assetsDir, img.file)
        if (!buf) {
          parts.push({ type: 'text', text: `[이미지: ${img.name}] (파일 없음)` })
          continue
        }
        parts.push({ type: 'text', text: `[이미지 원본: ${img.name}]` })
        parts.push({ type: 'image', data: buf.toString('base64'), mimeType: img.mime })
      }
      for (const ext of mods.externalImages.slice(0, 8)) {
        parts.push({ type: 'text', text: `[외부 이미지: ${ext.name}] ${ext.url}` })
      }
      for (const svg of mods.svgs.slice(0, 4)) {
        const buf = await readUpload(deps.assetsDir, svg.file)
        const src = buf ? buf.toString('utf8').slice(0, 4000) : '(파일 없음)'
        parts.push({ type: 'text', text: `[SVG 소스: ${svg.name}]\n${src}` })
      }
      for (const f of mods.files.slice(0, 8)) {
        const buf = await readUpload(deps.assetsDir, f.file)
        if (!buf) {
          parts.push({ type: 'text', text: `[파일: ${f.name}] (파일 없음)` })
          continue
        }
        let body = buf.toString('utf8')
        if (body.length > 16000) body = body.slice(0, 16000) + '\n…(잘림)'
        parts.push({ type: 'text', text: `[파일: ${f.name} (${f.mime})]\n${body}` })
      }
      for (const pdf of mods.pdfs.slice(0, 4)) {
        const buf = await readUpload(deps.assetsDir, pdf.file)
        if (!buf) {
          parts.push({ type: 'text', text: `[PDF: ${pdf.name}] (파일 없음)` })
          continue
        }
        try {
          const text = await extractPdfText(buf)
          parts.push({ type: 'text', text: `[PDF: ${pdf.name}]\n${text || '(추출된 텍스트 없음 — 스캔본일 수 있음)'}` })
        } catch (err) {
          parts.push({ type: 'text', text: `[PDF: ${pdf.name}] (추출 실패: ${(err as Error).message})` })
        }
      }
      for (const link of mods.links.slice(0, 5)) {
        try {
          const excerpt = await fetchLinkText(link.url)
          parts.push({ type: 'text', text: `[링크: ${link.url}${link.title ? ` — ${link.title}` : ''}]\n${excerpt}` })
        } catch (err) {
          parts.push({ type: 'text', text: `[링크: ${link.url}] (읽기 실패: ${(err as Error).message})` })
        }
      }
      // 영상 — 시간 태그 댓글의 시점 프레임을 브라우저로 캡처해 댓글과 함께 전달
      for (const video of mods.videos.slice(0, 3)) {
        const tagged = video.comments.filter((c) => typeof c.t === 'number').slice(0, 6)
        const untagged = video.comments.filter((c) => typeof c.t !== 'number')
        const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

        let head = `[영상: ${video.name}] 댓글 ${video.comments.length}개`
        if (untagged.length > 0) {
          head += '\n' + untagged.map((c) => `- ${c.author ?? '익명'}: ${c.text}`).join('\n')
        }
        if (video.comments.length === 0) head += ' — 시간 태그 댓글이 없어 분석할 시점이 지정되지 않음'
        parts.push({ type: 'text', text: head })

        for (const c of tagged) {
          const label = `[영상 '${video.name}' t=${fmt(c.t!)} — ${c.author ?? '익명'}: "${c.text}"]`
          try {
            const png = await deps.bridge.requestVideoFrame(video.shapeId, c.t!)
            parts.push({ type: 'text', text: label })
            parts.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' })
          } catch (err) {
            parts.push({ type: 'text', text: `${label} (프레임 캡처 생략: ${(err as Error).message})` })
          }
        }
      }

      // 위치 북마크 — 대상 영역 제목을 찾아 따라갈 수 있게 안내
      if (mods.gotoPins.length > 0) {
        const areas = listAreas(deps.getSnapshot())
        for (const pin of mods.gotoPins) {
          const target = areas.find((a) => a.id === pin.targetId)
          parts.push({
            type: 'text',
            text: target
              ? `[위치 북마크 → '${target.title}' (${target.id})] — 필요하면 read_area("${target.id}")로 따라가 읽으세요.`
              : `[위치 북마크 → ${pin.targetId}] (대상 영역을 찾을 수 없음)`,
          })
        }
      }

      return { content: parts }
    },
  )

  server.registerTool(
    'post_card',
    {
      title: '카드 게시',
      description:
        'Claude의 정리("이거 맞나요")를 보드의 해당 영역 옆에 카드로 추가한다. markdown 텍스트를 받아 카드 shape로 띄운다. 연결된 모든 참여자 화면에 실시간 반영된다.',
      inputSchema: {
        area_id: z.string().describe('카드를 붙일 기준 영역 id'),
        markdown: z.string().describe('카드에 표시할 markdown 정리 내용'),
      },
    },
    async ({ area_id, markdown }) => {
      try {
        await deps.postCard(area_id, markdown)
        return { content: [{ type: 'text', text: `카드를 보드(${area_id})에 띄웠습니다.` }] }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `카드 추가 실패: ${(err as Error).message}` }],
          isError: true,
        }
      }
    },
  )

  return server
}
