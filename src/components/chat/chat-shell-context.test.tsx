// @vitest-environment jsdom
//
// DOM-environment tests for ChatShellProvider / useChatShell — the route-level
// context that lifts the chat's streaming status + running token totals up to
// the SiteHeader (Ready/Responding status + the Session Tokens menu). Pins the
// context contract (default busy=false + empty-usage, setBusy / setUsage
// delegation, stable callback identities, the provider + thrown-on-missing-
// consumer contract) AND the iteration-31 side effect that mirrors the
// per-session chatBusy into the module-level busy-signal so the root-level
// AppSidebar (which lives OUTSIDE this provider, in the root AppShell) can
// apply the reference's three chatBusy guards (start new chat / select session
// / delete the active one). The mirror must reset to false on unmount (e.g. on
// a chat switch) so a stale true can never leak into the next session's view —
// a load-bearing contract the AppSidebar's navigation guards depend on.
//
// Uses the React Testing Library renderHook harness established in iteration
// 53 (jsdom + renderHook with a wrapper provider). The busy-signal module
// holds module-level state (a `current` flag + listener Set at module scope),
// so each test resets it in afterEach via setChatBusySignal(false) — harmless
// when already false, and a forced reset when a test left it true. Each test
// file gets its own module registry (vitest's default isolation), so this
// state never leaks into busy-signal.test.ts.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatShellProvider, useChatShell } from "~/components/chat/chat-shell-context";
import { getChatBusySnapshot, setChatBusySignal } from "~/lib/chat/busy-signal";
import type { ChatUsageSummary } from "~/lib/chat/tool-events";

const EMPTY_USAGE: ChatUsageSummary = {
  sessionUsage: {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
  },
};

/** renderHook wrapper that mounts the consumer inside the ChatShellProvider. */
function renderShellHook() {
  return renderHook(() => useChatShell(), { wrapper: ChatShellProvider });
}

beforeEach(() => {
  setChatBusySignal(false);
});

afterEach(() => {
  setChatBusySignal(false);
});

describe("ChatShellProvider context contract", () => {
  it("exposes chatBusy=false and an empty-usage summary by default", () => {
    const { result } = renderShellHook();
    expect(result.current.chatBusy).toBe(false);
    expect(result.current.usage).toEqual(EMPTY_USAGE);
  });

  it("setBusy updates the chatBusy flag", () => {
    const { result } = renderShellHook();
    expect(result.current.chatBusy).toBe(false);
    act(() => result.current.setBusy(true));
    expect(result.current.chatBusy).toBe(true);
    act(() => result.current.setBusy(false));
    expect(result.current.chatBusy).toBe(false);
  });

  it("setUsage replaces the usage summary", () => {
    const { result } = renderShellHook();
    const next: ChatUsageSummary = {
      sessionUsage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        reasoningTokens: 0,
        cachedInputTokens: 0,
      },
    };
    act(() => result.current.setUsage(next));
    expect(result.current.usage).toBe(next);
  });

  it("keeps setBusy identity stable across renders", () => {
    const { result, rerender } = renderShellHook();
    const first = result.current.setBusy;
    act(() => result.current.setBusy(true));
    rerender();
    expect(result.current.setBusy).toBe(first);
  });

  it("keeps setUsage identity stable across renders", () => {
    const { result, rerender } = renderShellHook();
    const first = result.current.setUsage;
    act(() => result.current.setUsage({ ...EMPTY_USAGE }));
    rerender();
    expect(result.current.setUsage).toBe(first);
  });

  it("does not change the busy-signal while chatBusy stays false on mount", () => {
    setChatBusySignal(false);
    renderShellHook();
    expect(getChatBusySnapshot()).toBe(false);
  });
});

describe("ChatShellProvider busy-signal mirror (iteration 31)", () => {
  it("mirrors chatBusy=true into the module-level busy-signal", () => {
    const { result } = renderShellHook();
    expect(getChatBusySnapshot()).toBe(false);
    act(() => result.current.setBusy(true));
    expect(getChatBusySnapshot()).toBe(true);
  });

  it("mirrors a chatBusy true→false transition into the busy-signal", () => {
    const { result } = renderShellHook();
    act(() => result.current.setBusy(true));
    expect(getChatBusySnapshot()).toBe(true);
    act(() => result.current.setBusy(false));
    expect(getChatBusySnapshot()).toBe(false);
  });

  it("resets the busy-signal to false on unmount so a stale true never leaks", () => {
    const { result, unmount } = renderShellHook();
    act(() => result.current.setBusy(true));
    expect(getChatBusySnapshot()).toBe(true);
    unmount();
    expect(getChatBusySnapshot()).toBe(false);
  });

  it("mirrors the busy flag again if set true after a false transition (remount-like)", () => {
    const { result } = renderShellHook();
    act(() => result.current.setBusy(true));
    act(() => result.current.setBusy(false));
    act(() => result.current.setBusy(true));
    expect(getChatBusySnapshot()).toBe(true);
  });
});

describe("useChatShell consumer contract", () => {
  it("throws when used outside the ChatShellProvider", () => {
    // Suppress the expected console.error from the thrown Error.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useChatShell())).toThrow(/useChatShell must be used inside/);
    spy.mockRestore();
  });
});
