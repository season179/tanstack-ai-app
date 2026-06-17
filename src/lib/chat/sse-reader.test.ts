import { describe, expect, it } from "vitest";
import {
  type ChatStreamEvent,
  parseBreakdownFrame,
  parseMetadataFrame,
  parseToolCallFrame,
  parseToolResultFrame,
  parseUsageFrame,
  readChatStream,
} from "~/lib/chat/sse-reader";
import type {
  MetadataFrame,
  ToolCallFrame,
  ToolResultFrame,
  UsageFrame,
} from "~/lib/chat/tool-events";

/** Build a ReadableStream<Uint8Array> from a list of raw SSE wire strings. */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

/** Wrap a frame payload as a `data:` SSE line. */
function dataFrame(payload: string): string {
  return `data: ${payload}\n\n`;
}

/** Drain a chat SSE stream into an array of parsed events. */
async function read(stream: ReadableStream<Uint8Array>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  await readChatStream(stream, (event) => out.push(event));
  return out;
}

describe("readChatStream", () => {
  it("dispatches text and error frames", async () => {
    const events = await read(
      streamOf(
        dataFrame('{"type":"text","text":"Hello"}'),
        dataFrame('{"type":"text","text":" world"}'),
        dataFrame('{"type":"error","message":"boom"}'),
      ),
    );
    expect(events).toEqual([
      { type: "text", text: "Hello" },
      { type: "text", text: " world" },
      { type: "error", message: "boom" },
    ]);
  });

  it("dispatches reasoning frames (iteration 17 wire shape)", async () => {
    const events = await read(streamOf(dataFrame('{"type":"reasoning","text":"thinking"}')));
    expect(events).toEqual([{ type: "reasoning", text: "thinking" }]);
  });

  it("ignores empty payload, [DONE], and non-data lines", async () => {
    const events = await read(
      streamOf(
        "event: ping\n\n",
        "data:\n\n",
        "data: [DONE]\n\n",
        dataFrame('{"type":"text","text":"only"}'),
      ),
    );
    expect(events).toEqual([{ type: "text", text: "only" }]);
  });

  it("silently drops malformed JSON", async () => {
    const events = await read(
      streamOf("data: {not json\n\n", dataFrame('{"type":"text","text":"after"}')),
    );
    expect(events).toEqual([{ type: "text", text: "after" }]);
  });

  it("silently drops unknown frame types", async () => {
    const events = await read(
      streamOf(
        dataFrame('{"type":"something_new","text":"x"}'),
        dataFrame('{"type":"text","text":"kept"}'),
      ),
    );
    expect(events).toEqual([{ type: "text", text: "kept" }]);
  });

  it("tolerates frames split across multiple chunks (line-buffered)", async () => {
    // A single `data:` frame is split across three enqueued chunks; the parser
    // must reconstruct it before parsing. Tests the line-buffering contract
    // that protects against partial reads off a real network stream.
    const events = await read(
      streamOf(
        'data: {"type":"text","te',
        'xt":"s',
        'plit"}\n\n',
        dataFrame('{"type":"text","text":"after"}'),
      ),
    );
    expect(events).toEqual([
      { type: "text", text: "split" },
      { type: "text", text: "after" },
    ]);
  });

  it("handles \\r\\n line endings", async () => {
    const events = await read(streamOf('data: {"type":"text","text":"crlf"}\r\n\r\n'));
    expect(events).toEqual([{ type: "text", text: "crlf" }]);
  });

  it("handles multiple frames within a single chunk", async () => {
    const events = await read(
      streamOf('data: {"type":"text","text":"a"}\n\ndata: {"type":"text","text":"b"}\n\n'),
    );
    expect(events).toEqual([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]);
  });

  it("dispatches tool_call and tool_result frames", async () => {
    const events = await read(
      streamOf(
        dataFrame('{"type":"tool_call","call":{"name":"tool_search","arguments":{"query":"x"}}}'),
        dataFrame('{"type":"tool_result","result":{"name":"tool_search","ok":true,"output":"y"}}'),
      ),
    );
    expect(events.map((e) => e.type)).toEqual(["tool_call", "tool_result"]);
    expect((events[0] as ToolCallFrame).call.name).toBe("tool_search");
    expect((events[1] as ToolResultFrame).result.output).toBe("y");
  });

  it("dispatches usage, breakdown, and metadata frames", async () => {
    const events = await read(
      streamOf(
        dataFrame('{"type":"usage","usage":{"inputTokens":10,"outputTokens":5,"totalTokens":15}}'),
        dataFrame(
          '{"type":"breakdown","breakdown":{"categories":[{"id":"systemPrompt","label":"System","tokens":3,"percentage":30,"chars":9}]}}',
        ),
        dataFrame('{"type":"metadata","metadata":{"mode":"search","sentToolCount":3}}'),
      ),
    );
    expect(events.map((e) => e.type)).toEqual(["usage", "breakdown", "metadata"]);
    expect((events[0] as UsageFrame).usage.totalTokens).toBe(15);
    expect((events[2] as MetadataFrame).metadata.mode).toBe("search");
  });

  it("drops tool_call frame whose payload fails validation", async () => {
    const events = await read(
      streamOf(
        dataFrame('{"type":"tool_call","call":{"name":""}}'), // empty name -> drop
        dataFrame('{"type":"text","text":"kept"}'),
      ),
    );
    expect(events).toEqual([{ type: "text", text: "kept" }]);
  });
});

