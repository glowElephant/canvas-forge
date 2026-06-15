# canvas-forge — Agent Guide

[English](AGENTS.md) · **한국어**

무한 캔버스 협업 기획툴 + Claude가 MCP로 붙어 보드 영역을 읽고 기획→구현하는 도구. 안 붙이면 기획툴, 붙이면 기획+구현툴.

이 파일은 도구 비종속(IDE-agnostic) 가이드다. Claude Code 전용 지시는 `CLAUDE.md` 참조.

## 운영 모델

서버리스 / 호스트 초대 / 비상업. 데이터는 호스트 로컬에 남는다.

## 아키텍처

- 프론트: React + tldraw + Vite (무한 캔버스, 프레임=영역).
- 호스트 로컬 서버: Node. 보드 영속(`.board/board.json`) + 이미지 export + MCP 노출.
- MCP 도구: `list_areas`, `read_area(area_id)`(텍스트+스크린샷), `post_card(area_id, markdown)`.

## MVP 단계

- MVP1(현재): Claude 브릿지 루프(단일 호스트, 영역 지정→read_area→post_card→승인→빌드).
- MVP2: 실시간 협업(N명, P2P 동기화).
- MVP3: 음성·멀티모달.

## 가드레일

- 실시간 멀티유저·음성을 MVP1에 넣지 말 것 — 차별점 루프를 먼저 증명.
- 절대 경로 하드코딩 금지(상대경로/환경변수).
- MCP는 보드 읽기·쓰기까지, 파일 빌드는 에이전트 기본 도구로.

상세는 `docs/spec.md`, `docs/superpowers/specs/2026-06-09-canvas-forge-design.md`.
