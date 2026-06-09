import { describe, it, expect } from 'vitest'
import { listAreas, readArea } from '../areas.ts'

// 가짜 tldraw 스냅샷: 프레임 1개(제목 "로그인") + 그 안 텍스트 2개 + 프레임 밖 텍스트 1개
function richText(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

const snapshot = {
  document: {
    store: {
      'page:p1': { id: 'page:p1', typeName: 'page', name: 'Page 1' },
      'shape:frame1': {
        id: 'shape:frame1',
        typeName: 'shape',
        type: 'frame',
        parentId: 'page:p1',
        props: { name: '로그인', w: 400, h: 300 },
      },
      'shape:t1': {
        id: 'shape:t1',
        typeName: 'shape',
        type: 'text',
        parentId: 'shape:frame1',
        props: { richText: richText('이메일 입력') },
      },
      'shape:t2': {
        id: 'shape:t2',
        typeName: 'shape',
        type: 'text',
        parentId: 'shape:frame1',
        props: { richText: richText('비밀번호 입력') },
      },
      'shape:outside': {
        id: 'shape:outside',
        typeName: 'shape',
        type: 'text',
        parentId: 'page:p1',
        props: { richText: richText('프레임 밖 메모') },
      },
    },
  },
  session: {},
}

describe('listAreas', () => {
  it('프레임만 영역으로 추출하고 제목은 props.name', () => {
    const areas = listAreas(snapshot)
    expect(areas).toEqual([{ id: 'shape:frame1', title: '로그인' }])
  })

  it('store 형태(document 없이)도 지원', () => {
    const storeOnly = { store: snapshot.document.store }
    expect(listAreas(storeOnly)).toEqual([{ id: 'shape:frame1', title: '로그인' }])
  })

  it('빈/이상한 입력은 빈 배열', () => {
    expect(listAreas(null)).toEqual([])
    expect(listAreas({})).toEqual([])
  })
})

describe('readArea', () => {
  it('프레임 직속 자식 텍스트만 모은다 (밖 메모 제외)', () => {
    const content = readArea(snapshot, 'shape:frame1')
    expect(content).not.toBeNull()
    expect(content!.title).toBe('로그인')
    expect(content!.shapes.map((s) => s.id).sort()).toEqual(['shape:t1', 'shape:t2'])
    expect(content!.text).toContain('이메일 입력')
    expect(content!.text).toContain('비밀번호 입력')
    expect(content!.text).not.toContain('프레임 밖 메모')
  })

  it('없는 areaId면 null', () => {
    expect(readArea(snapshot, 'shape:nope')).toBeNull()
  })

  it('프레임이 아닌 id면 null', () => {
    expect(readArea(snapshot, 'shape:t1')).toBeNull()
  })
})