describe("parseToolCallFrame", () => {
  it("parses a minimal call with name + arguments", () => {
    const frame = parseToolCallFrame({ name: "tool_search", arguments: { query: "weather" } });
    expect(frame).toEqual({
      type: "tool_call",
      call: { name: "tool_search", arguments: { query: "weather" } },
    });
  });

  it("preserves service + title when provided", () => {
    const frame = parseToolCallFrame({
      name: "get_weather",
      arguments: { city: "sf" },
      service: "weather",
      title: "Get Weather",
    });
    expect(frame).toEqual({
      type: "tool_call",
      call: {
        name: "get_weather",
        arguments: { city: "sf" },
        service: "weather",
        title: "Get Weather",
      },
    });
  });

  it("includes service/title keys as undefined when absent", () => {
    // The parser always emits both keys (set to undefined when non-string) so
    // the wire object shape is stable; the consumer reads them via optional
    // chaining and undefined is falsy-equivalent to absent.
    const frame = parseToolCallFrame({ name: "noop" });
    expect(Object.keys(frame?.call ?? {}).sort()).toEqual([
      "arguments",
      "name",
      "service",
      "title",
    ]);
    expect(frame?.call.service).toBeUndefined();
    expect(frame?.call.title).toBeUndefined();
    expect(frame?.call.arguments).toBeUndefined();
  });

  it("coerces non-string service/title to undefined", () => {
    const frame = parseToolCallFrame({ name: "x", service: 123, title: null });
    expect(frame?.call.service).toBeUndefined();
    expect(frame?.call.title).toBeUndefined();
  });

  it("keeps arguments as-is (unknown passthrough, including null/undefined)", () => {
    expect(parseToolCallFrame({ name: "x", arguments: null })?.call.arguments).toBeNull();
    expect(parseToolCallFrame({ name: "x" })?.call.arguments).toBeUndefined();
    expect(parseToolCallFrame({ name: "x", arguments: [1, 2] })?.call.arguments).toEqual([1, 2]);
  });

  it("returns null for non-object payload", () => {
    expect(parseToolCallFrame(null)).toBeNull();
    expect(parseToolCallFrame(undefined)).toBeNull();
    expect(parseToolCallFrame("string")).toBeNull();
    expect(parseToolCallFrame(42)).toBeNull();
  });

  it("returns null for missing or empty name", () => {
    expect(parseToolCallFrame({})).toBeNull();
    expect(parseToolCallFrame({ arguments: {} })).toBeNull();
    expect(parseToolCallFrame({ name: "" })).toBeNull();
    expect(parseToolCallFrame({ name: 123 })).toBeNull();
  });
});

