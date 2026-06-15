# canvas-forge — Agent Guide

**English** · [한국어](AGENTS.ko.md)

An infinite-canvas collaborative planning tool, plus Claude attaching over MCP to read a board area and turn planning into implementation. Without Claude it's a planning tool; attach Claude and it's a planning + building tool.

This file is a tool-agnostic (IDE-agnostic) guide. For Claude Code-specific instructions, see `CLAUDE.md`.

## Operating model

Serverless / host-invited / non-commercial. Data stays local to the host.

## Architecture

- Front end: React + tldraw + Vite (infinite canvas, frame = area).
- Host local server: Node. Board persistence (`.board/board.json`) + image export + MCP exposure.
- MCP tools: `list_areas`, `read_area(area_id)` (text + screenshot), `post_card(area_id, markdown)`.

## MVP stages

- MVP1: Claude bridge loop (single host, mark area → read_area → post_card → approve → build).
- MVP2: real-time collaboration (N users, host-hub sync).
- MVP3: multimodal — images, text files, PDFs, web embeds, and video comment curation.

## Guardrails

- Do not put real-time multi-user or voice into MVP1 — prove the differentiator loop first.
- No hardcoded absolute paths (use relative paths / environment variables).
- MCP covers reading and writing the board only; file builds happen with the agent's own tools.

For details, see `docs/spec.md` and `docs/superpowers/specs/2026-06-09-canvas-forge-design.md`.
