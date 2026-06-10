import { useCallback, useMemo, useState } from 'react'
import { Tldraw, type Editor, type TLAssetStore } from 'tldraw'
import { useSync } from '@tldraw/sync'
import 'tldraw/tldraw.css'
import { SYNC_PATH, ASSETS_PATH } from '../shared/protocol'
import { connectExportBridge } from './ws-client'
import { ExternalHandlers } from './external'
import { AreaPanel } from './AreaPanel'
import { VideoCommentPanel } from './VideoCommentPanel'
import { embedDefinitions } from './embeds'

// 보드앱: tldraw 무한 캔버스 + 호스트 허브 실시간 동기화(@tldraw/sync).
// Claude 없이도 N명이 같이 쓰는 화이트보드로 완전히 동작한다.

interface UserInfo {
  id: string
  name: string
  color: string
}

const USER_KEY = 'cf-user'
const COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5', '#0c8599', '#e8590c']

function loadUser(): UserInfo | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as UserInfo) : null
  } catch {
    return null
  }
}

/** 이미지 등 asset은 호스트의 .board/assets/에 저장 (모든 참여자가 같은 URL로 봄) */
const hostAssets: TLAssetStore = {
  async upload(asset, file) {
    const url = `${location.origin}${ASSETS_PATH}/${encodeURIComponent(asset.id.replace(/[^a-zA-Z0-9_-]/g, '_'))}`
    const res = await fetch(url, { method: 'PUT', body: file })
    if (!res.ok) throw new Error(`asset 업로드 실패: ${res.status}`)
    return { src: url }
  },
  resolve(asset) {
    return asset.props.src
  },
}

export default function App() {
  const [user, setUser] = useState<UserInfo | null>(loadUser)
  if (!user) return <NameGate onDone={setUser} />
  return <Board user={user} />
}

function Board({ user }: { user: UserInfo }) {
  const uri = useMemo(
    () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${SYNC_PATH}`,
    [],
  )
  const store = useSync({ uri, assets: hostAssets, userInfo: user })

  const handleMount = useCallback((editor: Editor) => {
    // 디버그/검증용으로 editor를 전역 노출 (tldraw 앱 관행)
    ;(window as unknown as { editor: Editor }).editor = editor
    return connectExportBridge(editor)
  }, [])

  if (store.status === 'loading') {
    return <Center>보드에 연결 중…</Center>
  }
  if (store.status === 'error') {
    return <Center>연결 실패: {store.error.message} — 호스트가 켜져 있는지 확인하고 새로고침하세요.</Center>
  }

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw store={store.store} onMount={handleMount} embeds={embedDefinitions}>
        <ExternalHandlers />
        <AreaPanel />
        <VideoCommentPanel />
      </Tldraw>
      <TopBar online={store.connectionStatus === 'online'} />
    </div>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', font: '14px system-ui' }}>
      {children}
    </div>
  )
}

/** 첫 접속 시 이름 1회 입력 (localStorage 저장, 색은 자동) */
function NameGate({ onDone }: { onDone: (u: UserInfo) => void }) {
  const [name, setName] = useState('')
  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const user: UserInfo = {
      id: crypto.randomUUID(),
      name: trimmed,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    onDone(user)
  }
  return (
    <Center>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 280 }}>
        <strong style={{ fontSize: 16 }}>canvas-forge</strong>
        <span style={{ color: '#555' }}>보드에서 쓸 이름을 입력하세요</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="이름"
          style={{ padding: '8px 10px', fontSize: 14, border: '1px solid #ccc', borderRadius: 6 }}
        />
        <button
          onClick={submit}
          disabled={!name.trim()}
          style={{ padding: '8px 10px', fontSize: 14, borderRadius: 6, border: 'none', background: '#1971c2', color: '#fff', cursor: 'pointer' }}
        >
          입장
        </button>
      </div>
    </Center>
  )
}

/** 상단 가운데: 동기화 상태 배지 + 초대 링크 복사 버튼 */
function TopBar({ online }: { online: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        font: '12px/1.4 system-ui, sans-serif',
      }}
    >
      <div
        style={{
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 999,
          background: 'rgba(255,255,255,0.92)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
          color: '#111',
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 999, background: online ? '#16a34a' : '#dc2626' }} />
        {online ? '실시간 동기화 중' : '연결 끊김 — 재연결 시도 중'}
      </div>
      <InviteButton />
    </div>
  )
}

function InviteButton() {
  const [label, setLabel] = useState('초대 링크 복사')

  const copy = useCallback(async () => {
    try {
      const res = await fetch('/api/invite')
      const { urls } = (await res.json()) as { urls: string[] }
      const url = urls[0]
      if (!url) {
        setLabel('LAN IP 못 찾음')
        setTimeout(() => setLabel('초대 링크 복사'), 2000)
        return
      }
      await copyText(url)
      setLabel('복사됨!')
      setTimeout(() => setLabel('초대 링크 복사'), 2000)
    } catch {
      setLabel('복사 실패')
      setTimeout(() => setLabel('초대 링크 복사'), 2000)
    }
  }, [])

  return (
    <button
      onClick={copy}
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        border: 'none',
        background: '#1971c2',
        color: '#fff',
        cursor: 'pointer',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        font: 'inherit',
      }}
    >
      {label}
    </button>
  )
}

/** clipboard API는 https/localhost 전용 — LAN(http://192.168...) 게스트는 textarea 폴백 */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    if (!document.execCommand('copy')) throw new Error('execCommand 실패')
  } finally {
    document.body.removeChild(ta)
  }
}
