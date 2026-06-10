// 브라우저(보드앱) ↔ 호스트 프로세스 WebSocket 메시지 타입.
// 단일 출처: 프론트/서버 양쪽이 이 파일을 import 한다.
//
// MVP2부터 보드 동기화는 /sync(@tldraw/sync, TLSocketRoom)가 전담한다.
// 이 /ws 브리지는 "브라우저만 할 수 있는 일" — 프레임 PNG export — 전용이다.

/** 채팅 한 줄 (커서 말풍선 + 우측 채팅 패널이 같은 스트림 공유, 브라우저↔서버 릴레이) */
export interface CursorChatMsg {
  t: 'cursorChat'
  /** 클라이언트 발급 uuid (히스토리 dedup/key) */
  id: string
  userId: string
  name: string
  color: string
  text: string
  /** epoch ms — 서버가 수신 시 찍음 (히스토리 정렬 기준) */
  ts?: number
}

/** 브라우저 → 서버 */
export type ClientMsg =
  | { t: 'exportResult'; reqId: string; pngBase64: string }
  | { t: 'exportError'; reqId: string; error: string }
  | CursorChatMsg

/** 서버 → 브라우저 */
export type ServerMsg =
  | { t: 'requestExport'; reqId: string; areaId: string }
  // 영상의 특정 시점 프레임 캡처 요청 (응답은 exportResult/exportError 재사용)
  | { t: 'requestVideoFrame'; reqId: string; shapeId: string; time: number }
  // 다른 참여자의 채팅 릴레이 (보낸 사람 제외 브로드캐스트, ts 서버 스탬프)
  | CursorChatMsg
  // 연결 직후 1회: 누적 채팅 히스토리 (늦게 들어온 사람도 이전 대화를 봄)
  | { t: 'chatHistory'; items: CursorChatMsg[] }

/** export 브리지 WS 경로 */
export const WS_PATH = '/ws'
/** tldraw sync WS 경로 */
export const SYNC_PATH = '/sync'
/** MCP 엔드포인트 경로 */
export const MCP_PATH = '/mcp'
/** 이미지 등 asset 업로드/서빙 경로 prefix (주의: vite 번들이 /assets/를 쓰므로 겹치면 안 됨) */
export const ASSETS_PATH = '/uploads'
