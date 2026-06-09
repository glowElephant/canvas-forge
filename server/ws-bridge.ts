import { randomUUID } from 'node:crypto'
import type { WebSocket, WebSocketServer } from 'ws'
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts'

// 브라우저(보드앱)와의 WebSocket 브리지.
// MVP1은 단일 호스트라 연결은 사실상 1개 — 가장 최근 연결을 활성 클라이언트로 본다.

export interface WsBridge {
  /** 활성 브라우저 연결 존재 여부 */
  hasClient(): boolean
  /** 가장 최근에 받은 보드 스냅샷 (없으면 null) */
  getLatestSnapshot(): unknown | null
  /** 스냅샷 수신 콜백 등록 (영속 저장용) */
  onSnapshot(cb: (snapshot: unknown) => void): void
  /** 서버 측에서 스냅샷을 클라이언트로 push (시작 시 복원) */
  pushSnapshot(snapshot: unknown): void
  /** 프레임 영역 PNG export 요청 → PNG Buffer resolve (timeout 시 reject) */
  requestExport(areaId: string, timeoutMs?: number): Promise<Buffer>
  /** 카드 shape 삽입 요청을 브라우저로 push */
  pushCard(areaId: string, markdown: string): void
}

export function createWsBridge(wss: WebSocketServer): WsBridge {
  let client: WebSocket | null = null
  let latestSnapshot: unknown | null = null
  const snapshotCbs: Array<(s: unknown) => void> = []
  const pending = new Map<string, { resolve: (b: Buffer) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

  function send(msg: ServerMsg): void {
    if (client && client.readyState === client.OPEN) {
      client.send(JSON.stringify(msg))
    }
  }

  wss.on('connection', (ws: WebSocket) => {
    client = ws
    // 새 연결에 마지막 스냅샷 복원 push
    if (latestSnapshot !== null) {
      ws.send(JSON.stringify({ t: 'snapshot', snapshot: latestSnapshot } satisfies ServerMsg))
    }

    ws.on('message', (data) => {
      let msg: ClientMsg
      try {
        msg = JSON.parse(data.toString()) as ClientMsg
      } catch {
        return
      }
      handleClientMsg(msg)
    })

    ws.on('close', () => {
      if (client === ws) client = null
    })
  })

  function handleClientMsg(msg: ClientMsg): void {
    switch (msg.t) {
      case 'snapshot':
        latestSnapshot = msg.snapshot
        for (const cb of snapshotCbs) cb(msg.snapshot)
        break
      case 'exportResult': {
        const p = pending.get(msg.reqId)
        if (p) {
          clearTimeout(p.timer)
          pending.delete(msg.reqId)
          p.resolve(Buffer.from(msg.pngBase64, 'base64'))
        }
        break
      }
      case 'exportError': {
        const p = pending.get(msg.reqId)
        if (p) {
          clearTimeout(p.timer)
          pending.delete(msg.reqId)
          p.reject(new Error(msg.error))
        }
        break
      }
    }
  }

  return {
    hasClient: () => client !== null && client.readyState === client.OPEN,
    getLatestSnapshot: () => latestSnapshot,
    onSnapshot: (cb) => {
      snapshotCbs.push(cb)
    },
    pushSnapshot: (snapshot) => {
      latestSnapshot = snapshot
      send({ t: 'snapshot', snapshot })
    },
    requestExport: (areaId, timeoutMs = 15000) =>
      new Promise<Buffer>((resolve, reject) => {
        if (!client || client.readyState !== client.OPEN) {
          reject(new Error('보드 브라우저가 연결돼 있지 않습니다 (탭을 열어 주세요)'))
          return
        }
        const reqId = randomUUID()
        const timer = setTimeout(() => {
          pending.delete(reqId)
          reject(new Error('export 응답 타임아웃'))
        }, timeoutMs)
        pending.set(reqId, { resolve, reject, timer })
        send({ t: 'requestExport', reqId, areaId })
      }),
    pushCard: (areaId, markdown) => {
      send({ t: 'postCard', areaId, markdown })
    },
  }
}