describe("parseToolResultFrame", () => {
  it("parses an ok result with output", () => {
    const frame = parseToolResultFrame({ name: "tool_search", ok: true, output: "result text" });
    expect(frame).toEqual({
      type: "tool_result",
      result: { name: "tool_search", ok: true, output: "result text" },
    });
  });

  it("parses a failure result (ok:false) and keeps the output value", () => {
    const frame = parseToolResultFrame({ name: "tool_call", ok: false, output: { error: "nope" } });
    expect(frame?.result.ok).toBe(false);
    expect(frame?.result.output).toEqual({ error: "nope" });
  });

  it("coerces non-true ok to false (only exactly true is ok)", () => {
    expect(parseToolResultFrame({ name: "x", ok: "true" })?.result.ok).toBe(false);
    expect(parseToolResultFrame({ name: "x", ok: 1 })?.result.ok).toBe(false);
    expect(parseToolResultFrame({ name: "x" })?.result.ok).toBe(false);
    expect(parseToolResultFrame({ name: "x", ok: true })?.result.ok).toBe(true);
  });

  it("keeps output as-is when absent (undefined)", () => {
    expect(parseToolResultFrame({ name: "x", ok: true })?.result.output).toBeUndefined();
  });

  it("returns null for non-object payload", () => {
    expect(parseToolResultFrame(null)).toBeNull();
    expect(parseToolResultFrame(undefined)).toBeNull();
    expect(parseToolResultFrame("x")).toBeNull();
  });

  it("returns null for missing or empty name", () => {
    expect(parseToolResultFrame({})).toBeNull();
    expect(parseToolResultFrame({ ok: true })).toBeNull();
    expect(parseToolResultFrame({ name: "" })).toBeNull();
    expect(parseToolResultFrame({ name: 5 })).toBeNull();
  });
});

describe("parseUsageFrame", () => {
  it("parses a complete usage record", () => {
    const frame = parseUsageFrame({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      reasoningTokens: 12,
      cachedInputTokens: 88,
    });
    expect(frame?.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      reasoningTokens: 12,
      cachedInputTokens: 88,
    });
  });

  it("defaults missing numeric fields to 0", () => {
    const frame = parseUsageFrame({ inputTokens: 7 });
    expect(frame?.usage).toEqual({
      inputTokens: 7,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
    });
  });

  it("returns a full-zero record for an empty object (not null)", () => {
    // An empty object is a valid (all-zero) usage record so the UI can render
    // a "0 · 0 · 0" caption if it chooses; the gating is the consumer's job.
    const frame = parseUsageFrame({});
    expect(frame?.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
    });
  });

  it("coerces non-finite and negative numbers to 0", () => {
    const frame = parseUsageFrame({
      inputTokens: Number.POSITIVE_INFINITY,
      outputTokens: Number.NaN,
      totalTokens: -10,
      reasoningTokens: 3.5,
      cachedInputTokens: "5",
    });
    expect(frame?.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: 3.5,
      cachedInputTokens: 0,
    });
  });

  it("returns null for non-object payload", () => {
    expect(parseUsageFrame(null)).toBeNull();
    expect(parseUsageFrame(undefined)).toBeNull();
    expect(parseUsageFrame(5)).toBeNull();
  });
});

