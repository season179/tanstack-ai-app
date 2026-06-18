// @vitest-environment jsdom
//
// DOM-environment hook tests for useChatSessions — the live view of the
// localStorage chat-sessions store that the sidebar, redirect logic, and
// routes all read through. The hook is a thin useSyncExternalStore +
// useCallback wrapper over sessions-store, so the store itself is already
// covered (sessions-store.dom.test.ts); these tests pin the hook-layer
// contract that the UI depends on: snapshot shape + reactivity across hook
// instances, referential stability of the snapshot between mutations (the
// same invariant the store pins, verified to propagate through
// useSyncExternalStore), referential stability of the action callbacks,
// newest-updated-first ordering, title provenance, cross-tab storage-event
// reactivity, and that every action delegates to the store (touch re-float,
// rename stamps 'manual', remove drops the row).
//
// Harness mirrors use-chat-stream.dom.test.tsx (iteration 53): vi.resetModules
// + dynamic import for a fresh store/hook singleton per test, localStorage
// cleared in beforeEach, deterministic fake clock so ordering assertions don't
// hit sub-millisecond ties.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SessionsStore = typeof import("~/lib/chat/sessions-store");
type UseChatSessionsModule = typeof import("~/lib/hooks/use-chat-sessions");

async function importFresh(): Promise<{
  store: SessionsStore;
  hook: UseChatSessionsModule;
}> {
  vi.resetModules();
  return {
    store: await import("~/lib/chat/sessions-store"),
    hook: await import("~/lib/hooks/use-chat-sessions"),
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ["Date"] });
  vi.setSystemTime(new Date("2024-06-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const tick = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

describe("useChatSessions initial state", () => {
  it("starts with an empty sessions list", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useChatSessions());
    expect(result.current.sessions).toEqual([]);
  });
});

describe("useChatSessions createSession delegation", () => {
  it("mints a session through the store and surfaces it in the snapshot", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useChatSessions());

    let id = "";
    act(() => {
      id = result.current.createSession("First chat");
    });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0]).toMatchObject({
      id,
      title: "First chat",
      titleSource: "auto",
    });
  });

  it("falls back to the default title for blank/whitespace input", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useChatSessions());

    act(() => {
      result.current.createSession("   ");
    });
    expect(result.current.sessions[0]?.title).toBe("New chat");
  });

  it("writes through to localStorage so the snapshot survives a fresh import", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useChatSessions());

    let id = "";
    act(() => {
      id = result.current.createSession("Persisted");
    });

    // A fresh module + hook (simulating a remount) re-reads localStorage.
    const fresh = await importFresh();
    const { result: freshResult } = renderHook(() => fresh.hook.useChatSessions());
    expect(freshResult.current.sessions).toHaveLength(1);
    expect(freshResult.current.sessions[0]?.id).toBe(id);
    expect(freshResult.current.sessions[0]?.title).toBe("Persisted");
  });
});

describe("useChatSessions reactivity across hook instances", () => {
  it("shares one source of truth: a write in one instance surfaces in another", async () => {
    const { hook } = await importFresh();
    const { result: a } = renderHook(() => hook.useChatSessions());
    const { result: b } = renderHook(() => hook.useChatSessions());

    expect(a.current.sessions).toEqual([]);
    expect(b.current.sessions).toEqual([]);

    act(() => {
      a.current.createSession("Hello");
    });

    // Both instances subscribe to the same store pub/sub.
    expect(a.current.sessions).toHaveLength(1);
    expect(b.current.sessions).toHaveLength(1);
    expect(b.current.sessions[0]?.id).toBe(a.current.sessions[0]?.id);
  });

  it("reflects a write performed directly through the store module (other-writer sync)", async () => {
    const { hook, store } = await importFresh();
    const { result } = renderHook(() => hook.useChatSessions());

    act(() => {
      store.createSession("Direct");
    });
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0]?.title).toBe("Direct");
  });

  it("re-renders on a cross-tab storage event for the sessions key", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useChatSessions());
    expect(result.current.sessions).toEqual([]);

    // Simulate another tab writing the sessions blob. The store's cross-tab
    // handler invalidates the in-memory cache on the storage event, then the
    // next snapshot read re-reads from window.localStorage (NOT from
    // event.newValue) — so the payload must land in localStorage before the
    // event is dispatched. jsdom doesn't auto-fire storage events on direct
    // writes, so we dispatch one manually (the same path the store wires up
    // for real cross-tab sync).
    act(() => {
      const external = [
        {
          id: "from-other-tab",
          title: "Other tab",
          titleSource: "auto",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      localStorage.setItem("tanstack-ai-app:sessions", JSON.stringify(external));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "tanstack-ai-app:sessions",
          newValue: JSON.stringify(external),
        }),
      );
    });
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0]?.id).toBe("from-other-tab");
  });
});

