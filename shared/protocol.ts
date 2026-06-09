// 브라우저(보드앱) ↔ 호스트 프로세스 WebSocket 메시지 타입.
// 단일 출처: 프론트/서버 양쪽이 이 파일을 import 한다.

/** 브라우저 → 서버 */
export type ClientMsg =
  | { t: 'snapshot'; snapshot: unknown } // 보드 상태 push (영속용)
  | { t: 'exportResult'; reqId: string; pngBase64: string }
  | { t: 'exportError'; reqId: string; error: string }

/** 서버 → 브라우저 */
export type ServerMsg =
  | { t: 'requestExport'; reqId: string; areaId: string } // 프레임 PNG export 요청
  | { t: 'postCard'; areaId: string; markdown: string } // 카드 shape 삽입 요청
  | { t: 'snapshot'; snapshot: unknown } // 초기 복원 push

/** WS 엔드포인트 경로 */
export const WS_PATH = '/ws'
/** MCP 엔드포인트 경로 */
export const MCP_PATH = '/mcp'
