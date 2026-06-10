# MVP3c(영상) — 댓글·시간 태그 기반 영상 읽기 설계

- 날짜: 2026-06-10
- 상태: 설계 승인 (구현 진행)
- 사용자 제안 채택: 자동 프레임 샘플링(ffmpeg) 대신 **사람이 댓글로 큐레이션한 시간대만** Claude가 분석한다.

## 1. 핵심 아이디어 (사용자 제안)

유튜브 댓글처럼 — 영상에 댓글을 달고, 댓글에 시간 라벨을 붙여 의견을 공유한다. Claude는 **시간 태그된 순간의 프레임 + 그 댓글들**만 받아 맥락과 함께 분석한다.

장점: ① 중요한 장면을 사람이 고름(샘플링은 장님 뽑기) ② 댓글=맥락 ③ **ffmpeg 불필요** — 특정 시간 프레임 1장은 브라우저가 `<video>` seek + canvas로 뽑는다(기존 export 브리지 패턴 확장, 서버 의존성 0).

## 2. 설계

- **올리기**: tldraw 기본 video shape (mp4/webm, 업로드는 기존 `/uploads`).
- **댓글 저장**: video shape의 `meta.cfComments = [{ t?: number(초), author, text }]` — meta 패턴이라 스키마 변경 없음, sync로 전 참여자 실시간 공유.
- **댓글 UI**: 영상 shape 선택 시 우측에 댓글 패널 — 목록(시간순) + 입력 + "⏱ 현재 시간" 토글(보드의 재생 시점 캡처, DOM `[data-shape-id] video`에서 currentTime). 시간 칩 클릭 → 영상이 그 시점으로 seek.
- **Claude 읽기**: `read_area`가 video shape를 만나면 — 시간 태그 댓글마다 WS 브리지 `requestVideoFrame(shapeId, t)` → 브라우저가 offscreen `<video>`를 t로 seek해 canvas 캡처 → PNG. 응답: `[영상 'name' t=1:23 — 작성자: "댓글"]` + 프레임 이미지. 시간 없는 댓글은 텍스트만. 탭 미연결이면 댓글 텍스트만 + 생략 안내.
- 제한: 영상 3개/영역, 태그 댓글 6개/영상. 캡처 폭 최대 1280px.

## 3. 구조 변화

```
shared/protocol.ts      ServerMsg에 requestVideoFrame 추가 (응답은 기존 exportResult/exportError 재사용)
server/ws-bridge.ts     requestVideoFrame() 추가 (pending 매칭 공통화)
server/modalities.ts    videos 추출 (asset 파일명 + cfComments)
server/mcp.ts           read_area 영상 파트
src/ws-client.ts        requestVideoFrame 핸들러 (offscreen video seek→canvas 캡처)
src/VideoCommentPanel.tsx [신규] 댓글 패널
scripts/verify-video.mjs  [신규] 헤드리스 검증 — 브라우저가 MediaRecorder로 webm을 직접 만들어 드롭
```

크로스 프로젝트 북마크는 별도 설계 필요 — 이번 범위에서 제외(잔여 3c).
