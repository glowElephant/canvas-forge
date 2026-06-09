# canvas-forge 설계

- 날짜: 2026-06-09
- 상태: 설계 승인 (MVP1 범위)

## 1. 비전

무한 캔버스 협업 보드 + Claude 통합. 여러 사람이 자유롭게 표현(텍스트·이미지·그림·추후 음성)하며 기획하고, 방장이 특정 영역을 지정해 Claude를 부르면 Claude가 그 난잡한 영역을 읽어 기획으로 구조화하고 구현까지 한다.

핵심 한 줄: **안 붙이면 기획툴, Claude를 붙이면 기획+구현툴.** 보드앱은 그 자체로 동작하는 화이트보드이고, Claude는 MCP로 "붙는다".

운영 모델: **서버리스 / 호스트 초대 / 비상업.** 중앙 서버·과금 없이, 호스트가 자기 머신에서 보드를 열고 사람을 초대해 같이 쓴다. 데이터는 호스트 로컬에 남는다.

## 2. 단계 분해

서로 독립적인 큰 덩어리라 쪼개서 간다. 차별점·불확실성이 가장 큰 "Claude가 보드를 읽는 루프"를 먼저 증명한다.

- **MVP1 — Claude 브릿지 루프** (이 spec의 범위): 단일 호스트가 캔버스에 자유 배치 + 프레임으로 구역 지정 + Claude가 MCP로 붙어 파악→카드 피드백→승인→빌드. 실시간 멀티유저·음성 제외.
- **MVP2 — 실시간 협업**: N명 동시접속, 멀티커서, 보드 실시간 동기화(서버리스 P2P, 예: Yjs + WebRTC). MVP1 위에 얹음.
- **MVP3 — 풍부한 멀티모달**: 음성(녹음·STT), 그 외 표현 수단 확장.

## 3. MVP1 아키텍처

두 부분으로 명확히 분리한다.

### 3.1 보드앱 (순수 기획툴)

- **프론트**: React + **tldraw** + Vite. 무한 캔버스, 텍스트/이미지/그림 객체, 프레임, 영역 선택 — 전부 tldraw 기본 제공.
- **호스트 로컬 프로세스**: Node **단일 프로세스**. 보드 UI 정적 서빙 + 브라우저와 WebSocket + `board.json` 영속 + MCP를 HTTP/SSE로 노출, 이 넷을 한 프로세스가 다 한다.
- Claude 없이도 화이트보드로 완전히 동작한다.

### 3.2 단일 프로세스 + WebSocket 브리지 (핵심 결정)

브라우저는 로컬 파일을 쓸 수도, MCP를 노출할 수도 없다. 그래서 이 둘을 잇는 로컬 프로세스가 **반드시 하나는** 필요하다. 일을 키우지 않기 위해 그 프로세스를 **정확히 하나로 통합**한다(프로세스 2개로 가는 순간 서로 찾는 배선이 생겨 일이 커진다).

- **MCP는 stdio가 아니라 HTTP/SSE 트랜스포트**로 보드 프로세스 안에 함께 노출한다. Claude Code는 URL로 붙는다(`claude mcp add --transport http ...`). stdio로 가면 Claude Code가 MCP 프로세스를 따로 띄워 보드 프로세스를 찾아 붙어야 하므로 프로세스가 2개가 된다 — 피한다.
- **브라우저↔프로세스 WebSocket 하나**에 세 가지를 모두 태운다: `board.json` 저장(스냅샷 push), `post_card` 푸시(서버→브라우저), `read_area`의 PNG export 요청/응답(서버↔브라우저 왕복).
- 호스트가 관리하는 것은 평생 **"프로세스 1개 + 브라우저 탭 1개"**가 전부다. 동작: ① `node host.js` 실행 ② 브라우저로 localhost 열기 ③ Claude Code에 MCP URL 등록.

### 3.3 MCP 도구 (Claude가 붙는 인터페이스)

- `list_areas` — 방장이 프레임으로 묶어둔 구역(주제/카테고리) 목록 반환
- `read_area(area_id)` — 그 영역의 텍스트 객체는 텍스트로, 시각 맥락은 **렌더 스크린샷(PNG)**으로 묶어 멀티모달 응답. (효율: 텍스트로 읽을 수 있는 건 텍스트, 난해한 시각은 스크린샷)
- `post_card(area_id, markdown)` — Claude의 "이거 맞나요" 정리를 보드에 **전용 카드 객체**로 추가

승인 후 실제 파일/프로젝트 생성은 Claude Code의 기본 도구(로컬 빌드)로 한다 — MCP는 보드 읽기·쓰기까지만 담당.

#### read_area의 PNG는 어떻게 얻는가 (옵션 A 채택)

tldraw의 이미지 export API는 **브라우저 DOM/Canvas 안에서만** 동작한다. MCP 서버(Node)는 직접 렌더할 수 없다. 따라서:

