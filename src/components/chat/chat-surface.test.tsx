// @vitest-environment jsdom
//
// DOM-environment component tests for ChatSurface — the primary chat surface
// that ties together the streaming hook, the composer, the skill slash-command
// autocomplete, the scroll-to-latest pinning, the error banner, and the
// usage/busy reporting up to the route-level ChatShellProvider. The extracted
// sub-pieces already have coverage (MessageRow/MessageBubble/MessageCopyButton
// — iteration 80; ModelPicker — iteration 55; useSkillAutocomplete —
// iteration 84; useChatStream/useModels/useSkills/useChatShell — iterations
// 53/60/81), so what had ZERO coverage was ChatSurface's OWN orchestration:
// the empty-state vs. message-list switch, the submitted-status placeholder,
// the composer input binding + Enter-to-send + Shift+Enter newline, the busy
// (Stop) vs. idle (Send) button toggle, the skill autocomplete menu wiring,
// the skill-resolution-on-submit path, the error banner + Retry, the
// scroll-to-latest pinning, and the usage/busy reporting effects.
//
// Harness: the data hooks (useChatStream/useModels/useSkills) and
// useChatShell are mocked so the surface renders against controlled
// messages/status/error + action spies, while the REAL useSkillAutocomplete
// runs (so the composer → menu → accept → setInput integration stays live)
// and the REAL findActivatableSkill/parseSkillCommand resolve skills on
// submit. MessageRow and ModelPicker are stubbed as markers so assertions
// target ChatSurface's own DOM (the composer, the menu, the banner) rather
// than the children's internals (already covered elsewhere).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatSurface } from "~/components/chat/chat-surface";
import type { ChatMessage } from "~/lib/hooks/use-chat-stream";
import type { Skill } from "~/lib/skills/skills-store";

// vi.mock factories are hoisted before imports, so the shared fixtures + spies
// live in a hoisted object the factories read at call time. Individual tests
// reassign mocks.messages/status/error/skills and clear the action spies in
// beforeEach.
const mocks = vi.hoisted(() => ({
  messages: [] as ChatMessage[],
  status: "ready" as "ready" | "submitted" | "streaming" | "error",
  error: null as string | null,
  skills: [] as Skill[],
  models: [],
  defaultModel: null as string | null,
  selectedModel: null as string | null,
  loading: false,
  send: vi.fn(),
  stop: vi.fn(),
  regenerate: vi.fn(),
  setSelectedModel: vi.fn(),
  ensureLoaded: vi.fn(),
  setBusy: vi.fn(),
  setUsage: vi.fn(),
}));

vi.mock("~/lib/hooks/use-chat-stream", () => ({
  useChatStream: () => ({
    messages: mocks.messages,
    status: mocks.status,
    error: mocks.error,
    send: mocks.send,
    stop: mocks.stop,
    regenerate: mocks.regenerate,
  }),
}));

vi.mock("~/lib/hooks/use-models", () => ({
  useModels: () => ({
    models: mocks.models,
    defaultModel: mocks.defaultModel,
    selectedModel: mocks.selectedModel,
    loading: mocks.loading,
    setSelectedModel: mocks.setSelectedModel,
    ensureLoaded: mocks.ensureLoaded,
  }),
}));

vi.mock("~/lib/hooks/use-skills", () => ({
  useSkills: () => ({ skills: mocks.skills }),
}));

vi.mock("~/components/chat/chat-shell-context", () => ({
  useChatShell: () => ({
    setBusy: mocks.setBusy,
    setUsage: mocks.setUsage,
    // ChatSurface only reads setBusy/setUsage from the shell; the usage value
    // itself is owned by the provider and never read back here.
    usage: {
      sessionUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
      },
    },
    chatBusy: false,
  }),
}));

// MessageRow stub: renders the message content so tests can assert on the
// rendered message list without depending on MessageRow's own internals
// (markdown, panels, badges — all covered in chat-message.test.tsx). The
// streaming placeholder mirrors MessageBubble's own Thinking… gate so the
// submitted-status placeholder assertion stays faithful.
vi.mock("~/components/chat/chat-message", () => ({
  MessageRow: (props: { content: string; sender: string; isStreaming?: boolean }) => (
    <div data-sender={props.sender}>
      {props.content === "" && props.isStreaming ? "Thinking…" : props.content}
    </div>
  ),
}));

