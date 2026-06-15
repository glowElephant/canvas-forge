import { useSyncExternalStore } from 'react'

// 최소 i18n (외부 의존성 없음): KO/EN 토글.
//  - 렌더 안: `const t = useT()` (언어 변경 시 자동 리렌더)
//  - 렌더 밖(토스트·콜백·모듈 초기화): `t(key, params)` 직접 호출 — 호출 시점의 currentLang을 읽음
// 문구는 평면 키(`ns.key`)로 관리. 보간은 `{name}` 토큰.

export type Lang = 'ko' | 'en'

const LANG_KEY = 'cf-lang'

const STRINGS: Record<Lang, Record<string, string>> = {
  ko: {
    'name_gate.instruction': '보드에서 쓸 이름을 입력하세요',
    'name_gate.placeholder': '이름',
    'name_gate.submit': '입장',

    'status.online': '실시간 동기화 중',
    'status.offline': '연결 끊김 — 재연결 시도 중',
    'status.build_time_hint': '빌드 시각 (MM-DD HH:mm)',

    'loading.connecting_board': '보드에 연결 중…',

    'error.connection_failed': '연결 실패: {error} — 호스트가 켜져 있는지 확인하고 새로고침하세요.',
    'error.runtime': '⚠ 오류: {message} — 이 메시지를 캡처해서 알려주세요',
    'error.close_hint': '클릭하면 닫힘',

    'invite.button': '초대 링크 복사',
    'invite.no_lan_ip': 'LAN IP 못 찾음',
    'invite.copied': '복사됨!',
    'invite.copy_failed': '복사 실패',

    'area_panel.header': '영역 {count}개',
    'area_panel.untitled': '(제목 없음)',
    'area_panel.empty': '프레임 도구로 영역을 그리세요 — 단축키 F (툴바 오른쪽 ⌃ 더보기 안에도 있음)',
    'area_panel.goto': '이 영역으로 이동',
    'area_panel.toggle_pick': 'Claude가 볼 영역으로 지정/해제 (★)',
    'area_panel.drop_pin': '현 위치에 이 영역으로 가는 핀 만들기',

    'chat.header': '💬 채팅',
    'chat.empty': '아직 대화가 없습니다. 아래 입력창으로 시작하세요.',
    'chat.placeholder': '메시지 입력… (Enter 전송)',

    'video.header': '🎬 영상 댓글',
    'video.empty': '시간 태그 댓글을 달면 Claude가 그 시점 장면을 분석합니다',
    'video.anonymous': '익명',
    'video.seek': '이 시점으로 이동',
    'video.placeholder': '댓글 입력…',
    'video.tag_time': '⏱ 현재 재생 시점 태그',
    'video.submit': '댓글 달기',

    'upload.failed': '업로드 실패: {filename}',

    'embed.webpage_title': '웹페이지 (iframe)',

    'drag.tooltip': '드래그로 이동',

    'lang.toggle_hint': 'Switch to English',
  },
  en: {
    'name_gate.instruction': 'Enter a name to use on the board',
    'name_gate.placeholder': 'Name',
    'name_gate.submit': 'Enter',

    'status.online': 'Syncing live',
    'status.offline': 'Disconnected — reconnecting',
    'status.build_time_hint': 'Build time (MM-DD HH:mm)',

    'loading.connecting_board': 'Connecting to board…',

    'error.connection_failed': 'Connection failed: {error} — make sure the host is running and refresh.',
    'error.runtime': '⚠ Error: {message} — please capture this message and report it',
    'error.close_hint': 'Click to dismiss',

    'invite.button': 'Copy invite link',
    'invite.no_lan_ip': 'No LAN IP found',
    'invite.copied': 'Copied!',
    'invite.copy_failed': 'Copy failed',

    'area_panel.header': 'Areas ({count})',
    'area_panel.untitled': '(untitled)',
    'area_panel.empty': 'Draw an area with the Frame tool — shortcut F (also in the ⌃ More menu at the right of the toolbar)',
    'area_panel.goto': 'Go to this area',
    'area_panel.toggle_pick': 'Mark/unmark as an area for Claude to read (★)',
    'area_panel.drop_pin': 'Drop a pin here that jumps to this area',

    'chat.header': '💬 Chat',
    'chat.empty': 'No messages yet. Start typing below.',
    'chat.placeholder': 'Type a message… (Enter to send)',

    'video.header': '🎬 Video comments',
    'video.empty': 'Add a time-tagged comment and Claude will analyze the scene at that moment',
    'video.anonymous': 'Anonymous',
    'video.seek': 'Seek to this moment',
    'video.placeholder': 'Add a comment…',
    'video.tag_time': '⏱ Tag current playback time',
    'video.submit': 'Comment',

    'upload.failed': 'Upload failed: {filename}',

    'embed.webpage_title': 'Web page (iframe)',

    'drag.tooltip': 'Drag to move',

    'lang.toggle_hint': '한국어로 전환',
  },
}

function detectInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'ko' || saved === 'en') return saved
  } catch {
    // localStorage 접근 불가 시 navigator로 폴백
  }
  return typeof navigator !== 'undefined' && navigator.language?.startsWith('ko') ? 'ko' : 'en'
}

let currentLang: Lang = detectInitialLang()

const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 현재 언어(렌더 밖에서 읽기). */
export function getLang(): Lang {
  return currentLang
}

/** 언어 변경 → localStorage 영속 + 모든 구독 컴포넌트 리렌더. */
export function setLang(lang: Lang): void {
  if (lang === currentLang) return
  currentLang = lang
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    // 영속 실패해도 세션 내 전환은 동작
  }
  listeners.forEach((cb) => cb())
}

/** 문구 조회 + `{name}` 보간. 렌더 밖에서도 호출 가능(호출 시점 언어). */
export function t(key: string, params?: Record<string, string | number>): string {
  const template = STRINGS[currentLang][key] ?? STRINGS.en[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`))
}

/** 렌더 안에서 사용: 언어 변경 구독 + t 반환. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, () => currentLang, () => currentLang)
  return t
}

/** 토글 버튼용: 현재 언어 구독. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, () => currentLang, () => currentLang)
}