- Claude가 `read_area(id)` 호출 → 서버가 WebSocket으로 브라우저에 "프레임 `id` export" 요청 → 브라우저가 tldraw `exportToBlob(frame)`로 PNG 생성 → WS로 서버에 전송 → 서버가 `.board/exports/<id>/area.png`로 저장하고 MCP 응답(텍스트 + PNG)으로 반환.
- 실제 화면과 100% 일치한다. 유일한 제약은 "보드 탭이 열려 있어야 함"인데, MVP1은 단일 호스트가 방금 프레임을 그리고 Claude를 부르는 상황이라 자연스럽게 충족된다.
- 대안이던 헤드리스 브라우저(Playwright)는 무겁고 오프스크린 tldraw 부팅이 복잡해 제외. 주기적 미리 export는 `post_card` 때문에 어차피 WS가 필요하므로 옵션 A 대비 이득이 없어 제외.

### 3.4 영역 = tldraw 프레임

방장이 프레임을 그리고 제목을 달면 그게 한 구역. 프레임 안에 들어간 shapes가 그 영역의 콘텐츠. 카테고리 구획·중첩도 프레임으로 자연스럽게 표현된다. 별도 구획 시스템을 만들지 않는다. `area_id`는 프레임 shape의 id를 그대로 쓴다.

## 4. MVP1 데이터 흐름

```
[방장이 프레임으로 영역 지정]
        │
        ▼
[호스트가 Claude Code 세션에서 "그 영역 봐줘" 호출]   ← 트리거 (가)
        │
        ▼
Claude → read_area(area_id)
        │  서버: board.json에서 프레임 안 shapes 추출(텍스트)
        │  서버 →(WS)→ 브라우저: "프레임 export" 요청
        │  브라우저: tldraw exportToBlob(frame) →(WS)→ 서버: PNG 수신·저장
        ▼
Claude가 파악 → post_card(area_id, "이거 맞나요…")
        │  서버 →(WS)→ 브라우저: 카드 shape 추가 → 화면 갱신
        ▼
[방장이 카드 수정 후 재호출 | 또는 승인]
        │
        ▼
승인 시 Claude Code 기본 도구로 실제 빌드(별도 프로젝트 폴더 생성)
```

**호출 트리거 (MVP1)**: 보드에서 영역 지정 후 호스트가 Claude Code 세션에서 직접 부르면 Claude가 MCP로 집어간다(트리거 가). 보드의 "Claude 호출" 버튼이 Claude를 능동적으로 깨우는 방식(나)은 폴링/큐가 필요해 MVP2 이후로 미룬다.

## 5. 저장 구조 (호스트 로컬)

```
.board/
  board.json          # 캔버스 전체 상태(tldraw 스냅샷)
  assets/             # 붙인 이미지 등
  exports/<area-id>/
    area.png          # read_area가 렌더한 프레임 영역 스크린샷
```

보드 상태는 `board.json`에 영속하고, 시작 시 복원한다.

## 6. 스택

| 부분 | 기술 |
|---|---|
| 프론트 | React + tldraw + Vite |
| 호스트 프로세스 | Node 단일 프로세스 (UI 서빙 + WebSocket + 보드 영속 + MCP 노출) |
| MCP | `@modelcontextprotocol/sdk` (TypeScript), **HTTP/SSE 트랜스포트** (stdio 아님) |
| 브라우저↔프로세스 | WebSocket (`ws`) — board 저장 / post_card 푸시 / export 왕복 |
| 이미지 export | 브라우저 측 tldraw `exportToBlob(frame)` → WS로 서버 전달 (옵션 A) |

## 7. MVP1 범위 (명확히)

**포함**: 단일 호스트, 무한 캔버스, 텍스트/이미지/그림 자유 배치, 프레임 구역, 보드 로컬 영속, MCP 3도구(list_areas/read_area/post_card), Claude가 붙어 파악→카드→승인→빌드 루프.

**제외(후속 MVP)**: 실시간 멀티유저·멀티커서·초대(MVP2), 음성·STT(MVP3), 트리거 (나) 버튼 능동 호출, 인증·과금.

## 8. 에러 처리 / 테스트

- MCP 도구 단위 테스트: `read_area`가 올바른 shapes + PNG를 반환하는지, `post_card`가 보드에 카드를 반영하는지, `list_areas`가 프레임만 집어내는지.
- 보드 저장/복원 라운드트립 테스트(board.json → 복원 후 동일 상태).
- Claude Code 미연결 상태에서도 보드앱이 정상 동작(기획툴 단독성).

## 9. 검증 기준 (MVP1 완료 정의)

1. 호스트가 보드앱을 로컬에서 띄우고 캔버스에 텍스트·이미지·그림을 배치, 프레임으로 영역을 묶을 수 있다.
2. 보드를 닫았다 열어도 상태가 복원된다.
3. Claude Code에 MCP를 등록하고 `list_areas`/`read_area`로 지정 영역을 텍스트+스크린샷으로 읽을 수 있다.
4. Claude가 `post_card`로 "이거 맞나요" 정리를 보드에 카드로 띄운다.
5. 방장이 승인하면 Claude Code가 그 기획을 바탕으로 실제 산출물을 빌드한다(한 번의 end-to-end 루프).