// ModelPicker stub: a marker button so the composer renders without the
// popover's scrollIntoView dependency (covered separately in
// model-picker.test.tsx). Exposes onOpen so the lazy-load wiring is testable.
vi.mock("~/components/chat/model-picker", () => ({
  ModelPicker: (props: {
    value: string | null;
    defaultModel: string | null;
    loading: boolean;
    onOpen: () => void;
    onChange: (value: string | null) => void;
  }) => (
    <button data-model-picker type="button" onClick={props.onOpen}>
      {props.value ?? props.defaultModel ?? "model"}
    </button>
  ),
}));

// jsdom does not implement Element.prototype.scrollTo (it's a layout
// primitive with no meaningful behavior in a headless DOM). ChatSurface's
// pin-to-bottom auto-scroll effect calls content.scrollTo(...) on mount and
// on every new token, so rendering would otherwise throw under jsdom. This is
// the same standard jsdom workaround the ModelPicker test uses for
// scrollIntoView — a no-op stub is sufficient for the component's contract.
beforeEach(() => {
  if (typeof Element.prototype.scrollTo !== "function") {
    Element.prototype.scrollTo = vi.fn();
  }
});

beforeEach(() => {
  mocks.messages = [];
  mocks.status = "ready";
  mocks.error = null;
  mocks.skills = [];
  mocks.models = [];
  mocks.defaultModel = null;
  mocks.selectedModel = null;
  mocks.loading = false;
  mocks.send.mockClear();
  mocks.stop.mockClear();
  mocks.regenerate.mockClear();
  mocks.setSelectedModel.mockClear();
  mocks.ensureLoaded.mockClear();
  mocks.setBusy.mockClear();
  mocks.setUsage.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// --- Fixtures --------------------------------------------------------------

function userMessage(content: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: `u-${content}`, role: "user", content, ...overrides };
}

function assistantMessage(content: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: `a-${content}`, role: "assistant", content, ...overrides };
}

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "skill-1",
    name: "piglatin",
    description: "Reply in pig latin",
    body: "Translate the user's message to pig latin.",
    isEnabled: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    references: [],
    ...overrides,
  };
}

function scrollToTopState() {
  // Make the scrollable region report as "scrolled up" so isAtBottom flips to
  // false and the scroll-to-latest button appears. The region is the
  // [aria-live="polite"] overflow-y-auto div.
  const region = document.querySelector('[aria-live="polite"]') as HTMLElement;
  expect(region).toBeTruthy();
  // jsdom leaves all geometry at 0; set a tall scrollHeight and a short
  // viewport with scrollTop pinned to the top so the distance-from-bottom
  // exceeds the 80px pin threshold.
  Object.defineProperty(region, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(region, "clientHeight", { value: 400, configurable: true });
  region.scrollTop = 0;
  fireEvent.scroll(region);
}

// --- Tests -----------------------------------------------------------------

describe("ChatSurface empty state", () => {
  it("renders the hero empty state when there are no messages", () => {
    render(<ChatSurface sessionId="s1" />);
    expect(screen.getByText("How can I help?")).toBeTruthy();
    expect(screen.getByText("Ask anything. Responses stream live from OpenRouter.")).toBeTruthy();
  });

  it("does not render the scroll-to-latest button in the empty state", () => {
    render(<ChatSurface sessionId="s1" />);
    expect(screen.queryByLabelText("Scroll to latest message")).toBeNull();
  });

  it("does not render the error banner when there is no error", () => {
    render(<ChatSurface sessionId="s1" />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ChatSurface message list", () => {
  it("renders a MessageRow for each persisted message", () => {
    mocks.messages = [userMessage("hi there"), assistantMessage("hello back")];
    render(<ChatSurface sessionId="s1" />);
    expect(screen.getByText("hi there")).toBeTruthy();
    expect(screen.getByText("hello back")).toBeTruthy();
  });

  it("renders an extra streaming assistant placeholder while status is submitted", () => {
    mocks.messages = [userMessage("hi")];
    mocks.status = "submitted";
    render(<ChatSurface sessionId="s1" />);
    // The persisted user message plus the submitted-status placeholder.
    const placeholders = screen.getAllByText("Thinking…");
    expect(placeholders.length).toBe(1);
  });

  it("does not render the empty-state hero once messages exist", () => {
    mocks.messages = [userMessage("hi")];
    render(<ChatSurface sessionId="s1" />);
    expect(screen.queryByText("How can I help?")).toBeNull();
  });
});

describe("ChatSurface composer input binding", () => {
  it("renders the textarea bound to input with the skill-hint placeholder", () => {
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
    expect(textarea.placeholder).toMatch(/\/skill-name/);
  });

  it("updates the textarea as the user types", () => {
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "hello world" } });
    expect((textarea as HTMLTextAreaElement).value).toBe("hello world");
  });
});

describe("ChatSurface submit button state", () => {
  it("disables Send when the input is empty", () => {
    render(<ChatSurface sessionId="s1" />);
    expect(screen.getByLabelText("Send message")).toHaveProperty("disabled", true);
  });

  it("enables Send once the input has non-whitespace text", () => {
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "hello" } });
    expect(screen.getByLabelText("Send message")).toHaveProperty("disabled", false);
  });

  it("keeps Send disabled when the input is whitespace-only", () => {
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "   " } });
    expect(screen.getByLabelText("Send message")).toHaveProperty("disabled", true);
  });

  it("disables Send (and shows Stop) while the status is streaming", () => {
    mocks.status = "streaming";
    render(<ChatSurface sessionId="s1" />);
    expect(screen.queryByLabelText("Send message")).toBeNull();
    expect(screen.getByLabelText("Stop")).toBeTruthy();
  });
});

