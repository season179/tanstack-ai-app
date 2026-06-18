// @vitest-environment jsdom
//
// DOM-environment component tests for TokenUsageMenu — the header popover that
// surfaces the session's cumulative OpenRouter token spend plus a breakdown of
// the most recent request (iteration 14/15). The five pure display helpers it
// renders were extracted to token-usage-display.ts and pinned in iteration 62;
// this file pins the component-level conditional-rendering contract that
// drives which panels appear: the summary trigger, the empty state, the
// ProviderUsageGrid, the PromptAllocation bar, the ToolSearchPanel (mode label,
// savings line, counts footer), the nested ToolSearchTrace, and the
// ToolSchemaBreakdown (visible/hidden aggregation). Extends the React Testing
// Library harness established in iteration 55 (ModelPicker) and used through
// iterations 59/63/65.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TokenUsageMenu } from "~/components/chat/token-usage-menu";
import type {
  TokenUsageBreakdown,
  ToolSearchSummary,
  TurnTokenUsage,
} from "~/lib/chat/tool-events";

afterEach(() => {
  cleanup();
});

const EMPTY_USAGE: TurnTokenUsage = {
  cachedInputTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
};

function usage(overrides: Partial<TurnTokenUsage> = {}): TurnTokenUsage {
  return { ...EMPTY_USAGE, ...overrides };
}

function toolSearch(overrides: Partial<ToolSearchSummary> = {}): ToolSearchSummary {
  return {
    availableToolCount: 200,
    callCount: 1,
    catalogSchemaTokens: 29636,
    deferredToolCount: 1,
    describeCount: 1,
    mode: "search",
    requestCount: 4,
    baselineSchemaTokens: 118542,
    savedSchemaTokens: 116982,
    searchCount: 1,
    sentSchemaTokens: 1560,
    sentToolCount: 3,
    trace: [],
    ...overrides,
  };
}

function breakdown(overrides: Partial<TokenUsageBreakdown> = {}): TokenUsageBreakdown {
  return {
    categories: [
      {
        chars: 2116,
        id: "messages",
        label: "Messages",
        percentage: 53,
        tokens: 2475,
      },
      {
        chars: 1436,
        id: "tools",
        label: "Tools",
        percentage: 36,
        tokens: 1679,
      },
      {
        chars: 452,
        id: "systemPrompt",
        label: "System prompt",
        percentage: 11,
        tokens: 529,
      },
    ],
    estimated: true,
    excludedRequestOptionTokens: 0,
    inputTokens: 4683,
    messageCount: 24,
    requestCount: 4,
    toolCount: 3,
    tools: [],
    ...overrides,
  };
}

describe("TokenUsageMenu summary trigger", () => {
  it("always renders the 'Session tokens' label and the formatted session total", () => {
    render(<TokenUsageMenu summary={{ sessionUsage: usage({ totalTokens: 1234 }) }} />);
    expect(screen.getByText("Session tokens")).toBeTruthy();
    expect(screen.getByText("1,234")).toBeTruthy();
  });

  it("formats the session total with locale thousands separators", () => {
    render(<TokenUsageMenu summary={{ sessionUsage: usage({ totalTokens: 1234567 }) }} />);
    expect(screen.getByText("1,234,567")).toBeTruthy();
  });

  it("renders '0' for the session total when usage is empty", () => {
    render(<TokenUsageMenu summary={{ sessionUsage: EMPTY_USAGE }} />);
    // When usage is empty, BOTH the trigger's session total AND the header's
    // last-request total (no latestUsage → formatTokenCount(0)) render "0".
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(1);
  });
});

describe("TokenUsageMenu empty state", () => {
  it("shows the 'Send a message to see usage.' hint when the session has no usage", () => {
    render(<TokenUsageMenu summary={{ sessionUsage: EMPTY_USAGE }} />);
    expect(screen.getByText("Send a message to see usage.")).toBeTruthy();
  });

  it("omits the empty hint once the session has accumulated usage", () => {
    render(<TokenUsageMenu summary={{ sessionUsage: usage({ totalTokens: 10 }) }} />);
    expect(screen.queryByText("Send a message to see usage.")).toBeNull();
  });
});

