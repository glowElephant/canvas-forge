import { type Editor, createShapeId, toRichText } from 'tldraw'
import type { ClientMsg, ServerMsg } from '../shared/protocol'
import { WS_PATH } from '../shared/protocol'
import { setupBoardSync, type BoardSync } from './board-sync'

// 서버와의 WebSocket 연결. board 동기화 + export 요청 처리 + post_card 카드 삽입.
// host 재시작 등으로 끊기면 백오프로 자동 재연결한다.

export type ConnStatus = 'connecting' | 'open' | 'closed'

export function connectBoard(editor: Editor, onStatus?: (s: ConnStatus) => void): () => void {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`

  let ws: WebSocket | null = null
  let closedByUser = false
  let retry = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  // sync(스토어 리스너)는 소켓 수명과 무관 — 한 번만 설정하고 재연결 시 재사용
  const sync: BoardSync = setupBoardSync(editor, (snapshot) => send({ t: 'snapshot', snapshot }))

  const send = (m: ClientMsg) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
  }

  function connect() {
    onStatus?.('connecting')
    ws = new WebSocket(url)

    ws.onopen = () => {
      retry = 0
      onStatus?.('open')
      // 여기서 push하지 않는다 — 서버의 init을 받기 전에 push하면 저장된 보드를 빈 상태로 덮을 수 있다.
      // 서버가 곧 보낼 init 메시지를 받아 처리한다(handleServerMsg).
    }

    ws.onmessage = async (ev) => {
      let msg: ServerMsg
      try {
        msg = JSON.parse(ev.data) as ServerMsg
      } catch {
        return
      }
      await handleServerMsg(editor, msg, sync, send)
    }

    ws.onerror = () => {
      ws?.close()
    }

    ws.onclose = () => {
      onStatus?.('closed')
      if (closedByUser) return
      const delay = Math.min(1000 * 2 ** retry, 10000) // 1s,2s,4s,8s,10s…
      retry += 1
      reconnectTimer = setTimeout(connect, delay)
    }
  }

  connect()

  // 탭을 닫거나 숨길 때, debounce 대기 중이던 마지막 편집을 즉시 전송 (유실 방지)
  const flushOnHide = () => {
    if (document.visibilityState === 'hidden') {
      send({ t: 'snapshot', snapshot: editor.getSnapshot() })
    }
  }
  window.addEventListener('pagehide', flushOnHide)
  document.addEventListener('visibilitychange', flushOnHide)

  return () => {
    closedByUser = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    window.removeEventListener('pagehide', flushOnHide)
    document.removeEventListener('visibilitychange', flushOnHide)
    sync.dispose()
    ws?.close()
  }
}

async function handleServerMsg(
  editor: Editor,
  msg: ServerMsg,
  sync: BoardSync,
  send: (m: ClientMsg) => void,
): Promise<void> {
  if (msg.t === 'init') {
    if (msg.snapshot !== null) {
      // 서버가 진실의 출처 — 서버 상태를 적용한다(우리 상태를 덮어쓰지 않게 push 안 함).
      sync.applyRemoteSnapshot(msg.snapshot)
    } else {
      // 서버에 보드가 없다 — 우리가 그릴 게 있으면(예: 서버 board.json 삭제 후 리로드) 한 번 올려준다.
      const snap = editor.getSnapshot()
      const shapeCount = editor.getCurrentPageShapes().length
      if (shapeCount > 0) send({ t: 'snapshot', snapshot: snap })
    }
  } else if (msg.t === 'snapshot') {
    sync.applyRemoteSnapshot(msg.snapshot)
  } else if (msg.t === 'requestExport') {
    await handleExport(editor, msg.areaId, msg.reqId, send)
  } else if (msg.t === 'postCard') {
    postCard(editor, msg.areaId, msg.markdown)
  }
}

/** 프레임 영역을 PNG로 export 해 서버에 응답 (옵션 A의 브라우저 측) */
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

/** Claude의 정리를 해당 영역 오른쪽에 노란 카드(note)로 띄운다 */
function postCard(editor: Editor, areaId: string, markdown: string): void {
  const frame = editor.getShape(areaId as Parameters<Editor['getShape']>[0])
  let x = 100
  let y = 100
  if (frame) {
    const w = (frame.props as { w?: number }).w ?? 0
    x = frame.x + w + 40
    y = frame.y
  }
  editor.createShape({
    id: createShapeId(),
    type: 'note',
    x,
    y,
    props: {
      richText: toRichText(markdown),
      color: 'yellow',
    },
  })
}