describe("parseBreakdownFrame", () => {
  const baseCategory = (id: "systemPrompt" | "messages" | "tools") => ({
    id,
    label: id,
    tokens: 10,
    percentage: 33,
    chars: 30,
  });

  it("parses a full breakdown with categories + tools", () => {
    const frame = parseBreakdownFrame({
      inputTokens: 100,
      requestCount: 4,
      messageCount: 24,
      toolCount: 3,
      excludedRequestOptionTokens: 5,
      categories: [baseCategory("systemPrompt"), baseCategory("tools")],
      tools: [{ name: "tool_search", tokens: 8, percentage: 80, chars: 20 }],
    });
    expect(frame?.type).toBe("breakdown");
    expect(frame?.breakdown.inputTokens).toBe(100);
    expect(frame?.breakdown.estimated).toBe(true);
    expect(frame?.breakdown.requestCount).toBe(4);
    expect(frame?.breakdown.categories.map((c) => c.id)).toEqual(["systemPrompt", "tools"]);
    expect(frame?.breakdown.tools[0]).toEqual({
      name: "tool_search",
      tokens: 8,
      percentage: 80,
      chars: 20,
    });
  });

  it("defaults requestCount to 1 when missing/zero/non-numeric", () => {
    expect(
      parseBreakdownFrame({ categories: [baseCategory("messages")] })?.breakdown.requestCount,
    ).toBe(1);
    expect(
      parseBreakdownFrame({ requestCount: 0, categories: [baseCategory("messages")] })?.breakdown
        .requestCount,
    ).toBe(1);
  });

  it("marks estimated=true always (client-owned mirror of the server)", () => {
    const frame = parseBreakdownFrame({ categories: [baseCategory("tools")] });
    expect(frame?.breakdown.estimated).toBe(true);
  });

  it("treats inputTokens as optional (undefined when absent/non-finite)", () => {
    expect(
      parseBreakdownFrame({ categories: [baseCategory("tools")] })?.breakdown.inputTokens,
    ).toBeUndefined();
    expect(
      parseBreakdownFrame({
        inputTokens: Number.POSITIVE_INFINITY,
        categories: [baseCategory("tools")],
      })?.breakdown.inputTokens,
    ).toBeUndefined();
  });

  it("treats tools as optional (defaults to empty array)", () => {
    const frame = parseBreakdownFrame({ categories: [baseCategory("tools")] });
    expect(frame?.breakdown.tools).toEqual([]);
  });

  it("drops categories with unknown ids", () => {
    const frame = parseBreakdownFrame({
      categories: [
        baseCategory("messages"),
        { id: "bogus", label: "X", tokens: 5, percentage: 10, chars: 2 },
        { id: 123, label: "X", tokens: 5, percentage: 10, chars: 2 },
      ],
    });
    expect(frame?.breakdown.categories.map((c) => c.id)).toEqual(["messages"]);
  });

  it("defaults a category's label to its id when blank/missing/non-string", () => {
    const frame = parseBreakdownFrame({
      categories: [{ id: "systemPrompt", tokens: 5, percentage: 10, chars: 2 }],
    });
    expect(frame?.breakdown.categories[0].label).toBe("systemPrompt");
  });

  it("coerces non-finite/negative numeric category fields to 0", () => {
    const frame = parseBreakdownFrame({
      categories: [
        {
          id: "tools",
          label: "Tools",
          tokens: -5,
          percentage: Number.NaN,
          chars: Number.POSITIVE_INFINITY,
        },
      ],
    });
    expect(frame?.breakdown.categories[0]).toEqual({
      id: "tools",
      label: "Tools",
      tokens: 0,
      percentage: 0,
      chars: 0,
    });
  });

  it("drops tools with missing/empty/non-string name", () => {
    const frame = parseBreakdownFrame({
      categories: [baseCategory("tools")],
      tools: [
        { name: "good", tokens: 1, percentage: 1, chars: 1 },
        { name: "", tokens: 1, percentage: 1, chars: 1 },
        { name: 5, tokens: 1, percentage: 1, chars: 1 },
        {},
      ],
    });
    expect(frame?.breakdown.tools.map((t) => t.name)).toEqual(["good"]);
  });

  it("returns null for non-object payload", () => {
    expect(parseBreakdownFrame(null)).toBeNull();
    expect(parseBreakdownFrame(undefined)).toBeNull();
    expect(parseBreakdownFrame("x")).toBeNull();
  });

  it("returns null when categories is missing or non-array", () => {
    expect(parseBreakdownFrame({})).toBeNull();
    expect(parseBreakdownFrame({ categories: "nope" })).toBeNull();
  });

  it("returns null when no categories survive validation", () => {
    expect(
      parseBreakdownFrame({
        categories: [{ id: "bogus", label: "X", tokens: 1, percentage: 1, chars: 1 }],
      }),
    ).toBeNull();
  });
});