describe("ChatSurface submit (Enter to send)", () => {
  it("calls send with the trimmed text and selected model on Enter", () => {
    mocks.selectedModel = "openai/gpt-4o";
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "  hello  " } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith("hello", {
      model: "openai/gpt-4o",
      skill: null,
    });
  });

  it("clears the input after a successful send", () => {
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(textarea.value).toBe("");
  });

  it("does not send on Shift+Enter (newline)", () => {
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not send while busy", () => {
    mocks.status = "streaming";
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("clicking the Send button submits", () => {
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "hi" } });
    fireEvent.click(screen.getByLabelText("Send message"));
    expect(mocks.send).toHaveBeenCalledWith("hi", { model: null, skill: null });
  });

  it("resolves a leading /skill-name to an enabled skill on send", () => {
    mocks.skills = [skill()];
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message");
    // A complete /skill-name command (trailing space + message) parses to the
    // skill name and resolves to the Skill object for the wire injection.
    fireEvent.change(textarea, { target: { value: "/piglatin hello world" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const [, options] = mocks.send.mock.calls[0];
    expect(options.skill).not.toBeNull();
    expect(options.skill?.name).toBe("piglatin");
  });

  it("sends raw text (skill=null) when the /skill-name is unknown", () => {
    mocks.skills = [skill()];
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "/nosuchskill hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const [, options] = mocks.send.mock.calls[0];
    expect(options.skill).toBeNull();
  });
});

describe("ChatSurface stop button", () => {
  it("calls stop when clicked while busy", () => {
    mocks.status = "streaming";
    render(<ChatSurface sessionId="s1" />);
    fireEvent.click(screen.getByLabelText("Stop"));
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });
});

describe("ChatSurface skill autocomplete menu", () => {
  it("opens the menu when the input starts with /matching-skill-name prefix", () => {
    mocks.skills = [skill(), skill({ id: "s2", name: "summarizer" })];
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "/pig" } });
    const listbox = screen.getByRole("listbox", { name: "Skills" });
    expect(listbox).toBeTruthy();
    expect(within(listbox).getByText("/piglatin")).toBeTruthy();
  });

  it("only lists enabled skills", () => {
    mocks.skills = [
      skill({ id: "s-disabled", name: "piglatin-off", isEnabled: false }),
      skill({ id: "s-on", name: "piglatin" }),
    ];
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "/pig" } });
    const listbox = screen.getByRole("listbox", { name: "Skills" });
    expect(within(listbox).getByText("/piglatin")).toBeTruthy();
    expect(within(listbox).queryByText("/piglatin-off")).toBeNull();
  });

  it("does not open the menu for plain (non-slash) input", () => {
    mocks.skills = [skill()];
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "hello" } });
    expect(screen.queryByRole("listbox", { name: "Skills" })).toBeNull();
  });

  it("accepting a skill via Enter replaces the input with /name and does not send", () => {
    mocks.skills = [skill()];
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "/pig" } });
    // Menu is open; Enter should accept, not submit.
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(textarea.value).toBe("/piglatin ");
  });

  it("Escape dismisses the menu", () => {
    mocks.skills = [skill()];
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "/pig" } });
    expect(screen.getByRole("listbox", { name: "Skills" })).toBeTruthy();
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Skills" })).toBeNull();
  });

  it("ArrowDown/ArrowUp move the highlighted option", () => {
    mocks.skills = [skill({ id: "s1", name: "piglatin" }), skill({ id: "s2", name: "pigment" })];
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "/pig" } });
    const options = screen.getAllByRole("option");
    // First option is highlighted by default.
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[1].getAttribute("aria-selected")).toBe("false");
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    expect(options[0].getAttribute("aria-selected")).toBe("false");
    expect(options[1].getAttribute("aria-selected")).toBe("true");
  });

  it("clicking an option accepts it", () => {
    mocks.skills = [skill()];
    render(<ChatSurface sessionId="s1" />);
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "/pig" } });
    fireEvent.click(screen.getByText("/piglatin"));
    expect(textarea.value).toBe("/piglatin ");
  });
});

