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

      // SSE frames are separated by blank lines; a single read can carry a
      // partial frame, a full frame, or several. Process only complete frames
      // and keep the remainder buffered for the next read.
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

        const delta = extractDelta(payload);
        if (delta) {
          onEvent({ type: "text", text: delta });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Pull the assistant text out of an OpenAI-style streaming chunk. */
function extractDelta(payload: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    // Malformed JSON frames are dropped; the upstream sometimes emits comments
    // or keepalive traffic that isn't valid JSON.
    return null;
  }

  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const content = (choices[0] as { delta?: { content?: unknown } }).delta?.content;
  return typeof content === "string" && content.length > 0 ? content : null;
}
