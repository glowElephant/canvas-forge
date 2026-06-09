import { type Editor, createShapeId, toRichText } from 'tldraw'
import type { ClientMsg, ServerMsg } from '../shared/protocol'
import { WS_PATH } from '../shared/protocol'
import { setupBoardSync } from './board-sync'

// 서버와의 WebSocket 연결. board 동기화 + export 요청 처리 + post_card 카드 삽입.

export function connectBoard(editor: Editor): () => void {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`
  const ws = new WebSocket(url)

  const send = (m: ClientMsg) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
  }

  const sync = setupBoardSync(editor, (snapshot) => send({ t: 'snapshot', snapshot }))

  ws.onopen = () => {
    // 연결 직후 현재 보드 상태를 서버에 한 번 push (서버가 비어있을 때 대비)
    send({ t: 'snapshot', snapshot: editor.getSnapshot() })
  }

  ws.onmessage = async (ev) => {
    let msg: ServerMsg
    try {
      msg = JSON.parse(ev.data) as ServerMsg
    } catch {
      return
    }
    if (msg.t === 'snapshot') {
      sync.applyRemoteSnapshot(msg.snapshot)
    } else if (msg.t === 'requestExport') {
      await handleExport(editor, msg.areaId, msg.reqId, send)
    } else if (msg.t === 'postCard') {
      postCard(editor, msg.areaId, msg.markdown)
    }
  }

  return () => {
    sync.dispose()
    ws.close()
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
