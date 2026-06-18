// @vitest-environment jsdom
//
// DOM-environment component tests for ReasoningPanel — the inline chain-of-
// thought disclosure rendered ABOVE an assistant message bubble for reasoning
// models (iteration 17). Like ToolTracePanel, it carries the load-bearing
// "uncontrolled <details> + one-shot auto-open during streaming" pattern
// (documented across iterations 11 and 17 as the controlled-open trap), plus
// the "Thinking…" live pulse vs the settled "Reasoning" label. This pins that
// behavior with zero prior coverage, extending the React Testing Library
// harness established in iteration 55 (ModelPicker).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReasoningPanel } from "~/components/chat/reasoning-panel";

afterEach(() => {
  cleanup();
});

/** getByRole("group") returns HTMLElement; <details> exposes `.open`. */
function getDetails(): HTMLDetailsElement {
  return screen.getByRole("group") as HTMLDetailsElement;
}

describe("ReasoningPanel empty-case early return", () => {
  it("renders nothing when reasoning is an empty string", () => {
    const { container } = render(<ReasoningPanel reasoning="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when reasoning is whitespace-only", () => {
    // NOTE: JSX double-quoted attribute strings do NOT process backslash
    // escapes (\n / \t pass through as literal backslash+n+t), so the
    // whitespace fixture must be a real JS string expression.
    const { container } = render(<ReasoningPanel reasoning={"   \n\t  "} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the panel when reasoning has non-whitespace content", () => {
    render(<ReasoningPanel reasoning="The user wants a greeting." />);
    expect(screen.getByRole("group")).toBeTruthy();
  });
});

describe("ReasoningPanel summary label (Thinking… vs Reasoning)", () => {
  it("shows the live Thinking… label while streaming with no visible content yet", () => {
    render(<ReasoningPanel reasoning="thinking…" isStreaming hasContent={false} />);
    expect(screen.getByText("Thinking…")).toBeTruthy();
  });

  it("flips to the settled Reasoning label once visible content has started", () => {
    render(<ReasoningPanel reasoning="thinking…" isStreaming hasContent />);
    expect(screen.getByText("Reasoning")).toBeTruthy();
    expect(screen.queryByText("Thinking…")).toBeNull();
  });

  it("shows the settled Reasoning label when not streaming (idle turn)", () => {
    render(<ReasoningPanel reasoning="thinking…" isStreaming={false} hasContent={false} />);
    expect(screen.getByText("Reasoning")).toBeTruthy();
    expect(screen.queryByText("Thinking…")).toBeNull();
  });

  it("defaults to the settled Reasoning label when isStreaming/hasContent are omitted", () => {
    render(<ReasoningPanel reasoning="thinking…" />);
    expect(screen.getByText("Reasoning")).toBeTruthy();
  });

  it("renders the Thinking… pulse dot only while thinking live", () => {
    // The pulse dot is an aria-hidden span; assert presence then absence.
    const { rerender } = render(
      <ReasoningPanel reasoning="thinking…" isStreaming hasContent={false} />,
    );
    // The pulse is the only animate-pulse rounded-full bg-primary span here.
    expect(document.querySelector(".animate-pulse.rounded-full.bg-primary")).not.toBeNull();

    rerender(<ReasoningPanel reasoning="thinking…" isStreaming hasContent />);
    expect(document.querySelector(".animate-pulse.rounded-full.bg-primary")).toBeNull();
  });
});

describe("ReasoningPanel streaming auto-open (one-shot, uncontrolled details)", () => {
  it("opens the details on first render when streaming", () => {
    render(<ReasoningPanel reasoning="thinking…" isStreaming />);
    expect(getDetails().open).toBe(true);
  });

  it("does NOT auto-open when not streaming", () => {
    render(<ReasoningPanel reasoning="thinking…" isStreaming={false} />);
    expect(getDetails().open).toBe(false);
  });

  it("hands toggle control to the user after the one-shot open (stays open across isStreaming→false)", () => {
    // The controlled-open trap: flipping isStreaming to false must NOT
    // force the panel closed. Re-render and assert it stays open.
    const { rerender } = render(<ReasoningPanel reasoning="thinking…" isStreaming />);
    const details = getDetails();
    expect(details.open).toBe(true);
    rerender(<ReasoningPanel reasoning="thinking…" isStreaming={false} />);
    expect(getDetails().open).toBe(true);
  });

  it("does not re-open the panel if the user closed it during streaming", () => {
    // The one-shot autoOpenedRef means a second streaming render after the
    // user toggled closed must not flip it back open.
    const { rerender } = render(<ReasoningPanel reasoning="thinking…" isStreaming />);
    const detailsBefore = getDetails();
    expect(detailsBefore.open).toBe(true);
    // Simulate the user closing it.
    detailsBefore.open = false;
    // Re-render (e.g. reasoning grew); the panel must stay closed.
    rerender(<ReasoningPanel reasoning="more thinking…" isStreaming />);
    expect(getDetails().open).toBe(false);
  });
});

describe("ReasoningPanel content rendering", () => {
  it("renders the reasoning text inside the disclosure body", () => {
    render(<ReasoningPanel reasoning="Step 1: parse the input." />);
    expect(screen.getByText(/Step 1: parse the input/)).toBeTruthy();
  });

  it("renders reasoning as markdown (paragraphs/lists, not raw text)", () => {
    // The Markdown component renders the body; a markdown list should produce
    // <ul>/<li> elements rather than a raw text blob.
    const { container } = render(<ReasoningPanel reasoning={"- first\n- second\n- third"} />);
    expect(container.querySelectorAll("li").length).toBe(3);
    expect(screen.getByText("first")).toBeTruthy();
    expect(screen.getByText("second")).toBeTruthy();
    expect(screen.getByText("third")).toBeTruthy();
  });

  it("renders inline code spans from markdown", () => {
    render(<ReasoningPanel reasoning={"Use the `tool_search` bridge."} />);
    // react-markdown maps inline code to a <code> element.
    expect(screen.getByText("tool_search").tagName).toBe("CODE");
  });
});
