import { describe, expect, it } from "vitest";

import {
  applyToolCall,
  applyToolResult,
  formatPercentageValue,
  formatSavingsLine,
  formatTokenCompact,
  formatTokenCount,
  formatTokenPercentage,
  formatUsageLine,
  isUsageEmpty,
  sumUsage,
  type ToolCallFrame,
  type ToolResultFrame,
  type ToolSearchSummary,
  type TurnTokenUsage,
  truncateForPreview,
} from "~/lib/chat/tool-events";

const USAGE: TurnTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
};

describe("applyToolCall / applyToolResult", () => {
  const call = (name: string, service = "svc"): ToolCallFrame => ({
    type: "tool_call",
    call: {
      name,
      service,
      title: `${name} title`,
      arguments: { q: name },
    },
  });
  const result = (name: string, ok = true): ToolResultFrame => ({
    type: "tool_result",
    result: {
      name,
      ok,
      output: ok ? `{"ok":true}` : "boom",
    },
  });

  it("applyToolCall appends a fresh running step", () => {
    const steps = applyToolCall([], call("tool_search"));
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("running");
    expect(steps[0].name).toBe("tool_search");
  });

  it("applyToolResult completes the most recent running step", () => {
    const steps = applyToolResult(applyToolCall([], call("tool_search")), result("tool_search"));
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("ok");
    expect(steps[0].output).toBe('{"ok":true}');
  });

  it("marks the step as error when the result is not ok", () => {
    const steps = applyToolResult(applyToolCall([], call("tool_call")), result("tool_call", false));
    expect(steps[0].status).toBe("error");
    expect(steps[0].output).toBe("boom");
  });

  it("pairs each result with its most recent running step under sequential dispatch", () => {
    // search → search → describe → call, each followed by its result.
    let steps = applyToolCall([], call("tool_search"));
    steps = applyToolResult(steps, result("tool_search"));
    steps = applyToolCall(steps, call("tool_describe"));
    steps = applyToolResult(steps, result("tool_describe"));
    expect(steps.map((s) => s.name)).toEqual(["tool_search", "tool_describe"]);
    expect(steps.every((s) => s.status === "ok")).toBe(true);
  });

  it("records an orphaned result as a standalone step rather than dropping it", () => {
    const steps = applyToolResult([], result("tool_call"));
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("ok");
    expect(steps[0].name).toBe("tool_call");
  });
});

describe("token formatters", () => {
  it("formatTokenCount adds thousands separators and returns 0 for non-positive", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(-5)).toBe("0");
    expect(formatTokenCount(1234)).toBe("1,234");
    expect(formatTokenCount(118542)).toBe("118,542");
  });

  it("formatTokenCompact collapses big numbers to k/M", () => {
    expect(formatTokenCompact(0)).toBe("0");
    expect(formatTokenCompact(42)).toBe("42");
    expect(formatTokenCompact(1000)).toBe("1k");
    expect(formatTokenCompact(1500)).toBe("1.5k");
    expect(formatTokenCompact(118542)).toBe("118.5k");
    expect(formatTokenCompact(2_500_000)).toBe("2.5M");
  });

  it("formatTokenPercentage takes a 0–1 fraction and returns rounded percent", () => {
    expect(formatTokenPercentage(0)).toBe("0%");
    expect(formatTokenPercentage(0.987)).toBe("99%");
    expect(formatTokenPercentage(1)).toBe("100%");
  });

  it("formatPercentageValue takes a 0–100 value (distinct from the fraction form)", () => {
    expect(formatPercentageValue(0)).toBe("0%");
    expect(formatPercentageValue(36.4)).toBe("36%");
    expect(formatPercentageValue(0.5)).toBe("0.5%");
    expect(formatPercentageValue(98.7)).toBe("99%");
  });
});

describe("truncateForPreview", () => {
  it("returns short text unchanged (collapsed to one line)", () => {
    expect(truncateForPreview("hello world")).toBe("hello world");
  });

  it("collapses internal whitespace to single spaces", () => {
    expect(truncateForPreview("a\n  b\t\tc")).toBe("a b c");
  });

  it("truncates with an ellipsis past the max", () => {
    const long = "x".repeat(200);
    const out = truncateForPreview(long, 10);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBe(10);
  });
});

describe("sumUsage / isUsageEmpty / formatUsageLine", () => {
  it("sumUsage accumulates each bucket across turns", () => {
    const a = { ...USAGE, inputTokens: 100, outputTokens: 50, totalTokens: 150 };
    const b = {
      ...USAGE,
      inputTokens: 5_000,
      outputTokens: 100,
      totalTokens: 5_100,
      reasoningTokens: 80,
      cachedInputTokens: 3_000,
    };
    expect(sumUsage([a, b])).toEqual({
      inputTokens: 5_100,
      outputTokens: 150,
      totalTokens: 5_250,
      reasoningTokens: 80,
      cachedInputTokens: 3_000,
    });
  });

  it("sumUsage of an empty iterable is all zeros", () => {
    expect(sumUsage([])).toEqual(USAGE);
  });

  it("isUsageEmpty is true only when every bucket is zero", () => {
    expect(isUsageEmpty(USAGE)).toBe(true);
    expect(isUsageEmpty({ ...USAGE, outputTokens: 1 })).toBe(false);
    expect(isUsageEmpty({ ...USAGE, reasoningTokens: 1 })).toBe(false);
  });

  it("formatUsageLine returns '' for an empty record so the UI can gate on truthiness", () => {
    expect(formatUsageLine(USAGE)).toBe("");
  });

  it("formatUsageLine includes cached/reasoning only when non-zero", () => {
    expect(formatUsageLine({ ...USAGE, inputTokens: 10, outputTokens: 5, totalTokens: 15 })).toBe(
      "↑ 10 · ↓ 5 · 15 total",
    );
    expect(
      formatUsageLine({
        ...USAGE,
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cachedInputTokens: 3,
        reasoningTokens: 2,
      }),
    ).toBe("↑ 10 · ↓ 5 · 15 total · cached 3 · reasoning 2");
  });
});

describe("formatSavingsLine", () => {
  const summary: ToolSearchSummary = {
    mode: "search",
    availableToolCount: 200,
    catalogSchemaTokens: 29_636,
    baselineSchemaTokens: 118_542,
    sentSchemaTokens: 1_560,
    savedSchemaTokens: 116_982,
    sentToolCount: 3,
    deferredToolCount: 200,
    requestCount: 4,
    searchCount: 1,
    describeCount: 1,
    callCount: 1,
  };

  it("renders mode + tool count + sent tokens + saved % and baseline", () => {
    expect(formatSavingsLine(summary)).toBe(
      "Search bridge · 3 tools sent · 1,560 schema tokens · 99% saved · 118.5k baseline",
    );
  });

  it("uses 'All tools' for mode='all'", () => {
    expect(formatSavingsLine({ ...summary, mode: "all" })).toMatch(/^All tools ·/);
  });

  it("omits the savings fragment when nothing was saved", () => {
    const noSavings = { ...summary, savedSchemaTokens: 0 };
    expect(formatSavingsLine(noSavings)).toBe("Search bridge · 3 tools sent · 1,560 schema tokens");
  });
});
