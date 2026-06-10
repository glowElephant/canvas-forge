# canvas-forge

무한 캔버스 협업 기획툴 + Claude가 MCP로 붙어 보드 영역을 읽고 기획→구현하는 도구.

**핵심 원칙: 안 붙이면 기획툴, Claude를 붙이면 기획+구현툴.** 보드앱은 그 자체로 동작하는 화이트보드다. Claude는 MCP로 "붙는다".

## 운영 모델

서버리스 / 호스트 초대 / 비상업. 중앙 서버·과금 없이 호스트가 자기 머신에서 보드를 열고 사람을 초대한다. 데이터는 호스트 로컬에 남는다.

## 아키텍처

- **프론트**: React + tldraw + Vite. 무한 캔버스, 텍스트/이미지/그림 객체, 프레임, 영역 선택 전부 tldraw 기본.
- **호스트 로컬 서버**: Node. 보드 상태 영속(`.board/board.json`) + 이미지 export + MCP 서버 노출. 브라우저 단독으론 로컬 파일/Claude Code 접근 불가라 이 서버가 다리.
- **MCP 서버** (Claude가 붙는 인터페이스): `list_areas` / `read_area(area_id)`(텍스트+스크린샷 멀티모달) / `post_card(area_id, markdown)`.
- **영역 = tldraw 프레임**. 방장이 프레임을 그리고 제목을 달면 그게 한 구역. 별도 구획 시스템을 만들지 않는다.

## MVP 단계

- **MVP1 (완료)** — Claude 브릿지 루프: 프레임 영역 지정 + Claude가 MCP로 붙어 `read_area`→`post_card`→승인→빌드. 실 브라우저 검증 완료.
- **MVP2 (완료)** — 실시간 협업: N명 동시접속, 멀티커서, **호스트 허브 WS 동기화(`@tldraw/sync` 공식)**. ※ 당초 "Yjs+WebRTC P2P"는 시그널링/TURN이 필요해 서버리스가 아니라서 기각 — 호스트가 이미 WS 서버이므로 허브 방식 채택.
- **MVP3 (다음)** — 음성·풍부한 멀티모달.

## 가드레일 (하지 말 것)

- **실시간 멀티유저·음성을 MVP1에 넣지 말 것.** 차별점(Claude가 보드를 읽는 루프)을 먼저 증명한다. 멀티유저부터 만들면 제일 큰 리스크를 늦게 확인하게 된다.
- **트리거 (나)** — 보드 버튼이 Claude를 능동적으로 깨우는 방식은 폴링/큐가 필요해 MVP1에서 제외. MVP1은 호스트가 Claude 세션에서 직접 호출(트리거 가).
- **절대 경로 하드코딩 금지.** `__dirname`/상대경로/환경변수 사용.
- MCP는 보드 읽기·쓰기까지만. 실제 파일 빌드는 Claude Code 기본 도구로.

## 구현 (MVP2, 동작 중)

**명령:** `npm install` → `npm run build`(프론트→dist/) → `npm run host`(호스트 프로세스, 기본 포트 4317). 테스트 `npm test`(vitest, 서버만). 타입체크 `npx tsc -p tsconfig.json --noEmit`(프론트) / `-p tsconfig.server.json`(서버).

**구조 (보드의 진실의 출처 = 서버의 `TLSocketRoom`):**
- `shared/protocol.ts` — `/ws` export 브리지 메시지 타입 + 경로 상수(`SYNC_PATH`/`WS_PATH`/`MCP_PATH`/`ASSETS_PATH`) 단일 출처.
- `server/` — `config.ts`(경로/포트, 절대경로 금지), `sync-room.ts`(**TLSocketRoom 생성 + board.json 영속·마이그레이션 + `roomToAreasInput`**), `cards.ts`(post_card 서버측 쓰기), `board.ts`(파일 r/w), `areas.ts`(스냅샷→list/read, **순수 함수**), `ws-bridge.ts`(export 전용), `mcp.ts`(3도구, room에서 읽음), `host.ts`(엔트리: 정적 + `/sync` + `/ws` + `/mcp` + `/uploads` 한 프로세스).
- `src/` — `App.tsx`(이름 게이트→`useSync`→`<Tldraw store>`), `ws-client.ts`(export 응답 전용, 자동 재연결).

