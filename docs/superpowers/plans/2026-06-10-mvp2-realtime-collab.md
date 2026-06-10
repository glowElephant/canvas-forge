# MVP2 — 실시간 협업 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** N명 동시접속 + 멀티커서 실시간 동기화. 호스트 허브 WS + `@tldraw/sync` 공식. MCP 루프는 다중 사용자에서도 동작, `post_card`는 브라우저 없이도 동작하게 격상.

**Architecture:** 호스트 프로세스에 `/sync` WS 엔드포인트 추가 — `TLSocketRoom`(서버 권위 store)이 동기화·충돌 해결. 영속은 room 스냅샷을 debounce 저장+종료 flush. MCP는 room에서 직접 읽고, `post_card`는 `room.updateStore()`로 서버측 직접 쓰기. `/ws` 브리지는 PNG export 전용으로 축소(브라우저만 렌더 가능). `board-sync.ts`·init 핸드셰이크 삭제(공식 sync가 대체).

**Tech Stack:** `@tldraw/sync`/`@tldraw/sync-core` **3.15.6 (tldraw와 동일 버전, 설치됨)**, 기존 스택 유지.

---

## 설치본(3.15.6) 검증된 API — 재발견 방지

- `TLSocketRoom` 생성자 opts: `{ initialSnapshot?: RoomSnapshot | TLStoreSnapshot, onDataChange?(), schema?, onSessionRemoved?, clientTimeout? }`
- 메서드: `handleSocketConnect({ sessionId, socket })`(ws의 WebSocket 그대로 가능), `getCurrentSnapshot(): RoomSnapshot`, `loadSnapshot()`, `updateStore(updater)`(서버측 쓰기: `store.getAll()/get/put/delete`), `getNumActiveSessions()`, `close()`
- `RoomSnapshot = { clock, documents: [{ state, lastChangedClock }], tombstones?, schema? }` — areas.ts 입력으로 쓰려면 `{ store: Object.fromEntries(documents.map(d => [d.state.id, d.state])) }`로 변환
- `useSync({ uri, assets, userInfo })` — uri에 `?sessionId=<TAB_ID>&storeId=` 쿼리를 **자동으로 붙임**(서버는 query에서 sessionId를 읽음). `sessionId`/`storeId`는 예약 쿼리명
- 스키마: `createTLSchema({ shapes: defaultShapeSchemas, bindings: defaultBindingSchemas })` — `@tldraw/tlschema`에서 import (React 무관, 서버 안전)
- note shape props 전체(검증 통과용): `{ color, labelColor, size, font, fontSizeAdjustment, align, verticalAlign, growY, url, richText, scale }`
- fractional index: `getIndexAbove(below?)` — `@tldraw/utils`
- `createShapeId`/`toRichText` — `@tldraw/tlschema`

## 파일 구조 변화

```
server/sync-room.ts      [신규] TLSocketRoom 생성 + board.json 로드(레거시 TLEditorSnapshot/신규 RoomSnapshot 겸용) + debounce 영속 + flush
server/cards.ts          [신규] post_card 서버측 쓰기 (updateStore로 note 레코드 put)
server/host.ts           [수정] /sync /ws upgrade 라우팅(noServer), /assets PUT/GET, room 배선
server/ws-bridge.ts      [수정] export 전용 축소 (snapshot/pushCard 제거)
server/mcp.ts            [수정] room 스냅샷에서 읽기, post_card → cards.ts
server/areas.ts          [유지] 입력 어댑터만 sync-room에 추가
shared/protocol.ts       [수정] ClientMsg=exportResult/exportError, ServerMsg=requestExport만
src/App.tsx              [수정] 이름 입력 게이트 + useSync + 상태 배지(sync status 기반)
src/ws-client.ts         [수정] export 응답 전용 (재연결 유지)
src/board-sync.ts        [삭제] 공식 sync가 대체
server/__tests__/        init-handshake 삭제, persistence-flush·degraded-mode·mcp.e2e를 sync 경로로 갱신
```

## Task 1: sync-room + cards (서버 코어)

