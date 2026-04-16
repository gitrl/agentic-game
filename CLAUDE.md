# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Language

All responses and commit messages should be in **Chinese (中文)**.

## Project Overview

法律悬疑互动小说游戏"逆判：重生证词"。玩家以第一人称扮演拥有"重生"能力的辩护律师，通过 50 轮法庭攻防为无辜被告争取无罪判决。基于 Agentic AI 架构，LLM 通过 tool calling 驱动游戏状态变化。

## Commands

```bash
# Install all dependencies (root + backend + frontend)
npm install && npm install --prefix backend && npm install --prefix frontend

# Start both backend and frontend concurrently
npm run dev
# Backend: http://localhost:4000  Frontend: http://localhost:5173

# Start individually
npm run dev:backend    # tsx watch, auto-reload
npm run dev:frontend   # vite dev server

# Build
npm run build          # builds both backend (tsc) and frontend (vite build)

# Backend only
cd backend && npm run build    # tsc -p tsconfig.json
cd backend && npm start        # node dist/index.js (production)
```

No test framework is configured.

## Tech Stack

- **Frontend**: React 18 + Vite + TailwindCSS + TypeScript (ESM, Bundler module resolution)
- **Backend**: Express + TypeScript (ESM, NodeNext module resolution) + tsx (dev)
- **AI**: OpenAI-compatible API via `openai` SDK (default: 阿里千问 qwen3.5-plus, with tool calling + thinking)
- **Storage**: File-based JSON (default) / MongoDB (optional, via `MONGODB_URI`)
- **Communication**: SSE (Server-Sent Events) for streaming narrative + game state

## Architecture

### Agentic Flow (Core Pattern)

The game uses an **LLM-as-agent** architecture where each turn:

1. `GameService.processTurn()` increments turn, snapshots state, writes memory file
2. `AgentService.processTurn()` sends full game context + system prompt to LLM with 6 tool definitions
3. LLM calls tools in a loop (max 5 rounds): `update_stats`, `generate_choices` (required), plus optional `resolve_player_input`, `update_evidence`, `shift_npc_relation`, `write_memory_anchor`
4. Tool calls execute against `GameState` in `tools/executor.ts` — mutations happen immediately on the state object
5. LLM returns final JSON `{narrative, summary}` as text content
6. Back in `GameService`, code-enforced rules run: verdict evaluation, rebirth trigger, game-over check
7. Controller streams result via SSE events in order: `input_feedback` → `narrative_delta` (chunked) → `choices` → `state_patch` → `progress` → `token_usage` → `done` → optional `game_over`

### Key Design Decisions

- **Tool calling drives state**: The LLM decides stat deltas, evidence changes, NPC shifts, and choice generation via structured tool calls. The executor applies clamped deltas to `GameState`.
- **Code-enforced invariants**: Verdict outlook, rebirth triggering, and game-over are computed by deterministic code in `gameEngine.ts` AFTER LLM tool calls — the LLM cannot override these.
- **Memory file for LLM context**: Each turn writes `data/{sessionId}.md` (Markdown) which is read back as `memoryContext` in the next LLM call, providing short/mid/long-term memory layers.
- **Graceful degradation**: If the LLM fails to call required tools (`update_stats`, `generate_choices`), the service throws `LLM_MISSING_TOOL` error. The `gameEngine.ts` also has a `buildChoices()` fallback used during `initializeGame`.

### Backend Layer Structure

```
controllers/gameController.ts  — SSE streaming, HTTP handling
services/gameService.ts        — orchestration: turn lifecycle, save/load, replay
services/agentService.ts       — LLM interaction: prompt building, tool-call loop, response parsing
tools/definitions.ts           — OpenAI tool schemas (6 tools)
tools/executor.ts              — tool dispatch + GameState mutations (clamp logic)
engine/gameEngine.ts           — deterministic rules: init, verdict, rebirth, game-over, memory bundles
prompts/agentSystemPrompt.ts   — LLM system prompt
types/game.ts                  — all TypeScript types (GameState, ActionResult, etc.)
repositories/                  — storage abstraction (file/mongodb/memory)
```

### Frontend

Single-page React app in `App.tsx`. Handles SSE stream parsing, typewriter effect (16ms per char), and localStorage session persistence (`agentic-game-session-id`). UI components in `components/ui/` are shadcn/ui-style primitives.

## Environment Variables

Backend env lives in `backend/.env`:
- `OPENAI_API_KEY` — required for game to function
- `OPENAI_BASE_URL` — defaults to dashscope (阿里云)
- `OPENAI_MODEL` — defaults to `qwen3.5-plus`
- `LLM_ENABLED` — must be `true` (the agentic flow requires LLM)
- `PORT` — backend port (default 4000)
- `MONGODB_URI` — optional, enables MongoDB instead of file storage

Frontend env in `frontend/.env`:
- `VITE_API_BASE_URL` — backend URL (default `http://localhost:4000`)

## Important Conventions

- Backend uses ESM with `.js` extensions in imports (e.g., `import { foo } from "./bar.js"`)
- All game state mutations during a turn happen through tool executor functions — never modify `GameState` directly in `agentService.ts`
- The LLM system prompt is in `prompts/agentSystemPrompt.ts` — changes here directly affect game behavior and narrative quality
- Runtime data (sessions, saves, memory files) goes to `data/` — this directory is gitignored
- The `skills/` directory contains design documentation, not runtime code
