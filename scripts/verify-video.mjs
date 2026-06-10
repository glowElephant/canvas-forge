// MVP3c 영상 댓글+시간태그 헤드리스 검증.
// 브라우저가 MediaRecorder로 webm을 직접 생성→드롭, meta.cfComments에 시간 태그 댓글,
// MCP read_area가 그 시점 프레임 이미지+댓글 라벨을 반환하는지 확인한다.
// 사용: node scripts/verify-video.mjs [boardUrl]  (기본 http://localhost:4399)

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'

const BOARD_URL = process.argv[2] || 'http://localhost:4399'
const DEBUG_PORT = 9234

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean)
  for (const c of candidates) if (fs.existsSync(c)) return c
  throw new Error('chrome.exe를 찾지 못함 — CHROME_PATH로 지정')
}

async function waitFor(fn, timeoutMs = 20000, interval = 250) {
  const start = Date.now()
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 타임아웃')
    await new Promise((r) => setTimeout(r, interval))
  }
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString())
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id)
        this.pending.delete(m.id)
        m.error ? reject(new Error(m.error.message)) : resolve(m.result)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }))
  }
  async eval(body) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true,
    })
    if (r.exceptionDetails) throw new Error('페이지 평가 실패: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    return r.result.value
  }
}

/** MCP 한 세션으로 read_area 호출 */
async function mcpReadArea(base, areaId) {
  const init = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'verify-video', version: '0' } } }),
  })
  const sid = init.headers.get('mcp-session-id')
  await init.text()
  await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  })
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sid },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_area', arguments: { area_id: areaId } } }),
  })
  const raw = await res.text()
  const line = raw.split('\n').map((l) => l.replace(/^data: /, '')).filter((l) => l.startsWith('{')).pop()
  return JSON.parse(line).result.content
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-vid-'))
const chrome = spawn(findChrome(), [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`,
  '--no-first-run', '--window-size=1280,900', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' })
const cleanup = () => {
  try { chrome.kill('SIGKILL') } catch { /* ignore */ }
  try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch { /* ignore */ }
}
process.on('exit', cleanup)

try {
  await waitFor(async () => (await fetch(`http://localhost:${DEBUG_PORT}/json/version`)).ok)
  const target = await (await fetch(`http://localhost:${DEBUG_PORT}/json/new?${new URLSearchParams({ url: BOARD_URL })}`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
  const cdp = new Cdp(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url: BOARD_URL })
  await waitFor(() => cdp.eval(`return document.readyState !== 'loading' && location.href.includes('localhost')`))

  // 보드 진입 + 영상 생성/드롭 + 댓글
  const setup = await cdp.eval(`
    const sleep = (ms) => new Promise(r => setTimeout(r, ms))
    for (let i = 0; i < 150; i++) { if (document.querySelector('input') || window.editor) break; await sleep(100) }
    const input = document.querySelector('input')
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '한아'); input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100)
      document.querySelectorAll('button').forEach(b => { if (b.textContent === '입장') b.click() })
    }
    for (let i = 0; i < 100; i++) { if (window.editor) break; await sleep(100) }
    const editor = window.editor
    if (!editor) return { error: 'editor 없음' }

    editor.createShape({ type: 'frame', x: 100, y: 100, props: { name: '영상 검토', w: 600, h: 460 } })
    const frame = editor.getCurrentPageShapes().find(s => s.type === 'frame')

    // 1.5초짜리 webm 생성: 0~0.5s 빨강 → 0.5~1.0s 초록 → 1.0~1.5s 파랑
    const canvas = document.createElement('canvas')
    canvas.width = 320; canvas.height = 240
    const ctx = canvas.getContext('2d')
    const stream = canvas.captureStream(20)
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const chunks = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const done = new Promise(r => { rec.onstop = r })
    rec.start(100)
    const colors = ['#e03131', '#2f9e44', '#1971c2']
    const t0 = performance.now()
    while (performance.now() - t0 < 1600) {
      const elapsed = (performance.now() - t0) / 1000
      ctx.fillStyle = colors[Math.min(2, Math.floor(elapsed / 0.5))]
      ctx.fillRect(0, 0, 320, 240)
      ctx.fillStyle = '#fff'; ctx.font = '28px sans-serif'
      ctx.fillText('t=' + elapsed.toFixed(1) + 's', 90, 130)
      await sleep(50)
    }
    rec.stop(); await done
    const file = new File([new Blob(chunks, { type: 'video/webm' })], 'demo.webm', { type: 'video/webm' })
    await editor.putExternalContent({ type: 'files', files: [file], point: { x: 350, y: 300 } })

    // video shape + asset 업로드 완료 대기
    let video = null
    for (let i = 0; i < 100; i++) {
      video = editor.getCurrentPageShapes().find(s => s.type === 'video')
      const src = video && editor.getAsset(video.props.assetId)?.props?.src
      if (src) break
      await sleep(150)
    }
    if (!video) return { error: 'video shape 생성 실패' }
    editor.reparentShapes([video.id], frame.id)

    // 댓글: 시간 태그(1.2s = 파랑 구간) + 태그 없음
    editor.updateShape({
      id: video.id, type: 'video',
      meta: { cfComments: [
        { t: 1.2, author: '한아', text: '이 장면 색 확인 필요' },
        { author: '게스트', text: '전체 길이는 적당' },
      ] },
    })
    await sleep(800)
    return { frameId: frame.id, videoId: video.id, assetSrc: editor.getAsset(video.props.assetId).props.src }
  `)
  if (setup.error) throw new Error(setup.error)
  console.log('1) 보드 구성 OK:', JSON.stringify(setup))

  // 브라우저를 켜둔 채 MCP read_area 호출 (프레임 캡처는 이 탭이 수행)
  const content = await mcpReadArea(BOARD_URL, setup.frameId)
  const texts = content.filter((c) => c.type === 'text').map((c) => c.text)
  const images = content.filter((c) => c.type === 'image')
  console.log('2) read_area 파트:', texts.map((t) => t.split('\n')[0].slice(0, 70)))
  console.log('   이미지 수:', images.length, '(스크린샷 1 + 영상 프레임 1 기대)')

  const videoLabel = texts.find((t) => t.includes("[영상 'demo.webm' t=0:01") && t.includes('이 장면 색 확인'))
  const untaggedShown = texts.some((t) => t.includes('전체 길이는 적당'))
  if (!videoLabel) throw new Error('영상 시간태그 라벨 누락: ' + JSON.stringify(texts))
  if (!untaggedShown) throw new Error('태그 없는 댓글 누락')
  if (images.length < 2) throw new Error(`프레임 캡처 이미지 누락 (images=${images.length})`)

  // 캡처 프레임(마지막 이미지)이 파랑 구간(t=1.2s)인지 픽셀 검사 (페이지에서 수행)
  const frameB64 = images[images.length - 1].data
  const pixel = await cdp.eval(`
    const img = new Image()
    img.src = 'data:image/png;base64,' + ${JSON.stringify(frameB64)}
    await new Promise(r => { img.onload = r })
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const x = c.getContext('2d'); x.drawImage(img, 0, 0)
    const [r, g, b] = x.getImageData(10, 10, 1, 1).data
    return { r, g, b, w: img.width, h: img.height }
  `)
  console.log('3) 캡처 프레임 픽셀(10,10):', JSON.stringify(pixel), '— 파랑(#1971c2 근처) 기대')
  if (!(pixel.b > 120 && pixel.b > pixel.r && pixel.b > pixel.g)) {
    throw new Error('t=1.2s 프레임이 파랑 구간이 아님 — seek 캡처 부정확')
  }

  console.log('\\n검증 성공: 시간태그 댓글 → 해당 시점 프레임 + 맥락이 Claude에게 전달됨')
  ws.close()
} finally {
  cleanup()
}
