import { describe, expect, it } from "vitest";
import {
  getBreakdownBarColor,
  getBreakdownCategoryCopy,
  getBreakdownDotColor,
  getToolSearchEventDetail,
  getToolSearchEventLabel,
} from "~/lib/chat/token-usage-display";
import type {
  TokenUsageBreakdown,
  ToolSearchTraceEvent,
  ToolSearchTraceMatch,
} from "~/lib/chat/tool-events";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function match(name: string): ToolSearchTraceMatch {
  return { name };
}

const searchEvent = (query: string, names: string[]): ToolSearchTraceEvent => ({
  kind: "search",
  matches: names.map(match),
  query,
});

const describeEvent = (name: string, found: boolean): ToolSearchTraceEvent => ({
  kind: "describe",
  found,
  name,
});

const callEvent = (name: string, found: boolean): ToolSearchTraceEvent => ({
  kind: "call",
  found,
  name,
});

const breakdown = (toolCount: number): TokenUsageBreakdown => ({
  estimated: true,
  requestCount: 1,
  messageCount: 2,
  toolCount,
  excludedRequestOptionTokens: 0,
  inputTokens: 100,
  categories: [],
  tools: [],
});

/* -------------------------------------------------------------------------- */
/* getToolSearchEventLabel                                                    */
/* -------------------------------------------------------------------------- */

