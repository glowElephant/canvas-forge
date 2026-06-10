# canvas-forge 프로젝트 명세

상세 설계와 데이터 흐름은 [`superpowers/specs/2026-06-09-canvas-forge-design.md`](superpowers/specs/2026-06-09-canvas-forge-design.md)에 있다. 이 파일은 그 요약 명세다.

## Goal

무한 캔버스 협업 기획툴을 만들고, Claude가 MCP로 붙어 보드의 한 영역을 읽어 기획으로 구조화하고 구현까지 하게 한다. MVP1에서 "Claude가 보드 영역을 읽어 기획→피드백→빌드"하는 루프 한 바퀴를 끝까지 동작시키는 것이 "done".

## Milestones

1. **MVP1 — Claude 브릿지 루프**: 단일 호스트가 캔버스에 자유 배치 + 프레임으로 영역 지정 + MCP 3도구(`list_areas`/`read_area`/`post_card`)로 Claude가 붙어 파악→카드→승인→빌드.
2. **MVP2 — 실시간 협업**: N명 동시접속, 멀티커서, 호스트 허브 WS 동기화(`@tldraw/sync` 공식). ※ 당초 "Yjs + WebRTC P2P"였으나 WebRTC는 시그널링/TURN이 필요해 서버리스가 아니며, 호스트가 이미 WS 서버를 돌리므로 호스트 허브 + tldraw 공식 sync로 결정(2026-06-10, [MVP2 설계](superpowers/specs/2026-06-10-mvp2-realtime-collab-design.md)).
3. **MVP3 — 풍부한 멀티모달**: 음성(녹음·STT) 등 표현 수단 확장.

## Constraints

- 서버리스 / 호스트 초대 / 비상업. 중앙 서버·인증·과금 없음. 데이터는 호스트 로컬에 영속.
- 브라우저 단독으론 로컬 파일·Claude Code 접근 불가 → 호스트 로컬 Node 서버가 필수 중개자.
- Claude 연동은 MCP로. 보드앱은 Claude 없이도 화이트보드로 완전히 동작해야 한다.

## Domain

- **영역 = tldraw 프레임.** 방장이 프레임을 그리고 제목을 달면 한 구역. 프레임 안 shapes가 그 영역의 콘텐츠. 카테고리 구획·중첩도 프레임으로.
- **read_area는 멀티모달**: 텍스트로 읽을 객체는 텍스트로, 시각 맥락은 프레임 영역 PNG 스크린샷으로 묶어 반환.
- **트리거 (MVP1)**: 영역 지정 후 호스트가 Claude Code 세션에서 직접 호출하면 Claude가 MCP로 집어간다.
- 저장: `.board/board.json`(tldraw 스냅샷) + `.board/assets/` + `.board/exports/<area-id>/area.png`.

## Avoid

- 실시간 멀티유저·음성을 MVP1에 넣지 말 것 — 차별점(Claude가 보드를 읽는 루프)을 먼저 증명. 멀티유저부터 만들면 제일 큰 리스크를 늦게 확인하게 된다.
- 보드 버튼이 Claude를 능동적으로 깨우는 트리거(나)는 MVP1 제외(폴링/큐 필요).
- 절대 경로 하드코딩 금지.
- 무한 캔버스·실시간 동기화를 직접 구현하지 말 것 — tldraw(+`@tldraw/sync`)의 검증된 조합을 쓴다.
