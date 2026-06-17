/**
 * Shared client-side SSE reader for the app's self-owned `/api/chat` protocol.
 *
 * Extracted verbatim from use-chat-stream so two independent consumers — the
 * React chat hook (interactive turns) and the scheduled-task executor
 * (background agent runs that fire on a cron/one-off schedule) — fold the exact
 * same frames into the same ChatMessage shape. Pure, no React: a plain
 * `data:` line pump that validates each frame payload off the wire and hands a
 * discriminated-union `ChatStreamEvent` to the caller.
 */
import type {
  BreakdownFrame,
  MetadataFrame,
  ToolCallFrame,
  ToolFrame,
  ToolResultFrame,
  UsageFrame,
} from "~/lib/chat/tool-events";

export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | ToolFrame;

/**
 * Read `/api/chat`'s SSE body and dispatch one callback per parsed frame.
 * Tolerates partial frames split across chunks (line-buffered) and silently
 * drops malformed JSON / unknown frame types, matching the server's contract.
 */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
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

      let parsed: {
        type?: unknown;
        text?: unknown;
        message?: unknown;
        call?: unknown;
        result?: unknown;
        metadata?: unknown;
        usage?: unknown;
        breakdown?: unknown;
      };
      try {
        parsed = JSON.parse(payload) as typeof parsed;
      } catch {
        continue;
      }

      if (parsed.type === "text" && typeof parsed.text === "string") {
        onEvent({ type: "text", text: parsed.text });
      } else if (parsed.type === "reasoning" && typeof parsed.text === "string") {
        onEvent({ type: "reasoning", text: parsed.text });
      } else if (parsed.type === "error" && typeof parsed.message === "string") {
        onEvent({ type: "error", message: parsed.message });
      } else if (parsed.type === "tool_call") {
        const frame = parseToolCallFrame(parsed.call);
        if (frame) {
          onEvent(frame);
        }
      } else if (parsed.type === "tool_result") {
        const frame = parseToolResultFrame(parsed.result);
        if (frame) {
          onEvent(frame);
        }
      } else if (parsed.type === "usage") {
        const frame = parseUsageFrame(parsed.usage);
        if (frame) {
          onEvent(frame);
        }
      } else if (parsed.type === "breakdown") {
        const frame = parseBreakdownFrame(parsed.breakdown);
        if (frame) {
          onEvent(frame);
        }
      } else if (parsed.type === "metadata") {
        const frame = parseMetadataFrame(parsed.metadata);
        if (frame) {
          onEvent(frame);
        }
      }
    }
  }
}

/** Validate a tool_call frame payload off the wire; null if malformed. */
export function parseToolCallFrame(raw: unknown): ToolCallFrame | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const call = raw as { name?: unknown; arguments?: unknown; service?: unknown; title?: unknown };
  if (typeof call.name !== "string" || call.name.length === 0) {
    return null;
  }
  return {
    type: "tool_call",
    call: {
      name: call.name,
      arguments: call.arguments,
      service: typeof call.service === "string" ? call.service : undefined,
      title: typeof call.title === "string" ? call.title : undefined,
    },
  };
}

/** Validate a tool_result frame payload off the wire; null if malformed. */
export function parseToolResultFrame(raw: unknown): ToolResultFrame | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const result = raw as { name?: unknown; ok?: unknown; output?: unknown };
  if (typeof result.name !== "string" || result.name.length === 0) {
    return null;
  }
  return {
    type: "tool_result",
    result: {
      name: result.name,
      ok: result.ok === true,
      output: result.output,
    },
  };
}

/**
 * Validate a usage frame payload off the wire; null if malformed or missing
 * the numeric fields the UI reads. Defaults any missing field to 0 so the
 * provider's partial usage (e.g. only prompt/completion, no cached/reasoning)
 * still surfaces without crashing the parser.
 */
export function parseUsageFrame(raw: unknown): UsageFrame | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const u = raw as Record<string, unknown>;
  const num = (key: string): number =>
    typeof u[key] === "number" && Number.isFinite(u[key] as number) && (u[key] as number) >= 0
      ? (u[key] as number)
      : 0;
  return {
    type: "usage",
    usage: {
      inputTokens: num("inputTokens"),
      outputTokens: num("outputTokens"),
      totalTokens: num("totalTokens"),
      reasoningTokens: num("reasoningTokens"),
      cachedInputTokens: num("cachedInputTokens"),
    },
  };
}

/**
 * Validate a breakdown frame payload off the wire; null if malformed or
 * missing the categories array the UI renders. Numeric fields default sanely
 * so a partial breakdown still surfaces; unknown extra fields are dropped so
 * the persisted shape stays the client's own.
 */
