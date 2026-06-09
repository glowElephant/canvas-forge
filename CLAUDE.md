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

- **MVP1 (현재)** — Claude 브릿지 루프: 단일 호스트 + 프레임 영역 지정 + Claude가 MCP로 붙어 `read_area`→`post_card`→승인→빌드. 이 루프 하나를 끝까지 동작시키는 게 목표.
- **MVP2** — 실시간 협업: N명 동시접속, 멀티커서, 서버리스 P2P 동기화(Yjs + WebRTC).
- **MVP3** — 음성·풍부한 멀티모달.

## 가드레일 (하지 말 것)

- **실시간 멀티유저·음성을 MVP1에 넣지 말 것.** 차별점(Claude가 보드를 읽는 루프)을 먼저 증명한다. 멀티유저부터 만들면 제일 큰 리스크를 늦게 확인하게 된다.
- **트리거 (나)** — 보드 버튼이 Claude를 능동적으로 깨우는 방식은 폴링/큐가 필요해 MVP1에서 제외. MVP1은 호스트가 Claude 세션에서 직접 호출(트리거 가).
- **절대 경로 하드코딩 금지.** `__dirname`/상대경로/환경변수 사용.
- MCP는 보드 읽기·쓰기까지만. 실제 파일 빌드는 Claude Code 기본 도구로.

## 구현 (MVP1, 동작 중)

**명령:** `npm install` → `npm run build`(프론트→dist/) → `npm run host`(호스트 프로세스, 기본 포트 4317). 테스트 `npm test`(vitest, 서버만). 타입체크 `npx tsc -p tsconfig.json --noEmit`(프론트) / `-p tsconfig.server.json`(서버).

**구조:**
- `shared/protocol.ts` — 브라우저↔서버 WS 메시지 타입(`ClientMsg`/`ServerMsg`) 단일 출처.
- `server/` — `config.ts`(경로/포트, `__dirname` 기반·절대경로 금지), `board.ts`(board.json 영속), `areas.ts`(스냅샷→list/read 추출, **순수 함수**), `ws-bridge.ts`(브라우저 WS: requestExport/pushCard), `mcp.ts`(3도구), `host.ts`(엔트리: 정적+MCP HTTP+WS 한 프로세스).
- `src/` — `App.tsx`(`<Tldraw onMount>`), `board-sync.ts`(스냅샷 동기화·에코 루프 방지), `ws-client.ts`(export 응답·카드 삽입).

**재발견 방지 — 검증된 사실(설치본 기준):**
- MCP SDK 1.29: HTTP 트랜스포트 클래스명은 `StreamableHTTPServerTransport`(context7가 알려준 `Node...` 접두사는 틀림). import `@modelcontextprotocol/sdk/server/streamableHttp.js`. stateful 세션(`mcp-session-id` 헤더)으로 구현 — Claude Code HTTP 클라이언트가 GET(SSE)도 열기 때문에 stateless보다 안전.
- tldraw 3.15: PNG는 `editor.toImage([shapeId], {format:'png', background:true})`→`{blob}` (브라우저 전용 → 옵션 A로 WS 왕복). 영속 `editor.getSnapshot()`/`loadSnapshot()`. 스냅샷 구조 `{document:{store:Record<id,rec>}, session}`. 프레임=`type:'frame'`·제목=`props.name`, 텍스트=`props.richText`(ProseMirror JSON). `createShapeId`/`toRichText`는 `'tldraw'`에서 import.
- read_area의 export 저장 폴더명은 area_id를 `safeName()`으로 치환(Windows `:` 금지).
- 영속은 debounce(500ms) 저장 — 종료 시 유실 막으려 `close()`가 `flushSave()`를 await하고, 직접 실행 시 SIGINT/SIGTERM도 flush 후 종료. `close()`는 `closeAllConnections()`로 keep-alive MCP 연결을 강제 종료(안 하면 종료가 무기한 대기). 브라우저도 `pagehide`/`visibilitychange(hidden)`에 마지막 스냅샷을 즉시 전송.
- **init 핸드셰이크(중요)**: 서버는 연결 직후 `{t:'init', snapshot}`을 1회 보낸다. 브라우저는 init을 받기 전에 절대 자기 상태를 push하지 않는다 — 안 그러면 새 탭(빈 보드)이 연결되며 저장된 보드를 빈 상태로 덮어쓴다(데이터 유실). 서버가 진실의 출처. init.snapshot이 null(서버 보드 없음)일 때만 브라우저가 자기 shape를 올린다.
- `startHost({ port, boardFile, exportsDir })` — 경로 주입 가능. 테스트는 temp 디렉토리로 격리(실제 `.board` 오염 금지).
- 검증: `server/__tests__/`의 mcp.e2e(전체 MCP 루프) + persistence-flush(종료 시 저장) + board/areas 단위. 실 브라우저 검증은 `docs/superpowers/mvp1-loop-verified.png` 참고.

**MVP1 의도된 한계(결함 아님):** 단일 탭 가정 — 탭 여러 개를 동시에 열면 마지막 연결이 활성 클라이언트가 되고 스냅샷이 서로 덮어쓸 수 있다(다중 클라이언트 동기화는 MVP2 Yjs 몫). 인증 없음 + `0.0.0.0` 바인딩이라 LAN의 초대된 사람이 접근 가능(스펙대로 비상업·호스트 초대). 정적 서빙은 경로 탈출만 차단.

## 참조

- 구현 계획: `docs/superpowers/plans/2026-06-09-mvp1-claude-bridge-loop.md`
- 프로젝트 명세: `docs/spec.md`
- 상세 설계: `docs/superpowers/specs/2026-06-09-canvas-forge-design.md`
- 큐레이션된 노하우: `docs/know-how/*.md` (특히 `mcp--*`, `skills--superpowers-skills-pattern`)
