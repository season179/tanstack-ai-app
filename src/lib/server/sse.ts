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
 * and any non-content deltas are ignored.
 */
export async function pumpChatCompletion(
  upstream: ReadableStream<Uint8Array> | null,
  onEvent: ChatStreamSink,
  signal?: AbortSignal,
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
    },
    signal,
  );
}

/**
 * Lower-level OpenAI streaming chunk: the parsed `choices[0].delta` fields we
 * care about plus the terminal `finish_reason`. Used by the tool-aware turn
 * pump; the content-only `pumpChatCompletion` keeps its own simpler reader so
 * the existing plain chat path stays byte-identical.
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

  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return {};
  }

  const choice = choices[0] as {
    delta?: { content?: unknown; tool_calls?: unknown };
    finish_reason?: unknown;
  };
  const delta = choice.delta ?? {};
  const chunk: OpenAiDeltaChunk = {};

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