**재발견 방지 — 검증된 사실(설치본 기준):**
- MCP SDK 1.29: HTTP 트랜스포트 클래스명은 `StreamableHTTPServerTransport`(context7가 알려준 `Node...` 접두사는 틀림). import `@modelcontextprotocol/sdk/server/streamableHttp.js`. stateful 세션(`mcp-session-id` 헤더)으로 구현 — Claude Code HTTP 클라이언트가 GET(SSE)도 열기 때문에 stateless보다 안전.
- tldraw 3.15: PNG는 `editor.toImage([shapeId], {format:'png', background:true})`→`{blob}` (브라우저 전용 → `/ws` 브리지로 왕복). 프레임=`type:'frame'`·제목=`props.name`, 텍스트=`props.richText`(ProseMirror JSON).
- **@tldraw/sync 3.15.6 (tldraw와 동일 버전 필수):** 서버 `TLSocketRoom<TLRecord, void>` — opts `{ initialSnapshot: RoomSnapshot|TLStoreSnapshot, onDataChange, schema }`, 메서드 `handleSocketConnect({sessionId, socket})`(ws의 WebSocket 그대로), `getCurrentSnapshot()`, `updateStore(s => s.put(record))`(서버측 쓰기 — post_card가 브라우저 없이 동작하는 근거). 클라 `useSync({uri, assets, userInfo})`가 `?sessionId=`를 자동으로 붙임. 스키마는 `createTLSchema({shapes: defaultShapeSchemas, bindings: defaultBindingSchemas})`(`@tldraw/tlschema`, 서버 안전).
- `RoomSnapshot = {clock, documents:[{state,...}]}` — areas.ts 입력으로 쓰려면 `roomToAreasInput`으로 `{store}` 변환. board.json은 신규(RoomSnapshot)·레거시(MVP1 TLEditorSnapshot, `document`를 initialSnapshot으로) 겸용 로드.
- **테스트 픽스처에 가짜 schema 금지** — `{schemaVersion:2, sequences:{}}` 같은 가짜를 넣으면 room 로드 시 `migration-error`. 반드시 `createTLSchema(...).serialize()` 사용 (`server/__tests__/fixtures.ts`).
- **`/assets` 경로 충돌 주의** — vite 번들이 `/assets/`를 쓰므로 업로드 경로는 `/uploads`(ASSETS_PATH). 겹치면 JS 404로 빈 페이지.
- note shape를 서버에서 만들 땐 props 전부 필요: `{color, labelColor, size, font, fontSizeAdjustment, align, verticalAlign, growY, url, richText, scale}` + `index: getIndexAbove(...)`(`@tldraw/utils`), `createShapeId`/`toRichText`(`@tldraw/tlschema`).
- read_area의 export 저장 폴더명은 area_id를 `safeName()`으로 치환(Windows `:` 금지).
- 영속은 debounce(500ms) — 종료 유실 막으려 `close()`가 flush를 await, 직접 실행 시 SIGINT/SIGTERM도 flush 후 종료. `closeAllConnections()`로 keep-alive MCP 연결 강제 종료(안 하면 종료 무기한 대기).
- `startHost({ port, boardFile, exportsDir, assetsDir })` — 경로 주입 가능. 테스트는 temp 디렉토리로 격리(실제 `.board` 오염 금지).
- 검증: `server/__tests__/` 19개(테스트: sync-room 마이그레이션·post_card / mcp.e2e / persistence-flush / degraded-mode / static-guard / board / areas). 실 브라우저 검증 스크린샷: `docs/superpowers/mvp1-loop-verified.png`, `mvp2-collab-verified.png`.

**의도된 한계(결함 아님):** 인증 없음 + `0.0.0.0` 바인딩이라 LAN의 초대된 사람이 접근 가능(스펙대로 비상업·호스트 초대). 정적 서빙·업로드는 경로 탈출만 차단. 원격(인터넷 너머) 접속은 호스트가 직접 터널/포트포워딩 해야 함.

## 참조

- 구현 계획: `docs/superpowers/plans/2026-06-09-mvp1-claude-bridge-loop.md`, `2026-06-10-mvp2-realtime-collab.md`
- 프로젝트 명세: `docs/spec.md`
- 상세 설계: `docs/superpowers/specs/2026-06-09-canvas-forge-design.md`, `2026-06-10-mvp2-realtime-collab-design.md`
- 큐레이션된 노하우: `docs/know-how/*.md` (특히 `mcp--*`, `skills--superpowers-skills-pattern`)