describe("useChatSessions referential stability", () => {
  it("returns the same snapshot reference between non-mutating renders", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useChatSessions());

    act(() => {
      result.current.createSession("A");
    });
    const before = result.current.sessions;

    // A re-render with no store mutation must return the same reference —
    // useSyncExternalStore bails out via Object.is on the cached snapshot.
    act(() => {
      // touch on an unknown id is a no-op write (the store reads, finds nothing,
      // and never invalidates the cache).
      result.current.touch("nonexistent-id");
    });
    expect(result.current.sessions).toBe(before);
  });

  it("returns a fresh snapshot reference after a real mutation", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useChatSessions());

    act(() => {
      result.current.createSession("A");
    });
    const before = result.current.sessions;

    act(() => {
      result.current.createSession("B");
    });
    expect(result.current.sessions).not.toBe(before);
    expect(result.current.sessions).toHaveLength(2);
  });

  it("keeps the action callbacks referentially stable across renders", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useChatSessions());
    const initial = {
      create: result.current.createSession,
      remove: result.current.removeSession,
      rename: result.current.renameSession,
      touch: result.current.touch,
    };

    act(() => {
      result.current.createSession("Trigger a re-render");
    });

    // useCallback([]) → identity must survive a store-mutated re-render.
    expect(result.current.createSession).toBe(initial.create);
    expect(result.current.removeSession).toBe(initial.remove);
    expect(result.current.renameSession).toBe(initial.rename);
    expect(result.current.touch).toBe(initial.touch);
  });
});

describe("useChatSessions ordering", () => {
  it("lists sessions newest-activity-first and re-floats on touch", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useChatSessions());

    act(() => {
      result.current.createSession("First");
    });
    tick(60_000);
    act(() => {
      result.current.createSession("Second");
    });
    tick(60_000);
    act(() => {
      result.current.createSession("Third");
    });

    // Creation order alone → Third, Second, First.
    expect(result.current.sessions.map((s) => s.title)).toEqual(["Third", "Second", "First"]);

    const firstId = result.current.sessions[2]?.id;
    expect(firstId).toBeTruthy();
    tick(60_000);
    act(() => {
      result.current.touch(firstId as string);
    });

    // touch bumps updatedAt → First floats back to the top.
    expect(result.current.sessions.map((s) => s.title)).toEqual(["First", "Third", "Second"]);
  });
});

describe("useChatSessions removeSession / renameSession delegation", () => {
  it("removeSession drops the row from the snapshot", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useChatSessions());

    let id = "";
    act(() => {
      id = result.current.createSession("Doomed");
    });
    expect(result.current.sessions).toHaveLength(1);

    act(() => {
      result.current.removeSession(id);
    });
    expect(result.current.sessions).toEqual([]);
  });

  it("renameSession updates the title and stamps titleSource 'manual'", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useChatSessions());

    let id = "";
    act(() => {
      id = result.current.createSession("Original");
    });
    expect(result.current.sessions[0]?.titleSource).toBe("auto");

    act(() => {
      result.current.renameSession(id, "Renamed by user");
    });
    expect(result.current.sessions[0]?.title).toBe("Renamed by user");
    expect(result.current.sessions[0]?.titleSource).toBe("manual");
  });

  it("renameSession leaves the snapshot content unchanged for an unknown id", async () => {
    // Note: sessions-store.renameSession has NO unknown-id guard — it calls
    // flush(getSessionsSnapshot().map(...)) unconditionally, which invalidates
    // the cache and notifies subscribers even when no row matched. The
    // snapshot CONTENT is preserved (no row is added/removed/retitled), but
    // the array REFERENCE is not. This test pins the content-preservation
    // contract; the unconditional-cache-invalidate is a documented minor
    // inefficiency, not a bug.
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useChatSessions());

    act(() => {
      result.current.createSession("Real");
    });

    act(() => {
      result.current.renameSession("does-not-exist", "Ignored");
    });
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0]?.title).toBe("Real");
    expect(result.current.sessions[0]?.titleSource).toBe("auto");
  });
});
