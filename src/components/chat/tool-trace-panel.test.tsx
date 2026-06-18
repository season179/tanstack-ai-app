// @vitest-environment jsdom
//
// DOM-environment component tests for ToolTracePanel — the inline tool-activity
// disclosure rendered beneath an assistant message bubble (iteration 11). The
// panel carries the load-bearing "uncontrolled <details> + one-shot auto-open
// during streaming" pattern (documented across iterations 11 and 17 as the
// critical UX trap a controlled-open panel falls into), plus the summary line
// derived from the deferred-tool-search metadata and the per-step rows. This
// pins that behavior with zero prior coverage, extending the React Testing
// Library harness established in iteration 55 (ModelPicker).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ToolTracePanel } from "~/components/chat/tool-trace-panel";
import type { ToolSearchSummary, ToolStep } from "~/lib/chat/tool-events";

afterEach(() => {
  cleanup();
});

/** getByRole("group") returns HTMLElement; <details> exposes `.open`. */
function getDetails(): HTMLDetailsElement {
  return screen.getByRole("group") as HTMLDetailsElement;
}

function makeSummary(overrides: Partial<ToolSearchSummary> = {}): ToolSearchSummary {
  return {
    mode: "search",
    availableToolCount: 200,
    sentToolCount: 3,
    deferredToolCount: 197,
    requestCount: 4,
    catalogSchemaTokens: 118542,
    sentSchemaTokens: 1560,
    baselineSchemaTokens: 118542,
    savedSchemaTokens: 116982,
    searchCount: 1,
    describeCount: 1,
    callCount: 1,
    ...overrides,
  };
}

function makeStep(overrides: Partial<ToolStep> = {}): ToolStep {
  return {
    name: "tool_search",
    status: "ok",
    ...overrides,
  };
}