describe("TokenUsageMenu last-request header", () => {
  it("renders the 'Last request' heading and its description copy", () => {
    render(<TokenUsageMenu summary={{ sessionUsage: usage({ totalTokens: 10 }) }} />);
    expect(screen.getByText("Last request")).toBeTruthy();
    expect(screen.getByText(/OpenRouter totals are exact/)).toBeTruthy();
  });

  // The header row is a flex <div> containing the inner heading <div> AND the
  // right-side total <p> as a sibling. "Last request" lives in the inner div,
  // so .closest("div") lands there; the total is in the parent (flex) div.
  function headerRow(): HTMLElement {
    const inner = screen.getByText("Last request").closest("div");
    return (inner?.parentElement as HTMLElement) ?? (inner as HTMLElement);
  }

  it("shows the latestUsage total in the header when present", () => {
    render(
      <TokenUsageMenu
        summary={{
          latestUsage: usage({ totalTokens: 723 }),
          sessionUsage: usage({ totalTokens: 723 }),
        }}
      />,
    );
    expect(within(headerRow()).getByText("723")).toBeTruthy();
  });

  it("shows 0 for the latestUsage total when absent", () => {
    render(<TokenUsageMenu summary={{ sessionUsage: usage({ totalTokens: 10 }) }} />);
    // No latestUsage → the header right-side renders formatTokenCount(0) = "0".
    expect(within(headerRow()).getByText("0")).toBeTruthy();
  });
});

