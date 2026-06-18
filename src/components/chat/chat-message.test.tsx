// @vitest-environment jsdom
//
// DOM-environment component tests for the chat-surface message presentation
// components extracted into chat-message.tsx (MessageRow / MessageBubble /
// MessageCopyButton). These are the per-turn render primitives that stack the
// optional ReasoningPanel above the MessageBubble, then the ToolTracePanel, the
// per-turn token-usage caption, and a footer actions cluster (Copy on every
// completed assistant turn, Regenerate only on the last one). They were
// previously private to chat-surface.tsx (the largest untested component) with
// zero coverage; extraction makes the message-presentation contract testable
// in isolation on the established React Testing Library harness.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageBubble, MessageCopyButton, MessageRow } from "~/components/chat/chat-message";
import type { ToolSearchSummary, ToolStep, TurnTokenUsage } from "~/lib/chat/tool-events";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const USAGE: TurnTokenUsage = {
  inputTokens: 12,
  outputTokens: 34,
  totalTokens: 46,
  reasoningTokens: 0,
  cachedInputTokens: 0,
};

const EMPTY_USAGE: TurnTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
};

const TOOL_STEP: ToolStep = {
  name: "tool_search",
  service: "bridge",
  title: "Search the tool catalog",
  status: "ok",
  arguments: { query: "weather" },
  output: '{"matches":[]}',
};

const TOOL_SEARCH: ToolSearchSummary = {
  mode: "search",
  availableToolCount: 200,
  sentToolCount: 3,
  deferredToolCount: 197,
  requestCount: 4,
  catalogSchemaTokens: 29636,
  sentSchemaTokens: 1560,
  baselineSchemaTokens: 118542,
  savedSchemaTokens: 116982,
  searchCount: 1,
  describeCount: 1,
  callCount: 1,
};

