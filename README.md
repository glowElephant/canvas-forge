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

1. 브라우저로 `http://localhost:4317` 열기 → 이름 입력 후 무한 캔버스가 뜬다. 상단 배지로 동기화 상태를 확인할 수 있고, host를 재시작해도 자동 재연결한다.
2. **초대**: 같은 네트워크 사람에게 `http://<호스트IP>:4317`을 알려주면 끝. 각자 이름으로 들어와 같은 보드를 실시간 동시 편집(멀티커서·이름표 표시).
3. Claude Code에 MCP 등록:
   ```bash
   claude mcp add --transport http canvas-forge http://localhost:4317/mcp
   ```
4. 보드에서 **프레임**을 그리고 제목을 단다(= 한 영역). 프레임 안에 텍스트·그림을 배치.
5. Claude Code 세션에서 호출: "list_areas 봐줘" → `read_area`로 영역을 텍스트+스크린샷으로 읽음(스크린샷은 열려 있는 탭 하나가 렌더) → `post_card`로 "이거 맞나요" 카드를 띄우면 **모든 참여자 화면에 실시간 반영** → 방장이 승인하면 Claude Code 기본 도구로 실제 빌드.

데이터는 호스트 로컬 `.board/`(board.json + exports + uploads)에 남고, 닫았다 열어도 복원된다. 카드 게시(`post_card`)와 영역 텍스트 읽기는 브라우저 탭이 없어도 동작한다.

### 개발

```bash
npm run dev:web        # vite dev 서버(프론트만, HMR) — 단, MCP/영속은 npm run host 쪽
npm test               # 서버 테스트(vitest): board 영속 / areas 추출 / MCP e2e
```

## Status

✅ **MVP1 동작** — Claude 브릿지 루프(영역 지정→`read_area`→`post_card`→승인→빌드). 실 브라우저 end-to-end 검증.
✅ **MVP2 동작** — 실시간 협업: N명 동시접속·멀티커서·호스트 허브 동기화(`@tldraw/sync`). 실 브라우저 2탭(호스트+게스트) 동시 편집·카드 실시간 전파·재시작 복원 검증(테스트 19개 통과).

로드맵: ~~MVP1 Claude 브릿지 루프~~ → ~~MVP2 실시간 협업(N명)~~ → MVP3 음성·멀티모달.

명세: [`docs/spec.md`](docs/spec.md) · 설계: [`docs/superpowers/specs/2026-06-09-canvas-forge-design.md`](docs/superpowers/specs/2026-06-09-canvas-forge-design.md), [`MVP2`](docs/superpowers/specs/2026-06-10-mvp2-realtime-collab-design.md)