export function parseBreakdownFrame(raw: unknown): BreakdownFrame | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const b = raw as Record<string, unknown>;
  if (!Array.isArray(b.categories)) {
    return null;
  }
  const categories = b.categories
    .map(parseBreakdownCategory)
    .filter((category): category is NonNullable<typeof category> => category !== undefined);
  if (categories.length === 0) {
    return null;
  }
  const tools = Array.isArray(b.tools)
    ? b.tools
        .map(parseToolBreakdown)
        .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined)
    : [];
  const num = (key: string): number =>
    typeof b[key] === "number" && Number.isFinite(b[key] as number) && (b[key] as number) >= 0
      ? (b[key] as number)
      : 0;
  const inputTokens =
    typeof b.inputTokens === "number" && Number.isFinite(b.inputTokens) ? b.inputTokens : undefined;
  return {
    type: "breakdown",
    breakdown: {
      inputTokens,
      estimated: true,
      requestCount: num("requestCount") || 1,
      messageCount: num("messageCount"),
      toolCount: num("toolCount"),
      excludedRequestOptionTokens: num("excludedRequestOptionTokens"),
      categories,
      tools,
    },
  };
}

function parseBreakdownCategory(
  raw: unknown,
): import("~/lib/chat/tool-events").TokenUsageBreakdownCategory | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const c = raw as Record<string, unknown>;
  if (c.id !== "systemPrompt" && c.id !== "messages" && c.id !== "tools") {
    return undefined;
  }
  const id = c.id;
  const num = (key: string): number =>
    typeof c[key] === "number" && Number.isFinite(c[key] as number) && (c[key] as number) >= 0
      ? (c[key] as number)
      : 0;
  return {
    id,
    label: typeof c.label === "string" && c.label.length > 0 ? c.label : id,
    tokens: num("tokens"),
    percentage: num("percentage"),
    chars: num("chars"),
  };
}

function parseToolBreakdown(
  raw: unknown,
): import("~/lib/chat/tool-events").TokenUsageToolBreakdown | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const t = raw as Record<string, unknown>;
  if (typeof t.name !== "string" || t.name.length === 0) {
    return undefined;
  }
  const num = (key: string): number =>
    typeof t[key] === "number" && Number.isFinite(t[key] as number) && (t[key] as number) >= 0
      ? (t[key] as number)
      : 0;
  return {
    name: t.name,
    tokens: num("tokens"),
    percentage: num("percentage"),
    chars: num("chars"),
  };
}

/**
 * Validate a metadata frame payload off the wire; null if malformed or missing
 * the numeric fields the UI reads. Unknown extra fields (e.g. `trace`) are
 * tolerated and dropped so the persisted shape stays the client's own.
 */
export function parseMetadataFrame(raw: unknown): MetadataFrame | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const m = raw as Record<string, unknown>;
  const mode = m.mode === "all" || m.mode === "search" ? m.mode : null;
  if (!mode) {
    return null;
  }
  const num = (key: string): number => (typeof m[key] === "number" ? (m[key] as number) : 0);
  const trace = Array.isArray(m.trace)
    ? m.trace
        .map(parseTraceEvent)
        .filter((event): event is NonNullable<typeof event> => event !== null)
    : [];
  return {
    type: "metadata",
    metadata: {
      mode,
      availableToolCount: num("availableToolCount"),
      sentToolCount: num("sentToolCount"),
      deferredToolCount: num("deferredToolCount"),
      requestCount: num("requestCount"),
      catalogSchemaTokens: num("catalogSchemaTokens"),
      sentSchemaTokens: num("sentSchemaTokens"),
      baselineSchemaTokens: num("baselineSchemaTokens"),
      savedSchemaTokens: num("savedSchemaTokens"),
      searchCount: num("searchCount"),
      describeCount: num("describeCount"),
      callCount: num("callCount"),
      trace: trace.length > 0 ? trace : undefined,
    },
  };
}

/**
 * Validate a single bridge trace event off the wire. Returns null for anything
 * that isn't a {kind: search|describe|call} object with the fields the UI reads;
 * extra fields are dropped so the persisted shape stays the client's own.
 */
function parseTraceEvent(
  raw: unknown,
): import("~/lib/chat/tool-events").ToolSearchTraceEvent | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const e = raw as Record<string, unknown>;
  const str = (key: string): string | undefined =>
    typeof e[key] === "string" ? (e[key] as string) : undefined;
  const name = str("name");
  const title = str("title");
  const service = str("service");

  if (e.kind === "search") {
    const query = str("query") ?? "";
    const matches = Array.isArray(e.matches)
      ? e.matches
          .map(parseTraceEventMatch)
          .filter((match): match is NonNullable<typeof match> => match !== null)
      : [];
    return { kind: "search", query, matches };
  }
  if ((e.kind === "describe" || e.kind === "call") && typeof name === "string") {
    const found = e.found === true;
    return { kind: e.kind, name, found, title, service };
  }
  return null;
}

function parseTraceEventMatch(
  raw: unknown,
): import("~/lib/chat/tool-events").ToolSearchTraceMatch | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const x = raw as Record<string, unknown>;
  if (typeof x.name !== "string" || x.name.length === 0) {
    return null;
  }
  const str = (key: string): string | undefined =>
    typeof x[key] === "string" ? (x[key] as string) : undefined;
  return { name: x.name, service: str("service"), title: str("title") };
}
