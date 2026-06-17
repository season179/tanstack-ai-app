import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the OpenRouter network client for the runToolLoop tests below: keep the
// real compactUsage/sumUsage (the loop sums real usage across round-trips) but
// replace streamToolAwareTurn with a controllable vi.fn() so we can script the
// model's turns without touching the network. File-scoped, so the existing
// sentToolCountForMode tests (which never call the network) are unaffected.
vi.mock("~/lib/server/openrouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/server/openrouter")>();
  return { ...actual, streamToolAwareTurn: vi.fn() };
});

import { type OpenRouterToolCall, streamToolAwareTurn } from "~/lib/server/openrouter";
import type { OpenAiUsage } from "~/lib/server/sse";
import { mockToolCount, mockToolSpecs } from "~/lib/server/tools/mock-tools";
import type { ToolExposureMode } from "~/lib/server/tools/token-usage";
import {
  runToolLoop,
  sentToolCountForMode,
  type ToolLoopEvent,
  type ToolLoopOptions,
} from "~/lib/server/tools/tool-loop";

const mockTurn = vi.mocked(streamToolAwareTurn);

// A real catalog tool name used to drive registry/bridge dispatch scenarios.
const REAL_TOOL_NAME = mockToolSpecs[0]?.name ?? "github_search_repositories";

