import { createTLSchema, defaultShapeSchemas, defaultBindingSchemas } from '@tldraw/tlschema'

// 테스트 공용 보드 픽스처. MVP1(레거시 TLEditorSnapshot) 형식 —
// 실제 tldraw가 저장하는 것과 같은 골격 + 현재 버전의 정상 serialized schema
// (스키마가 가짜면 room 로드 시 migration-error가 난다 — sync-room.test에서 배운 사실).

export function richText(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

export function legacyBoardFixture(
  opts: { frameTitle?: string; text?: string; extraStore?: Record<string, unknown> } = {},
) {
  const frameTitle = opts.frameTitle ?? '로그인 화면'
  const text = opts.text ?? '이메일과 비밀번호'
  return {
    document: {
      store: {
        'document:document': { gridSize: 10, name: '', meta: {}, id: 'document:document', typeName: 'document' },
        'page:p1': { meta: {}, id: 'page:p1', name: 'Page 1', index: 'a1', typeName: 'page' },
        'shape:frame1': {
          x: 100, y: 100, rotation: 0, isLocked: false, opacity: 1, meta: {},
          id: 'shape:frame1', type: 'frame', parentId: 'page:p1', index: 'a1',
          props: { w: 300, h: 200, name: frameTitle, color: 'black' },
          typeName: 'shape',
        },
        'shape:t1': {
          x: 120, y: 140, rotation: 0, isLocked: false, opacity: 1, meta: {},
          id: 'shape:t1', type: 'text', parentId: 'shape:frame1', index: 'a1',
          props: {
            color: 'black', size: 'm', w: 100, font: 'draw', textAlign: 'start',
            autoSize: true, scale: 1, richText: richText(text),
          },
          typeName: 'shape',
        },
        ...(opts.extraStore ?? {}),
      },
      schema: createTLSchema({ shapes: defaultShapeSchemas, bindings: defaultBindingSchemas }).serialize(),
    },
    session: {},
  }
}
