import fs from 'node:fs/promises'
import path from 'node:path'

// board.json 영속. 브라우저가 보낸 tldraw 스냅샷을 디스크에 저장하고 시작 시 복원한다.

/** 스냅샷을 board.json에 저장 (디렉토리 자동 생성, atomic write) */
export async function saveBoard(file: string, snapshot: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(snapshot), 'utf8')
  await fs.rename(tmp, file)
}

/** board.json 로드. 파일이 없으면 null */
export async function loadBoard(file: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}
