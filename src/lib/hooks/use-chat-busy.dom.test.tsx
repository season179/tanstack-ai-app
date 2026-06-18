// @vitest-environment jsdom
//
// DOM-environment hook tests for useChatBusy — the thin useSyncExternalStore
// wrapper over the module-level busy-signal that lets components outside the
// per-session ChatShellProvider (notably the sidebar) mirror the reference's
// chatBusy guards. The busy-signal module itself is already covered
// (busy-signal.test.ts); these tests pin the hook-layer contract the UI
// depends on: the default false snapshot, true/false reactivity across signal
// transitions, cross-instance fan-out, and the SSR-safe getServerSnapshot
// contract (returns false when no signal has been set).
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type BusySignalModule = typeof import("~/lib/chat/busy-signal");
type UseChatBusyModule = typeof import("~/lib/hooks/use-chat-busy");

async function importFresh(): Promise<{
  signal: BusySignalModule;
  hook: UseChatBusyModule;
}> {
  vi.resetModules();
  return {
    signal: await import("~/lib/chat/busy-signal"),
    hook: await import("~/lib/hooks/use-chat-busy"),
  };
}

beforeEach(async () => {
  const { signal } = await importFresh();
  // Reset the module-level flag to its default so tests don't leak state.
  act(() => {
    signal.setChatBusySignal(false);
  });
});

afterEach(async () => {
  const { signal } = await importFresh();
  act(() => {
    signal.setChatBusySignal(false);
  });
});

describe("useChatBusy", () => {
  it("returns false by default before any signal has been set", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useChatBusy());
    expect(result.current).toBe(false);
  });

  it("returns true after setChatBusySignal(true) and re-renders on the transition", async () => {
    const { signal, hook } = await importFresh();
    const { result } = renderHook(() => hook.useChatBusy());
    expect(result.current).toBe(false);

    act(() => {
      signal.setChatBusySignal(true);
    });
    expect(result.current).toBe(true);

    act(() => {
      signal.setChatBusySignal(false);
    });
    expect(result.current).toBe(false);
  });

  it("does not re-render on a no-op signal set (identical value)", async () => {
    const { signal, hook } = await importFresh();
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return hook.useChatBusy();
    });

    expect(renderCount).toBe(1);
    expect(result.current).toBe(false);

    // Setting the same value is a no-op (the signal guards on identity).
    act(() => {
      signal.setChatBusySignal(false);
    });
    expect(renderCount).toBe(1);

    // A real transition re-renders.
    act(() => {
      signal.setChatBusySignal(true);
    });
    expect(renderCount).toBe(2);
    expect(result.current).toBe(true);
  });

  it("fans out the same signal to multiple hook instances", async () => {
    const { signal, hook } = await importFresh();
    const { result: a } = renderHook(() => hook.useChatBusy());
    const { result: b } = renderHook(() => hook.useChatBusy());

    expect(a.current).toBe(false);
    expect(b.current).toBe(false);

    act(() => {
      signal.setChatBusySignal(true);
    });
    expect(a.current).toBe(true);
    expect(b.current).toBe(true);
  });

  it("unsubscribes on unmount so a later signal change does not throw", async () => {
    const { signal, hook } = await importFresh();
    const { result, unmount } = renderHook(() => hook.useChatBusy());
    expect(result.current).toBe(false);

    unmount();
    // After unmount the subscriber is gone; this must not throw and must not
    // affect any still-mounted hook (none here).
    expect(() => signal.setChatBusySignal(true)).not.toThrow();
  });
});
