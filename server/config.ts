import { fileURLToPath } from 'node:url'
import path from 'node:path'

// 절대경로 하드코딩 금지 — 이 파일 위치(server/) 기준으로 프로젝트 루트를 잡는다.
const here = path.dirname(fileURLToPath(import.meta.url))
export const projectRoot = path.resolve(here, '..')

/** 빌드된 프론트 정적 파일 디렉토리 */
export const distDir = path.join(projectRoot, 'dist')

/** 호스트 로컬 보드 데이터 루트 (.board/) */
export const boardDir = path.join(projectRoot, '.board')

/** board.json 경로 */
export const boardFile = path.join(boardDir, 'board.json')

/** read_area가 렌더한 프레임 PNG 저장 루트 (.board/exports/<area-id>/area.png) */
export const exportsDir = path.join(boardDir, 'exports')

/** 기본 포트 (환경변수 PORT로 덮어쓰기 가능) */
export const defaultPort = Number(process.env.PORT) || 4317