describe("TokenUsageMenu ProviderUsageGrid", () => {
  const ROW_LABELS = ["Sent to model", "Generated output", "Thinking subset", "Cache read"];

  it("renders all four provider rows when latestUsage is present and non-empty", () => {
    render(
      <TokenUsageMenu
        summary={{
          latestUsage: usage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
          sessionUsage: usage({ totalTokens: 150 }),
        }}
      />,
    );
    for (const label of ROW_LABELS) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("omits the provider grid entirely when latestUsage is absent", () => {
    render(<TokenUsageMenu summary={{ sessionUsage: usage({ totalTokens: 10 }) }} />);
    for (const label of ROW_LABELS) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("omits the provider grid when latestUsage is present but empty (all zeros)", () => {
    render(
      <TokenUsageMenu
        summary={{ latestUsage: EMPTY_USAGE, sessionUsage: usage({ totalTokens: 10 }) }}
      />,
    );
    for (const label of ROW_LABELS) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });
});

describe("TokenUsageMenu PromptAllocation", () => {
  it("renders the 'Estimated input-token split' heading when latestBreakdown is present", () => {
    render(
      <TokenUsageMenu
        summary={{ latestBreakdown: breakdown(), sessionUsage: usage({ totalTokens: 10 }) }}
      />,
    );
    expect(screen.getByText("Estimated input-token split")).toBeTruthy();
  });

  it("omits the allocation panel when latestBreakdown is absent", () => {
    render(<TokenUsageMenu summary={{ sessionUsage: usage({ totalTokens: 10 }) }} />);
    expect(screen.queryByText("Estimated input-token split")).toBeNull();
  });

  it("renders the request + tool count summary (pluralized)", () => {
    render(
      <TokenUsageMenu
        summary={{
          latestBreakdown: breakdown({ requestCount: 4, toolCount: 3 }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.getByText("4 requests · 3 tools")).toBeTruthy();
  });

  it("singularizes the request + tool count summary at 1", () => {
    render(
      <TokenUsageMenu
        summary={{
          latestBreakdown: breakdown({ requestCount: 1, toolCount: 1 }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.getByText("1 request · 1 tool")).toBeTruthy();
  });

  it("renders the excluded-API-options note only when excludedRequestOptionTokens > 0", () => {
    const { rerender } = render(
      <TokenUsageMenu
        summary={{
          latestBreakdown: breakdown({ excludedRequestOptionTokens: 0 }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.queryByText(/API options excluded/)).toBeNull();

    rerender(
      <TokenUsageMenu
        summary={{
          latestBreakdown: breakdown({ excludedRequestOptionTokens: 42 }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.getByText(/API options excluded/)).toBeTruthy();
  });
});

describe("TokenUsageMenu ToolSearchPanel", () => {
  it("renders the 'Tool search' heading when latestToolSearch is present", () => {
    render(
      <TokenUsageMenu
        summary={{ latestToolSearch: toolSearch(), sessionUsage: usage({ totalTokens: 10 }) }}
      />,
    );
    expect(screen.getByText("Tool search")).toBeTruthy();
  });

  it("omits the tool-search panel when latestToolSearch is absent", () => {
    render(<TokenUsageMenu summary={{ sessionUsage: usage({ totalTokens: 10 }) }} />);
    expect(screen.queryByText("Tool search")).toBeNull();
  });

  it("labels search mode 'Search bridge'", () => {
    render(
      <TokenUsageMenu
        summary={{
          latestToolSearch: toolSearch({ mode: "search" }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.getByText(/Search bridge/)).toBeTruthy();
    expect(screen.queryByText(/All tools/)).toBeNull();
  });

  it("labels all mode 'All tools'", () => {
    render(
      <TokenUsageMenu
        summary={{
          latestToolSearch: toolSearch({ mode: "all" }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.getByText(/All tools/)).toBeTruthy();
    expect(screen.queryByText(/Search bridge/)).toBeNull();
  });

  it("renders the request count (pluralized) alongside the mode label", () => {
    render(
      <TokenUsageMenu
        summary={{
          latestToolSearch: toolSearch({ requestCount: 4 }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.getByText(/4 requests/)).toBeTruthy();
  });

  it("singularizes the request count at 1", () => {
    render(
      <TokenUsageMenu
        summary={{
          latestToolSearch: toolSearch({ requestCount: 1 }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.getByText(/1 request/)).toBeTruthy();
    expect(screen.queryByText(/1 requests/)).toBeNull();
  });

  it("renders the baseline readout", () => {
    render(
      <TokenUsageMenu
        summary={{
          latestToolSearch: toolSearch({ baselineSchemaTokens: 118542 }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.getByText(/baseline 118,542/)).toBeTruthy();
  });

  it("renders the four stat rows (Catalog / Sent / Schema sent / Saved)", () => {
    render(
      <TokenUsageMenu
        summary={{
          latestToolSearch: toolSearch({
            availableToolCount: 200,
            savedSchemaTokens: 116982,
            sentSchemaTokens: 1560,
            sentToolCount: 3,
          }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.getAllByText("Catalog").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Schema sent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Saved").length).toBeGreaterThan(0);
    expect(screen.getByText("200 tools")).toBeTruthy();
    expect(screen.getByText("3 tools")).toBeTruthy();
    expect(screen.getByText("1,560 tokens")).toBeTruthy();
    expect(screen.getByText("116,982 tokens")).toBeTruthy();
  });

  it("renders the savings line only when savedSchemaTokens > 0", () => {
    const { rerender } = render(
      <TokenUsageMenu
        summary={{
          latestToolSearch: toolSearch({
            baselineSchemaTokens: 1000,
            savedSchemaTokens: 0,
          }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.queryByText(/of the baseline schema kept off the wire/)).toBeNull();

    rerender(
      <TokenUsageMenu
        summary={{
          latestToolSearch: toolSearch({
            baselineSchemaTokens: 1000,
            savedSchemaTokens: 987,
          }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.getByText(/99% of the baseline schema kept off the wire/)).toBeTruthy();
  });

  it("renders the counts footer (searches / describes / calls / deferred)", () => {
    render(
      <TokenUsageMenu
        summary={{
          latestToolSearch: toolSearch({
            callCount: 2,
            deferredToolCount: 5,
            describeCount: 3,
            searchCount: 1,
          }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.getByText("1 searches")).toBeTruthy();
    expect(screen.getByText("3 describes")).toBeTruthy();
    expect(screen.getByText("2 calls")).toBeTruthy();
    expect(screen.getByText("5 deferred")).toBeTruthy();
  });
});

describe("TokenUsageMenu ToolSearchTrace", () => {
  it("omits the trace disclosure when the trace is empty", () => {
    render(
      <TokenUsageMenu
        summary={{
          latestToolSearch: toolSearch({ trace: [] }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.queryByText("Search trace")).toBeNull();
  });

  it("renders the 'Search trace' disclosure with 'latest N of M' when a trace is present", () => {
    render(
      <TokenUsageMenu
        summary={{
          latestToolSearch: toolSearch({
            trace: [{ kind: "search", matches: [{ name: "github.list_repos" }], query: "github" }],
          }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.getByText("Search trace")).toBeTruthy();
    expect(screen.getByText(/latest 1 of 1/)).toBeTruthy();
  });

  it("caps the visible trace at the latest 5 events", () => {
    const events: ToolSearchSummary["trace"] = Array.from({ length: 7 }, (_, index) => ({
      kind: "call" as const,
      found: true,
      name: `tool_${index}`,
    }));
    render(
      <TokenUsageMenu
        summary={{
          latestToolSearch: toolSearch({ trace: events }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.getByText(/latest 5 of 7/)).toBeTruthy();
  });
});

describe("TokenUsageMenu ToolSchemaBreakdown", () => {
  it("omits the tool-schema breakdown when breakdown.tools is empty", () => {
    render(
      <TokenUsageMenu
        summary={{
          latestBreakdown: breakdown({ tools: [] }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.queryByText("Tool schema breakdown")).toBeNull();
  });

  it("renders the breakdown disclosure with 'top N of M' when tools are present", () => {
    render(
      <TokenUsageMenu
        summary={{
          latestBreakdown: breakdown({
            tools: [{ chars: 100, name: "tool_search", percentage: 50, tokens: 500 }],
          }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.getByText("Tool schema breakdown")).toBeTruthy();
    expect(screen.getByText(/top 1 of 1/)).toBeTruthy();
  });

  it("renders each visible (top-8) tool name and aggregates the rest into an 'Other' row", () => {
    const tools = Array.from({ length: 10 }, (_, index) => ({
      chars: 100,
      name: `tool_${index}`,
      percentage: 10,
      tokens: 100,
    }));
    render(
      <TokenUsageMenu
        summary={{
          latestBreakdown: breakdown({ tools }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    // Top 8 visible by name.
    for (let i = 0; i < 8; i += 1) {
      expect(screen.getByText(`tool_${i}`)).toBeTruthy();
    }
    // The 9th and 10th are hidden behind the "Other" aggregation row.
    expect(screen.queryByText("tool_8")).toBeNull();
    expect(screen.queryByText("tool_9")).toBeNull();
    expect(screen.getByText(/Other 2 tool schemas/)).toBeTruthy();
    // Aggregated tokens (2 hidden × 100) + percentage (2 × 10).
    expect(screen.getByText(/200 · 20%/)).toBeTruthy();
  });

  it("singularizes the 'Other' aggregation row at exactly 1 hidden tool", () => {
    const tools = Array.from({ length: 9 }, (_, index) => ({
      chars: 100,
      name: `tool_${index}`,
      percentage: 10,
      tokens: 100,
    }));
    render(
      <TokenUsageMenu
        summary={{
          latestBreakdown: breakdown({ tools }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.getByText(/Other 1 tool schema/)).toBeTruthy();
    expect(screen.queryByText(/Other 1 tool schemas/)).toBeNull();
  });

  it("omits the 'Other' row when there are 8 or fewer tools", () => {
    const tools = Array.from({ length: 8 }, (_, index) => ({
      chars: 100,
      name: `tool_${index}`,
      percentage: 12,
      tokens: 120,
    }));
    render(
      <TokenUsageMenu
        summary={{
          latestBreakdown: breakdown({ tools }),
          sessionUsage: usage({ totalTokens: 10 }),
        }}
      />,
    );
    expect(screen.queryByText(/^Other/)).toBeNull();
  });
});