describe("ToolTracePanel empty-case early return", () => {
  it("renders nothing when there are no steps and no summary", () => {
    const { container } = render(<ToolTracePanel steps={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the panel when only steps are present (no summary)", () => {
    render(<ToolTracePanel steps={[makeStep()]} />);
    expect(screen.getByText(/1 tool step/)).toBeTruthy();
  });

  it("renders the panel when only a summary is present (no steps)", () => {
    render(<ToolTracePanel steps={[]} summary={makeSummary()} />);
    // The summary line reads "N tool steps" from steps.length, which is 0 here,
    // but the panel still mounts because a summary was supplied.
    expect(screen.getByText(/0 tool steps/)).toBeTruthy();
  });
});

describe("ToolTracePanel summary header", () => {
  it("shows the step count singular vs plural", () => {
    const { rerender } = render(<ToolTracePanel steps={[makeStep()]} />);
    expect(screen.getByText(/1 tool step$/)).toBeTruthy();
    rerender(<ToolTracePanel steps={[makeStep(), makeStep({ name: "tool_describe" })]} />);
    expect(screen.getByText(/2 tool steps/)).toBeTruthy();
  });

  it("renders the savings summary line when a summary is supplied", () => {
    render(<ToolTracePanel steps={[makeStep()]} summary={makeSummary()} />);
    // formatSavingsLine emits "Search bridge · 3 tools sent · 1,560 schema tokens · 99% saved · 118.5k baseline"
    // The mode label "Search bridge" also appears in the SavingsGrid header
    // (jsdom renders closed-<details> content to the DOM — no CSS hides it —
    // so getAllByText is the correct query here; see the jsdom-details gotcha
    // learning below). The summary-line-specific clauses are unique, though.
    expect(screen.getAllByText(/Search bridge/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/3 tools sent/)).toBeTruthy();
    expect(screen.getByText(/1,560 schema tokens/)).toBeTruthy();
    expect(screen.getByText(/99% saved/)).toBeTruthy();
    expect(screen.getByText(/118.5k baseline/)).toBeTruthy();
  });

  it("renders the all-tools mode label in the summary line", () => {
    render(
      <ToolTracePanel
        steps={[makeStep()]}
        summary={makeSummary({ mode: "all", sentToolCount: 200 })}
      />,
    );
    // The mode label lives in both the summary line and the SavingsGrid
    // header; getAllByText pins the dual-location contract.
    expect(screen.getAllByText(/All tools/).length).toBeGreaterThanOrEqual(1);
  });

  it("omits the savings clause when savedSchemaTokens is 0 (the all-tools baseline)", () => {
    render(<ToolTracePanel steps={[makeStep()]} summary={makeSummary({ savedSchemaTokens: 0 })} />);
    // formatSavingsLine only appends the "% saved · … baseline" clause when
    // savedSchemaTokens > 0.
    expect(screen.queryByText(/saved/)).toBeNull();
  });
});

describe("ToolTracePanel streaming auto-open (one-shot, uncontrolled details)", () => {
  it("opens the details on first render when streaming and steps are present", () => {
    render(<ToolTracePanel isStreaming steps={[makeStep()]} />);
    expect(getDetails().open).toBe(true);
  });

  it("does NOT auto-open when not streaming (idle turn)", () => {
    render(<ToolTracePanel isStreaming={false} steps={[makeStep()]} />);
    expect(getDetails().open).toBe(false);
  });

  it("does NOT auto-open while streaming if there are no steps yet", () => {
    // The auto-open effect guards on steps.length === 0; an empty streaming
    // turn (e.g. only a summary arrived) must not yank open.
    render(<ToolTracePanel isStreaming steps={[]} summary={makeSummary()} />);
    expect(getDetails().open).toBe(false);
  });

  it("hands toggle control to the user after the one-shot open (stays open across an isStreaming→false transition without re-touching)", () => {
    // After auto-opening once during streaming, flipping isStreaming to false
    // must not force the details closed (the controlled-open trap). Re-render
    // with isStreaming=false and assert the panel remains open.
    const { rerender } = render(<ToolTracePanel isStreaming steps={[makeStep()]} />);
    const details = getDetails();
    expect(details.open).toBe(true);
    rerender(<ToolTracePanel isStreaming={false} steps={[makeStep()]} />);
    expect(details.open).toBe(true);
  });

  it("does not re-open the panel if the user closed it during streaming", () => {
    // The one-shot autoOpenedRef means a second streaming render after the user
    // toggled closed must not flip it back open. We simulate by rendering twice
    // with isStreaming=true; the ref stays set so the effect short-circuits.
    const { container, rerender } = render(<ToolTracePanel isStreaming steps={[makeStep()]} />);
    const detailsBefore = getDetails();
    expect(detailsBefore.open).toBe(true);
    // Simulate the user closing it.
    detailsBefore.open = false;
    // Add another step (re-render); the panel must stay closed because the
    // one-shot ref has already fired.
    rerender(<ToolTracePanel isStreaming steps={[makeStep(), makeStep({ name: "x" })]} />);
    expect(getDetails().open).toBe(false);
    // Container sanity: still mounted.
    expect(container.firstChild).not.toBeNull();
  });
});

describe("ToolTracePanel step rows", () => {
  it("renders one row per step with the title-or-name label", () => {
    render(
      <ToolTracePanel
        steps={[
          makeStep({ name: "tool_search", title: "Search the catalog" }),
          makeStep({ name: "github_list_repos", title: undefined }),
        ]}
      />,
    );
    // Title takes precedence over name.
    expect(screen.getByText("Search the catalog")).toBeTruthy();
    // Falls back to the wire name when no title.
    expect(screen.getByText("github_list_repos")).toBeTruthy();
  });

  it("renders the service as an uppercased sublabel when present", () => {
    render(<ToolTracePanel steps={[makeStep({ name: "t", service: "github" })]} />);
    // The sublabel is rendered in an uppercase tracking span; the text content
    // is the raw service string.
    expect(screen.getByText("github")).toBeTruthy();
  });

  it("renders the running… hint for a step still in flight", () => {
    render(<ToolTracePanel steps={[makeStep({ name: "t", status: "running" })]} />);
    expect(screen.getByText(/running…/)).toBeTruthy();
  });

  it("renders the truncated output preview for a completed step with string output", () => {
    render(
      <ToolTracePanel
        steps={[makeStep({ name: "t", status: "ok", output: "all good, the tool ran" })]}
      />,
    );
    expect(screen.getByText(/→ all good, the tool ran/)).toBeTruthy();
  });

  it("omits the output preview for a step with empty output", () => {
    render(<ToolTracePanel steps={[makeStep({ name: "t", status: "ok", output: "" })]} />);
    // No "→" preview line should be present.
    expect(screen.queryByText(/→/)).toBeNull();
  });

  it("renders the args preview for a step with object arguments", () => {
    render(<ToolTracePanel steps={[makeStep({ name: "t", arguments: { query: "weather" } })]} />);
    // formatArgsPreview JSON-stringifies then collapses → {"query":"weather"}
    expect(screen.getByText('{"query":"weather"}')).toBeTruthy();
  });

  it("omits the args preview for a step with empty object arguments ({})", () => {
    render(<ToolTracePanel steps={[makeStep({ name: "t", arguments: {} })]} />);
    // The {} case is suppressed by formatArgsPreview.
    expect(screen.queryByText("{}")).toBeNull();
  });

  it("renders the savings grid (Sent/Schema sent/Saved/Baseline) when a summary is present", () => {
    render(<ToolTracePanel steps={[makeStep()]} summary={makeSummary()} />);
    expect(screen.getByText("Sent")).toBeTruthy();
    expect(screen.getByText("Schema sent")).toBeTruthy();
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.getByText("Baseline")).toBeTruthy();
  });

  it("renders the search/describe/call/deferred counts in the savings grid footer", () => {
    render(
      <ToolTracePanel
        steps={[makeStep()]}
        summary={makeSummary({
          searchCount: 2,
          describeCount: 3,
          callCount: 4,
          deferredToolCount: 197,
        })}
      />,
    );
    expect(screen.getByText(/2 searches/)).toBeTruthy();
    expect(screen.getByText(/3 describes/)).toBeTruthy();
    expect(screen.getByText(/4 calls/)).toBeTruthy();
    expect(screen.getByText(/197 deferred/)).toBeTruthy();
  });

  it("renders the request-count label with singular vs plural", () => {
    const { rerender } = render(
      <ToolTracePanel steps={[makeStep()]} summary={makeSummary({ requestCount: 1 })} />,
    );
    expect(screen.getByText(/1 request$/)).toBeTruthy();
    rerender(<ToolTracePanel steps={[makeStep()]} summary={makeSummary({ requestCount: 5 })} />);
    expect(screen.getByText(/5 requests/)).toBeTruthy();
  });
});
