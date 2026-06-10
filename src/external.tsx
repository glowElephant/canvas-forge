import { useEffect } from 'react'
import {
  AssetRecordType,
  createShapeId,
  defaultHandleExternalFileContent,
  getHashForString,
  toRichText,
  useEditor,
  useToasts,
  useTranslation,
  type TLAsset,
} from 'tldraw'
import { ASSETS_PATH } from '../shared/protocol'

// 외부 콘텐츠 핸들러 (MVP3a):
//  - 파일 드롭: 이미지/영상은 tldraw 기본(업로드→image shape), 텍스트류는 업로드 후 "파일 카드"(meta.cfFile)
//  - URL 붙여넣기: /api/unfurl로 제목·설명·썸네일을 채운 bookmark asset
// <Tldraw> 자식으로 렌더해야 함 (toasts/번역 컨텍스트 필요).

const TEXT_EXTENSIONS = new Set([
  'json', 'xml', 'yml', 'yaml', 'md', 'txt', 'csv', 'tsv', 'js', 'ts', 'tsx', 'jsx',
  'html', 'css', 'py', 'java', 'cs', 'go', 'rs', 'sh', 'toml', 'ini', 'env', 'log', 'sql',
])

function isTextLike(file: File): boolean {
  if (file.type.startsWith('text/')) return true
  if (/^application\/(json|xml|x-yaml|yaml|toml)/.test(file.type)) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return TEXT_EXTENSIONS.has(ext)
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function ExternalHandlers() {
  const editor = useEditor()
  const toasts = useToasts()
  const msg = useTranslation()

  useEffect(() => {
    // 파일 드롭/붙여넣기
    editor.registerExternalContentHandler('files', async (content) => {
      const { files, point } = content
      const textFiles = files.filter(isTextLike)
      const mediaFiles = files.filter((f) => !isTextLike(f))

      if (mediaFiles.length > 0) {
        await defaultHandleExternalFileContent(editor, { files: mediaFiles, point }, { toasts, msg })
      }

      const at = point ?? editor.getViewportPageBounds().center
      let offset = 0
      for (const file of textFiles) {
        const uploadName = `file-${Date.now().toString(36)}-${sanitize(file.name)}`
        const res = await fetch(`${ASSETS_PATH}/${encodeURIComponent(uploadName)}`, { method: 'PUT', body: file })
        if (!res.ok) {
          toasts.addToast({ title: `업로드 실패: ${file.name}`, severity: 'error' })
          continue
        }
        editor.createShape({
          id: createShapeId(),
          type: 'note',
          x: at.x + offset,
          y: at.y,
          meta: { cfFile: { file: uploadName, name: file.name, mime: file.type || 'text/plain' } },
          props: { richText: toRichText(`📄 ${file.name}`), color: 'blue' },
        })
        offset += 240
      }
    })

    // URL 붙여넣기 → bookmark asset 메타데이터 채우기
    editor.registerExternalAssetHandler('url', async ({ url }) => {
      let meta = { title: '', description: '', image: '', favicon: '' }
      try {
        const res = await fetch(`/api/unfurl?url=${encodeURIComponent(url)}`)
        if (res.ok) meta = { ...meta, ...((await res.json()) as Partial<typeof meta>) }
      } catch {
        // 메타데이터 실패해도 북마크 자체는 생성
      }
      const asset: TLAsset = {
        id: AssetRecordType.createId(getHashForString(url)),
        typeName: 'asset',
        type: 'bookmark',
        meta: {},
        props: { src: url, title: meta.title, description: meta.description, image: meta.image, favicon: meta.favicon },
      }
      return asset
    })
  }, [editor, toasts, msg])

  return null
}
