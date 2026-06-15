import { useCallback, useMemo, useRef, useState } from 'react'
import { Tldraw, type Editor, type TLAssetStore } from 'tldraw'
import { useSync } from '@tldraw/sync'
import 'tldraw/tldraw.css'
import { SYNC_PATH, ASSETS_PATH } from '../shared/protocol'
import { isImeComposingEnter } from './ime'
import { uid } from './uid'
import { ErrorRibbon } from './ErrorRibbon'
import { connectExportBridge, type BridgeHandle } from './ws-client'
import { ChatPanel } from './ChatPanel'
import { CursorChat } from './CursorChat'
import { ExternalHandlers } from './external'
import { AreaPanel } from './AreaPanel'
import { FixedContextMenu } from './FixedContextMenu'
import { VideoCommentPanel } from './VideoCommentPanel'
import { embedDefinitions } from './embeds'
import { useT } from './i18n'
import { LangToggle } from './LangToggle'

// 컨텍스트 메뉴 재오픈 버그 우회 (FixedContextMenu 주석 참고)
const components = { ContextMenu: FixedContextMenu }

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
  return (
    <>
      {user ? <Board user={user} /> : <NameGate onDone={setUser} />}
      <ErrorRibbon />
    </>
  )
}

function Board({ user }: { user: UserInfo }) {
  const uri = useMemo(
    () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${SYNC_PATH}`,
    [],
  )
  const store = useSync({ uri, assets: hostAssets, userInfo: user })
  const [bridge, setBridge] = useState<BridgeHandle | null>(null)
  const t = useT()

  const handleMount = useCallback(
    (editor: Editor) => {
      // 디버그/검증용으로 editor를 전역 노출 (tldraw 앱 관행)
      ;(window as unknown as { editor: Editor }).editor = editor
      // 모든 새 shape에 작성 시각·작성자 기록 → Claude가 논의를 시간 순서로 이해 (read_area 정렬 근거)
      editor.getInitialMetaForShape = () => ({ createdAt: Date.now(), createdBy: user.name })
      const handle = connectExportBridge(editor)
      setBridge(handle)
      return () => handle.dispose()
    },
    [user.name],
  )

  if (store.status === 'loading') {
    return <Center>{t('loading.connecting_board')}</Center>
  }
  if (store.status === 'error') {
    return <Center>{t('error.connection_failed', { error: store.error.message })}</Center>
  }

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw store={store.store} onMount={handleMount} embeds={embedDefinitions} components={components}>
        <ExternalHandlers />
        <AreaPanel />
        <VideoCommentPanel />
        {bridge && <CursorChat bridge={bridge} user={user} />}
        {bridge && <ChatPanel bridge={bridge} user={user} />}
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
  const t = useT()
  const done = useRef(false) // keydown+keyup 폴백으로 이중 제출 방지
  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed || done.current) return
    done.current = true
    const user: UserInfo = {
      id: uid(),
      name: trimmed,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    }
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    onDone(user)
  }
  return (
    <Center>
      <LangToggle style={{ position: 'fixed', top: 12, right: 12 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 280 }}>
        <strong style={{ fontSize: 16 }}>canvas-forge</strong>
        <span style={{ color: '#555' }}>{t('name_gate.instruction')}</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !isImeComposingEnter(e) && submit()}
          onKeyUp={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()}
          placeholder={t('name_gate.placeholder')}
          style={{ padding: '8px 10px', fontSize: 14, border: '1px solid #ccc', borderRadius: 6 }}
        />
        <button
          onClick={submit}
          disabled={!name.trim()}
          style={{ padding: '8px 10px', fontSize: 14, borderRadius: 6, border: 'none', background: '#1971c2', color: '#fff', cursor: 'pointer' }}
        >
          {t('name_gate.submit')}
        </button>
      </div>
    </Center>
  )
}

/** 상단 가운데: 동기화 상태 배지 + 초대 링크 복사 버튼 */
function TopBar({ online }: { online: boolean }) {
  const t = useT()
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
        {online ? t('status.online') : t('status.offline')}
        <span style={{ color: '#adb5bd', fontSize: 10 }} title={t('status.build_time_hint')}>
          {__BUILD_ID__}
        </span>
      </div>
      <InviteButton />
      <LangToggle />
    </div>
  )
}

type InviteStatus = 'idle' | 'no_ip' | 'copied' | 'failed'

function InviteButton() {
  const t = useT()
  // 라벨이 아니라 상태를 들고 t()로 렌더 → 언어 전환 시에도 즉시 반영
  const [status, setStatus] = useState<InviteStatus>('idle')

  const copy = useCallback(async () => {
    const reset = () => setTimeout(() => setStatus('idle'), 2000)
    try {
      const res = await fetch('/api/invite')
      const { urls } = (await res.json()) as { urls: string[] }
      const url = urls[0]
      if (!url) {
        setStatus('no_ip')
        reset()
        return
      }
      await copyText(url)
      setStatus('copied')
      reset()
    } catch {
      setStatus('failed')
      reset()
    }
  }, [])

  const label =
    status === 'no_ip'
      ? t('invite.no_lan_ip')
      : status === 'copied'
        ? t('invite.copied')
        : status === 'failed'
          ? t('invite.copy_failed')
          : t('invite.button')

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
