import { randomUUID } from 'node:crypto'
import type { WebSocket, WebSocketServer } from 'ws'
import type { ClientMsg, CursorChatMsg, ServerMsg } from '../shared/protocol.ts'

// 브라우저(보드앱)와의 export 브리지 + 채팅 릴레이/히스토리.
// tldraw PNG 렌더는 브라우저에서만 가능하므로 read_area의 스크린샷 요청을 연결된 탭 하나에 위임한다.
// 보드 동기화는 /sync(TLSocketRoom) 몫 — 여기서는 다루지 않는다.

const CHAT_HISTORY_MAX = 500

export interface WsBridge {
  /** export를 처리해줄 브라우저 연결 존재 여부 */
  hasClient(): boolean
  /** 프레임 영역 PNG export 요청 → PNG Buffer resolve (timeout 시 reject) */
  requestExport(areaId: string, timeoutMs?: number): Promise<Buffer>
  /** 영상 특정 시점 프레임 캡처 요청 → PNG Buffer */
  requestVideoFrame(shapeId: string, time: number, timeoutMs?: number): Promise<Buffer>
}

export interface WsBridgeOpts {
  /** 시작 시 복원할 채팅 히스토리 */
  initialChat?: CursorChatMsg[]
  /** 채팅 수신 시 호출 (영속 저장용) */
  onChat?(history: CursorChatMsg[]): void
}

export function createWsBridge(wss: WebSocketServer, opts: WsBridgeOpts = {}): WsBridge {
  // 연결된 탭들 중 가장 최근 것을 우선 사용 (아무 탭이나 export 가능)
  const clients = new Set<WebSocket>()
  const pending = new Map<string, { resolve: (b: Buffer) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  const chatHistory: CursorChatMsg[] = [...(opts.initialChat ?? [])]

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws)
    // 누적 채팅 히스토리 전달 (늦게 들어온 참여자도 이전 대화를 봄)
    if (chatHistory.length > 0) {
      ws.send(JSON.stringify({ t: 'chatHistory', items: chatHistory } satisfies ServerMsg))
    }

    ws.on('message', (data) => {
      let msg: ClientMsg
      try {
        msg = JSON.parse(data.toString()) as ClientMsg
      } catch {
        return
      }
      // 채팅: 서버가 ts 스탬프 → 히스토리 적재 → 보낸 사람 제외 전원에게 릴레이
      if (msg.t === 'cursorChat') {
        const stamped: CursorChatMsg = { ...msg, ts: Date.now() }
        chatHistory.push(stamped)
        if (chatHistory.length > CHAT_HISTORY_MAX) chatHistory.splice(0, chatHistory.length - CHAT_HISTORY_MAX)
        opts.onChat?.(chatHistory)
        const payload = JSON.stringify(stamped)
        for (const other of clients) {
          if (other !== ws && other.readyState === other.OPEN) other.send(payload)
        }
        return
      }
      const p = pending.get(msg.reqId)
      if (!p) return
      clearTimeout(p.timer)
      pending.delete(msg.reqId)
      if (msg.t === 'exportResult') p.resolve(Buffer.from(msg.pngBase64, 'base64'))
      else p.reject(new Error(msg.error))
    })

    ws.on('close', () => {
      clients.delete(ws)
    })
  })

  function pickClient(): WebSocket | null {
    for (const ws of [...clients].reverse()) {
      if (ws.readyState === ws.OPEN) return ws
    }
    return null
  }

  /** reqId 발급 → 메시지 전송 → exportResult/exportError 응답을 Buffer로 매칭 */
  function request(makeMsg: (reqId: string) => ServerMsg, timeoutMs: number): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const client = pickClient()
      if (!client) {
        reject(new Error('보드 브라우저가 연결돼 있지 않습니다 (탭을 열어 주세요)'))
        return
      }
      const reqId = randomUUID()
      const timer = setTimeout(() => {
        pending.delete(reqId)
        reject(new Error('브라우저 응답 타임아웃'))
      }, timeoutMs)
      pending.set(reqId, { resolve, reject, timer })
      client.send(JSON.stringify(makeMsg(reqId)))
    })
  }

  return {
    hasClient: () => pickClient() !== null,
    requestExport: (areaId, timeoutMs = 15000) =>
      request((reqId) => ({ t: 'requestExport', reqId, areaId }), timeoutMs),
    requestVideoFrame: (shapeId, time, timeoutMs = 20000) =>
      request((reqId) => ({ t: 'requestVideoFrame', reqId, shapeId, time }), timeoutMs),
  }
}