describe("ChatSurface error banner", () => {
  it("renders the error banner with the message when error is set", () => {
    mocks.error = "Something went wrong";
    render(<ChatSurface sessionId="s1" />);
    const banner = screen.getByRole("alert");
    expect(within(banner).getByText("Chat request failed")).toBeTruthy();
    expect(within(banner).getByText("Something went wrong")).toBeTruthy();
  });

  it("the Retry button calls regenerate", () => {
    mocks.error = "boom";
    render(<ChatSurface sessionId="s1" />);
    fireEvent.click(screen.getByText("Retry"));
    expect(mocks.regenerate).toHaveBeenCalledTimes(1);
  });
});

describe("ChatSurface scroll-to-latest button", () => {
  it("appears when the user has scrolled up from the bottom", () => {
    mocks.messages = [userMessage("a"), assistantMessage("b")];
    render(<ChatSurface sessionId="s1" />);
    // Initially pinned to the bottom (jsdom geometry = 0 distance).
    expect(screen.queryByLabelText("Scroll to latest message")).toBeNull();
    scrollToTopState();
    expect(screen.getByLabelText("Scroll to latest message")).toBeTruthy();
  });

  it("is absent in the empty state regardless of scroll", () => {
    render(<ChatSurface sessionId="s1" />);
    scrollToTopState();
    expect(screen.queryByLabelText("Scroll to latest message")).toBeNull();
  });
});

describe("ChatSurface shell reporting effects", () => {
  it("reports chatBusy=false to the shell on mount when idle", () => {
    render(<ChatSurface sessionId="s1" />);
    expect(mocks.setBusy).toHaveBeenCalledWith(false);
  });

  it("reports chatBusy=true to the shell while streaming", () => {
    mocks.status = "streaming";
    render(<ChatSurface sessionId="s1" />);
    expect(mocks.setBusy).toHaveBeenCalledWith(true);
  });

  it("reports a usage summary to the shell reflecting persisted assistant usage", () => {
    mocks.messages = [
      userMessage("hi"),
      assistantMessage("hello", {
        tokenUsage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          reasoningTokens: 0,
          cachedInputTokens: 0,
        },
      }),
    ];
    render(<ChatSurface sessionId="s1" />);
    const summary = mocks.setUsage.mock.calls.at(-1)?.[0];
    expect(summary).toBeTruthy();
    expect(summary.sessionUsage.totalTokens).toBe(30);
    expect(summary.latestUsage?.totalTokens).toBe(30);
  });
});
