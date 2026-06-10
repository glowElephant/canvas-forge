import http from 'node:http'
import os from 'node:os'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { WS_PATH, SYNC_PATH, MCP_PATH, ASSETS_PATH } from '../shared/protocol.ts'
import { createWsBridge } from './ws-bridge.ts'
import { buildMcpServer } from './mcp.ts'
import { createSyncRoom, roomToAreasInput } from './sync-room.ts'
import { postCardToRoom } from './cards.ts'
import { distDir, boardFile, exportsDir, assetsDir, defaultPort } from './config.ts'

// 호스트 단일 프로세스: 정적 UI + tldraw sync(/sync) + export 브리지(/ws) + MCP(HTTP) + assets.
// 보드의 진실의 출처는 TLSocketRoom(서버 권위 store) — 영속·MCP 읽기·post_card 모두 room 기준.

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
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

/** LAN에서 접속 가능한 초대 URL 목록 (IPv4, 루프백 제외). 첫 항목이 가장 유력한 후보 */
export function getInviteUrls(port: number): string[] {
  const urls: string[] = []
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue
      urls.push(`http://${iface.address}:${port}`)
    }
  }
  // 사설망 대역(공유기 환경)을 앞으로 — 게스트가 실제로 닿을 가능성이 높은 주소
  return urls.sort((a, b) => Number(privateRank(b)) - Number(privateRank(a)))
}

function privateRank(url: string): boolean {
  return /\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url)
}

/** baseDir 밖으로 탈출하지 않는 안전한 파일 경로를 만든다. 탈출 시 null */
function safeJoin(baseDir: string, rel: string): string | null {
  const full = path.resolve(baseDir, '.' + (rel.startsWith('/') ? rel : `/${rel}`))
  if (full !== baseDir && !full.startsWith(baseDir + path.sep)) return null
  return full
}

/** dist/ 정적 파일 서빙 (SPA: 없는 경로는 index.html) */
async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  let filePath = safeJoin(distDir, urlPath === '/' ? '/index.html' : urlPath)
  if (!filePath) {
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
  opts: { port?: number; boardFile?: string; exportsDir?: string; assetsDir?: string } = {},
): Promise<RunningHost> {
  const port = opts.port ?? defaultPort
  const boardFilePath = opts.boardFile ?? boardFile
  const exportsDirPath = opts.exportsDir ?? exportsDir
  const assetsDirPath = opts.assetsDir ?? assetsDir

  const httpServer = http.createServer()

  // 동기화 룸 (영속 포함)
  const syncRoom = await createSyncRoom({ boardFile: boardFilePath })

  // WS 2개: /sync(tldraw sync) + /ws(export 브리지) — noServer로 만들어 upgrade에서 직접 라우팅
  const wssSync = new WebSocketServer({ noServer: true })
  const wssBridge = new WebSocketServer({ noServer: true })
  const bridge = createWsBridge(wssBridge)

  httpServer.on('upgrade', (req, socket: Duplex, head) => {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname === SYNC_PATH) {
      const sessionId = url.searchParams.get('sessionId')
      if (!sessionId) {
        socket.destroy()
        return
      }
      wssSync.handleUpgrade(req, socket, head, (ws) => {
        syncRoom.room.handleSocketConnect({ sessionId, socket: ws })
      })
    } else if (url.pathname === WS_PATH) {
      wssBridge.handleUpgrade(req, socket, head, (ws) => {
        wssBridge.emit('connection', ws, req)
      })
    } else {
      socket.destroy()
    }
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

    if (url.startsWith(ASSETS_PATH + '/')) {
      await handleAssets(req, res, decodeURIComponent(url.slice(ASSETS_PATH.length)))
      return
    }

    // 초대 링크 (UI의 "초대 링크 복사" 버튼이 사용)
    if (url === '/api/invite') {
      const p = (httpServer.address() as AddressInfo).port
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({ urls: getInviteUrls(p) }),
      )
      return
    }

    // 나머지는 정적 UI
    await serveStatic(req, res)
  })

  /** 이미지 등 asset 업로드(PUT)/서빙(GET) — .board/assets/ */
  async function handleAssets(req: http.IncomingMessage, res: http.ServerResponse, rel: string): Promise<void> {
    const filePath = safeJoin(assetsDirPath, rel)
    if (!filePath) {
      res.writeHead(403).end('forbidden')
      return
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      await fsp.mkdir(path.dirname(filePath), { recursive: true })
      const out = fs.createWriteStream(filePath)
      req.pipe(out)
      await new Promise<void>((resolve, reject) => {
        out.on('finish', resolve)
        out.on('error', reject)
        req.on('error', reject)
      })
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }))
      return
    }
    if (req.method === 'GET') {
      const stat = await fsp.stat(filePath).catch(() => null)
      if (!stat || stat.isDirectory()) {
        res.writeHead(404).end('not found')
        return
      }
      const ext = path.extname(filePath).toLowerCase()
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' })
      fs.createReadStream(filePath).pipe(res)
      return
    }
    res.writeHead(405).end('method not allowed')
  }

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
          getSnapshot: () => roomToAreasInput(syncRoom.room.getCurrentSnapshot()),
          postCard: (areaId, markdown) => postCardToRoom(syncRoom.room, areaId, markdown),
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
    const onError = (err: Error) => {
      httpServer.off('error', onError)
      reject(err)
    }
    httpServer.once('error', onError)
    httpServer.listen(port, () => {
      httpServer.off('error', onError)
      resolve()
    })
  })
  const actualPort = (httpServer.address() as AddressInfo).port

  return {
    port: actualPort,
    close: async () => {
      await syncRoom.close() // flush 후 room 종료 (유실 방지)
      wssSync.close()
      wssBridge.close()
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
      const invites = getInviteUrls(h.port)
      if (invites.length > 0) {
        console.log(`  초대:     같은 네트워크 사람에게 이 링크를 주세요 → ${invites[0]}`)
        for (const extra of invites.slice(1)) console.log(`            (다른 네트워크 인터페이스: ${extra})`)
      } else {
        console.log(`  초대:     LAN IP를 찾지 못함 — ipconfig로 확인 후 http://<IP>:${h.port}`)
      }
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
