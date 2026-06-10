// 커서 채팅 헤드리스 검증: 실제 키 입력('/'→타이핑→Enter)으로 전송되고,
// 원격(node WS 클라이언트) 메시지가 보드 DOM에 줄로 떴다가 페이드아웃되는지 확인.
// 사용: node scripts/verify-chat.mjs [boardUrl]

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'

const BOARD_URL = process.argv[2] || 'http://localhost:4399'
const DEBUG_PORT = 9235

function findChrome() {
  for (const c of [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].filter(Boolean)) {
    if (fs.existsSync(c)) return c
  }
  throw new Error('chrome.exe 없음 — CHROME_PATH 지정')
}
async function waitFor(fn, timeoutMs = 15000, interval = 200) {
  const start = Date.now()
  for (;;) {
    try { const v = await fn(); if (v) return v } catch { /* retry */ }
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
    const r = await this.send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error('평가 실패: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    return r.result.value
  }
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-chat-'))
const chrome = spawn(findChrome(), ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`, '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' })
const cleanup = () => {
  try { chrome.kill('SIGKILL') } catch { /* ignore */ }
  try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch { /* ignore */ }
}
process.on('exit', cleanup)

try {
  await waitFor(async () => (await fetch(`http://localhost:${DEBUG_PORT}/json/version`)).ok)
  const target = await (await fetch(`http://localhost:${DEBUG_PORT}/json/new?url=about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
  const cdp = new Cdp(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url: BOARD_URL })
  await waitFor(() => cdp.eval(`return document.readyState !== 'loading' && location.href.includes('localhost')`))

  // 보드 진입
  const ready = await cdp.eval(`
    const sleep = (ms) => new Promise(r => setTimeout(r, ms))
    for (let i = 0; i < 150; i++) { if (document.querySelector('input') || window.editor) break; await sleep(100) }
    const input = document.querySelector('input')
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '한아'); input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100)
      document.querySelectorAll('button').forEach(b => { if (b.textContent === '입장') b.click() })
    }
    for (let i = 0; i < 100; i++) { if (window.editor) break; await sleep(100) }
    document.querySelector('.tl-canvas, .tl-container')?.focus?.()
    return { hasEditor: !!window.editor }
  `)
  if (!ready.hasEditor) throw new Error('editor 마운트 실패')
  console.log('1) 보드 진입 OK')

  // 원격 참여자 역: node가 /ws에 직접 접속
  const wsUrl = BOARD_URL.replace('http', 'ws') + '/ws'
  const remote = new WebSocket(wsUrl)
  await new Promise((res, rej) => { remote.on('open', res); remote.on('error', rej) })
  const received = []
  remote.on('message', (d) => {
    const m = JSON.parse(d.toString())
    if (m.t === 'cursorChat') received.push(m)
  })

  // 2) 실제 키 입력으로 채팅 전송: '/' → 타이핑 → Enter
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', text: '/' })
  await new Promise((r) => setTimeout(r, 300))
  const inputOpen = await cdp.eval(`return !!document.querySelector('input[placeholder^="채팅"]')`)
  if (!inputOpen) throw new Error("'/'로 채팅 입력창이 안 열림")
  await cdp.send('Input.insertText', { text: '여기 좀 봐줘' })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await new Promise((r) => setTimeout(r, 500))

  const ownLineShown = await cdp.eval(`return document.body.innerText.includes('여기 좀 봐줘')`)
  if (!ownLineShown) throw new Error('내 채팅 줄이 화면에 안 보임')
  if (!received.some((m) => m.text === '여기 좀 봐줘' && m.name === '한아')) {
    throw new Error('원격 클라이언트가 채팅 릴레이를 못 받음: ' + JSON.stringify(received))
  }
  console.log('2) 송신 OK — 줄 표시 + 릴레이 수신 (한아: "여기 좀 봐줘")')

  // 3) 원격 → 보드: node가 보낸 채팅이 DOM에 표시
  remote.send(JSON.stringify({ t: 'cursorChat', userId: 'remote-1', name: '원격이', color: '#e03131', text: '잘 보인다!' }))
  await waitFor(() => cdp.eval(`return document.body.innerText.includes('잘 보인다!')`), 5000)
  console.log('3) 수신 OK — 원격 채팅이 보드에 표시')

  // 4) 페이드아웃: 수명(4.5s)+페이드(0.9s) 후 줄이 사라져야 함
  await new Promise((r) => setTimeout(r, 6000))
  const stillThere = await cdp.eval(`return document.body.innerText.includes('여기 좀 봐줘') || document.body.innerText.includes('잘 보인다!')`)
  if (stillThere) throw new Error('페이드아웃 후에도 줄이 남아있음')
  console.log('4) 페이드아웃 OK — 시간 경과 후 줄 제거')

  // 5) 패널 위치/드래그 핸들 확인 (스타일 패널과 안 겹치는 좌측 + ⠿ 핸들)
  const panel = await cdp.eval(`
    const handle = [...document.querySelectorAll('span')].find(s => s.textContent === '⠿')
    const panelEl = handle?.closest('div[style*="position: absolute"]') ?? handle?.parentElement?.parentElement
    const rect = panelEl?.getBoundingClientRect()
    return { hasHandle: !!handle, left: rect?.left ?? -1 }
  `)
  if (!panel.hasHandle) throw new Error('패널 드래그 핸들(⠿) 없음')
  if (panel.left > 400) throw new Error('영역 패널이 여전히 우측(스타일 패널과 충돌 위험): left=' + panel.left)
  console.log('5) 패널 OK — 좌측 배치 + 드래그 핸들:', JSON.stringify(panel))

  console.log('\\n커서 채팅 검증 성공')
  remote.close(); ws.close()
} finally {
  cleanup()
}
