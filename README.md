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

## Status

Scaffold + design system + app chrome. Streaming chat, tool search, and token
instrumentation land in subsequent iterations.