- [ ] `server/sync-room.ts`: `createSyncRoom({ boardFile })` — board.json 읽어 `'clock' in saved`면 RoomSnapshot, `'document' in saved`면 레거시 TLEditorSnapshot→`saved.document`를 initialSnapshot으로. `onDataChange`→debounce(500ms) `saveBoard(boardFile, room.getCurrentSnapshot())`. `flushSave()`/`closeRoom()` 노출. 스키마는 `createTLSchema` 기본값 전달.
- [ ] `server/cards.ts`: `postCardToRoom(room, areaId, markdown)` — `updateStore`에서 frame 찾고(`type==='frame'&&id===areaId`), 부모 page·형제 max index→`getIndexAbove`, frame 오른쪽(x+w+40,y)에 note 레코드 put (위 props 전체 + `richText: toRichText(markdown)`). frame 없으면 page 원점 근처.
- [ ] 단위 테스트: 레거시 마이그레이션 로드, postCard 후 `getCurrentSnapshot`에 note 존재.
- [ ] commit

## Task 2: host 배선 + 브리지 축소 + assets

- [ ] `protocol.ts` 축소. `ws-bridge.ts`에서 snapshot/pushCard/getLatestSnapshot 제거(export 요청/응답·hasClient만).
- [ ] `host.ts`: `WebSocketServer({noServer:true})` ×2, `httpServer.on('upgrade')`에서 pathname으로 라우팅(`/sync`→`room.handleSocketConnect({sessionId: query.sessionId, socket})`, `/ws`→브리지). `/assets/<name>` PUT(스트림 저장→`.board/assets/`, safeName)·GET(서빙). close: room flush+close 포함. MCP deps: `getSnapshot: () => roomToAreasInput(room.getCurrentSnapshot())`, `postCard: (a,m) => postCardToRoom(...)`.
- [ ] `mcp.ts`: deps 교체 — post_card는 항상 서버측 쓰기(브라우저 불필요), read_area 텍스트는 room에서, PNG만 브리지.
- [ ] commit

## Task 3: 프론트

- [ ] `App.tsx`: localStorage `cf-user` 없으면 이름 입력 오버레이(색은 팔레트 랜덤). `useSync({ uri: ws(s)://host/sync, assets, userInfo })`, status별 로딩/에러/`<Tldraw store=...>`. 배지는 sync status. onMount에서 ws-client(export 전용) 연결 + window.editor.
- [ ] assets store: `upload`→`PUT /assets/<asset.id>` 후 그 URL 반환, `resolve`→`asset.props.src`.
- [ ] `board-sync.ts` 삭제, `ws-client.ts` export 전용화(재연결 유지, pagehide flush 제거 — 변경이 실시간으로 서버에 가므로 불필요).
- [ ] 타입체크+빌드. commit

## Task 4: 테스트 갱신

- [ ] `init-handshake.test.ts` 삭제(구조적으로 해소). `persistence-flush`: MCP post_card(서버 쓰기)→close→board.json(RoomSnapshot)에 note 존재로 재작성. `degraded-mode`: post_card가 **성공**으로 기대 변경, read_area 텍스트는 room에서. `mcp.e2e`: 보드 시드를 WS push 대신 boardFile 초기 파일로, mock 브라우저는 export 응답만.
- [ ] 전체 그린 확인. commit

## Task 5: 실 브라우저 검증 + 문서

- [ ] 빌드→host 기동→탭 2개: A에서 그리면 B에 실시간 반영, 멀티커서/이름표 표시, MCP list/read(PNG)/post_card(양 탭에 카드) 확인, 재시작 후 복원 확인. 스크린샷 저장.
- [ ] README(초대 방법: 같은 LAN에서 `http://<호스트IP>:4317`)·CLAUDE.md(MVP2 구조·검증 사실) 갱신. commit

## 자가 점검

- 스펙 커버: §3 아키텍처→T1/T2, §4 MCP→T2, §5 UX→T3, §7 테스트→T4/T5. 누락 없음.
- 타입 일관: areas 입력 어댑터 단일 함수(`roomToAreasInput`), 도구명 불변.
- 리스크: note 레코드 수동 구성이 스키마 검증에 걸릴 수 있음 → T1 단위 테스트에서 즉시 검출.