describe("MessageBubble — caret + placeholder", () => {
  it("shows the Thinking… placeholder when streaming with empty content", () => {
    render(<MessageBubble content="" isStreaming sender="assistant" />);
    expect(screen.getByText("Thinking…")).toBeTruthy();
  });

  it("does not show the placeholder once content has streamed in", () => {
    render(<MessageBubble content="Hello" isStreaming sender="assistant" />);
    expect(screen.queryByText("Thinking…")).toBeNull();
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("does not show the placeholder for a settled (non-streaming) assistant turn", () => {
    render(<MessageBubble content="Hello" sender="assistant" />);
    expect(screen.queryByText("Thinking…")).toBeNull();
  });

  it("shows the placeholder regardless of sender when streaming + empty (sender-agnostic gate)", () => {
    // showCaret = isStreaming && content.length === 0 is NOT sender-gated. A
    // user turn with empty content + streaming never happens in practice
    // (the composer requires non-empty input to send and the submitted
    // placeholder is always sender="assistant"), so the sender-agnostic gate
    // is harmless. Pinned as the current contract so a future tightening to
    // assistant-only is a deliberate change, not a silent one — the same
    // 'pin the lenient current contract' approach documented across earlier
    // iterations.
    render(<MessageBubble content="" isStreaming sender="user" />);
    expect(screen.getByText("Thinking…")).toBeTruthy();
  });
});

describe("MessageBubble — user content is verbatim, assistant is markdown", () => {
  it("renders user content verbatim including whitespace (no markdown)", () => {
    const { container } = render(
      <MessageBubble content={"line one\n\n  indented"} sender="user" />,
    );
    // User content is wrapped in a whitespace-pre-wrap span (not a markdown
    // tree), so the raw newlines/indent survive as text.
    const span = container.querySelector("span.whitespace-pre-wrap");
    expect(span).toBeTruthy();
    expect(span?.textContent).toBe("line one\n\n  indented");
  });

  it("renders assistant content through the Markdown tree (paragraphs)", () => {
    render(<MessageBubble content="**bold** and _italic_" sender="assistant" />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
  });

  it("renders a streaming caret sibling for user turns that have content", () => {
    const { container } = render(<MessageBubble content="hi" isStreaming sender="user" />);
    const caret = container.querySelector(".animate-pulse");
    expect(caret).toBeTruthy();
    expect(caret?.textContent).toContain("▋");
  });

  it("renders a streaming caret sibling for assistant turns that have content", () => {
    const { container } = render(<MessageBubble content="hi" isStreaming sender="assistant" />);
    // Two .animate-pulse elements exist for an assistant streaming turn that
    // has content: the caret span. (The placeholder path uses a pulse too, but
    // only when content is empty.)
    const pulses = container.querySelectorAll(".animate-pulse");
    expect(pulses.length).toBeGreaterThanOrEqual(1);
  });

  it("does not render a streaming caret when not streaming", () => {
    const { container } = render(<MessageBubble content="hi" sender="assistant" />);
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });
});

describe("MessageBubble — provenance badges", () => {
  it("renders the activatedSkill Zap badge on user turns only", () => {
    const { rerender } = render(
      <MessageBubble content="hi" activatedSkill="pig-latin" sender="user" />,
    );
    expect(screen.getByText("pig-latin")).toBeTruthy();

    // The badge is user-only: an assistant turn carrying activatedSkill does
    // not render it.
    rerender(<MessageBubble content="hi" activatedSkill="pig-latin" sender="assistant" />);
    expect(screen.queryByText("pig-latin")).toBeNull();
  });

  it("renders the scheduled-origin CalendarClock badge on assistant turns only", () => {
    const { rerender } = render(
      <MessageBubble content="ran" origin="scheduled" sender="assistant" />,
    );
    expect(screen.getByText("Ran scheduled task")).toBeTruthy();

    // The badge is assistant-only: a user turn with origin=scheduled does not
    // render it.
    rerender(<MessageBubble content="ran" origin="scheduled" sender="user" />);
    expect(screen.queryByText("Ran scheduled task")).toBeNull();
  });

  it("does not render the scheduled badge when origin is absent", () => {
    render(<MessageBubble content="ran" sender="assistant" />);
    expect(screen.queryByText("Ran scheduled task")).toBeNull();
  });
});

describe("MessageRow — layout direction by sender", () => {
  it("aligns user turns to the end (right)", () => {
    const { container } = render(<MessageRow content="hi" sender="user" />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("items-end");
  });

  it("aligns assistant turns to the start (left)", () => {
    const { container } = render(<MessageRow content="hi" sender="assistant" />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("items-start");
  });
});

describe("MessageRow — reasoning panel gating", () => {
  it("renders the ReasoningPanel only for assistant turns with non-whitespace reasoning", () => {
    const { rerender } = render(
      <MessageRow content="answer" reasoning="because" sender="assistant" />,
    );
    expect(screen.getByRole("group")).toBeTruthy();

    // Whitespace-only reasoning is treated as absent.
    rerender(<MessageRow content="answer" reasoning={"  \n "} sender="assistant" />);
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("does not render the ReasoningPanel for user turns even with reasoning", () => {
    render(<MessageRow content="q" reasoning="secret" sender="user" />);
    expect(screen.queryByRole("group")).toBeNull();
  });
});

describe("MessageRow — tool trace gating", () => {
  it("renders the ToolTracePanel when an assistant turn carries tool steps", () => {
    render(<MessageRow content="answer" sender="assistant" toolSteps={[TOOL_STEP]} />);
    // ToolTracePanel's summary line reads "{n} tool step(s)".
    expect(screen.getByText(/1 tool step/)).toBeTruthy();
  });

  it("renders the ToolTracePanel when an assistant turn carries a tool search summary", () => {
    render(<MessageRow content="answer" sender="assistant" toolSearch={TOOL_SEARCH} />);
    // With no steps but a summary, the summary line reads "0 tool steps".
    expect(screen.getByText(/0 tool steps/)).toBeTruthy();
  });

  it("does not render the ToolTracePanel for assistant turns with no tool activity", () => {
    render(<MessageRow content="answer" sender="assistant" />);
    expect(screen.queryByText(/tool step/)).toBeNull();
  });

  it("does not render the ToolTracePanel for user turns even with tool activity", () => {
    render(
      <MessageRow content="q" sender="user" toolSteps={[TOOL_STEP]} toolSearch={TOOL_SEARCH} />,
    );
    expect(screen.queryByText(/tool step/)).toBeNull();
  });
});

describe("MessageRow — token-usage caption gating", () => {
  it("renders the caption for a settled assistant turn with non-empty usage", () => {
    render(<MessageRow content="answer" sender="assistant" tokenUsage={USAGE} />);
    expect(screen.getByText(/↑ 12 · ↓ 34 · 46 total/)).toBeTruthy();
  });

  it("does not render the caption while the assistant turn is still streaming", () => {
    render(<MessageRow content="answer" isStreaming sender="assistant" tokenUsage={USAGE} />);
    expect(screen.queryByText(/46 total/)).toBeNull();
  });

  it("does not render the caption when usage is empty (no flicker mid-stream)", () => {
    render(<MessageRow content="answer" sender="assistant" tokenUsage={EMPTY_USAGE} />);
    expect(screen.queryByText(/total/)).toBeNull();
  });

  it("does not render the caption for user turns", () => {
    render(<MessageRow content="q" sender="user" tokenUsage={USAGE} />);
    expect(screen.queryByText(/46 total/)).toBeNull();
  });
});

describe("MessageRow — footer actions cluster (Copy / Regenerate)", () => {
  it("renders Copy on every settled non-empty assistant turn", () => {
    render(<MessageRow content="answer" sender="assistant" />);
    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
  });

  it("does not render Copy while streaming or on empty content", () => {
    const { rerender } = render(<MessageRow content="answer" isStreaming sender="assistant" />);
    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();

    rerender(<MessageRow content="" sender="assistant" />);
    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();
  });

  it("does not render Copy on user turns", () => {
    render(<MessageRow content="q" sender="user" />);
    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();
  });

  it("renders Regenerate only on the last assistant turn with a callback", () => {
    const onRegenerate = vi.fn();
    render(
      <MessageRow
        content="answer"
        isLastAssistant
        onRegenerate={onRegenerate}
        sender="assistant"
      />,
    );
    const regen = screen.getByRole("button", { name: /Regenerate/ });
    fireEvent.click(regen);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("does not render Regenerate when not the last assistant turn", () => {
    render(
      <MessageRow
        content="answer"
        isLastAssistant={false}
        onRegenerate={vi.fn()}
        sender="assistant"
      />,
    );
    expect(screen.queryByRole("button", { name: /Regenerate/ })).toBeNull();
  });

  it("does not render Regenerate when no callback is supplied", () => {
    render(<MessageRow content="answer" isLastAssistant sender="assistant" />);
    expect(screen.queryByRole("button", { name: /Regenerate/ })).toBeNull();
  });

  it("does not render Regenerate while streaming", () => {
    render(
      <MessageRow
        content="answer"
        isLastAssistant
        isStreaming
        onRegenerate={vi.fn()}
        sender="assistant"
      />,
    );
    expect(screen.queryByRole("button", { name: /Regenerate/ })).toBeNull();
  });
});

describe("MessageCopyButton — clipboard write + confirmation flash", () => {
  /** navigator.clipboard is a read-only getter on the Navigator prototype in
   * jsdom, so Object.assign(navigator, { clipboard }) silently fails; a
   * defineProperty override is the robust way to stub it per-test. */
  function stubClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  }

  it("renders the default Copy state with the correct aria-label", () => {
    render(<MessageCopyButton content="hello world" />);
    const button = screen.getByRole("button", { name: "Copy message" });
    expect(button.textContent).toContain("Copy");
    expect(button.textContent).not.toContain("Copied");
  });

  it("writes content to the clipboard on click and flashes Copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    vi.useFakeTimers();
    render(<MessageCopyButton content="copy me" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));

    // The clipboard promise resolves on the microtask queue; flush it before
    // asserting on the Copied flash.
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    });

    expect(writeText).toHaveBeenCalledWith("copy me");
  });

  it("reverts from Copied back to Copy after the ~1.5s confirmation window", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    vi.useFakeTimers();
    render(<MessageCopyButton content="copy me" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    });

    // Advancing the fake timer fires the component's setTimeout(() =>
    // setCopied(false)) callback; wrapping in act flushes the resulting React
    // re-render before the assertion.
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });

  it("fails soft (stays Copy, no throw) when the clipboard API rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    stubClipboard(writeText);

    render(<MessageCopyButton content="copy me" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    // Drain the rejected promise so the catch handler runs.
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("copy me");
    });

    // Still in the default Copy state (never flashed Copied).
    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });
});
