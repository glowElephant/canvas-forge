import type { Editor } from 'tldraw'

// editor ↔ 서버 스냅샷 동기화. 로컬 변경은 debounce로 서버에 push,
// 서버에서 온 스냅샷은 loadSnapshot으로 복원하되 에코 루프를 막는다.

export interface BoardSync {
  /** 서버가 보낸 스냅샷을 보드에 적용 (적용 중 로컬 push 억제) */
  applyRemoteSnapshot: (snapshot: unknown) => void
  dispose: () => void
}

export function setupBoardSync(editor: Editor, onLocalSnapshot: (snapshot: unknown) => void): BoardSync {
  let applyingRemote = false
  let timer: ReturnType<typeof setTimeout> | null = null

  // 사용자 발생(document scope) 변경만 감지 → debounce 후 스냅샷 전송
  const unlisten = editor.store.listen(
    () => {
      if (applyingRemote) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => onLocalSnapshot(editor.getSnapshot()), 500)
    },
    { source: 'user', scope: 'document' },
  )

  return {
    applyRemoteSnapshot(snapshot) {
      applyingRemote = true
      try {
        editor.loadSnapshot(snapshot as Parameters<Editor['loadSnapshot']>[0])
      } finally {
        applyingRemote = false
      }
    },
    dispose() {
      unlisten()
      if (timer) clearTimeout(timer)
    },
  }
}
