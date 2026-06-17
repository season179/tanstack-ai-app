import { describe, expect, it } from "vitest";

import { forEachOpenAiDelta, type OpenAiDeltaChunk, SSE_DONE, sseData } from "~/lib/server/sse";

/** Build a ReadableStream<Uint8Array> from a list of SSE frame strings. */
function streamOf(...frames: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(new TextEncoder().encode(frame));
      }
      controller.close();
    },
  });
}

/** Drain a stream into an array of delta chunks. */
async function read(stream: ReadableStream<Uint8Array>): Promise<OpenAiDeltaChunk[]> {
  const out: OpenAiDeltaChunk[] = [];
  await forEachOpenAiDelta(stream, (delta) => out.push(delta));
  return out;
}

const textChunk = (content: string, finishReason: string | null = null) =>
  sseData({
    choices: [{ delta: { content }, ...(finishReason ? { finish_reason: finishReason } : {}) }],
  });

const reasoningChunk = (reasoning: string, viaContent = false) =>
  sseData({
    choices: [
      {
        delta: viaContent ? { reasoning_content: reasoning } : { reasoning },
      },
    ],
  });

const usageOnlyChunk = (usage: object) => sseData({ choices: [], usage });

describe("sseData", () => {
  it("wraps a payload in a single data: frame terminated by a blank line", () => {
    expect(sseData({ type: "text", text: "hi" })).toBe('data: {"type":"text","text":"hi"}\n\n');
  });
});

describe("forEachOpenAiDelta", () => {
  it("yields one content delta per chunk and ignores [DONE] / empty / non-data lines", async () => {
    const chunks = await read(
      streamOf(
        textChunk("Hello"),
        "event: ping\n\n", // non-data line, ignored
        "data:\n\n", // empty payload, ignored
        SSE_DONE,
        textChunk("world", "stop"),
      ),
    );
    expect(chunks.map((c) => c.content)).toEqual(["Hello", "world"]);
    expect(chunks.at(-1)?.finishReason).toBe("stop");
  });

  it("coalesces multi-frame content into ordered deltas", async () => {
    const chunks = await read(streamOf(textChunk("a"), textChunk("b"), textChunk("c")));
    expect(chunks.map((c) => c.content).join("")).toBe("abc");
  });

  it("parses reasoning deltas from OpenRouter's normalized `reasoning` field", async () => {
    const chunks = await read(streamOf(reasoningChunk("thinking...")));
    expect(chunks[0].reasoning).toBe("thinking...");
  });

  it("parses reasoning deltas from the raw `reasoning_content` field some providers still stream", async () => {
    // iteration 17 finding: DeepSeek still emits reasoning_content; a parser
    // that only reads `reasoning` silently drops all chain-of-thought.
    const chunks = await read(streamOf(reasoningChunk("CoT", true)));
    expect(chunks[0].reasoning).toBe("CoT");
  });

  it("captures the terminal usage from the empty-choices chunk (iteration 12 regression)", async () => {
    // The terminal usage chunk has choices: [] and the usage object at the
    // top level. The parser MUST extract usage BEFORE the empty-choices early
    // return or it's silently dropped.
    const chunks = await read(
      streamOf(
        textChunk("pong"),
        usageOnlyChunk({
          prompt_tokens: 36,
          completion_tokens: 32,
          total_tokens: 68,
          prompt_tokens_details: { cached_tokens: 12 },
          completion_tokens_details: { reasoning_tokens: 8 },
        }),
      ),
    );
    const usage = chunks.at(-1)?.usage;
    expect(usage).toEqual({
      promptTokens: 36,
      completionTokens: 32,
      totalTokens: 68,
      cachedPromptTokens: 12,
      reasoningTokens: 8,
    });
  });

  it("returns null usage from a malformed / empty usage object", async () => {
    const chunks = await read(streamOf(usageOnlyChunk({})));
    expect(chunks.at(-1)?.usage).toBeUndefined();
  });

  it("drops non-finite / negative usage fields", async () => {
    const chunks = await read(
      streamOf(
        usageOnlyChunk({
          prompt_tokens: -5,
          completion_tokens: Number.NaN,
          total_tokens: 7,
        }),
      ),
    );
    expect(chunks.at(-1)?.usage).toEqual({ totalTokens: 7 });
  });

  it("reassembles streamed tool_call fragments (iteration 10 regression)", async () => {
    // The first fragment carries id + name; subsequent fragments carry only
    // index + function.arguments (the args string arrives in pieces). A parser
    // that filters on id/name presence silently erases every arg fragment.
    const chunks = await read(
      streamOf(
        sseData({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: { name: "tool_search", arguments: "" },
                  },
                ],
              },
            },
          ],
        }),
        sseData({
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"qu' } }],
              },
            },
          ],
        }),
        sseData({
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: 'ery":"x"}' } }],
              },
            },
          ],
        }),
      ),
    );
    const allCalls = chunks.flatMap((c) => c.tool_calls ?? []);
    expect(allCalls).toHaveLength(3);
    // Every fragment is kept (id+name in the first, non-empty args in the rest).
    expect(allCalls.every((c) => c.function?.arguments !== undefined)).toBe(true);
    expect(allCalls[0].id).toBe("call_1");
    expect(allCalls[0].function?.name).toBe("tool_search");
  });

  it("ignores malformed JSON frames (keepalive comments etc.)", async () => {
    const chunks = await read(streamOf("data: not json\n\n", ": keepalive\n\n", textChunk("ok")));
    expect(chunks.map((c) => c.content)).toEqual(["ok"]);
  });

  it("returns immediately for a null upstream", async () => {
    const out: OpenAiDeltaChunk[] = [];
    await forEachOpenAiDelta(null, (delta) => out.push(delta));
    expect(out).toEqual([]);
  });

  it("surfaces partial frames once the buffer sees the newline", async () => {
    // A frame split across two enqueues must still be parsed as one chunk once
    // the newline lands — the buffer holds the partial line until then.
    const splitStream = new ReadableStream({
      start(controller) {
        const full = textChunk("split");
        const mid = full.indexOf('{"choices"');
        controller.enqueue(new TextEncoder().encode(full.slice(0, mid)));
        controller.enqueue(new TextEncoder().encode(full.slice(mid)));
        controller.close();
      },
    });
    const chunks = await read(splitStream);
    expect(chunks.map((c) => c.content)).toEqual(["split"]);
  });
});
