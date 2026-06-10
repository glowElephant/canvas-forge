// 헤드리스 Chrome(CDP)으로 보드 UI를 실제로 구동해 검증하는 스크립트.
// 사용: node scripts/verify-headless.mjs [boardUrl]  (기본 http://localhost:4399)
// chrome-devtools MCP가 막혔을 때의 대체 검증 수단. ws 패키지 사용.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'

const BOARD_URL = process.argv[2] || 'http://localhost:4399'
const DEBUG_PORT = 9233

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean)
  for (const c of candidates) if (fs.existsSync(c)) return c
  throw new Error('chrome.exe를 찾지 못함 — CHROME_PATH 환경변수로 지정하세요')
}

async function waitFor(fn, timeoutMs = 15000, interval = 250) {
  const start = Date.now()
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      /* retry */
    }
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 타임아웃')
    await new Promise((r) => setTimeout(r, interval))
  }
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.on('message', (d) => {
      const msg = JSON.parse(d.toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  /** 페이지에서 async 함수 본문 실행, JSON 반환 */
  async eval(body) {
    const res = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (res.exceptionDetails) throw new Error('페이지 평가 실패: ' + JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text))
    return res.result.value
  }
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-cdp-'))
const chrome = spawn(findChrome(), [
  `--headless=new`,
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${userDataDir}`,
  '--no-first-run',
  '--window-size=1280,900',
  'about:blank',
], { stdio: 'ignore' })

const cleanup = () => {
  try { chrome.kill('SIGKILL') } catch { /* ignore */ }
  try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch { /* ignore */ }
}
process.on('exit', cleanup)

try {
  // 탭 열기
  const version = await waitFor(async () => {
    const r = await fetch(`http://localhost:${DEBUG_PORT}/json/version`)
    return r.ok ? r.json() : null
  })
  console.log('chrome:', version.Browser)
  const target = await (await fetch(`http://localhost:${DEBUG_PORT}/json/new?${new URLSearchParams({ url: BOARD_URL })}`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 })
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
  const cdp = new Cdp(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url: BOARD_URL })
  await waitFor(() => cdp.eval(`return location.href.startsWith('${BOARD_URL.slice(0, 20)}') && document.readyState !== 'loading'`))

  // 1) 이름 게이트 통과 + editor 대기
  const ready = await cdp.eval(`
    for (let i = 0; i < 150; i++) {
      if (document.querySelector('input') || window.editor) break
      await new Promise(r => setTimeout(r, 100))
    }
    const input = document.querySelector('input')
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '검증봇')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 100))
      document.querySelectorAll('button').forEach(b => { if (b.textContent === '입장') b.click() })
    }
    for (let i = 0; i < 100; i++) { if (window.editor) break; await new Promise(r => setTimeout(r, 100)) }
    return {
      hasEditor: !!window.editor,
      href: location.href,
      body: document.body.innerText.slice(0, 120),
      hadInput: !!input,
    }
  `)
  if (!ready.hasEditor) throw new Error('editor 마운트 실패: ' + JSON.stringify(ready))
  console.log('1) 보드 진입 OK')

  // 2) 프레임 2개 + PDF 드롭 + URL 붙여넣기(북마크 기대) + 임베드(다이얼로그 경로) + 핀
  const setup = await cdp.eval(`
    const editor = window.editor
    const sleep = (ms) => new Promise(r => setTimeout(r, ms))
    editor.createShape({ type: 'frame', x: 100, y: 100, props: { name: '자료실', w: 600, h: 460 } })
    editor.createShape({ type: 'frame', x: 1600, y: 100, props: { name: '참조 영역', w: 400, h: 300 } })
    const [frame1, frame2] = editor.getCurrentPageShapes().filter(s => s.type === 'frame')

    // PDF 드롭 (파일 카드 경로)
    const pdfBody = '%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\\n4 0 obj<</Length 52>>stream\\nBT /F1 24 Tf 72 720 Td (Quarterly Plan Doc) Tj ET\\nendstream\\nendobj\\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\\ntrailer<</Root 1 0 R/Size 6>>\\n%%EOF'
    const pdfFile = new File([pdfBody], 'plan.pdf', { type: 'application/pdf' })
    await editor.putExternalContent({ type: 'files', files: [pdfFile], point: { x: 300, y: 250 } })

    // URL 붙여넣기 → 북마크여야 함 (catch-all 임베드가 가로채면 embed가 됨)
    await editor.putExternalContent({ type: 'url', url: 'https://example.com/', point: { x: 450, y: 350 } })

    // 임베드 다이얼로그 경로 시뮬레이션 (type:'embed' + catch-all 정의)
    const embedUtil = editor.getShapeUtil('embed')
    const defs = embedUtil?.getEmbedDefinitions?.() ?? []
    const webpageDef = defs.find(d => d.type === 'webpage')
    if (webpageDef) {
      await editor.putExternalContent({ type: 'embed', url: 'https://example.com/', point: { x: 900, y: 700 }, embed: webpageDef })
    }
    await sleep(1200)

    // 생성물들을 frame1 안으로
    for (const s of editor.getCurrentPageShapes()) {
      if (s.type !== 'frame' && s.parentId !== frame1.id && s.type !== 'embed') {
        editor.reparentShapes([s.id], frame1.id)
      }
    }
    // 핀: frame1 안에 'frame2로 가는 핀' (AreaPanel의 📍와 동일 구조)
    editor.createShape({
      type: 'note', x: 480, y: 420,
      meta: { cfGoto: { targetId: frame2.id } },
      props: { richText: { type:'doc', content:[{type:'paragraph', content:[{type:'text', text:'📍 참조 영역'}]}] }, color: 'violet' },
    })
    const pin = editor.getCurrentPageShapes().find(s => s.meta?.cfGoto)
    editor.reparentShapes([pin.id], frame1.id)
    await sleep(800)

    const shapes = editor.getCurrentPageShapes().map(s => s.type)
    const bookmarkCount = shapes.filter(t => t === 'bookmark').length
    const embedCount = shapes.filter(t => t === 'embed').length
    // 핀 화면 좌표 (CDP 마우스 입력용)
    const pinBounds = editor.getShapePageBounds(pin.id)
    const pinScreen = editor.pageToScreen({ x: pinBounds.midX, y: pinBounds.midY })
    // 패널 존재 확인
    const panelText = [...document.querySelectorAll('button')].map(b => b.textContent).find(t => t && t.includes('영역'))
    return {
      frame1: frame1.id, frame2: frame2.id,
      shapes, bookmarkCount, embedCount,
      hasWebpageEmbedDef: !!webpageDef,
      pinScreen: { x: pinScreen.x, y: pinScreen.y },
      panelText,
    }
  `)
  console.log('2) 보드 구성:', JSON.stringify(setup))
  if (setup.bookmarkCount !== 1) throw new Error(`URL 붙여넣기가 북마크가 아님 (bookmark=${setup.bookmarkCount})`)
  if (!setup.hasWebpageEmbedDef) throw new Error('catch-all webpage 임베드 정의 없음')
  if (setup.embedCount !== 1) throw new Error(`임베드 생성 실패 (embed=${setup.embedCount})`)

  // 3) 핀 클릭(실제 마우스 이벤트) → frame2로 점프
  const { x, y } = setup.pinScreen
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  }
  await new Promise((r) => setTimeout(r, 900))
  const jump = await cdp.eval(`
    const editor = window.editor
    const vp = editor.getViewportPageBounds()
    const f2 = editor.getShapePageBounds('${setup.frame2}')
    return { jumped: vp.contains ? vp.contains(f2) : (vp.x <= f2.x && vp.y <= f2.y && vp.x+vp.w >= f2.x+f2.w), vp: {x:vp.x,y:vp.y,w:vp.w,h:vp.h} }
  `)
  console.log('3) 핀 클릭 점프:', JSON.stringify(jump))
  if (!jump.jumped) throw new Error('핀 클릭으로 카메라가 frame2로 이동하지 않음')

  console.log('\\n검증 성공 — frame1 id:', setup.frame1)
  console.log('PDF/링크 읽기는 이어서 MCP read_area로 확인하세요 (area_id 위)')
  ws.close()
} finally {
  cleanup()
}
