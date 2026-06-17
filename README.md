# tanstack-ai-app

A TanStack Start + React reimplementation of the patterns proven out in
`ai-sdk-app` — a measurement instrument for agent behavior. The same product
goals (conversation-first chat surface, a tool-search bridge over a large tool
registry, token-usage visibility) but built on **only TanStack and React**: no
Next.js, no Vercel AI SDK.

## Stack

- **TanStack Start** (`@tanstack/react-start`) — full-stack React framework on
  Vite + Nitro, file-based routing via **TanStack Router**.
- **React 19**.
- **Tailwind CSS 4** (Vite plugin, OKLCH design tokens).
- **Biome** for lint/format, **TypeScript** in `strict` mode.

The chat backend calls the OpenRouter chat completions API directly over SSE
and drives a server-side tool loop (search → describe → call) — replacing the AI
SDK's `ToolLoopAgent` and `useChat` with hand-rolled equivalents.

## Setup

1. Node 24 and pnpm 11.
2. `pnpm install`
3. Copy `.env.example` to `.env` and fill in `OPENROUTER_API_KEY` and
   `OPENROUTER_DEFAULT_MODEL`.
4. `pnpm dev` and open http://localhost:3000

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm build
```

The `/api/chat` route drives the hand-rolled tool loop directly over
OpenRouter's function-calling API. By default (`TOOL_EXPOSURE_MODE=search`)
it exposes only the local BM25 tool-search bridge over 200 mock-backed tools,
and returns `x-openrouter-model`, `x-mock-tools`, `x-total-tools`, and
`x-tool-exposure-mode` response headers on every chat response for local
verification — e.g. `curl -i -N -X POST http://localhost:3000/api/chat ...`.
Set `TOOL_EXPOSURE_MODE=all` to send every tool schema instead (the token-cost
baseline), or `none`/`off` to disable the tool loop entirely.

## Status

Feature-complete with the reference's chat-surface thesis:

- App chrome (collapsible sidebar, header, /, /tasks, /skills, /chat/$sessionId)
  on the OKLCH design system.
- Streaming chat (no AI SDK): OpenRouter over a self-owned SSE protocol, with
  multi-session localStorage persistence, inline rename, smart auto-scroll,
  retry/regenerate, and a searchable model picker.
- Deferred tool-search bridge (BM25 over 200 mock tools) driven by a
  hand-rolled OpenRouter tool loop (search → describe → call), surfaced inline
  as a collapsible tool trace with deferred-vs-all token savings.
- Real per-turn + session-cumulative OpenRouter token usage, an estimated
  input-token split (system / messages / tools), and reasoning (chain-of-
  thought) display for reasoning models.
- Skills (localStorage CRUD + editor with references) activated either by a
  `/skill-name` composer command or, in the reference, by agent-driven
  `skill_search` / `skill_get_content` tools.
- Scheduled tasks (localStorage + a client-side cron ticker) with a live
  Running now / Up next / Past runs board and a create dialog.

Faithful within the no-backend constraint: skills and scheduled tasks are
browser-local (no Postgres / pg-boss worker), so the reference's server-side
scheduled-task-runs-into-a-session pattern is intentionally out of scope.
