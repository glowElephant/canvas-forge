import fs from 'node:fs/promises'
import path from 'node:path'
import { ASSETS_PATH } from '../shared/protocol.ts'

// read_area의 멀티모달 확장 (MVP3a).
// 앞부분은 순수 함수(스냅샷 → 영역 내 모달리티 목록), 뒷부분은 IO(디스크/URL 읽기).

interface AnyRecord {
  id: string
  typeName?: string
  type?: string
  parentId?: string
  meta?: Record<string, unknown>
  props?: Record<string, unknown>
}

export interface AreaModalities {
  /** 업로드된 래스터 이미지 (png/jpg/gif/webp) — uploads 상대 파일명 */
  images: Array<{ name: string; mime: string; file: string }>
  /** SVG — 이미지가 아니라 소스 텍스트로 전달 */
  svgs: Array<{ name: string; file: string }>
  /** 외부 URL 이미지 (디스크에 없음 — URL만 안내) */
  externalImages: Array<{ name: string; url: string }>
  /** 텍스트 파일 카드 (meta.cfFile) */
  files: Array<{ name: string; mime: string; file: string }>
  /** PDF 파일 카드 (meta.cfFile, mime=application/pdf) */
  pdfs: Array<{ name: string; file: string }>
  /** 링크 (bookmark/embed) */
  links: Array<{ url: string; title: string }>
  /** 보드 내 위치 북마크 핀 (meta.cfGoto) — 다른 영역 참조 */
  gotoPins: Array<{ targetId: string }>
}

/** /uploads/<name> 형태의 src에서 uploads 상대 파일명 추출. 아니면 null */
function uploadsFile(src: unknown): string | null {
  if (typeof src !== 'string') return null
  const prefix = ASSETS_PATH + '/'
  if (!src.startsWith(prefix) && !src.includes(`${prefix}`)) return null
  const idx = src.indexOf(prefix)
  return decodeURIComponent(src.slice(idx + prefix.length).split('?')[0])
}

/** 프레임 직속 자식들에서 모달리티 추출 (areas.ts와 동일한 입력: { store }) */
export function extractAreaModalities(
  input: { store: Record<string, unknown> },
  areaId: string,
): AreaModalities {
  const store = input.store as Record<string, AnyRecord>
  const out: AreaModalities = { images: [], svgs: [], externalImages: [], files: [], pdfs: [], links: [], gotoPins: [] }

  for (const r of Object.values(store)) {
    if (r?.typeName !== 'shape' || r.parentId !== areaId) continue
    const props = r.props ?? {}

    // 위치 북마크 핀 (meta.cfGoto)
    const cfGoto = r.meta?.cfGoto as { targetId?: string } | undefined
    if (cfGoto?.targetId) {
      out.gotoPins.push({ targetId: cfGoto.targetId })
      continue
    }

    // 파일 카드 (어느 shape든 meta.cfFile) — PDF는 별도 분류
    const cfFile = r.meta?.cfFile as { file?: string; name?: string; mime?: string } | undefined
    if (cfFile?.file) {
      if (cfFile.mime === 'application/pdf') {
        out.pdfs.push({ file: cfFile.file, name: cfFile.name ?? cfFile.file })
      } else {
        out.files.push({ file: cfFile.file, name: cfFile.name ?? cfFile.file, mime: cfFile.mime ?? 'text/plain' })
      }
      continue
    }

    if (r.type === 'image') {
      const asset = store[props.assetId as string]
      const ap = asset?.props ?? {}
      const name = (ap.name as string) || '이미지'
      const mime = (ap.mimeType as string) || ''
      const file = uploadsFile(ap.src)
      if (!file) {
        if (typeof ap.src === 'string' && ap.src.startsWith('http')) out.externalImages.push({ name, url: ap.src })
        continue
      }
      if (mime === 'image/svg+xml') out.svgs.push({ name, file })
      else if (/^image\/(png|jpeg|gif|webp)$/.test(mime)) out.images.push({ name, mime, file })
      continue
    }

    if (r.type === 'bookmark') {
      const asset = store[props.assetId as string]
      const ap = asset?.props ?? {}
      const url = (ap.src as string) || ''
      if (url) out.links.push({ url, title: (ap.title as string) || '' })
      continue
    }

    if (r.type === 'embed') {
      const url = props.url as string
      if (url) out.links.push({ url, title: '' })
    }
  }
  return out
}

// ---------- IO ----------

/** uploads 디렉토리에서 파일 읽기 (경로 탈출 차단). 없으면 null */
export async function readUpload(assetsDir: string, file: string): Promise<Buffer | null> {
  const full = path.resolve(assetsDir, file)
  if (full !== assetsDir && !full.startsWith(assetsDir + path.sep)) return null
  try {
    return await fs.readFile(full)
  } catch {
    return null
  }
}

const FETCH_TIMEOUT_MS = 8000
const FETCH_MAX_BYTES = 1024 * 1024

async function fetchHtml(url: string): Promise<string> {
  const u = new URL(url)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('http(s)만 지원')
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': 'canvas-forge/0.3 (+local board tool)' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ct = res.headers.get('content-type') ?? ''
  if (!/text\/html|text\/plain|application\/xhtml/.test(ct)) throw new Error(`본문 추출 불가 형식: ${ct}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return buf.subarray(0, FETCH_MAX_BYTES).toString('utf8')
}

/** HTML → 평문 발췌 (태그/스크립트 제거) */
export function htmlToText(html: string, maxChars = 3000): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > maxChars ? text.slice(0, maxChars) + ' …(잘림)' : text
}

/** 링크 본문을 텍스트로 (read_area용) */
export async function fetchLinkText(url: string, maxChars = 3000): Promise<string> {
  return htmlToText(await fetchHtml(url), maxChars)
}

/** PDF 버퍼에서 텍스트 추출 (unpdf = pdf.js, worker 불필요) */
export async function extractPdfText(buf: Buffer, maxChars = 16000): Promise<string> {
  const { getDocumentProxy, extractText } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buf))
  const { text } = await extractText(pdf, { mergePages: true })
  const t = (text as string).replace(/\s+/g, ' ').trim()
  return t.length > maxChars ? t.slice(0, maxChars) + ' …(잘림)' : t
}

export interface Unfurled {
  title: string
  description: string
  image: string
  favicon: string
}

function metaContent(html: string, patterns: RegExp[]): string {
  for (const p of patterns) {
    const m = html.match(p)
    if (m?.[1]) return m[1].trim()
  }
  return ''
}

/** URL의 og 메타데이터 파싱 (bookmark 카드 표시용) */
export async function unfurl(url: string): Promise<Unfurled> {
  const html = await fetchHtml(url)
  const og = (prop: string) => [
    new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:${prop}["']`, 'i'),
  ]
  return {
    title: metaContent(html, [...og('title'), /<title[^>]*>([^<]*)<\/title>/i]),
    description: metaContent(html, [
      ...og('description'),
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    ]),
    image: metaContent(html, og('image')),
    favicon: metaContent(html, [/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']*)["']/i]),
  }
}