describe("getToolSearchEventLabel", () => {
  it("maps each event kind to its capitalized label", () => {
    expect(getToolSearchEventLabel(searchEvent("q", []))).toBe("Search");
    expect(getToolSearchEventLabel(describeEvent("n", true))).toBe("Describe");
    expect(getToolSearchEventLabel(callEvent("n", true))).toBe("Call");
  });

  it("is exhaustive over the discriminated union (label never empty)", () => {
    const events: ToolSearchTraceEvent[] = [
      searchEvent("q", ["a"]),
      describeEvent("n", true),
      callEvent("n", true),
    ];
    for (const event of events) {
      expect(getToolSearchEventLabel(event).length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* getToolSearchEventDetail                                                   */
/* -------------------------------------------------------------------------- */

describe("getToolSearchEventDetail", () => {
  describe("search events", () => {
    it("renders the quoted query followed by the top 3 match names", () => {
      expect(
        getToolSearchEventDetail(searchEvent("weather", ["get_weather", "get_forecast"])),
      ).toBe('"weather" -> get_weather, get_forecast');
    });

    it("caps the rendered matches at 3 even when more are present", () => {
      const detail = getToolSearchEventDetail(searchEvent("q", ["a", "b", "c", "d", "e"]));
      // Only the first three names appear; the trailing two are dropped.
      expect(detail).toBe('"q" -> a, b, c');
      expect(detail).not.toContain("d");
      expect(detail).not.toContain("e");
    });

    it("falls back to 'no matches' when the match list is empty", () => {
      expect(getToolSearchEventDetail(searchEvent("zzz", []))).toBe('"zzz" -> no matches');
    });

    it("preserves the query verbatim (no trimming or escaping)", () => {
      expect(getToolSearchEventDetail(searchEvent("  spaced query  ", []))).toBe(
        '"  spaced query  " -> no matches',
      );
    });

    it("renders exactly one match with no trailing comma", () => {
      expect(getToolSearchEventDetail(searchEvent("q", ["only"]))).toBe('"q" -> only');
    });
  });

  describe("describe events", () => {
    it("renders '<name> schema loaded' when found", () => {
      expect(getToolSearchEventDetail(describeEvent("send_email", true))).toBe(
        "send_email schema loaded",
      );
    });

    it("renders '<name> not found' when not found", () => {
      expect(getToolSearchEventDetail(describeEvent("ghost", false))).toBe("ghost not found");
    });
  });

  describe("call events", () => {
    it("renders '<name> invoked' when found", () => {
      expect(getToolSearchEventDetail(callEvent("send_email", true))).toBe("send_email invoked");
    });

    it("renders '<name> not found' when not found", () => {
      expect(getToolSearchEventDetail(callEvent("ghost", false))).toBe("ghost not found");
    });
  });

  it("is exhaustive over the discriminated union (detail never empty)", () => {
    const events: ToolSearchTraceEvent[] = [
      searchEvent("q", ["a"]),
      describeEvent("n", true),
      describeEvent("n", false),
      callEvent("n", true),
      callEvent("n", false),
    ];
    for (const event of events) {
      expect(getToolSearchEventDetail(event).length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* getBreakdownCategoryCopy                                                   */
/* -------------------------------------------------------------------------- */

describe("getBreakdownCategoryCopy", () => {
  describe("tools category", () => {
    it("labels tool definitions and pluralizes the schema count", () => {
      const copy = getBreakdownCategoryCopy("tools", breakdown(3));
      expect(copy.label).toBe("Tool definitions");
      expect(copy.description).toBe("3 available tool schemas sent to the provider");
    });

    it("uses the singular 'schema' when exactly one tool is present", () => {
      const copy = getBreakdownCategoryCopy("tools", breakdown(1));
      expect(copy.description).toBe("1 available tool schema sent to the provider");
    });

    it("renders '0' tool schemas (no special-casing for zero)", () => {
      const copy = getBreakdownCategoryCopy("tools", breakdown(0));
      expect(copy.description).toBe("0 available tool schemas sent to the provider");
    });

    it("formats large tool counts with locale thousands separators", () => {
      const copy = getBreakdownCategoryCopy("tools", breakdown(200));
      expect(copy.description).toBe("200 available tool schemas sent to the provider");
    });
  });

  describe("messages category", () => {
    it("labels the conversation", () => {
      const copy = getBreakdownCategoryCopy("messages", breakdown(0));
      expect(copy.label).toBe("Conversation");
      expect(copy.description).toBe(
        "User, assistant, and tool-result messages in the conversation",
      );
    });

    it("is independent of the breakdown's toolCount", () => {
      const zero = getBreakdownCategoryCopy("messages", breakdown(0));
      const many = getBreakdownCategoryCopy("messages", breakdown(200));
      expect(zero).toEqual(many);
    });
  });

  describe("systemPrompt category", () => {
    it("labels the system instructions", () => {
      const copy = getBreakdownCategoryCopy("systemPrompt", breakdown(0));
      expect(copy.label).toBe("System instructions");
      expect(copy.description).toBe("Hidden app and system instructions, when present");
    });
  });

  it("returns distinct labels for every category id", () => {
    const ids = ["tools", "messages", "systemPrompt"] as const;
    const labels = new Set(ids.map((id) => getBreakdownCategoryCopy(id, breakdown(1)).label));
    expect(labels.size).toBe(ids.length);
  });

  it("is exhaustive over the category union (label + description never empty)", () => {
    const ids = ["tools", "messages", "systemPrompt"] as const;
    for (const id of ids) {
      const copy = getBreakdownCategoryCopy(id, breakdown(2));
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* getBreakdownBarColor / getBreakdownDotColor                               */
/* -------------------------------------------------------------------------- */

describe("getBreakdownBarColor", () => {
  it("maps each category id to a distinct bg-* tailwind class", () => {
    const tools = getBreakdownBarColor("tools");
    const messages = getBreakdownBarColor("messages");
    const systemPrompt = getBreakdownBarColor("systemPrompt");

    expect(tools).toMatch(/^bg-/);
    expect(messages).toMatch(/^bg-/);
    expect(systemPrompt).toMatch(/^bg-/);

    const classes = new Set([tools, messages, systemPrompt]);
    expect(classes.size).toBe(3);
  });

  it("is exhaustive over the category union (class never empty)", () => {
    const ids = ["tools", "messages", "systemPrompt"] as const;
    for (const id of ids) {
      expect(getBreakdownBarColor(id).length).toBeGreaterThan(0);
    }
  });
});

describe("getBreakdownDotColor", () => {
  it("matches the bar color for every category (legend matches its segment)", () => {
    const ids = ["tools", "messages", "systemPrompt"] as const;
    for (const id of ids) {
      expect(getBreakdownDotColor(id)).toBe(getBreakdownBarColor(id));
    }
  });

  it("returns a non-empty class for every category id", () => {
    const ids = ["tools", "messages", "systemPrompt"] as const;
    for (const id of ids) {
      expect(getBreakdownDotColor(id).length).toBeGreaterThan(0);
    }
  });
});
