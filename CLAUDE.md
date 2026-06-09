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

## 참조

- 프로젝트 명세: `docs/spec.md`
- 상세 설계: `docs/superpowers/specs/2026-06-09-canvas-forge-design.md`
- 큐레이션된 노하우: `docs/know-how/*.md` (특히 `mcp--*`, `skills--superpowers-skills-pattern`)
