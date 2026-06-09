# canvas-forge

> 무한 캔버스에서 같이 기획하고, Claude를 붙이면 그대로 만들어지는 협업 보드.

여러 사람이 끝없는 캔버스에 텍스트·이미지·그림으로 자유롭게 표현하며 기획한다. 방장이 한 영역을 지정해 Claude를 부르면, Claude가 그 영역을 읽어 기획으로 정리("이거 맞나요?")하고 승인 시 실제로 만든다. **안 붙이면 기획툴, Claude를 붙이면 기획+구현툴.**

- 서버리스 / 호스트 초대 / 비상업 — 호스트가 자기 머신에서 열고 초대, 데이터는 호스트 로컬에.
- Claude는 **MCP**로 붙는다.

## Quick start

> (작성 예정 — MVP1 구현 후 채움)

```
# 호스트 로컬에서 보드앱 실행 → Claude Code에 MCP 등록 → 영역 지정 후 호출
```

## Status

🚧 **MVP1 구현 전** — Claude 브릿지 루프(단일 호스트, 영역 지정→read_area→post_card→승인→빌드).

로드맵: MVP1 Claude 브릿지 루프 → MVP2 실시간 협업(N명) → MVP3 음성·멀티모달.

명세: [`docs/spec.md`](docs/spec.md) · 설계: [`docs/superpowers/specs/2026-06-09-canvas-forge-design.md`](docs/superpowers/specs/2026-06-09-canvas-forge-design.md)
