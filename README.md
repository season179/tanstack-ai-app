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
(`<skill_content>` XML block builder + escape semantics), the Skills page
editor's pure draft helpers extracted into `skill-draft`
(`draftFromSkill`'s Skill→draft conversion reusing the persisted id as the
list key, `validateDraft`'s per-field `.trim()`-then-validate aggregation
across the top-level name/description/body fields plus the per-reference
errors keyed by draft key with clean-reference omission, and
`hasDraftErrors`'s any-error detector driving the editor's submit guard), the server-side skill
tools (`skill_search` / `skill_get_content` dispatch, the tier-1 catalog block,
token-overlap ranking with exact-name weighting, and the tier-2/tier-3 content
formatting), the scheduler's cron projection (`canFire` / `projectNextFire`) and
the board's running/upcoming/past overview layout (`buildOverview`), the scheduled-jobs board display
formatters (run duration / result / status classes, and the unified `scheduleLabel`
schedule readout shared by the Up next / Paused sections), the Create Task dialog's
pure validation + datetime-local helpers extracted into `create-task-helpers`
(the `TITLE_MAX` / `INSTRUCTION_MAX` length limits, the `Draft` / `Errors`
shape, the `EMPTY_DRAFT` default, the `toLocalInputValue` Date → datetime-local
formatter that always emits the seconds component so the +10s / +30s
sub-minute quick offsets remain representable, the `localInputToIso` local-time
→ ISO parser with its empty / malformed / whitespace → null fallbacks, and
`validate`'s title / instruction / one-off-future-time / cron rules with an
injectable `now` for deterministic boundary testing of the past / exactly-now
/ strictly-future cases and the cron-parser constraint errors), the tool-events formatters
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
`OpenRouterError` env + error guards), the tool loop's `sentToolCountForMode` (the per-exposure-mode schema count that drives the
`x-total-tools` verification header across search/all/none + skill-extras) and
the `runToolLoop` orchestrator itself (mocked network boundary driving the
real bridge executors + central registry: single-turn termination, bridge
search/describe/call dispatch with trace events, all-mode registry dispatch,
extra skill-tool routing, the `MAX_LOOP_ITERATIONS=6` cap, abort-before-first-
iteration, cross-round-trip usage aggregation, the always-emitted final
metadata, and system-prompt/tools/tool-result message threading),
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
deterministic fake `Date` clock for ordering-sensitive assertions), the
ubiquitous small pure helpers — the `cn`/`isUuid`/`UUID_PATTERN` utilities
(clsx+tailwind-merge class composition with conflict resolution, the
anchored case-insensitive UUID validator driving the chat route's id check)
and the chat busy-signal pub/sub (the no-op-on-identical-value guard,
change-driven notification, multi-subscriber fan-out, and unsubscribe
semantics that let the root-level sidebar mirror the per-session provider's
streaming flag and apply the reference's three chatBusy guards), and the
scheduled-task background executor `executeScheduledRun` (the last
side-effect module: a mocked-global-`fetch` harness scripting `/api/chat` SSE
Responses while the real sessions + tasks stores run, covering the happy-path
text stream + verdict + `origin="scheduled"` transcript append, multi-frame
folding of reasoning / tool_call / tool_result / usage / breakdown / metadata
onto the assistant turn, prior-transcript history threading on the wire, the
whitespace-instruction / missing-home-session / fetch-reject / non-ok-JSON /
non-ok-status / stream-error-frame failure modes, per-run-id idempotency,
distinct-run independence, and the `touchSession` sidebar re-float), and the
no-AI-SDK session titler `generateSessionTitle` (a mocked-global-`fetch` harness
controlling `process.env`, covering the missing-API-key / whitespace-key /
missing-model env guards, the empty/whitespace-input guard, the fetch-reject /
non-ok-status / malformed-JSON / missing-choices / empty-choices / non-string-
content failure modes, the request construction (OpenRouter endpoint, Bearer
auth, JSON content-type, `OPENROUTER_TITLE_MODEL` precedence over
`OPENROUTER_DEFAULT_MODEL`, whitespace trimming, the 1024-token cap, the system
prompt, the user-message turn labeling, and the 2000-char-per-source	runcation), and the title normalization (strip wrapping quotes/backticks,
collapse whitespace, drop trailing periods, cap at 60 chars, empty→null),
plus — via a React Testing Library `renderHook` harness (jsdom + a mocked global `fetch`
scripting `/api/chat` SSE bodies) — the React hooks layer that was the last
untested surface: `useChatStream` (the client chat runtime: send happy path
with transcript persistence + first-turn AI titling firing once, the empty /
whitespace / busy no-op guards, the empty-placeholder drop on a no-text
stream, the non-ok status-fallback + JSON-error-body-preferred + fetch-reject
+ server-error-frame error paths, `stop` abort + settle, `regenerate`
dropping the trailing reply + busy no-op, reasoning / tool_call / tool_result /
usage / breakdown / metadata folding onto one assistant turn, and
`/skill-name` activation prepending the skill block on the wire only),
`useModels` (localStorage selection restore + `setSelectedModel` persistence
including the null-removal and storage-throw fail-soft paths, and the lazy
`ensureLoaded` fetch with idempotency + non-ok soft-fail + reject-then-retry
reset + loading flag), `useChatSessions` (the live view of the chat-sessions
store the sidebar / redirect logic / routes read through: createSession
delegation + default-title fallback + localStorage persistence, reactivity
across hook instances + cross-tab storage-event re-render, referential
stability of the snapshot between non-mutating renders + of the action
callbacks across renders, newest-updated-first ordering + `touch` re-float,
and `removeSession` / `renameSession` delegation with the 'manual' provenance
stamp), and `useSkills` (the live view of the skills store the Skills page
and the chat composer's `/skill-name` autocomplete read through: createSkill
delegation + enabled-by-default + persistence, reactivity across instances +
cross-tab re-render, referential stability of the snapshot + callbacks,
newest-created-first ordering stable across `updatedAt` bumps, and
`updateSkill` / `removeSkill` delegation including the unknown-id `null`
return + content preservation), `useTasks` (the live view of the
scheduled-task store the scheduled-jobs board / root `AppShell` scheduler
boot / `CreateTaskDialog` read through: createTask delegation for both
once- and cron-task shapes including the implicit home-session mint +
localStorage persistence, the `startTaskScheduler` boot side-effect firing
exactly once on mount and idempotently across re-renders, reactivity across
hook instances + cross-tab storage-event re-render across BOTH the tasks
and runs keys, referential stability of the snapshot between non-mutating
renders + of the action callbacks, newest-created-first ordering stable
across `updatedAt` bumps, `updateTask` / `removeTask` delegation including
the unknown-id `null` return + content preservation, and the
`useGoToTranscript` navigation wrapper — navigate on a real id, no-op on
null, stable callback identity), and `useHydrated` (the post-mount true +
rerender / remount stability), and `useSkillAutocomplete` (the composer's
`/skill-name` autocomplete state machine extracted from `chat-surface`:
menu visibility driven by `parsePartialSkillCommand` — closed for non-command
input, open with all activatable skills on a bare slash, prefix-filtered by the
partial name, and closed once a space follows it or no name matches; the
dismiss / `resetMenu` / `clearDismissed` semantics — Escape dismisses, onChange
reopens + zeroes the highlight, the after-send path reopens without resetting
the highlight; the clamp-on-shrink so a narrowing query can't outrun the
highlight; the `+ matches.length`-before-modulo wrap-around keyboard
navigation; `accept` firing `onAccept` + dismissing; and referential stability
of `skillMatches` + the empty-deps callbacks + `accept` while `onAccept` is
stable), and — extending that React Testing Library
harness from `renderHook` to `render`/`screen`/`fireEvent` — the interactive
UI components,
starting with the `ModelPicker` (the composer's searchable, keyboard-navigable,
lazy-loading model selector: the trigger label derivation across value /
default-model / catalog-display-name / shortName fallbacks, the popover
open/close + `onOpen` lazy-load callback, the prefix-then-substring
ranking filter + case-insensitivity, the `MAX_RENDERED` cap + the "Showing N
of M" refine hint, the empty-catalog default-model fallback row, the loading
state, the keyboard navigation (ArrowDown/ArrowUp wrap + Enter-to-select +
Escape-to-close + no-op on an empty result set), the mouse hover-re-highlight
+ click-to-select, the outside-click dismiss, the active-descendant
`aria-selected` semantics vs the chosen-value Check-icon distinction, and
the `K`-suffixed context-length formatting), and the AppSidebar's session-listing
helpers (`parseActiveSessionId` / `formatRelative` / `isSameDay` /
`groupSessions`: pathname extraction, relative-time formatting with the
nearest-minute rounding + the <30s "just now" cutoff + locale-date fallback,
local-calendar-day equality, and the Today/Older grouping by calendar day
rather than a 24h window), and the chat message-bubble display helper
extracted into `message-display` (`messageContentClassName`: the per-turn
content className ported from the reference's `ai-elements` `MessageContent`,
pinning the user-gets-a-bubble / assistant-is-borderless fidelity contract —
both turns share `px-4 py-3 text-sm leading-6`, the user turn adds the
`bg-primary text-primary-foreground rounded-lg` bubble capped at `max-w
min(46rem,82%)` with `whitespace-pre-wrap break-words` for plain-text input,
and the assistant turn is borderless `text-card-foreground` at `max-w
min(72rem,100%)` with no background / rounding / shadow, matching the modern
chat-app pattern where only the user's input gets a bubble), and the `/api/chat` route's pure input-validation
+ response-header helpers extracted into `chat-route-helpers`
(`chatStreamHeaders` building the SSE + four `x-*` verification headers across
search/all/none modes + skill-extras additivity, `toChatMessages` validating
the message history with role+content fail-fast on non-object / unknown-role /
non-string / empty-content entries, `toSkillSnapshot` failing-soft per-row
validation of the client's enabled-skills payload including nested-reference
filtering, and `buildSystemPrompt` appending the skills catalog block when
present), and the inline tool-trace + reasoning disclosure panels' display
helpers and component behavior (the `tool-trace-display` pure helpers
extracted from `tool-trace-panel.tsx`: the `statusVisual` status → icon +
className mapping for ok/error/running with the `animate-spin` class that
lucide-react's missing `spin` prop requires, and the `formatArgsPreview`
arguments-preview formatter with its null-suppression for absent / empty /
whitespace-only / `{}` inputs, JSON-stringification of object/array/number/
boolean args, the `String()` fallback when `JSON.stringify` throws on
circular refs, the single-line whitespace collapse, and the configurable
char-cap truncation with ellipsis; plus the `ToolTracePanel` and
`ReasoningPanel` components themselves via the React Testing Library
`render`/`screen` harness — the empty-case early return, the summary-line
savings readout with the search/all mode label + the singular/plural step
+ request counts, the savings grid (Sent / Schema sent / Saved / Baseline)
+ the search/describe/call/deferred counts footer, the per-step rows with
the title-or-name label + service sublabel + running hint + args/output
previews, and critically the load-bearing "uncontrolled `<details>` +
one-shot auto-open during streaming" pattern that avoids the controlled-
open trap documented across iterations 11 and 17 — pinning that the panel
auto-opens on the first streaming render, stays open across the
isStreaming→false transition without re-touching, and never re-opens after
the user manually closes it, plus the `ReasoningPanel`'s `Thinking…` live
pulse vs the settled `Reasoning` label and the markdown body rendering),
and the header `TokenUsageMenu`'s pure display helpers extracted into
`token-usage-display` (the `getToolSearchEventLabel` / `getToolSearchEventDetail`
search-trace row rendering — quoted query + top-3-match-name join with the
`"no matches"` fallback and the 3-name cap, and the `"<name> schema loaded"` /
`"<name> invoked"` / `"<name> not found"` describe/call detail strings — plus
the `getBreakdownCategoryCopy` human label + description for each of the
three allocation categories with the tool-schema count's singular/plural
form and locale thousands separators, and the `getBreakdownBarColor` /
`getBreakdownDotColor` tailwind color-class mapping with the legend-matches-
segment invariant across tools/messages/systemPrompt), and the `TokenUsageMenu`
component itself via the React Testing Library harness (the summary trigger's
formatted session-total + the `0` fallback, the `Send a message to see usage.`
empty state, the last-request header total, the conditional rendering of the
`ProviderUsageGrid` / `PromptAllocation` / `ToolSearchPanel` panels keyed on
their respective prop presence, the singular/plural request + tool-count
copy, the search/all mode label, the savings-percentage line gated on
`savedSchemaTokens > 0`, the search/describe/call/deferred counts footer,
the nested `ToolSearchTrace` disclosure with its `latest N of M` and 5-row
cap, and the `ToolSchemaBreakdown` top-8 visible + aggregated `Other N tool
schema(s)` hidden-row contract), and the `Markdown`
renderer (the framework-agnostic react-markdown + remark-gfm replacement for
the reference's Streamdown, used by every assistant bubble, the reasoning
panel, and the Skills page bodies/preview: the wrapper-div class-merging, the
paragraph / h1–h6 / strong / em / ul / ol / blockquote / hr / img element
mappings onto the OKLCH design tokens, the block-vs-inline `<code>` detection
language-/newline heuristic with the bare-```-fence fallback path, the `<pre>`
block chrome vs the inline `<code>` muted pill, the link sandboxing
(target=`_blank` + rel=`noreferrer` + text-primary), the GFM features (tables
with th/td styling, strikethrough `<del>`, task-list checkboxes, autolinks),
and the load-bearing security contract that raw HTML is dropped by default
(both inline `<script>` and block-level `<div class="evil">` payloads are
stripped from the rendered DOM)), and the `CreateTaskDialog` modal form (the
interactive task-creation UX layered on top of the already-tested pure
`create-task-helpers`: the open/close surface — renders nothing when closed,
the full dialog chrome when open, and the four close affordances (header X
button, Cancel button, full-screen click catcher, and the Escape keydown);
the prefill-on-open effect that seeds the one-off time to ~10 minutes from
now and clears stale validation errors on re-open; the schedule-type toggle
between the One-off (`datetime-local` with the `+10s` / `+30s` / `+1m` /
`+5m` quick-offset buttons that preserve the seconds component) and
Recurring (cron with the Every-minute / Every-5-minutes / Hourly /
Daily-at-09:00 presets) fields; the validation-error rendering (title +
instruction required messages, the future-time runAt error, the cron-parser
constraint errors, and the `aria-invalid` field marking) without calling
`onCreate`/`onClose`; the submit happy path for both once and cron shapes
(title trimming, the scheduleType/runAt/cron field wiring, and the
close-on-success) via both the Create-button click and the form `onSubmit`;
and the title/instruction field binding + the `TITLE_MAX`/`INSTRUCTION_MAX`
`maxLength` caps), the `ScheduledJobsBoard` component (the entire `/tasks`
page surface layered on top of the already-tested `buildOverview` /
`canFire` + `display.ts` formatters, rendered against controlled store
fixtures while the real overview computation runs: the whole-board empty
state vs. the four-section board switch; the Running now / Up next / Paused /
Past runs section headings + per-row rendering (task title, schedule label,
status badge, duration, result, payload label); the per-section empty notes
that appear only when the board is otherwise non-empty (and the Paused
section's `null`-when-empty omission); the `homeSessionId`-gated View
transcript button; and the action wiring — Disable → `updateTask(id, {
isEnabled: false })`, Enable → `updateTask(id, { isEnabled: true })`, Delete →
a `window.confirm`-gated `removeTask(id)` (cancelled vs. confirmed), View
transcript → `goToTranscript(homeSessionId)`, and both New task buttons
opening the create dialog), and the `ThemeToggle` sidebar selector (the two-shape theme
affordance ported from the reference's commit 213e0af: the segmented
`Light | Dark | System` control when the sidebar is expanded
(`withLabel`), where the active segment reads as selection via
`aria-pressed` + the solid `bg-background` on the muted track and each
segment is a one-tap `setTheme`, and the single cycling icon when the rail
is docked (too narrow for three segments) that advances light → dark →
system → light; pinned via the React Testing Library harness against the
real `ThemeProvider`: the three labeled segments, the `aria-pressed` active
contract derived from the stored preference (defaulting to System), the
`setTheme` → localStorage persistence + `.dark`-class application on click,
the active-only `bg-background` styling, the rail's single-button shape +
derived `aria-label`/`title`, and the light → dark → system → light cycle
across repeated clicks), and the `AppSidebar` component (the persistent left
rail that holds the brand, the primary `Chat` / `Scheduled tasks` / `Skills`
nav, the `New chat` affordance, the live `Today`/`Older`-grouped chat-session
list, and the `ThemeToggle` footer — layered on the already-tested
`sidebar-grouping` helpers, `useChatSessions` / `useChatBusy` hooks, and
`sessions-store`, rendered against controlled router/shell/busy/sessions
mocks while the real grouping helpers run: the brand + collapse/expand toggle
(`toggleSidebar`), the three nav items with their `aria-current="page"`
active-state derivation from the router pathname (`Chat` active on both `/`
and `/chat/$sessionId`, `Scheduled tasks` on `/tasks`, `Skills` on `/skills`),
the icon-only rail shape when collapsed (labels hidden, surfaced via `title`),
the mobile backdrop + the close-on-nav behavior when the viewport is mobile,
the `New chat` button (`createSession` + navigate, disabled + no-op while a
chat is streaming), the session list's empty state, the `Today`/`Older`
calendar-day grouping + the per-row relative timestamp, and the
`aria-current="true"` active-session marker; and each `SessionRow`'s action
wiring — select → navigate (with the chatBusy guard that blocks navigating
*away* from an actively-streaming chat but allows the no-op back to the
active one), the inline rename (`Pencil` → input seeded with the current
title, commit on Enter or the `onMouseDown` `Check` button before blur
cancels, cancel on Escape, no-op on blank or unchanged draft), and the delete
(`window.confirm`-gated `removeSession` with the cancelled-vs-confirmed
split, the chatBusy guard that disables deleting the actively-streaming chat
but still permits deleting an idle one, and the redirect-to-`/` navigation
when the active chat is removed)), and the `chat-message` components
(`MessageRow` / `MessageBubble` / `MessageCopyButton`, the per-turn render
primitives extracted from `chat-surface.tsx` so the message-presentation
contract is unit-testable: the `Thinking…` streaming placeholder gated on
`isStreaming && content.length === 0`, the verbatim-vs-markdown content split
(user input rendered `whitespace-pre-wrap`, assistant replies through the
`Markdown` tree), the streaming caret, the user-only `activatedSkill` Zap
badge and assistant-only `scheduled`-origin `CalendarClock` badge, the
per-sender `items-end`/`items-start` alignment, the `ReasoningPanel` /
`ToolTracePanel` / token-usage-caption gating (caption suppressed while
streaming or for empty usage so it never flickers a mid-stream `0 · 0 · 0`),
the footer actions cluster (`Copy` on every settled non-empty assistant turn,
`Regenerate` only on the last one with a callback and never while streaming),
and the `MessageCopyButton`'s clipboard write + 1.5s `Copied` confirmation
flash + fail-soft on a rejecting clipboard API), and the app-chrome context
+ header components the whole UI is mounted under — the `AppShellProvider` /
`useAppShell` root context (the sidebar open/close state the `AppShellFrame`
reads for its `--sidebar-width` / `--sidebar-rail` CSS custom properties and
the `AppSidebar` consumes for its collapse/expand toggle, plus the SSR-safe
`isMobileViewport` matchMedia read and the exported `SIDEBAR_WIDTH` /
`SIDEBAR_RAIL` / `MOBILE_QUERY` layout constants), the `ChatShellProvider` /
`useChatShell` route context that lifts the chat's streaming status + running
token totals up to the `SiteHeader` (the default `chatBusy=false` +
empty-usage summary, `setBusy` / `setUsage` delegation, stable callback
identities, and the thrown-on-missing-consumer contract), and the iteration-31
side effect that mirrors the per-session `chatBusy` into the module-level
busy-signal so the root-level `AppSidebar` (which lives outside this
provider, in the root `AppShell`) can apply the reference's three chatBusy
guards (start new chat / select session / delete the active one) — pinned via
`getChatBusySnapshot` assertions that the busy flag mirrors on true and on a
true→false transition, and that the mirror resets to `false` on unmount so a
stale `true` can never leak into the next session's view, plus the
`SiteHeader` / `SiteHeaderStatus` presentational surface (the status +
actions right cluster with the actions cluster only rendering when actions
are supplied, the `banner` landmark, and the runtime status dot —
`aria-hidden` so screen readers rely on the label, `size-1.5` for the status
indicator, and the `animate-pulse` gate that pulses only while the page is
actively working), the root `AppShell` / `AppShellFrame` layout frame (the always-mounted root that wraps every routed page in the `AppShellProvider` and renders the persistent `AppSidebar` + the content region: the iteration-32 scheduler-boot invariant — `startTaskScheduler` fires exactly once on mount, never on re-render, and re-fires on a fresh lifecycle remount, so the scheduled-task ticker runs on EVERY route rather than only `/tasks`; the mobile-collapsed-on-mount side effect that calls `closeSidebar()` on first mount ONLY when `isMobileViewport()` returns true — so a fresh phone load starts with the rail docked — and is a no-op on desktop; and the structural rendering contract — the full-viewport `flex h-dvh bg-background` frame wrapping `AppSidebar` + the content region, with the `--sidebar-rail` CSS custom property pinned to `SIDEBAR_RAIL` regardless of state and `--sidebar-width` toggling between `SIDEBAR_WIDTH` (expanded) and `SIDEBAR_RAIL` (docked) off the `sidebarOpen` flag the provider flows down), and the `Button` design-system component (the cva
resolver's 4 variants × 3 sizes = 12 distinct class combinations, the
default-variant/default-size fallbacks, the load-bearing distinction that
`buttonVariants()` only concatenates classes while the `<Button>` component's
`cn()` wrapper runs tailwind-merge to strip overridden utilities like the
`h-10`/`px-4` the `icon` size overrides, the caller-`className` override
semantics where a conflicting caller utility wins and a non-conflicting one
appends, and the prop-forwarding surface — `onClick` / `type` / `disabled` /
`aria-*` / `data-*` / `title` all reach the underlying `<button>` while
`variant` / `size` are consumed by cva and never leak onto the DOM).

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
  on the OKLCH design system, with light/dark/system theming (a no-dep
  ThemeProvider replacing next-themes, a no-flash inline script, and a
  segmented Light|Dark|System selector pinned to the sidebar footer).
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
