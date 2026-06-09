# canvas-forge

> 무한 캔버스에서 같이 기획하고, Claude를 붙이면 그대로 만들어지는 협업 보드.

여러 사람이 끝없는 캔버스에 텍스트·이미지·그림으로 자유롭게 표현하며 기획한다. 방장이 한 영역을 지정해 Claude를 부르면, Claude가 그 영역을 읽어 기획으로 정리("이거 맞나요?")하고 승인 시 실제로 만든다. **안 붙이면 기획툴, Claude를 붙이면 기획+구현툴.**

- 서버리스 / 호스트 초대 / 비상업 — 호스트가 자기 머신에서 열고 초대, 데이터는 호스트 로컬에.
- Claude는 **MCP**로 붙는다.

## Quick start

```bash
npm install
npm run build          # 프론트(tldraw 보드)를 dist/로 빌드
npm run host           # 호스트 단일 프로세스 기동 (기본 포트 4317, PORT 환경변수로 변경)
```

1. 브라우저로 `http://localhost:4317` 열기 → 무한 캔버스가 뜬다. 이 탭은 켜둔 채로 둔다(Claude의 영역 읽기가 이 탭의 렌더를 쓴다).
2. Claude Code에 MCP 등록:
   ```bash
   claude mcp add --transport http canvas-forge http://localhost:4317/mcp
   ```
3. 보드에서 **프레임**을 그리고 제목을 단다(= 한 영역). 프레임 안에 텍스트·그림을 배치.
4. Claude Code 세션에서 호출: "list_areas 봐줘" → `read_area`로 영역을 텍스트+스크린샷으로 읽음 → `post_card`로 "이거 맞나요" 카드를 보드에 띄움 → 방장이 승인하면 Claude Code 기본 도구로 실제 빌드.

데이터는 호스트 로컬 `.board/`(board.json + exports)에 남고, 닫았다 열어도 복원된다.

### 개발

```bash
npm run dev:web        # vite dev 서버(프론트만, HMR) — 단, MCP/영속은 npm run host 쪽
npm test               # 서버 테스트(vitest): board 영속 / areas 추출 / MCP e2e
```

## Status

✅ **MVP1 동작** — Claude 브릿지 루프(단일 호스트, 영역 지정→`read_area`→`post_card`→승인→빌드). 실제 브라우저 end-to-end 검증 완료(테스트 13개 통과 + 실 렌더 PNG 왕복 확인).

로드맵: MVP1 Claude 브릿지 루프 → MVP2 실시간 협업(N명) → MVP3 음성·멀티모달.

명세: [`docs/spec.md`](docs/spec.md) · 설계: [`docs/superpowers/specs/2026-06-09-canvas-forge-design.md`](docs/superpowers/specs/2026-06-09-canvas-forge-design.md)
