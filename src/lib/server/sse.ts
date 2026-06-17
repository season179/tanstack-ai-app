/**
 * Tiny server-sent-events writer. The chat route re-emits OpenRouter's upstream
 * SSE in a minimal, self-owned protocol so the client parses one shape instead
 * of the raw OpenAI chunk tree. Every event is a JSON `data:` line terminated by
 * a blank line:
 *
 *   data: {"type":"text","text":"Hello"}\n\n
 *   data: {"type":"error","message":"..."}\n\n
 *   data: [DONE]\n\n
 */
export type ChatStreamEvent = { type: "text"; text: string } | { type: "error"; message: string };

export type ChatStreamSink = (event: ChatStreamEvent) => void;

/**
 * Wrap a value in a single SSE `data:` frame. Newlines are escaped via
 * JSON.stringify, so a frame never leaks across the wire mid-value.
 */
export function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export const SSE_DONE = "data: [DONE]\n\n";

/** Standard headers for a text/event-stream response. */
export const SSE_HEADERS: HeadersInit = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

/**
 * Pump an upstream SSE byte stream through a transform that yields our own
 * text/error events, invoking `onEvent` for each assistant token. Returns when
 * the upstream stream closes or errors. The upstream's terminal `data: [DONE]`
 * and any non-content deltas are ignored. Real OpenRouter `usage` from the
 * final chunk is folded into `onUsage` if provided (the plain chat path emits
 * a single per-turn usage frame once the stream resolves).
 */
export async function pumpChatCompletion(
  upstream: ReadableStream<Uint8Array> | null,
  onEvent: ChatStreamSink,
  signal?: AbortSignal,
  onUsage?: (usage: OpenAiUsage) => void,
): Promise<void> {
  // Content-only view over the generic OpenAI chunk pump: any text delta is
  // re-emitted as our minimal {type:"text"} event. Tool-call deltas are
  // ignored here (the plain chat path never sends tools).
  await forEachOpenAiDelta(
    upstream,
    (delta) => {
      if (delta.content) {
        onEvent({ type: "text", text: delta.content });
      }
      if (delta.usage) {
        onUsage?.(delta.usage);
      }
    },
    signal,
  );
}

/**
 * Real token usage emitted by OpenRouter in the terminal chunk when the
 * request set `stream_options.include_usage: true`. All fields are optional
 * because providers differ in which details they populate; callers compact
 * this into the client-facing TurnTokenUsage shape (undefined → 0).
 *
 * Mirrors the OpenAI/OpenRouter shape: `prompt_tokens_details.cached_tokens`
 * is the cache-read count, `completion_tokens_details.reasoning_tokens` is the
 * reasoning output the model produced before its visible answer.
 */
export type OpenAiUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedPromptTokens?: number;
  reasoningTokens?: number;
};

/**
 * Lower-level OpenAI streaming chunk: the parsed `choices[0].delta` fields we
 * care about plus the terminal `finish_reason` and the top-level `usage`
 * (emitted once in the final chunk when include_usage is on). Used by the
 * tool-aware turn pump; the content-only `pumpChatCompletion` keeps its own
 * simpler reader so the existing plain chat path stays byte-identical.
 */
export type OpenAiDeltaChunk = {
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
  finishReason?: string | null;
  usage?: OpenAiUsage;
};

/**
 * Pump an upstream SSE byte stream, invoking `onChunk` for each OpenAI-style
 * `data:` frame's `choices[0]` delta + finish_reason. Returns when the upstream
 * closes or errors. Empty/data-[DONE] frames are ignored, as are malformed
 * JSON frames (OpenRouter occasionally emits keepalive comments).
 */
