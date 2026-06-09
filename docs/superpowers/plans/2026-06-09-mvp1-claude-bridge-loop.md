# MVP1 — Claude 브릿지 루프 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단일 호스트가 tldraw 보드에 자유 배치 + 프레임으로 영역 지정 + Claude가 MCP(HTTP)로 붙어 `read_area`(텍스트+PNG)→`post_card`→승인→빌드 루프를 한 바퀴 끝까지 돌린다.

**Architecture:** Node **단일 프로세스**가 ① 보드 UI 정적 서빙 ② 브라우저와 WebSocket ③ `.board/board.json` 영속 ④ MCP를 Streamable HTTP로 노출을 모두 담당한다. tldraw export는 브라우저에서만 되므로(옵션 A), `read_area`는 WS로 브라우저에 export를 요청해 PNG를 받아온다. `post_card`도 WS로 브라우저에 카드 shape를 푸시한다.

**Tech Stack:** React + tldraw + Vite (프론트), Node + `ws` + `@modelcontextprotocol/sdk` (호스트 프로세스), Vitest (테스트), TypeScript + tsx.

---

## 파일 구조

```
package.json            # 루트 단일 패키지 (프론트 + 서버 의존성)
tsconfig.json           # 공통 + 프론트
tsconfig.server.json    # 서버용 (node)
vite.config.ts          # 프론트 빌드 (출력 dist/)
vitest.config.ts        # 서버 테스트
index.html              # 프론트 진입
.board/                 # 런타임 데이터 (gitignore)
  board.json
  exports/<area-id>/area.png

shared/
  protocol.ts           # 브라우저↔서버 WS 메시지 타입 (단일 출처)

server/
  config.ts             # 포트/경로 상수 (절대경로 금지, __dirname 기반)
  board.ts              # board.json load/save (영속)
  areas.ts              # 스냅샷 → list_areas / read_area 텍스트 추출 (순수 함수)
  ws-bridge.ts          # WS 서버: 연결 관리 + requestExport() + pushCard() + 스냅샷 수신
  mcp.ts               # McpServer + 3도구 등록 (areas/ws-bridge/board에 의존)
  host.ts              # 엔트리: http 서버(정적 + /mcp) + ws 서버 기동 + 배선
  __tests__/
    board.test.ts
    areas.test.ts
    mcp.e2e.test.ts     # mock 브라우저 WS로 전체 경로 검증

src/                    # 프론트엔드
  main.tsx
  App.tsx               # <Tldraw> + persistence + WS 연동 mount
  board-sync.ts         # editor ↔ 서버 스냅샷 동기화 (debounced)
  ws-client.ts          # 서버 WS 연결 + export 요청 처리 + 카드 삽입
```

**경계:** `areas.ts`는 순수 함수(스냅샷 in → 데이터 out)라 단위 테스트가 쉽다. `ws-bridge.ts`는 전송만, `mcp.ts`는 도구 정의만, `board.ts`는 디스크만 담당 — 한 파일 한 책임.

---

## WS 프로토콜 (shared/protocol.ts)

서버→브라우저 / 브라우저→서버 메시지를 한 곳에서 정의한다.

```ts
// 브라우저 → 서버
export type ClientMsg =
  | { t: 'snapshot'; snapshot: unknown }            // 보드 상태 push (영속용)
  | { t: 'exportResult'; reqId: string; pngBase64: string }
  | { t: 'exportError'; reqId: string; error: string };

// 서버 → 브라우저
export type ServerMsg =
  | { t: 'requestExport'; reqId: string; areaId: string }  // 프레임 PNG export 요청
  | { t: 'postCard'; areaId: string; markdown: string }    // 카드 shape 삽입 요청
  | { t: 'snapshot'; snapshot: unknown };                   // 초기 복원 push
```

---

## Task 1: 스캐폴드

**Files:** Create `package.json`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `.gitignore`(append), `shared/protocol.ts`

- [ ] **Step 1:** `package.json` 작성 — deps: `react`, `react-dom`, `tldraw`; devDeps: `vite`, `@vitejs/plugin-react`, `typescript`, `tsx`, `vitest`, `ws`, `@types/ws`, `@types/node`, `@modelcontextprotocol/sdk`. scripts: `dev:web`(vite), `build`(vite build), `host`(tsx server/host.ts), `test`(vitest run).
- [ ] **Step 2:** tsconfig들 + vite.config.ts(react 플러그인, build.outDir=dist) + index.html 작성.
- [ ] **Step 3:** `.gitignore`에 `node_modules/`, `dist/`, `.board/` 추가.
- [ ] **Step 4:** `shared/protocol.ts` 위 타입 작성.
- [ ] **Step 5:** `npm install` 실행해 설치 성공 확인.
- [ ] **Step 6:** 설치된 `@modelcontextprotocol/sdk`의 Streamable HTTP transport 정확한 export 경로/클래스명을 `node_modules`에서 확인(추측 금지). tldraw `toImage`/snapshot API명도 확인.
- [ ] **Step 7:** commit `feat: MVP1 스캐폴드`.

