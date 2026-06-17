import { describe, expect, it } from "vitest";

import {
  estimateRequestTokenUsage,
  estimateTokensFromChars,
  type RequestTokenEstimate,
  resolveToolExposureMode,
  toTokenUsageBreakdown,
} from "~/lib/server/tools/token-usage";

// ---------------------------------------------------------------------------
// resolveToolExposureMode
// ---------------------------------------------------------------------------

describe("resolveToolExposureMode", () => {
  it("defaults to 'search' (the reference's thesis: the model sees only the bridge)", () => {
    expect(resolveToolExposureMode(undefined)).toBe("search");
    expect(resolveToolExposureMode("")).toBe("search");
    expect(resolveToolExposureMode("garbage")).toBe("search");
  });

  it("normalizes value to lowercase + trims whitespace before matching", () => {
    expect(resolveToolExposureMode(" ALL ")).toBe("all");
    expect(resolveToolExposureMode("None")).toBe("none");
    expect(resolveToolExposureMode(" Off ")).toBe("none");
    expect(resolveToolExposureMode("Search")).toBe("search");
  });

  it("maps 'all' / 'search' / ('none'|'off') to their modes", () => {
    expect(resolveToolExposureMode("all")).toBe("all");
    expect(resolveToolExposureMode("search")).toBe("search");
    expect(resolveToolExposureMode("none")).toBe("none");
    expect(resolveToolExposureMode("off")).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// estimateTokensFromChars
// ---------------------------------------------------------------------------

describe("estimateTokensFromChars", () => {
  it("returns 0 for zero or negative chars", () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(-10)).toBe(0);
  });

  it("floors any positive char count to at least 1 token", () => {
    expect(estimateTokensFromChars(1)).toBe(1);
    expect(estimateTokensFromChars(3)).toBe(1);
    expect(estimateTokensFromChars(4)).toBe(1);
  });

  it("divides chars by 4 with half-up rounding", () => {
    expect(estimateTokensFromChars(8)).toBe(2);
    // Math.round(2.5) === 3 (half rounds up, not banker's rounding)
    expect(estimateTokensFromChars(10)).toBe(3);
    expect(estimateTokensFromChars(100)).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// estimateRequestTokenUsage
// ---------------------------------------------------------------------------

describe("estimateRequestTokenUsage", () => {
  it("returns undefined for undefined / null / non-record bodies", () => {
    expect(estimateRequestTokenUsage(undefined)).toBeUndefined();
    expect(estimateRequestTokenUsage(null)).toBeUndefined();
    expect(estimateRequestTokenUsage("not an object")).toBeUndefined();
    expect(estimateRequestTokenUsage(42)).toBeUndefined();
  });

  it("parses a JSON string body before measuring", () => {
    const estimate = estimateRequestTokenUsage(
      JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    );
    expect(estimate).toBeDefined();
    expect(estimate?.messageCount).toBe(1);
  });

  it("returns undefined when the prompt is empty (no system / messages / tools)", () => {
    expect(estimateRequestTokenUsage({})).toBeUndefined();
    // A body with only request options (model/stream flags) has no prompt
    // content, so it must not produce a phantom estimate.
    expect(estimateRequestTokenUsage({ model: "gpt-4", stream: true })).toBeUndefined();
  });

  it("splits messages into system vs non-system buckets by role", () => {
    const estimate = estimateRequestTokenUsage({
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
    });
    expect(estimate).toBeDefined();
    expect(estimate?.messageCount).toBe(3);
    expect(estimate?.systemPromptChars).toBe(
      JSON.stringify([{ role: "system", content: "system prompt" }]).length,
    );
    expect(estimate?.messageChars).toBe(
      JSON.stringify([
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ]).length,
    );
    expect(estimate?.toolChars).toBe(0);
    expect(estimate?.toolCount).toBe(0);
  });

  it("measures tool schemas from the `tools` array and reads each tool's name", () => {
    const tools = [
      { type: "function", function: { name: "tool_search", description: "d", parameters: {} } },
      { type: "function", function: { name: "tool_describe", description: "d2", parameters: {} } },
    ];
    const estimate = estimateRequestTokenUsage({ tools });
    expect(estimate).toBeDefined();
    expect(estimate?.toolCount).toBe(2);
    expect(estimate?.tools).toHaveLength(2);
    expect(estimate?.tools?.[0]).toEqual({
      name: "tool_search",
      chars: JSON.stringify(tools[0]).length,
    });
    expect(estimate?.tools?.[1]).toEqual({
      name: "tool_describe",
      chars: JSON.stringify(tools[1]).length,
    });
    expect(estimate?.toolChars).toBe(JSON.stringify(tools).length);
  });

  it("falls back to the legacy `functions` object shape and the outer-name read path", () => {
    // The OpenAI legacy shape is `{ functionName: { description, parameters } }`,
    // where the tool name is the object key, not a nested function.name.
    const functions = {
      weather: { description: "get weather", parameters: {} },
    };
    const estimate = estimateRequestTokenUsage({ functions });
    expect(estimate).toBeDefined();
    expect(estimate?.toolCount).toBe(1);
    expect(estimate?.tools).toHaveLength(1);
    expect(estimate?.tools?.[0]?.name).toBe("weather");
  });

  it("falls back to `tool_<index>` when an array tool has no readable name", () => {
    const estimate = estimateRequestTokenUsage({
      tools: [{ type: "function", function: { description: "no name here" } }],
    });
    expect(estimate?.tools?.[0]?.name).toBe("tool_1");
  });

  it("excludes messages/tools from the request-options measurement", () => {
    const estimate = estimateRequestTokenUsage({
      model: "gpt-4",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
    });
    // requestOptionChars must reflect only { model, stream } — the user
    // message must NOT be double-counted into the request options bucket.
    expect(estimate?.requestOptionChars).toBe(
      JSON.stringify({ model: "gpt-4", stream: true }).length,
    );
    expect(estimate?.messageChars).toBe(JSON.stringify([{ role: "user", content: "hi" }]).length);
  });
});

// ---------------------------------------------------------------------------
// toTokenUsageBreakdown
// ---------------------------------------------------------------------------

describe("toTokenUsageBreakdown", () => {
  it("returns undefined when there are no estimates", () => {
    expect(toTokenUsageBreakdown(100, [])).toBeUndefined();
    expect(toTokenUsageBreakdown(undefined, [])).toBeUndefined();
  });

  it("returns undefined when the aggregated estimate has zero prompt chars", () => {
    const estimate: RequestTokenEstimate = {
      systemPromptChars: 0,
      messageChars: 0,
      toolChars: 0,
      requestOptionChars: 500,
      messageCount: 0,
      toolCount: 0,
      tools: [],
    };
    expect(toTokenUsageBreakdown(100, [estimate])).toBeUndefined();
  });

  it("allocates 100% of input tokens to the only visible category", () => {
    const estimate: RequestTokenEstimate = {
      systemPromptChars: 0,
      messageChars: 0,
      toolChars: 400,
      requestOptionChars: 0,
      messageCount: 0,
      toolCount: 3,
      tools: [],
    };
    const breakdown = toTokenUsageBreakdown(100, [estimate]);
    expect(breakdown).toBeDefined();
    expect(breakdown?.categories).toHaveLength(1);
    expect(breakdown?.categories[0]?.id).toBe("tools");
    expect(breakdown?.categories[0]?.tokens).toBe(100);
    expect(breakdown?.categories[0]?.percentage).toBe(100);
  });

  it("splits tokens proportionally by char share using largest-remainder (sum invariant)", () => {
    // system=100, tools=300, messages=200 → 600 total. Target 100 tokens.
    // exact: system=16.67, tools=50, messages=33.33 → floored sum=99.
    // Remainder 1 goes to the largest fractional part (system 0.67).
    const estimate: RequestTokenEstimate = {
      systemPromptChars: 100,
      messageChars: 200,
      toolChars: 300,
      requestOptionChars: 0,
      messageCount: 3,
      toolCount: 3,
      tools: [],
    };
    const breakdown = toTokenUsageBreakdown(100, [estimate]);
    const tokensByCategory = new Map(breakdown?.categories.map((c) => [c.id, c.tokens]));
    // Sum invariant: largest-remainder must distribute every token.
    expect(breakdown?.categories.reduce((sum, c) => sum + c.tokens, 0)).toBe(100);
    expect(tokensByCategory.get("systemPrompt")).toBe(17);
    expect(tokensByCategory.get("tools")).toBe(50);
    expect(tokensByCategory.get("messages")).toBe(33);
  });

  it("falls back to char-based estimation when inputTokens is undefined", () => {
    const estimate: RequestTokenEstimate = {
      systemPromptChars: 400,
      messageChars: 0,
      toolChars: 0,
      requestOptionChars: 0,
      messageCount: 0,
      toolCount: 0,
      tools: [],
    };
    const breakdown = toTokenUsageBreakdown(undefined, [estimate]);
    // 400 chars / 4 = 100 estimated tokens, all to systemPrompt.
    expect(breakdown?.categories[0]?.id).toBe("systemPrompt");
    expect(breakdown?.categories[0]?.tokens).toBe(100);
  });

  it("sub-allocates the tools-category slice across individual tool schemas (sum invariant)", () => {
    // Two tools: A has 2x the chars of B. Tools category gets 90 tokens.
    // exact: A=60, B=30 (no remainder). Sum must equal the tools-category slice.
    const estimate: RequestTokenEstimate = {
      systemPromptChars: 0,
      messageChars: 0,
      toolChars: 300,
      requestOptionChars: 0,
      messageCount: 0,
      toolCount: 2,
      tools: [
        { name: "tool_a", chars: 200 },
        { name: "tool_b", chars: 100 },
      ],
    };
    const breakdown = toTokenUsageBreakdown(90, [estimate]);
    const toolSlice = breakdown?.categories.find((c) => c.id === "tools")?.tokens ?? 0;
    const toolTokens = breakdown?.tools.reduce((sum, t) => sum + t.tokens, 0) ?? 0;
    expect(toolTokens).toBe(toolSlice);
    expect(breakdown?.tools[0]?.name).toBe("tool_a");
    expect(breakdown?.tools[0]?.tokens).toBe(Math.round((toolSlice * 2) / 3));
  });

  it("sorts tools by tokens desc then name asc (deterministic tie-break)", () => {
    const estimate: RequestTokenEstimate = {
      systemPromptChars: 0,
      messageChars: 0,
      toolChars: 400,
      requestOptionChars: 0,
      messageCount: 0,
      toolCount: 4,
      tools: [
        { name: "zebra", chars: 100 },
        { name: "alpha", chars: 100 },
        { name: "mid", chars: 200 },
        { name: "beta", chars: 100 },
      ],
    };
    const breakdown = toTokenUsageBreakdown(40, [estimate]);
    expect(breakdown?.tools.map((t) => t.name)).toEqual(["mid", "alpha", "beta", "zebra"]);
  });

  it("aggregates multiple estimates: sums chars + messageCount, takes max toolCount, merges tool chars by name", () => {
    // Two round-trips. messageCount sums (the reference's growing-history
    // semantics); toolCount is the max across round-trips; tool chars are
    // merged by name so a tool present in both round-trips isn't double-named.
    const estimates: RequestTokenEstimate[] = [
      {
        systemPromptChars: 100,
        messageChars: 100,
        toolChars: 100,
        requestOptionChars: 50,
        messageCount: 4,
        toolCount: 3,
        tools: [
          { name: "tool_search", chars: 40 },
          { name: "tool_describe", chars: 30 },
          { name: "tool_call", chars: 30 },
        ],
      },
      {
        systemPromptChars: 100,
        messageChars: 200,
        toolChars: 100,
        requestOptionChars: 50,
        messageCount: 6,
        toolCount: 3,
        tools: [
          { name: "tool_search", chars: 40 },
          { name: "tool_describe", chars: 30 },
          { name: "tool_call", chars: 30 },
        ],
      },
    ];
    const breakdown = toTokenUsageBreakdown(200, estimates);
    expect(breakdown?.requestCount).toBe(2);
    expect(breakdown?.messageCount).toBe(10); // 4 + 6 (summed)
    expect(breakdown?.toolCount).toBe(3); // max, not sum
    expect(breakdown?.excludedRequestOptionChars).toBe(100); // 50 + 50
    expect(breakdown?.excludedRequestOptionTokens).toBe(25); // 100 / 4
    // Merged tool chars by name: each tool appears once with summed chars.
    const searchTool = breakdown?.tools.find((t) => t.name === "tool_search");
    expect(searchTool?.chars).toBe(80); // 40 + 40
    expect(breakdown?.tools).toHaveLength(3);
  });

  it("computes category percentages relative to total input tokens", () => {
    const estimate: RequestTokenEstimate = {
      systemPromptChars: 100,
      messageChars: 100,
      toolChars: 100,
      requestOptionChars: 0,
      messageCount: 2,
      toolCount: 1,
      tools: [{ name: "t", chars: 100 }],
    };
    const breakdown = toTokenUsageBreakdown(99, [estimate]);
    // Equal char share → each category gets exactly 33 tokens (33*3=99, no
    // remainder to distribute). The percentage contract is tokens/targetTokens.
    for (const category of breakdown?.categories ?? []) {
      expect(category.tokens).toBe(33);
      expect(category.percentage).toBeCloseTo((33 / 99) * 100, 5);
    }
  });

  it("computes tool percentages relative to the tools-category slice (not total tokens)", () => {
    const estimate: RequestTokenEstimate = {
      systemPromptChars: 300,
      messageChars: 0,
      toolChars: 100,
      requestOptionChars: 0,
      messageCount: 0,
      toolCount: 1,
      tools: [{ name: "only_tool", chars: 100 }],
    };
    const breakdown = toTokenUsageBreakdown(100, [estimate]);
    // The single tool owns the entire tools slice, so its percentage is 100
    // even though tools is only ~25% of the total input tokens.
    expect(breakdown?.tools[0]?.percentage).toBe(100);
  });

  it("sorts categories by tokens desc", () => {
    const estimate: RequestTokenEstimate = {
      systemPromptChars: 100,
      messageChars: 400,
      toolChars: 200,
      requestOptionChars: 0,
      messageCount: 5,
      toolCount: 2,
      tools: [],
    };
    const breakdown = toTokenUsageBreakdown(70, [estimate]);
    const tokens = breakdown?.categories.map((c) => c.tokens) ?? [];
    expect([...tokens]).toEqual([...tokens].sort((a, b) => b - a));
  });

  it("drops categories with zero chars from the allocation entirely", () => {
    const estimate: RequestTokenEstimate = {
      systemPromptChars: 100,
      messageChars: 0, // empty conversation
      toolChars: 300,
      requestOptionChars: 0,
      messageCount: 0,
      toolCount: 3,
      tools: [],
    };
    const breakdown = toTokenUsageBreakdown(40, [estimate]);
    const ids = breakdown?.categories.map((c) => c.id);
    expect(ids).toContain("systemPrompt");
    expect(ids).toContain("tools");
    expect(ids).not.toContain("messages");
  });
});

// ---------------------------------------------------------------------------
// Integration: estimateRequestTokenUsage → toTokenUsageBreakdown
// (the exact composition the chat route performs)
// ---------------------------------------------------------------------------

describe("estimateRequestTokenUsage + toTokenUsageBreakdown integration", () => {
  it("produces a breakdown whose category tokens sum to the real inputTokens", () => {
    const body = {
      model: "gpt-4",
      stream: true,
      messages: [
        { role: "system", content: "You are a helpful measurement instrument." },
        { role: "user", content: "Search for a weather tool and call it." },
      ],
      tools: [
        {
          type: "function",
          function: { name: "tool_search", description: "search", parameters: {} },
        },
        {
          type: "function",
          function: { name: "tool_describe", description: "describe", parameters: {} },
        },
        { type: "function", function: { name: "tool_call", description: "call", parameters: {} } },
      ],
    };
    const estimate = estimateRequestTokenUsage(body);
    expect(estimate).toBeDefined();
    if (!estimate) {
      // Narrows the type for the composition below (the assertion above is
      // the actual contract check).
      return;
    }
    // The reference's chat route measures a real provider inputTokens value
    // and feeds it here; for the integration we pass a deterministic 500.
    const breakdown = toTokenUsageBreakdown(500, [estimate]);
    expect(breakdown).toBeDefined();
    expect(breakdown?.estimated).toBe(true);
    expect(breakdown?.inputTokens).toBe(500);
    const total = breakdown?.categories.reduce((sum, c) => sum + c.tokens, 0);
    expect(total).toBe(500); // largest-remainder preserves every token
    // The three bridge tools dominate a short turn (matches the live
    // observations from iteration 15).
    const toolsCategory = breakdown?.categories.find((c) => c.id === "tools");
    expect(toolsCategory && toolsCategory.tokens > 0).toBe(true);
    expect(breakdown?.tools).toHaveLength(3);
  });
});
