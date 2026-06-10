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
2. **초대**: host 콘솔에 실제 초대 링크가 찍힌다(예: `http://192.168.0.95:4317`). 보드 상단의 **"초대 링크 복사"** 버튼으로도 복사 가능. 같은 네트워크 사람이 그 링크로 들어와 이름만 입력하면 같은 보드를 실시간 동시 편집(멀티커서·이름표 표시). ※ 처음 접속이 안 되면 Windows 방화벽 허용을 확인.
3. Claude Code에 MCP 등록:
   ```bash
   claude mcp add --transport http canvas-forge http://localhost:4317/mcp
   ```
4. 보드에서 **프레임**을 그리고 제목을 단다(= 한 영역). 프레임 안에 텍스트·그림을 배치.
5. 프레임 안에 **뭐든 올려라** — 텍스트·그림은 물론, 이미지 드롭(png/jpg/gif/webp/svg), 텍스트 파일·**PDF** 드롭(→ 📄 파일 카드), URL 붙여넣기(북마크: 제목·썸네일 자동), 메뉴의 임베드 삽입으로 **웹페이지 iframe**(사이트가 프레이밍을 막으면 빈 화면 — 그땐 북마크), **영상**(mp4/webm). 우상단 **영역 패널**에서 영역 클릭 이동·📍 위치 핀(클릭하면 그 영역으로 점프)도 가능. Claude가 전부 읽는다.
6. **영상은 댓글로 큐레이션** — 영상을 선택하면 댓글 패널이 뜬다. "⏱ 현재 재생 시점 태그"를 켜고 댓글을 달면(유튜브 댓글의 `1:23`처럼), Claude가 **그 시점의 프레임 + 댓글 맥락**만 가져와 분석한다. 시간 칩 클릭 시 그 시점으로 이동. 댓글은 모든 참여자에게 실시간 공유.
7. Claude Code 세션에서 호출: "list_areas 봐줘" → `read_area`가 영역을 **텍스트 + 스크린샷 + 이미지 원본들 + 파일 내용 + PDF + 링크 본문 + 영상 태그 시점 프레임**으로 멀티모달로 읽음 → `post_card`로 "이거 맞나요" 카드를 띄우면 **모든 참여자 화면에 실시간 반영** → 방장이 승인하면 Claude Code 기본 도구로 실제 빌드.

데이터는 호스트 로컬 `.board/`(board.json + exports + uploads)에 남고, 닫았다 열어도 복원된다. 카드 게시(`post_card`)와 영역 텍스트 읽기는 브라우저 탭이 없어도 동작한다.

### 개발

```bash
npm run dev:web        # vite dev 서버(프론트만, HMR) — 단, MCP/영속은 npm run host 쪽
npm test               # 서버 테스트(vitest): board 영속 / areas 추출 / MCP e2e
```

## Status

✅ **MVP1 동작** — Claude 브릿지 루프(영역 지정→`read_area`→`post_card`→승인→빌드). 실 브라우저 end-to-end 검증.
✅ **MVP2 동작** — 실시간 협업: N명 동시접속·멀티커서·호스트 허브 동기화(`@tldraw/sync`). 실 브라우저 2탭(호스트+게스트) 검증.
✅ **MVP3a 동작** — 멀티모달 읽기: 이미지 원본 개별 전달·텍스트 파일 카드·링크 unfurl+본문 읽기.
✅ **MVP3b 동작** — PDF 텍스트 추출·웹페이지 iframe 임베드·영역 패널/위치 핀·**MCP 서버 instructions**(붙는 Claude에게 사용 규칙 자동 전달).
✅ **MVP3c(영상) 동작** — 영상 댓글+시간 태그 큐레이션: 사람이 댓글로 짚은 시점만 Claude가 프레임+맥락으로 분석(ffmpeg 불필요 — 브라우저 캡처). 헤드리스 검증: 태그 시점 프레임 픽셀 일치 확인(테스트 32개 통과).

로드맵: ~~MVP1~~ → ~~MVP2~~ → ~~MVP3a~~ → ~~MVP3b~~ → ~~MVP3c(영상)~~ → 잔여: 크로스 프로젝트 북마크.

명세: [`docs/spec.md`](docs/spec.md) · 설계: [`docs/superpowers/specs/2026-06-09-canvas-forge-design.md`](docs/superpowers/specs/2026-06-09-canvas-forge-design.md), [`MVP2`](docs/superpowers/specs/2026-06-10-mvp2-realtime-collab-design.md)
