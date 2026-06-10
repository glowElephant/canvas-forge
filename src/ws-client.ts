import type { Editor } from 'tldraw'
import type { ClientMsg, ServerMsg } from '../shared/protocol'
import { WS_PATH } from '../shared/protocol'

// export 브리지: 서버의 read_area가 요청하는 프레임 PNG 렌더를 담당.
// (보드 동기화는 useSync(/sync) 몫 — 이 소켓은 export 전용)
// host 재시작 등으로 끊기면 백오프로 자동 재연결한다.

export function connectExportBridge(editor: Editor): () => void {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`

  let ws: WebSocket | null = null
  let closedByUser = false
  let retry = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

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

  return () => {
    closedByUser = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    ws?.close()
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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error ?? new Error('blob 읽기 실패'))
    reader.readAsDataURL(blob)
  })
}