## Task 2: board 영속 (server/board.ts)

**Files:** Create `server/config.ts`, `server/board.ts`, `server/__tests__/board.test.ts`

- [ ] **Step 1 (실패 테스트):** `saveBoard(dir, snapshot)` 후 `loadBoard(dir)`가 동일 객체를 반환. 없는 dir이면 `loadBoard`는 `null`.
- [ ] **Step 2:** 실행해 실패 확인 (`npx vitest run server/__tests__/board.test.ts`).
- [ ] **Step 3:** `config.ts`에 `boardDir = path.resolve(__dirname, '..', '.board')` 등 경로 상수(절대경로 하드코딩 금지). `board.ts`에 `loadBoard`/`saveBoard`(JSON 파일 r/w, dir 자동 생성) 구현.
- [ ] **Step 4:** 테스트 통과 확인.
- [ ] **Step 5:** commit `feat: board.json 영속 라운드트립`.

## Task 3: areas 로직 (server/areas.ts)

**Files:** Create `server/areas.ts`, `server/__tests__/areas.test.ts`

`areas.ts`는 tldraw 스냅샷(store records map)을 받아 순수 함수로 처리한다.

- [ ] **Step 1 (실패 테스트):** 프레임 1개 + 그 안 텍스트 shape 2개 + 프레임 밖 shape 1개를 담은 가짜 스냅샷으로:
  - `listAreas(snapshot)` → `[{ id, title }]` 프레임만 (밖 shape 제외).
  - `readAreaText(snapshot, frameId)` → 프레임 안 텍스트 shape들의 텍스트를 합친 문자열 + shape 목록.
- [ ] **Step 2:** 실행해 실패 확인.
- [ ] **Step 3:** 구현 — 스냅샷에서 `typeName==='shape' && type==='frame'`을 영역으로, 제목은 `props.name`. 텍스트 추출은 `parentId===frameId`인 shape 중 `props.text`/`props.richText` 보유분. (정확한 richText 구조는 Task1 Step6에서 확인한 tldraw 스키마 기준.)
- [ ] **Step 4:** 테스트 통과 확인.
- [ ] **Step 5:** commit `feat: list_areas/read_area 추출 로직`.

## Task 4: WS 브리지 (server/ws-bridge.ts)

**Files:** Create `server/ws-bridge.ts`

- [ ] **Step 1:** `createWsBridge(wss)` 반환 객체: `onSnapshot(cb)`, `getLatestSnapshot()`, `requestExport(areaId): Promise<Buffer>`(reqId 발급→`requestExport` 전송→`exportResult` 매칭 resolve, timeout 시 reject), `pushCard(areaId, markdown)`, `hasClient()`.
- [ ] **Step 2:** 연결된 브라우저 ws를 보관, 메시지 라우팅(`snapshot`→저장/cb, `exportResult`/`exportError`→pending 매칭).
- [ ] **Step 3:** commit `feat: 브라우저 WS 브리지`. (단위 테스트는 Task 6 e2e에서 mock 클라이언트로 함께 검증.)

## Task 5: MCP 도구 (server/mcp.ts)

**Files:** Create `server/mcp.ts`

- [ ] **Step 1:** `buildMcpServer({ bridge, board, exportDir })` → `McpServer` 반환. 3도구 등록:
  - `list_areas` → `bridge.getLatestSnapshot()`(없으면 board.load) → `listAreas` → 텍스트 목록 반환.
  - `read_area(area_id)` → 텍스트 추출 + `bridge.requestExport(area_id)`로 PNG Buffer → `.board/exports/<id>/area.png` 저장 → content에 `{type:'text'}` + `{type:'image', data: base64, mimeType:'image/png'}` 반환. 브라우저 미연결이면 텍스트만 + 경고.
  - `post_card(area_id, markdown)` → `bridge.pushCard()` 호출 → 성공 메시지.
- [ ] **Step 2:** commit `feat: MCP 3도구`.

## Task 6: host 엔트리 + e2e 테스트 (server/host.ts, mcp.e2e.test.ts)

**Files:** Create `server/host.ts`, `server/__tests__/mcp.e2e.test.ts`

