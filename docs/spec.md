# canvas-forge — Project Spec

**English** · [한국어](spec.ko.md)

The detailed design and data flow live in [`superpowers/specs/2026-06-09-canvas-forge-design.md`](superpowers/specs/2026-06-09-canvas-forge-design.md). This file is the summary spec.

## Goal

Build an infinite-canvas collaborative planning tool, and let Claude attach over MCP to read one area of the board, structure it into a plan, and carry it through to implementation. For MVP1, "done" means running one full turn of the loop where Claude reads a board area → plans → gives feedback → builds.

## Milestones

1. **MVP1 — Claude bridge loop**: a single host freely arranges things on the canvas, marks areas with frames, and Claude attaches via the three MCP tools (`list_areas` / `read_area` / `post_card`) to understand → card → approve → build.
2. **MVP2 — real-time collaboration**: N concurrent users, multi-cursors, host-hub WS sync (official `@tldraw/sync`). ※ Originally "Yjs + WebRTC P2P", but WebRTC needs signaling/TURN and so isn't serverless; since the host already runs a WS server, we chose host-hub + tldraw's official sync (2026-06-10, [MVP2 design](superpowers/specs/2026-06-10-mvp2-realtime-collab-design.md)).
3. **MVP3 — richer multimodal**: extending the means of expression — images, text files, PDFs, web embeds, video comment curation (voice/STT was scoped out).

## Constraints

- Serverless / host-invited / non-commercial. No central server, auth, or billing. Data persists local to the host.
- A browser alone can't reach local files or Claude Code → the host's local Node server is the required intermediary.
- Claude integration is over MCP. The board app must work fully as a whiteboard without Claude.

## Domain

- **Area = a tldraw frame.** The host draws a frame and titles it — that's one section. The shapes inside the frame are that area's content. Categories and nesting are done with frames too.
- **read_area is multimodal**: objects readable as text come back as text; visual context comes back bundled as a PNG screenshot of the frame area.
- **Trigger (MVP1)**: after marking an area, the host calls it directly from a Claude Code session and Claude picks it up over MCP.
- Storage: `.board/board.json` (tldraw snapshot) + `.board/assets/` + `.board/exports/<area-id>/area.png`.

## Avoid

- Don't put real-time multi-user or voice into MVP1 — prove the differentiator (Claude reading the board loop) first. Building multi-user first means confirming the biggest risk last.
- A board button that actively wakes Claude (a push trigger) is out of scope for MVP1 (needs polling/queue).
- No hardcoded absolute paths.
- Don't implement the infinite canvas or real-time sync yourself — use the proven tldraw (+ `@tldraw/sync`) combination.
