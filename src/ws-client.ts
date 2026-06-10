import type { Editor } from 'tldraw'
import type { ClientMsg, CursorChatMsg, ServerMsg } from '../shared/protocol'
import { WS_PATH } from '../shared/protocol'
import { uid } from './uid'

// export 브리지: 서버의 read_area가 요청하는 프레임 PNG 렌더 + 커서 채팅 릴레이.
// (보드 동기화는 useSync(/sync) 몫)
// host 재시작 등으로 끊기면 백오프로 자동 재연결한다.

export interface BridgeHandle {
  dispose(): void
  /** 채팅 한 줄 전송 — 커서 말풍선과 우측 채팅 패널이 같은 스트림을 공유. 로컬에도 즉시 에코됨 */
  sendCursorChat(msg: Omit<CursorChatMsg, 't' | 'id' | 'ts'>): void
  /** 라이브 채팅 수신 콜백 (내가 보낸 것 포함 — 로컬 에코) */
  onCursorChat(cb: (msg: CursorChatMsg) => void): void
  /** 연결 시 서버가 보내는 누적 히스토리 콜백 */
  onChatHistory(cb: (items: CursorChatMsg[]) => void): void
}

export function connectExportBridge(editor: Editor): BridgeHandle {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`

  let ws: WebSocket | null = null
  let closedByUser = false
  let retry = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  const chatCbs: Array<(m: CursorChatMsg) => void> = []
  const historyCbs: Array<(items: CursorChatMsg[]) => void> = []

  const send = (m: ClientMsg) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
  }

  function connect() {
    ws = new WebSocket(url)

    ws.onopen = () => {
      retry = 0
    }

    ws.onmessage = async (ev) => {
      let msg: ServerMsg
      try {
        msg = JSON.parse(ev.data) as ServerMsg
      } catch {
        return
      }
      if (msg.t === 'requestExport') {
        await handleExport(editor, msg.areaId, msg.reqId, send)
      } else if (msg.t === 'requestVideoFrame') {
        await handleVideoFrame(editor, msg.shapeId, msg.time, msg.reqId, send)
      } else if (msg.t === 'cursorChat') {
        for (const cb of chatCbs) cb(msg)
      } else if (msg.t === 'chatHistory') {
        for (const cb of historyCbs) cb(msg.items)
      }
    }

    ws.onerror = () => {
      ws?.close()
    }

    ws.onclose = () => {
      if (closedByUser) return
      const delay = Math.min(1000 * 2 ** retry, 10000) // 1s,2s,4s,8s,10s…
      retry += 1
      reconnectTimer = setTimeout(connect, delay)
    }
  }

  connect()

  return {
    dispose() {
      closedByUser = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    },
    sendCursorChat(msg) {
      const full: CursorChatMsg = { t: 'cursorChat', id: uid(), ts: Date.now(), ...msg }
      send(full)
      // 로컬 에코 — 보낸 사람의 말풍선/패널도 같은 경로로 갱신 (UI 이원화 방지)
      for (const cb of chatCbs) cb(full)
    },
    onCursorChat(cb) {
      chatCbs.push(cb)
    },
    onChatHistory(cb) {
      historyCbs.push(cb)
    },
  }
}

/** 프레임 영역을 PNG로 export 해 서버에 응답 */
async function handleExport(
  editor: Editor,
  areaId: string,
  reqId: string,
  send: (m: ClientMsg) => void,
): Promise<void> {
  try {
    const shape = editor.getShape(areaId as Parameters<Editor['getShape']>[0])
    if (!shape) throw new Error(`영역을 찾을 수 없습니다: ${areaId}`)
    const result = await editor.toImage([shape.id], { format: 'png', background: true, padding: 16 })
    const pngBase64 = await blobToBase64(result.blob)
    send({ t: 'exportResult', reqId, pngBase64 })
  } catch (e) {
    send({ t: 'exportError', reqId, error: (e as Error).message })
  }
}

/** 영상의 특정 시점 프레임을 offscreen <video> seek + canvas로 캡처 */
async function handleVideoFrame(
  editor: Editor,
  shapeId: string,
  time: number,
  reqId: string,
  send: (m: ClientMsg) => void,
): Promise<void> {
  try {
    const shape = editor.getShape(shapeId as Parameters<Editor['getShape']>[0])
    if (!shape || shape.type !== 'video') throw new Error(`영상 shape를 찾을 수 없습니다: ${shapeId}`)
    const assetId = (shape.props as { assetId?: string }).assetId
    const asset = assetId ? editor.getAsset(assetId as Parameters<Editor['getAsset']>[0]) : null
    const src = (asset?.props as { src?: string } | undefined)?.src
    if (!src) throw new Error('영상 소스 없음')

    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.src = src
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('영상 로드 실패'))
    })
    video.currentTime = Math.min(time, Math.max(0, (video.duration || time) - 0.01))
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve()
      video.onerror = () => reject(new Error('seek 실패'))
      setTimeout(resolve, 3000) // seeked 이벤트 누락 대비
    })

    const maxW = 1280
    const scale = Math.min(1, maxW / (video.videoWidth || maxW))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round((video.videoWidth || 640) * scale)
    canvas.height = Math.round((video.videoHeight || 360) * scale)
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('캡처 실패')
    send({ t: 'exportResult', reqId, pngBase64: await blobToBase64(blob) })
  } catch (e) {
    send({ t: 'exportError', reqId, error: (e as Error).message })
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('blob 읽기 실패'))
    reader.readAsDataURL(blob)
  })
}