describe("parseMetadataFrame", () => {
  const base = {
    mode: "search" as const,
    availableToolCount: 200,
    sentToolCount: 3,
    deferredToolCount: 197,
    requestCount: 4,
    catalogSchemaTokens: 29636,
    sentSchemaTokens: 1560,
    baselineSchemaTokens: 29636,
    savedSchemaTokens: 28076,
    searchCount: 1,
    describeCount: 1,
    callCount: 1,
  };

  it("parses a complete search-mode metadata frame", () => {
    const frame = parseMetadataFrame(base);
    expect(frame?.type).toBe("metadata");
    expect(frame?.metadata.mode).toBe("search");
    expect(frame?.metadata.savedSchemaTokens).toBe(28076);
    expect(frame?.metadata.trace).toBeUndefined();
  });

  it("parses an all-mode metadata frame", () => {
    const frame = parseMetadataFrame({ ...base, mode: "all", sentToolCount: 200 });
    expect(frame?.metadata.mode).toBe("all");
    expect(frame?.metadata.sentToolCount).toBe(200);
  });

  it("returns null for an invalid mode", () => {
    expect(parseMetadataFrame({ ...base, mode: "none" })).toBeNull();
    expect(parseMetadataFrame({ ...base, mode: 123 })).toBeNull();
  });

  it("defaults numeric fields to 0 when missing/non-numeric", () => {
    const frame = parseMetadataFrame({ mode: "search" });
    expect(frame?.metadata.sentToolCount).toBe(0);
    expect(frame?.metadata.catalogSchemaTokens).toBe(0);
    expect(frame?.metadata.callCount).toBe(0);
  });

  it("returns null for non-object payload", () => {
    expect(parseMetadataFrame(null)).toBeNull();
    expect(parseMetadataFrame(undefined)).toBeNull();
    expect(parseMetadataFrame("x")).toBeNull();
  });

  it("parses a search trace event with matches", () => {
    const frame = parseMetadataFrame({
      ...base,
      trace: [
        {
          kind: "search",
          query: "weather",
          matches: [{ name: "get_weather", service: "weather", title: "Get Weather" }],
        },
      ],
    });
    expect(frame?.metadata.trace).toEqual([
      {
        kind: "search",
        query: "weather",
        matches: [{ name: "get_weather", service: "weather", title: "Get Weather" }],
      },
    ]);
  });

  it("parses describe and call trace events (found flagged)", () => {
    const frame = parseMetadataFrame({
      ...base,
      trace: [
        {
          kind: "describe",
          name: "get_weather",
          found: true,
          title: "Get Weather",
          service: "weather",
        },
        { kind: "call", name: "get_weather", found: false },
      ],
    });
    expect(frame?.metadata.trace?.[0]).toEqual({
      kind: "describe",
      name: "get_weather",
      found: true,
      title: "Get Weather",
      service: "weather",
    });
    expect(frame?.metadata.trace?.[1]).toEqual({
      kind: "call",
      name: "get_weather",
      found: false,
    });
  });

  it("coerces non-true found to false in describe/call events", () => {
    const frame = parseMetadataFrame({
      ...base,
      trace: [{ kind: "describe", name: "x", found: "yes" }],
    });
    const trace = frame?.metadata.trace?.[0];
    expect(trace?.kind).toBe("describe");
    if (trace?.kind === "describe") {
      expect(trace.found).toBe(false);
    }
  });

  it("drops describe/call trace events missing a name", () => {
    const frame = parseMetadataFrame({
      ...base,
      trace: [{ kind: "describe", found: true }, { kind: "call" }, { kind: "search", query: "q" }],
    });
    // describe/call dropped; the valid search event survives
    expect(frame?.metadata.trace).toEqual([{ kind: "search", query: "q", matches: [] }]);
  });

  it("defaults a search event's query to empty string and matches to empty array", () => {
    const frame = parseMetadataFrame({ ...base, trace: [{ kind: "search" }] });
    expect(frame?.metadata.trace).toEqual([{ kind: "search", query: "", matches: [] }]);
  });

  it("drops trace events with unknown kinds", () => {
    const frame = parseMetadataFrame({
      ...base,
      trace: [
        { kind: "bogus", name: "x" },
        { kind: "search", query: "ok" },
      ],
    });
    expect(frame?.metadata.trace?.length).toBe(1);
    expect(frame?.metadata.trace?.[0].kind).toBe("search");
  });

  it("drops match entries with missing/empty/non-string name", () => {
    const frame = parseMetadataFrame({
      ...base,
      trace: [
        {
          kind: "search",
          query: "q",
          matches: [{ name: "good" }, { name: "" }, { name: 5 }, { service: "x" }, null],
        },
      ],
    });
    const trace = frame?.metadata.trace?.[0];
    if (trace?.kind === "search") {
      expect(trace.matches).toEqual([{ name: "good" }]);
    }
  });

  it("omits trace from the parsed frame when empty after validation", () => {
    const frame = parseMetadataFrame({ ...base, trace: [{ kind: "bogus" }] });
    expect(frame?.metadata.trace).toBeUndefined();
  });

  it("treats a non-array trace as no trace", () => {
    const frame = parseMetadataFrame({ ...base, trace: "nope" });
    expect(frame?.metadata.trace).toBeUndefined();
  });
});