- [ ] **Step 1:** `host.ts` — http 서버: `GET /*`는 `dist/` 정적 서빙, `POST /mcp`는 Streamable HTTP transport(stateless, `sessionIdGenerator: undefined`)로 처리. 같은 http 서버에 `ws` 서버 attach(`/ws`). 스냅샷 수신 시 debounce 저장, 시작 시 board 복원해 클라이언트에 push. `startHost({port})` 형태로 export(테스트에서 재사용).
- [ ] **Step 2 (e2e 실패 테스트):** `mcp.e2e.test.ts` — `startHost`로 임의 포트 기동 → **mock 브라우저 WS 클라이언트**가 `/ws` 접속해 가짜 스냅샷(프레임+텍스트) 전송하고 `requestExport`에 작은 PNG base64로 응답하도록 핸들러 등록 → HTTP로 MCP `initialize`+`tools/list`+`tools/call(list_areas)`, `read_area`, `post_card` 호출 → 응답 검증(list_areas에 프레임 보임, read_area에 image content 포함, post_card가 mock 클라이언트에 `postCard` 도달).
- [ ] **Step 3:** 실행해 실패 → 구현/배선 → 통과.
- [ ] **Step 4:** commit `feat: host 엔트리 + MCP e2e`.

## Task 7: 프론트엔드 (src/)

**Files:** Create `src/main.tsx`, `src/App.tsx`, `src/board-sync.ts`, `src/ws-client.ts`

- [ ] **Step 1:** `App.tsx` — `<Tldraw onMount={...}>`. onMount에서 editor 확보 후 `ws-client` 연결.
- [ ] **Step 2:** `board-sync.ts` — `editor.store.listen` 변경 시 debounce로 `getSnapshot()` → WS `snapshot` 전송. 서버에서 온 `snapshot`은 `loadSnapshot()`으로 복원.
- [ ] **Step 3:** `ws-client.ts` — `requestExport` 수신 시 프레임 shape를 `editor.toImage([areaId], {format:'png', background:true})` → blob→base64 → `exportResult` 응답. `postCard` 수신 시 프레임 근처에 카드 shape(geo `rectangle` + text, 또는 note) 생성.
- [ ] **Step 4:** `npm run build`로 타입체크+번들 성공 확인.
- [ ] **Step 5:** commit `feat: 프론트 보드 + WS 연동`.

## Task 8: 통합 실행 검증 + 문서

- [ ] **Step 1:** `npm run build` (프론트) → `dist/` 생성 확인.
- [ ] **Step 2:** `npm run host` 백그라운드 기동 → `POST /mcp`로 `initialize`+`tools/list` curl/스크립트 → 3도구 노출 확인.
- [ ] **Step 3:** (가능 시) Playwright 또는 수동: 브라우저로 보드 열어 프레임+텍스트 그리고 → 실제 `read_area`가 진짜 PNG 반환하는지 확인. 불가하면 e2e(mock) 통과 + 수동 스모크 절차를 README에 기록.
- [ ] **Step 4:** README에 실행법(`npm install`→`npm run build`→`npm run host`→브라우저 열기→`claude mcp add --transport http canvas-forge http://localhost:<port>/mcp`) 작성. CLAUDE.md에 빌드/테스트 명령·구조 추가.
- [ ] **Step 5:** commit `docs: 실행법 + 구조 문서화`.

---

## 검증 기준 (spec §9 매핑)

1. 보드에 배치·프레임 묶기 → Task 7 (tldraw 기본).
2. 닫았다 열어도 복원 → Task 2 + Task 6(스냅샷 push/복원) + Task 7(board-sync).
3. `list_areas`/`read_area`로 텍스트+스크린샷 → Task 3,5,6 (+실제 PNG는 Task 7,8).
4. `post_card`로 카드 → Task 5,6,7.
5. 승인 후 Claude Code 기본 도구로 빌드 → 루프 자체는 위로 증명, 빌드는 Claude Code 수작업(MCP 범위 밖, spec대로).

## 자가 점검

- 스펙 커버리지: §3(아키텍처)→Task6/7, §4(흐름)→Task5/6/7, §5(저장구조)→Task2/5, §7(범위)→전체, §8(테스트)→Task2/3/6. 누락 없음.
- 타입 일관성: `ClientMsg`/`ServerMsg` 단일 출처(shared), 도구명 `list_areas`/`read_area`/`post_card` 통일, `area_id`=프레임 id 통일.
- 플레이스홀더: tldraw richText/snapshot/toImage·MCP transport 정확명은 Task1 Step6에서 설치본 확인 후 확정(추측으로 작성 금지).
