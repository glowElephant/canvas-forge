# MVP2 — 실시간 협업 설계

- 날짜: 2026-06-10
- 상태: 설계 승인 (구현 진행)
- 전제: MVP1(Claude 브릿지 루프) 완료 — 단일 호스트 + MCP 3도구 + 실 브라우저 검증 끝.

## 1. 목표

N명 동시접속 + 멀티커서 + 실시간 동기화. 호스트가 URL을 공유하면 LAN의 초대자가 브라우저로 접속해 같은 보드를 동시 편집한다. MCP 루프(Claude가 영역을 읽고 카드를 띄움)는 다중 사용자 환경에서도 그대로 동작해야 한다.

## 2. 핵심 결정 2가지 (승인됨)

### 2.1 전송: Yjs over WebSocket이 아니라 "호스트 허브 WS"

스펙의 "서버리스 P2P(WebRTC)"는 실제로는 서버리스가 아니다 — WebRTC는 시그널링 서버가 필요하고 NAT 너머는 STUN/TURN까지 필요하다. 우리는 이미 호스트가 Node 프로세스(WS 서버)를 돌리고 있고 운영 모델이 "호스트 초대"이므로, **호스트 프로세스가 동기화 허브**가 되는 것이 인프라 추가 0으로 정확히 들어맞는다. P2P는 채택하지 않는다.

### 2.2 엔진: Yjs가 아니라 @tldraw/sync 공식

스펙의 "Yjs" 문구는 "검증된 동기화를 직접 만들지 말 것" 취지였다. tldraw에는 공식 멀티플레이어 패키지가 있다:

- 클라이언트 `@tldraw/sync` — `useSync` 훅이 store를 통째로 대체, presence(멀티커서·이름표) 내장.
- 서버 `@tldraw/sync-core` — `TLSocketRoom`이 서버 권위 store로 충돌 해결.

Yjs를 쓰면 tldraw store↔Y.Doc 커스텀 바인딩(공식 없음)을 직접 작성·유지보수해야 하고 이것이 MVP2 최대 리스크가 된다. 호스트 허브로 확정한 순간 Yjs의 P2P 일반성은 의미가 없으므로 **공식 sync 채택**. 스펙 문서의 Yjs 문구는 이 결정으로 갱신한다.

## 3. 아키텍처

```
초대자A ─WS /sync─┐
초대자B ─WS /sync─┼─▶ 호스트 프로세스 (단일, MVP1 그대로 확장)
호스트탭 ─WS /sync─┘    ├ TLSocketRoom (서버 권위 store, 충돌 해결, presence)
                        ├ board.json 영속 (room 스냅샷 debounce 저장 + 종료 flush)
                        ├ MCP /mcp (list/read/post — room 스냅샷에서 직접 읽음)
                        └ /ws 브리지 (PNG export·post_card 푸시 전용으로 축소)
```

- **`board-sync.ts`(수동 스냅샷 push·에코 방지)와 init 핸드셰이크는 삭제** — 그 역할을 공식 sync가 전부 대체한다. MVP1의 "새 탭 클로버" 결함 계열이 구조적으로 사라진다.
- `/ws` 브리지는 남는다 — 동기화가 아니라 **브라우저만 할 수 있는 일**(tldraw 렌더 PNG export)과 post_card 푸시 전용. `shared/protocol.ts`에서 snapshot 계열 메시지를 제거해 축소한다.
- 영속: `TLSocketRoom`의 데이터 변경 훅에서 room 스냅샷을 debounce 저장 + `close()`/SIGINT flush (MVP1 방식 유지). 기존 `board.json`(TLEditorSnapshot)은 room 초기 스냅샷으로 마이그레이션 로드한다.

## 4. MCP 도구 변화

- `list_areas`/`read_area` 텍스트: **room 스냅샷에서 직접** 읽음 — 브라우저 연결 여부와 무관(저하 모드 축소). room 스냅샷 형식과 기존 `areas.ts` 입력(TLEditorSnapshot/TLStoreSnapshot) 간 어댑터를 둔다.
- `read_area` PNG: 여전히 브라우저 1개 필요 — 연결된 탭 중 하나에 export 요청 (N명 중 1명만 있으면 됨).
- `post_card`: 서버가 room store에 직접 shape를 쓸 수 있으면(설치본 3.15 sync-core API 확인) 브라우저 없이도 동작하게 격상. 불가하면 MVP1 방식(브리지 푸시) 유지.

## 5. 참여 UX

- 접속 시 이름 1회 입력(localStorage 저장) + 자동 색상. `useSync`의 `userInfo`로 전달 → tldraw 내장 협업 UI(커서·이름표)가 표시.
- 인증 없음(스펙: 호스트 초대·비상업). 단일 룸(보드 1개/호스트) 유지.

## 6. 검증 필요 사항 (구현 시 설치본 기준 재확인 — 추측 금지)

- `@tldraw/sync`/`@tldraw/sync-core`는 설치된 tldraw **3.15.6과 동일 버전** 설치 필수.
- `TLSocketRoom`의 3.15 기준 생성자 옵션(초기 스냅샷)·스냅샷 추출·변경 훅·서버측 store 쓰기 API. (웹 문서는 v4 기준이 섞여 있음 — SQLiteSyncStorage는 v4.3 기능이라 사용 불가.)
- 소켓 연결 방식(`handleSocketConnect`)과 `ws` 서버 연동 시그니처.

## 7. 테스트

- 두 클라이언트 동시 편집 수렴 e2e (WS 2개로 같은 room 접속 → 한쪽 변경이 다른 쪽에 도달).
- room 스냅샷 영속(debounce+flush) — 기존 persistence-flush 테스트를 sync 경로로 갱신.
- 기존 board.json 마이그레이션 로드.
- MCP가 room 스냅샷에서 읽기(브라우저 0명 포함) — degraded-mode 테스트 갱신.
- 실 브라우저 2탭 동시 편집 + 멀티커서 + MCP 루프 검증.

## 8. MVP2 범위 제외

음성·STT(MVP3), 트리거 (나), 인증·권한, 멀티 룸, 원격(인터넷 너머) 접속 지원.
