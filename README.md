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

## Production

```bash
pnpm build
pnpm start   # serves .output/server/index.mjs on :3000
```

`pnpm start` runs the built Nitro server and auto-loads `.env` via Node 24's
built-in `--env-file-if-exists=.env` flag (no `dotenv` dependency). The file is
optional — if absent, the server boots and the chat routes fail soft (empty
model list, no default) just like dev without a key. To override any value,
export it in the shell: shell env wins over `.env`.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` runs the Vitest suite over the pure domain logic that carries the
most risk if silently regressed: the chat-message reconciliation helpers, the
skill `/skill-name` parsers, validation rules, and activation wire-format
(`<skill_content>` XML block builder + escape semantics), the server-side skill
tools (`skill_search` / `skill_get_content` dispatch, the tier-1 catalog block,
token-overlap ranking with exact-name weighting, and the tier-2/tier-3 content
formatting), the scheduler's cron projection (`canFire` / `projectNextFire`) and
the board's running/upcoming/past overview layout (`buildOverview`), the scheduled-jobs board display
formatters (run duration / result / status classes), the tool-events formatters
+ tool-step pairing, the deferred tool-search bridge (BM25 + substring fallback
+ the savings metadata), the token-usage allocation math (char→token
estimation, the largest-remainder category + per-tool-schema split driving
the header's input-token breakdown, the sum-vs-max aggregation across
round-trips), the central tool registry (`createToolRegistry`'s duplicate-name
and missing-handler wiring guards, the `Object.hasOwn` Object.prototype
shadowing protection, provider-order preservation, and the singleton's
200-tool dispatch contract), the 200-tool mock catalog and deterministic mock
executor (`mockToolCount` checksum, no-duplicate-name integrity, every spec's
`required`-references-a-declared-property invariant, the OpenRouter function-
schema builders, `getMockToolSpec` name lookup, and `executeMockTool`'s output
shape + record-label derivation across first-string-wins / spec.title fallback
/ empty-input cases), the OpenAI/OpenRouter SSE chunk parser (covering the
usage-capture and tool-call fragment reassembly regressions documented in
the iteration log), the client-side `/api/chat` SSE reader (the
`readChatStream` line-buffered frame pump plus the six wire-frame validators
for tool_call/tool_result/usage/breakdown/metadata/trace that protect the UI
against malformed payloads), the OpenRouter client's pure helpers (the
`compactUsage`/`sumUsage` per-turn usage compaction + aggregation that feed
the usage frames, and the `requireEnv`/`MissingEnvironmentVariableError`/
`OpenRouterError` env + error guards), the tool loop's
`sentToolCountForMode` (the per-exposure-mode schema count that drives the
`x-total-tools` verification header across search/all/none + skill-extras),
and the localStorage-backed persistence stores — the chat sessions store
(title provenance auto/generated/manual, AI-title upgrade guards, newest-
updated-first ordering + `touchSession` re-float, per-session message
pub/sub + cross-tab forwarding), the skills store (CRUD, replace-set
reference semantics, newest-created-first ordering, cold-read validation),
and the scheduled-tasks store (create/delete with home-session cascade,
`ensureRun` idempotency, `completeRun`/`markTaskFired`, the `MAX_RUNS`
trim, and the dual-flush `deleteTask` cascade). The store tests run under a
jsdom environment (per-file `@vitest-environment jsdom`) so the stores'
`window.localStorage` + `crypto.randomUUID` + cross-tab `storage`-event
paths are exercised end-to-end, with a `vi.resetModules()` + dynamic
re-import per test to reset the module-level caches/listeners and a
deterministic fake `Date` clock for ordering-sensitive assertions.

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
  multi-session localStorage persistence, AI-generated session titles (with a
  provenance-tracked instant first-message fallback), inline rename, smart
  auto-scroll, retry/regenerate, and a searchable model picker.
- Deferred tool-search bridge (BM25 over 200 mock tools) driven by a
  hand-rolled OpenRouter tool loop (search → describe → call), surfaced inline
  as a collapsible tool trace with deferred-vs-all token savings.
- Real per-turn + session-cumulative OpenRouter token usage, an estimated
  input-token split (system / messages / tools), and reasoning (chain-of-
  thought) display for reasoning models.
- Skills (localStorage CRUD + editor with references) activated either by a
  `/skill-name` composer command or by agent-driven `skill_search` /
  `skill_get_content` tools (the reference's progressive-disclosure tier
  system). The client ships its enabled-skills snapshot per request so the
  server-side tool loop can expose the two skill tools over that snapshot.
- Scheduled tasks (localStorage + a client-side cron ticker) with a live
  Running now / Up next / Past runs board and a create dialog. When a task
  fires, its instruction runs against `/api/chat` and the model's reply is
  appended to the task's own chat transcript ("View transcript" on the board),
  so a scheduled fire produces a real agent turn rather than a placeholder.

Faithful within the no-backend constraint: skills are browser-local (no
Postgres), and scheduled tasks run only while a tab is open — but they now
execute a real model turn per fire and write it into a home chat session
(the reference's scheduled-task-runs-into-a-session pattern), client-side,
reusing the same `/api/chat` endpoint as the interactive chat.