export async function forEachOpenAiDelta(
  upstream: ReadableStream<Uint8Array> | null,
  onChunk: (delta: OpenAiDeltaChunk) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!upstream) {
    return;
  }

  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");

        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const payload = trimmed.slice("data:".length).trim();
        if (payload.length === 0 || payload === "[DONE]") {
          continue;
        }

        const chunk = parseOpenAiDelta(payload);
        if (chunk) {
          onChunk(chunk);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Extract the assistant delta + finish reason from one OpenAI chunk payload. */
function parseOpenAiDelta(payload: string): OpenAiDeltaChunk | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const root = parsed as { choices?: unknown; usage?: unknown };

  const chunk: OpenAiDeltaChunk = {};

  // OpenRouter/OpenAI emit the final usage as a TOP-LEVEL field on a terminal
  // chunk whose `choices` array is empty. Extract it before the empty-choices
  // early return so the per-turn token accounting isn't silently dropped.
  const usage = parseUsage(root.usage);
  if (usage) {
    chunk.usage = usage;
  }

  const choices = root.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    // Either the usage-only final chunk (usage captured above) or a malformed
    // keepalive; return what we have so the caller sees any usage we parsed.
    return chunk;
  }

  const choice = choices[0] as {
    delta?: { content?: unknown; tool_calls?: unknown };
    finish_reason?: unknown;
  };
  const delta = choice.delta ?? {};

  if (typeof delta.content === "string" && delta.content.length > 0) {
    chunk.content = delta.content;
  }

  if (Array.isArray(delta.tool_calls)) {
    chunk.tool_calls = (delta.tool_calls as Array<Record<string, unknown>>)
      .map((raw) => {
        const index = typeof raw.index === "number" ? raw.index : 0;
        const id = typeof raw.id === "string" ? raw.id : undefined;
        const type = typeof raw.type === "string" ? raw.type : undefined;
        const fn = raw.function as { name?: unknown; arguments?: unknown } | undefined;
        const name = typeof fn?.name === "string" ? fn.name : undefined;
        const args = typeof fn?.arguments === "string" ? fn.arguments : undefined;
        return { index, id, type, function: { name, arguments: args } };
      })
      // Keep any fragment that carries a useful field. Streaming arguments
      // arrive in chunks that have ONLY index + function.arguments (no id or
      // name, which come in the first chunk); dropping those would silently
      // erase the entire arguments string and dispatch every tool with {}.
      .filter(
        (call) =>
          call.id !== undefined ||
          call.function.name !== undefined ||
          (call.function.arguments !== undefined && call.function.arguments.length > 0),
      );
    if (chunk.tool_calls.length === 0) {
      delete chunk.tool_calls;
    }
  }

  if (typeof choice.finish_reason === "string") {
    chunk.finishReason = choice.finish_reason;
  }

  return chunk;
}

/**
 * Read the OpenAI/OpenRouter usage object off a chunk. Returns null when the
 * payload is absent or carries no numeric field we care about (the provider
 * sometimes sends `{}` while streaming). Numbers are coerced: non-finite or
 * negative values are dropped so the client can trust any present field.
 */
function parseUsage(raw: unknown): OpenAiUsage | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const u = raw as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown } | null;
    completion_tokens_details?: { reasoning_tokens?: unknown } | null;
  };

  const num = (value: unknown): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return undefined;
    }
    return value;
  };

  const usage: OpenAiUsage = {};
  const promptTokens = num(u.prompt_tokens);
  const completionTokens = num(u.completion_tokens);
  const totalTokens = num(u.total_tokens);
  const cachedPromptTokens = num(u.prompt_tokens_details?.cached_tokens);
  const reasoningTokens = num(u.completion_tokens_details?.reasoning_tokens);

  if (promptTokens !== undefined) {
    usage.promptTokens = promptTokens;
  }
  if (completionTokens !== undefined) {
    usage.completionTokens = completionTokens;
  }
  if (totalTokens !== undefined) {
    usage.totalTokens = totalTokens;
  }
  if (cachedPromptTokens !== undefined) {
    usage.cachedPromptTokens = cachedPromptTokens;
  }
  if (reasoningTokens !== undefined) {
    usage.reasoningTokens = reasoningTokens;
  }

  return Object.keys(usage).length > 0 ? usage : null;
}
