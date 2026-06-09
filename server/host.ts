import http from 'node:http'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { WS_PATH, MCP_PATH } from '../shared/protocol.ts'
import { createWsBridge } from './ws-bridge.ts'
import { buildMcpServer } from './mcp.ts'
import { loadBoard, saveBoard } from './board.ts'
import { distDir, boardFile, exportsDir, defaultPort } from './config.ts'

// 호스트 단일 프로세스: 정적 UI 서빙 + MCP(HTTP) + 브라우저 WS, 한 프로세스에서.

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : undefined)
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

/** dist/ 정적 파일 서빙 (SPA: 없는 경로는 index.html) */
async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  let filePath = path.join(distDir, urlPath === '/' ? 'index.html' : urlPath)
  // 경로 탈출 방지
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403).end('forbidden')
    return
  }
  try {
    let stat = await fsp.stat(filePath).catch(() => null)
    if (!stat || stat.isDirectory()) {
      filePath = path.join(distDir, 'index.html')
      stat = await fsp.stat(filePath).catch(() => null)
    }
    if (!stat) {
      res.writeHead(404).end('보드 UI가 아직 빌드되지 않았습니다. `npm run build`를 실행하세요.')
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
    fs.createReadStream(filePath).pipe(res)
  } catch {
    res.writeHead(500).end('static error')
  }
}

export interface RunningHost {
  port: number
  close: () => Promise<void>
}

export async function startHost(
  opts: { port?: number; boardFile?: string; exportsDir?: string } = {},
): Promise<RunningHost> {
  const port = opts.port ?? defaultPort
  const boardFilePath = opts.boardFile ?? boardFile
  const exportsDirPath = opts.exportsDir ?? exportsDir

  const httpServer = http.createServer()
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH })
  const bridge = createWsBridge(wss)

  // 시작 시 board 복원 → 브라우저 미연결이어도 list_area 등이 동작하도록 latest로 설정
  const restored = await loadBoard(boardFilePath)
  if (restored !== null) bridge.pushSnapshot(restored)

  // 스냅샷 수신 시 debounce 저장. 종료 시 flush 안 하면 마지막 편집이 유실되므로 pending을 추적.
  let saveTimer: NodeJS.Timeout | null = null
  let pendingSnapshot: unknown = null
  let hasPending = false
  async function flushSave(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!hasPending) return
    hasPending = false
    try {
      await saveBoard(boardFilePath, pendingSnapshot)
    } catch (e) {
      console.error('board 저장 실패:', e)
    }
  }
  bridge.onSnapshot((snapshot) => {
    pendingSnapshot = snapshot
    hasPending = true
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void flushSave(), 500)
  })

  // MCP는 stateful Streamable HTTP: 세션별 transport 보관
  const transports = new Map<string, StreamableHTTPServerTransport>()

  httpServer.on('request', async (req, res) => {
    const url = (req.url || '/').split('?')[0]

    if (url === MCP_PATH) {
      try {
        await handleMcp(req, res)
      } catch (e) {
        console.error('MCP 처리 오류:', e)
        if (!res.headersSent) res.writeHead(500).end('mcp error')
      }
      return
    }
    // 나머지는 정적 UI
    await serveStatic(req, res)
  })

  async function handleMcp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined

    if (req.method === 'POST') {
      const body = await readJsonBody(req)
      let transport: StreamableHTTPServerTransport | undefined =
        sessionId ? transports.get(sessionId) : undefined

      if (!transport && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports.set(sid, transport!)
          },
        })
        transport.onclose = () => {
          if (transport!.sessionId) transports.delete(transport!.sessionId)
        }
        const server = buildMcpServer({
          bridge,
          readPersisted: () => loadBoard(boardFilePath),
          exportsDir: exportsDirPath,
        })
        await server.connect(transport)
      }

      if (!transport) {
        res.writeHead(400, { 'content-type': 'application/json' }).end(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: '세션 없음 또는 잘못된 요청' }, id: null }),
        )
        return
      }
      await transport.handleRequest(req, res, body)
      return
    }

    // GET(SSE 스트림) / DELETE(세션 종료)
    if (req.method === 'GET' || req.method === 'DELETE') {
      const transport = sessionId ? transports.get(sessionId) : undefined
      if (!transport) {
        res.writeHead(400).end('세션 없음')
        return
      }
      await transport.handleRequest(req, res)
      return
    }

    res.writeHead(405).end('method not allowed')
  }

  await new Promise<void>((resolve, reject) => {
    // listen 에러(EADDRINUSE 등)는 httpServer뿐 아니라 wss(server를 감쌈)에서도 재emit된다.
    // 둘 다 핸들링하지 않으면 unhandled 'error'로 프로세스가 크래시한다.
    const onError = (err: Error) => {
      httpServer.off('error', onError)
      wss.off('error', onError)
      reject(err)
    }
    httpServer.once('error', onError)
    wss.once('error', onError)
    httpServer.listen(port, () => {
      httpServer.off('error', onError)
      wss.off('error', onError)
      resolve()
    })
  })
  const actualPort = (httpServer.address() as AddressInfo).port

  return {
    port: actualPort,
    close: async () => {
      await flushSave() // 종료 전 대기 중인 마지막 편집을 저장 (유실 방지)
      wss.close()
      // keep-alive MCP 연결이 남아 close가 무기한 대기하지 않도록 강제 종료
      httpServer.closeAllConnections()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}

// 직접 실행될 때만 기동 (테스트 import 시엔 자동 기동 안 함)
const invokedDirectly =
  !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (invokedDirectly) {
  startHost()
    .then((h) => {
      console.log(`canvas-forge host 기동: http://localhost:${h.port}`)
      console.log(`  보드 UI:  http://localhost:${h.port}  (먼저 npm run build 필요)`)
      console.log(`  MCP:      http://localhost:${h.port}${MCP_PATH}`)
      console.log(`  등록:     claude mcp add --transport http canvas-forge http://localhost:${h.port}${MCP_PATH}`)

      // Ctrl+C / 종료 시그널에도 대기 중인 저장을 flush 후 깔끔히 종료
      let closing = false
      const shutdown = async () => {
        if (closing) return
        closing = true
        await h.close()
        process.exit(0)
      }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    })
    .catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') {
        console.error(
          `포트 ${process.env.PORT || defaultPort}가 이미 사용 중입니다. ` +
            `다른 host가 떠 있거나 포트가 점유됐습니다. PORT 환경변수로 바꾸거나 기존 프로세스를 종료하세요.`,
        )
      } else {
        console.error('host 기동 실패:', e)
      }
      process.exit(1)
    })
}
