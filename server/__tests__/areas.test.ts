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
    expect(areas).toEqual([{ id: 'shape:frame1', title: '로그인', picked: false }])
  })

  it('store 형태(document 없이)도 지원', () => {
    const storeOnly = { store: snapshot.document.store }
    expect(listAreas(storeOnly)).toEqual([{ id: 'shape:frame1', title: '로그인', picked: false }])
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

  it('meta.createdAt 기준 시간순 정렬 + [HH:MM 작성자] 라벨', () => {
    const t1 = new Date(2026, 5, 10, 14, 30).getTime()
    const t2 = new Date(2026, 5, 10, 14, 5).getTime() // 더 이른 시각인데 store에는 나중에 등장
    const snap = {
      store: {
        'shape:f': { id: 'shape:f', typeName: 'shape', type: 'frame', props: { name: '순서' } },
        'shape:late': {
          id: 'shape:late', typeName: 'shape', type: 'text', parentId: 'shape:f',
          meta: { createdAt: t1, createdBy: '한아' },
          props: { richText: richText('나중 의견: 이전 안 뒤집음') },
        },
        'shape:early': {
          id: 'shape:early', typeName: 'shape', type: 'text', parentId: 'shape:f',
          meta: { createdAt: t2, createdBy: '게스트' },
          props: { richText: richText('처음 의견') },
        },
      },
    }
    const content = readArea(snap, 'shape:f')!
    expect(content.shapes.map((s) => s.id)).toEqual(['shape:early', 'shape:late'])
    expect(content.text.indexOf('처음 의견')).toBeLessThan(content.text.indexOf('나중 의견'))
    expect(content.text).toContain('[14:05 게스트] 처음 의견')
    expect(content.text).toContain('[14:30 한아] 나중 의견')
  })
})

describe('listAreas 지정(★)', () => {
  it('meta.cfClaudePick이 picked로 노출된다', () => {
    const snap = {
      store: {
        'shape:a': { id: 'shape:a', typeName: 'shape', type: 'frame', meta: { cfClaudePick: true }, props: { name: '지정됨' } },
        'shape:b': { id: 'shape:b', typeName: 'shape', type: 'frame', props: { name: '일반' } },
      },
    }
    const areas = listAreas(snap)
    expect(areas.find((a) => a.id === 'shape:a')!.picked).toBe(true)
    expect(areas.find((a) => a.id === 'shape:b')!.picked).toBe(false)
  })
})
