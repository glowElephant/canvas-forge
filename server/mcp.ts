import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { listAreas, readArea } from './areas.ts'
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
}

/** area_id(예: "shape:frame1")를 파일시스템 안전 폴더명으로 변환 (Windows ':' 금지 대응) */
function safeName(areaId: string): string {
  return areaId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export function buildMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: 'canvas-forge', version: '0.2.0' })

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