describe("sentToolCountForMode", () => {
  it("counts the 3 bridge tools in search mode (the deferred-tool-search thesis)", () => {
    expect(sentToolCountForMode("search")).toBe(3);
  });

  it("counts every catalog tool in all mode (the token-cost baseline)", () => {
    expect(sentToolCountForMode("all")).toBe(mockToolCount);
    expect(sentToolCountForMode("all")).toBe(200);
  });

  it("counts zero tools in none mode (plain streaming, no tool loop)", () => {
    expect(sentToolCountForMode("none")).toBe(0);
  });

  it("adds the extras count to the mode's base count", () => {
    // Skill tools ride alongside the bridge/catalog; the header must reflect
    // what the model actually sees this turn.
    expect(sentToolCountForMode("search", 2)).toBe(5);
    expect(sentToolCountForMode("all", 2)).toBe(mockToolCount + 2);
    expect(sentToolCountForMode("none", 2)).toBe(2);
  });

  it("treats extrasCount=0 the same as omitting it (the default)", () => {
    const modes: ToolExposureMode[] = ["search", "all", "none"];
    for (const mode of modes) {
      expect(sentToolCountForMode(mode)).toBe(sentToolCountForMode(mode, 0));
    }
  });

  it("preserves the search < all ordering the verification contract depends on", () => {
    // The deferred-vs-all savings thesis is only observable if all > search.
    expect(sentToolCountForMode("all")).toBeGreaterThan(sentToolCountForMode("search"));
    expect(sentToolCountForMode("none")).toBeLessThan(sentToolCountForMode("search"));
  });

  it("is additive across all three modes with the same extras count", () => {
    // A 2-tool skill snapshot adds 2 regardless of mode.
    expect(sentToolCountForMode("search", 2) - sentToolCountForMode("search")).toBe(2);
    expect(sentToolCountForMode("all", 2) - sentToolCountForMode("all")).toBe(2);
    expect(sentToolCountForMode("none", 2) - sentToolCountForMode("none")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// runToolLoop — the hand-rolled, AI-SDK-free deferred tool-search orchestrator.
// We script streamToolAwareTurn (the only network boundary) and let the real
// bridge executors + central registry run, so these are integration tests of
// the loop's orchestration contract against the genuine 200-tool catalog.
// ---------------------------------------------------------------------------

type TurnScript = {
  text?: string;
  reasoning?: string;
  toolCalls?: OpenRouterToolCall[];
  usage?: OpenAiUsage;
  finishReason?: string;
};

/** Build a streamToolAwareTurn impl from a script: invokes the onText/
 * onReasoning callbacks to simulate streaming deltas, then resolves the
 * assembled turn. Mirrors the real client's contract (deltas via callbacks,
 * assembled content/toolCalls on the returned result). */
function scriptedTurn(script: TurnScript) {
  return (opts: Parameters<typeof streamToolAwareTurn>[0]) => {
    if (script.text) {
      opts.onText?.(script.text);
    }
    if (script.reasoning) {
      opts.onReasoning?.(script.reasoning);
    }
    return Promise.resolve({
      content: script.text ?? "",
      toolCalls: script.toolCalls ?? [],
      finishReason:
        script.finishReason ??
        (script.toolCalls && script.toolCalls.length > 0 ? "tool_calls" : "stop"),
      usage: script.usage,
    });
  };
}

/** Queue a sequence of scripted turns (consumed in order across iterations). */
function queue(...scripts: TurnScript[]): void {
  for (const script of scripts) {
    mockTurn.mockImplementationOnce(scriptedTurn(script));
  }
}

/** Build a function tool_call the model would emit. */
function call(id: string, name: string, args: unknown): OpenRouterToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

type RunResult = {
  events: ToolLoopEvent[];
  calls: Parameters<typeof streamToolAwareTurn>[0][];
};

/** Run the loop collecting events + the streamToolAwareTurn calls it made. */
async function runLoop(overrides: Partial<ToolLoopOptions> = {}): Promise<RunResult> {
  const events: ToolLoopEvent[] = [];
  await runToolLoop({
    apiKey: "k",
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    mode: "search",
    ...overrides,
    onEvent: (event) => events.push(event),
  });
  return { events, calls: mockTurn.mock.calls.map((c) => c[0]) };
}

function eventsOfType<T extends ToolLoopEvent["type"]>(
  events: ToolLoopEvent[],
  type: T,
): Extract<ToolLoopEvent, { type: T }>[] {
  return events.filter((e) => e.type === type) as Extract<ToolLoopEvent, { type: T }>[];
}

describe("runToolLoop", () => {
  beforeEach(() => {
    mockTurn.mockReset();
    // Loud default so a miscounted test fails rather than resolving undefined.
    mockTurn.mockImplementation(() => {
      throw new Error("streamToolAwareTurn called without a queued script");
    });
  });

  describe("single text turn (termination)", () => {
    it("emits text + usage + breakdown + metadata and stops after one round-trip in search mode", async () => {
      queue({ text: "Hello", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } });

      const { events, calls } = await runLoop();

      expect(calls).toHaveLength(1);
      expect(eventsOfType(events, "text").flatMap((e) => e.text)).toEqual(["Hello"]);
      const usage = eventsOfType(events, "usage")[0];
      expect(usage?.usage).toMatchObject({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
      expect(eventsOfType(events, "breakdown")).toHaveLength(1);
      const meta = eventsOfType(events, "metadata")[0];
      expect(meta).toBeDefined();
      expect(meta.metadata.mode).toBe("search");
      expect(meta.metadata.sentToolCount).toBe(3);
      expect(meta.metadata.trace).toEqual([]);
      expect(meta.metadata.searchCount).toBe(0);
      expect(meta.metadata.requestCount).toBe(1);
    });

    it("uses all-mode metadata (200 tools, deferredToolCount 0) in all mode", async () => {
      queue({ text: "hi" });
      const { events } = await runLoop({ mode: "all" });
      const meta = eventsOfType(events, "metadata")[0];
      expect(meta.metadata.mode).toBe("all");
      expect(meta.metadata.sentToolCount).toBe(200);
      expect(meta.metadata.deferredToolCount).toBe(0);
      expect(meta.metadata.trace).toEqual([]);
    });

    it("re-emits reasoning deltas as reasoning events", async () => {
      queue({ reasoning: "thinking...", text: "answer" });
      const { events } = await runLoop();
      expect(eventsOfType(events, "reasoning").flatMap((e) => e.text)).toEqual(["thinking..."]);
      expect(eventsOfType(events, "text").flatMap((e) => e.text)).toEqual(["answer"]);
    });
  });

  describe("bridge dispatch (search mode)", () => {
    it("dispatches tool_search through the bridge and records a search trace event", async () => {
      queue(
        { toolCalls: [call("c1", "tool_search", { query: "email", limit: 3 })] },
        { text: "done" },
      );
      const { events, calls } = await runLoop();
      expect(calls).toHaveLength(2);
      const toolCalls = eventsOfType(events, "tool_call");
      const toolResults = eventsOfType(events, "tool_result");
      expect(toolCalls[0]?.call.name).toBe("tool_search");
      expect(toolResults[0]?.result.ok).toBe(true);
      const meta = eventsOfType(events, "metadata")[0];
      expect(meta.metadata.searchCount).toBe(1);
      expect(meta.metadata.describeCount).toBe(0);
      expect(meta.metadata.callCount).toBe(0);
      expect(meta.metadata.trace).toHaveLength(1);
      expect(meta.metadata.trace[0]?.kind).toBe("search");
    });

    it("dispatches tool_describe through the bridge and records a describe trace event", async () => {
      queue({ toolCalls: [call("c1", "tool_describe", { name: REAL_TOOL_NAME })] }, { text: "ok" });
      const { events } = await runLoop();
      const meta = eventsOfType(events, "metadata")[0];
      expect(meta.metadata.describeCount).toBe(1);
      const trace0 = meta.metadata.trace[0];
      if (trace0 && trace0.kind === "describe") {
        expect(trace0.name).toBe(REAL_TOOL_NAME);
      } else {
        throw new Error("expected a describe trace event");
      }
    });

    it("dispatches tool_call (bridge) through the registry and records a call trace event", async () => {
      queue(
        {
          toolCalls: [call("c1", "tool_call", { name: REAL_TOOL_NAME, arguments: { q: "react" } })],
        },
        { text: "ok" },
      );
      const { events } = await runLoop();
      const result = eventsOfType(events, "tool_result")[0];
      expect(result?.result.ok).toBe(true);
      const meta = eventsOfType(events, "metadata")[0];
      expect(meta.metadata.callCount).toBe(1);
      expect(meta.metadata.trace[0]?.kind).toBe("call");
    });

    it("nudges the model back to the bridge on an unknown tool name in search mode", async () => {
      queue({ toolCalls: [call("c1", "nope_not_a_tool", {})] }, { text: "ok" });
      const { events } = await runLoop();
      const result = eventsOfType(events, "tool_result")[0];
      expect(result?.result.ok).toBe(false);
      const output = result?.result.output;
      expect(typeof output === "string" ? output : "").toMatch(/Unknown tool/);
      const meta = eventsOfType(events, "metadata")[0];
      expect(meta.metadata.trace).toEqual([]);
    });

    it("emits tool_call and tool_result in order before text/usage/metadata", async () => {
      queue(
        { toolCalls: [call("c1", "tool_search", { query: "github" })] },
        { text: "final answer" },
      );
      const { events } = await runLoop();
      const types = events.map((e) => e.type);
      const idx = (t: ToolLoopEvent["type"]) => types.indexOf(t);
      expect(idx("tool_call")).toBeLessThan(idx("tool_result"));
      expect(idx("tool_result")).toBeLessThan(idx("text"));
      expect(idx("text")).toBeLessThan(idx("usage"));
      expect(idx("usage")).toBeLessThan(idx("metadata"));
    });
  });

  describe("registry dispatch (all mode)", () => {
    it("dispatches a catalog tool directly through the registry (bridge trace stays empty)", async () => {
      queue({ toolCalls: [call("c1", REAL_TOOL_NAME, { q: "react" })] }, { text: "ok" });
      const { events } = await runLoop({ mode: "all" });
      const result = eventsOfType(events, "tool_result")[0];
      expect(result?.result.name).toBe(REAL_TOOL_NAME);
      expect(result?.result.ok).toBe(true);
      const meta = eventsOfType(events, "metadata")[0];
      // all mode bypasses the bridge, so no trace activity is recorded.
      expect(meta.metadata.trace).toEqual([]);
      expect(meta.metadata.callCount).toBe(0);
    });
  });

  describe("extra (skill) tools", () => {
    it("dispatches extra tool calls through extraToolHandler and leaves the bridge trace empty", async () => {
      const handler = vi.fn().mockReturnValue({ ok: true, msg: "skill applied" });
      const extraTools = [
        {
          type: "function" as const,
          function: {
            name: "skill_get_content",
            description: "d",
            parameters: { type: "object" as const },
          },
        },
      ];
      queue({ toolCalls: [call("c1", "skill_get_content", { id: "s1" })] }, { text: "ok" });
      const { events } = await runLoop({ extraTools, extraToolHandler: handler });
      expect(handler).toHaveBeenCalledWith("skill_get_content", { id: "s1" });
      const result = eventsOfType(events, "tool_result")[0];
      expect(result?.result.ok).toBe(true);
      expect(result?.result.output).toBe(JSON.stringify({ ok: true, msg: "skill applied" }));
      const meta = eventsOfType(events, "metadata")[0];
      expect(meta.metadata.trace).toEqual([]);
    });

    it("surfaces a failure when an extra tool has no handler", async () => {
      const extraTools = [
        {
          type: "function" as const,
          function: {
            name: "skill_get_content",
            description: "d",
            parameters: { type: "object" as const },
          },
        },
      ];
      queue({ toolCalls: [call("c1", "skill_get_content", { id: "s1" })] }, { text: "ok" });
      const { events } = await runLoop({ extraTools });
      const result = eventsOfType(events, "tool_result")[0];
      expect(result?.result.ok).toBe(false);
      const output = result?.result.output;
      expect(typeof output === "string" ? output : "").toMatch(/no registered handler/);
    });
  });

  describe("loop control", () => {
    it("caps at MAX_LOOP_ITERATIONS (6) round-trips when the model never stops calling tools", async () => {
      mockTurn.mockImplementation(
        scriptedTurn({ toolCalls: [call("c", "tool_search", { query: "x" })] }),
      );
      const { calls, events } = await runLoop();
      expect(calls).toHaveLength(6);
      expect(eventsOfType(events, "tool_call")).toHaveLength(6);
      expect(eventsOfType(events, "tool_result")).toHaveLength(6);
    });

    it("makes no upstream calls when the signal is already aborted, but still emits metadata", async () => {
      const controller = new AbortController();
      controller.abort();
      const { events, calls } = await runLoop({ signal: controller.signal });
      expect(calls).toHaveLength(0);
      // The finally block always emits usage + breakdown + metadata.
      expect(eventsOfType(events, "metadata")).toHaveLength(1);
      expect(eventsOfType(events, "usage")).toHaveLength(1);
      expect(eventsOfType(events, "usage")[0]?.usage.totalTokens).toBe(0);
    });
  });

  describe("usage aggregation", () => {
    it("sums per-round-trip usage across the whole loop into one aggregated frame", async () => {
      queue(
        {
          toolCalls: [call("c1", "tool_search", { query: "x" })],
          usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
        },
        {
          text: "done",
          usage: { promptTokens: 200, completionTokens: 20, totalTokens: 220, reasoningTokens: 5 },
        },
      );
      const { events } = await runLoop();
      const usage = eventsOfType(events, "usage")[0];
      expect(usage?.usage).toMatchObject({
        inputTokens: 300,
        outputTokens: 30,
        totalTokens: 330,
        reasoningTokens: 5,
      });
    });

    it("emits zero usage when the provider omits usage from every round-trip", async () => {
      queue({ text: "done" });
      const { events } = await runLoop();
      const usage = eventsOfType(events, "usage")[0];
      expect(usage?.usage).toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    });

    it("always emits metadata as the final event (even on early exit)", async () => {
      const controller = new AbortController();
      controller.abort();
      const { events } = await runLoop({ signal: controller.signal });
      expect(events[events.length - 1]?.type).toBe("metadata");
    });
  });

  describe("request threading", () => {
    it("prepends the tool-aware system prompt before the caller's messages", async () => {
      queue({ text: "ok" });
      const { calls } = await runLoop({
        messages: [{ role: "user", content: "hello" }],
      });
      const first = calls[0]?.messages[0];
      expect(first).toMatchObject({ role: "system" });
      const content = (first as { content?: string } | undefined)?.content;
      expect(content).toContain("tool_search");
      const second = calls[0]?.messages[1];
      expect(second).toMatchObject({ role: "user", content: "hello" });
    });

    it("preserves a caller-supplied system message after the tool system prompt", async () => {
      queue({ text: "ok" });
      const { calls } = await runLoop({
        messages: [
          { role: "system", content: "you are a pirate" },
          { role: "user", content: "ahoy" },
        ],
      });
      const msgs = calls[0]?.messages ?? [];
      expect(msgs[0]).toMatchObject({ role: "system" });
      expect((msgs[0] as { content: string }).content).toContain("tool_search");
      expect(msgs[1]).toMatchObject({ role: "system", content: "you are a pirate" });
      expect(msgs[2]).toMatchObject({ role: "user", content: "ahoy" });
    });

    it("threads the 3 bridge tools to the model in search mode", async () => {
      queue({ text: "ok" });
      const { calls } = await runLoop({ mode: "search" });
      const names = (calls[0]?.tools ?? []).map((t) => t.function.name);
      expect(names).toEqual(["tool_search", "tool_describe", "tool_call"]);
    });

    it("threads every catalog tool in all mode", async () => {
      queue({ text: "ok" });
      const { calls } = await runLoop({ mode: "all" });
      expect(calls[0]?.tools ?? []).toHaveLength(200);
    });

    it("appends bridge + extras when extras are provided", async () => {
      const extraTools = [
        {
          type: "function" as const,
          function: {
            name: "skill_search",
            description: "d",
            parameters: { type: "object" as const },
          },
        },
      ];
      queue({ text: "ok" });
      const { calls } = await runLoop({ extraTools });
      const names = (calls[0]?.tools ?? []).map((t) => t.function.name);
      expect(names).toEqual(["tool_search", "tool_describe", "tool_call", "skill_search"]);
    });

    it("appends an assistant tool_calls turn + a tool-role result on the next round-trip", async () => {
      queue({ toolCalls: [call("call-42", "tool_search", { query: "x" })] }, { text: "ok" });
      const { calls } = await runLoop();
      const secondMessages = calls[1]?.messages ?? [];
      const assistantTurn = secondMessages.find(
        (m) => m.role === "assistant" && "tool_calls" in m,
      ) as { tool_calls?: { id: string }[] } | undefined;
      const toolMsg = secondMessages.find((m) => m.role === "tool") as
        | { tool_call_id?: string; content?: string }
        | undefined;
      expect(assistantTurn?.tool_calls?.[0]?.id).toBe("call-42");
      expect(toolMsg?.tool_call_id).toBe("call-42");
      expect(typeof toolMsg?.content === "string" ? toolMsg.content : "").toBeTruthy();
    });
  });
});
