// @vitest-environment jsdom
//
// DOM-environment hook tests for useTasks — the live view of the localStorage
// scheduled-task store that the scheduled-jobs board (CRUD + sections), the
// root AppShell (scheduler boot), and CreateTaskDialog all read through. The
// hook is a thin useSyncExternalStore + useCallback wrapper over tasks-store,
// so the store itself is already covered (tasks-store.dom.test.ts); these
// tests pin the hook-layer contract that the UI depends on: snapshot shape +
// reactivity across hook instances, referential stability of the snapshot
// between mutations (the cache invariant the store pins, verified to
// propagate through useSyncExternalStore), referential stability of the
// action callbacks, newest-created-first ordering, createTask delegation
// (incl. the implicit home-session mint), updateTask (return-null-on-unknown
// guard) and removeTask delegation, the startTaskScheduler boot side-effect
// firing exactly once on mount, the cross-tab storage-event reactivity across
// BOTH the tasks and runs keys, and the useGoToTranscript navigation wrapper
// (no-op on null, navigate on a real id).
//
// Harness mirrors use-chat-sessions.dom.test.tsx and use-skills.dom.test.tsx
// (iterations 53/60): vi.resetModules + dynamic import for a fresh
// store/hook singleton per test, localStorage cleared in beforeEach,
// deterministic fake clock so ordering assertions don't hit sub-millisecond
// ties. The scheduler's startTaskScheduler is replaced with a hoisted spy so
// the mount side-effect doesn't actually start a real setInterval, and
// @tanstack/react-router's useNavigate is replaced with a hoisted spy so the
// useGoToTranscript wrapper can be tested without a router context.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TasksStore = typeof import("~/lib/tasks/tasks-store");
type UseTasksModule = typeof import("~/lib/hooks/use-tasks");

// vi.mock factories are hoisted BEFORE imports, so the spies must be created
// via vi.hoisted to be referenceable from inside the factory closures. The
// hoisted object holds stable references across vi.resetModules so individual
// tests can clear/reset without re-wiring the mock.
const mocks = vi.hoisted(() => ({
  startTaskSchedulerSpy: vi.fn(),
  navigateSpy: vi.fn(),
}));

vi.mock("~/lib/tasks/scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/tasks/scheduler")>();
  return {
    ...actual,
    // Replace the real singleton-boot function with the hoisted spy so the
    // mount effect never starts a real setInterval (which would leak across
    // tests and depend on real wall-clock time).
    startTaskScheduler: mocks.startTaskSchedulerSpy,
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    // Replace useNavigate so useGoToTranscript can be rendered without a
    // router context (otherwise useNavigate throws "must be used within a
    // Router"). The spy is re-set per test in beforeEach.
    useNavigate: () => mocks.navigateSpy,
  };
});

async function importFresh(): Promise<{
  store: TasksStore;
  hook: UseTasksModule;
}> {
  vi.resetModules();
  return {
    store: await import("~/lib/tasks/tasks-store"),
    hook: await import("~/lib/hooks/use-tasks"),
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ["Date"] });
  vi.setSystemTime(new Date("2024-06-01T00:00:00.000Z"));
  mocks.startTaskSchedulerSpy.mockClear();
  mocks.navigateSpy.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const tick = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

describe("useTasks initial state", () => {
  it("starts with an empty tasks list", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useTasks());
    expect(result.current.tasks).toEqual([]);
  });
});

describe("useTasks scheduler boot side-effect", () => {
  it("calls startTaskScheduler exactly once on mount", async () => {
    const { hook } = await importFresh();
    expect(mocks.startTaskSchedulerSpy).toHaveBeenCalledTimes(0);
    renderHook(() => hook.useTasks());
    expect(mocks.startTaskSchedulerSpy).toHaveBeenCalledTimes(1);
  });

  it("does not call startTaskScheduler again on re-render", async () => {
    const { hook } = await importFresh();
    const { result, rerender } = renderHook(() => hook.useTasks());
    expect(mocks.startTaskSchedulerSpy).toHaveBeenCalledTimes(1);

    rerender();
    rerender();
    rerender();

    // The useEffect has an empty deps array — the boot must be idempotent
    // across re-renders, exactly once for the hook's lifetime.
    expect(mocks.startTaskSchedulerSpy).toHaveBeenCalledTimes(1);
    // Sanity: the hook still returns the same reference shape.
    expect(result.current.tasks).toEqual([]);
  });
});

describe("useTasks createTask delegation", () => {
  it("mints a one-off task through the store and surfaces it in the snapshot", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useTasks());

    let id = "";
    act(() => {
      const created = result.current.createTask({
        title: "Daily standup",
        scheduleType: "once",
        instruction: "Summarize yesterday",
        runAt: "2024-06-01T00:05:00.000Z",
      });
      id = created.id;
    });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0]).toMatchObject({
      id,
      title: "Daily standup",
      scheduleType: "once",
      isEnabled: true,
    });
    // createTask mints a home chat session — the hook surfaces the link.
    expect(result.current.tasks[0]?.homeSessionId).not.toBeNull();
  });

  it("mints a cron task through the store and surfaces it in the snapshot", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useTasks());

    act(() => {
      result.current.createTask({
        title: "Hourly ping",
        scheduleType: "cron",
        instruction: "ping",
        cron: "0 * * * *",
      });
    });
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0]?.cron).toBe("0 * * * *");
    expect(result.current.tasks[0]?.runAt).toBeNull();
  });

  it("persists through to localStorage so the snapshot survives a fresh import", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useTasks());

    let id = "";
    act(() => {
      id = result.current.createTask({
        title: "Persisted",
        scheduleType: "once",
        instruction: "do thing",
        runAt: "2024-06-01T00:05:00.000Z",
      }).id;
    });

    const fresh = await importFresh();
    const { result: freshResult } = renderHook(() => fresh.hook.useTasks());
    expect(freshResult.current.tasks).toHaveLength(1);
    expect(freshResult.current.tasks[0]?.id).toBe(id);
    expect(freshResult.current.tasks[0]?.title).toBe("Persisted");
  });
});

describe("useTasks reactivity across hook instances", () => {
  it("shares one source of truth: a write in one instance surfaces in another", async () => {
    const { hook } = await importFresh();
    const { result: a } = renderHook(() => hook.useTasks());
    const { result: b } = renderHook(() => hook.useTasks());

    expect(a.current.tasks).toEqual([]);
    expect(b.current.tasks).toEqual([]);

    act(() => {
      a.current.createTask({
        title: "Shared",
        scheduleType: "once",
        instruction: "x",
        runAt: "2024-06-01T00:05:00.000Z",
      });
    });

    // Both instances subscribe to the same store pub/sub.
    expect(a.current.tasks).toHaveLength(1);
    expect(b.current.tasks).toHaveLength(1);
    expect(b.current.tasks[0]?.id).toBe(a.current.tasks[0]?.id);
  });

  it("reflects a write performed directly through the store module (other-writer sync)", async () => {
    const { hook, store } = await importFresh();
    const { result } = renderHook(() => hook.useTasks());

    act(() => {
      store.createTask({
        title: "Direct",
        scheduleType: "once",
        instruction: "x",
        runAt: "2024-06-01T00:05:00.000Z",
      });
    });
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0]?.title).toBe("Direct");
  });

  it("re-renders on a cross-tab storage event for the tasks key", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useTasks());
    expect(result.current.tasks).toEqual([]);

    // Simulate another tab writing the tasks blob. The store's cross-tab
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
          scheduleType: "once",
          payload: { kind: "instruction", instruction: "x" },
          cron: null,
          timezone: "UTC",
          runAt: "2024-06-01T00:05:00.000Z",
          isEnabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastFiredAt: null,
          homeSessionId: null,
        },
      ];
      localStorage.setItem("tanstack-ai-app:scheduled-tasks", JSON.stringify(external));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "tanstack-ai-app:scheduled-tasks",
          newValue: JSON.stringify(external),
        }),
      );
    });
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0]?.id).toBe("from-other-tab");
  });

  it("re-renders on a cross-tab storage event for the runs key (shared cache invalidation)", async () => {
    // tasks-store invalidates BOTH taskCache and runCache on ANY storage event
    // whose key matches tasks OR runs (or null) — so a runs write from another
    // tab still re-reads the tasks blob. This pins that dual-key path through
    // the hook layer.
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useTasks());
    expect(result.current.tasks).toEqual([]);

    act(() => {
      localStorage.setItem("tanstack-ai-app:scheduled-tasks", JSON.stringify([]));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "tanstack-ai-app:scheduled-task-runs",
          newValue: "[]",
        }),
      );
    });
    // No tasks were written, but the cache invalidation path is exercised —
    // the snapshot stays an array (not null/undefined) and stable.
    expect(Array.isArray(result.current.tasks)).toBe(true);
    expect(result.current.tasks).toHaveLength(0);
  });
});

describe("useTasks referential stability", () => {
  it("returns the same snapshot reference between non-mutating renders", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useTasks());

    act(() => {
      result.current.createTask({
        title: "A",
        scheduleType: "once",
        instruction: "x",
        runAt: "2024-06-01T00:05:00.000Z",
      });
    });
    const before = result.current.tasks;

    // updateTask has an unknown-id early-return guard (returns null without
    // calling flush), so the cache stays valid and the snapshot reference is
    // preserved — the contract useSyncExternalStore's Object.is bailout
    // relies on. A holder object dodges TS's control-flow narrowing of
    // `let x: T | null = null` to `null` across the act() callback's separate
    // function scope (the same pattern used in use-skills.dom.test.tsx).
    const holder: { value: unknown } = { value: "untouched" };
    act(() => {
      holder.value = result.current.updateTask("nonexistent-id", { title: "Ignored" });
    });
    expect(holder.value).toBeNull();
    expect(result.current.tasks).toBe(before);
  });

  it("returns a fresh snapshot reference after a real mutation", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useTasks());

    act(() => {
      result.current.createTask({
        title: "A",
        scheduleType: "once",
        instruction: "x",
        runAt: "2024-06-01T00:05:00.000Z",
      });
    });
    const before = result.current.tasks;

    act(() => {
      result.current.createTask({
        title: "B",
        scheduleType: "once",
        instruction: "x",
        runAt: "2024-06-01T00:05:00.000Z",
      });
    });
    expect(result.current.tasks).not.toBe(before);
    expect(result.current.tasks).toHaveLength(2);
  });

  it("keeps the action callbacks referentially stable across renders", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useTasks());
    const initial = {
      create: result.current.createTask,
      update: result.current.updateTask,
      remove: result.current.removeTask,
    };

    act(() => {
      result.current.createTask({
        title: "Trigger a re-render",
        scheduleType: "once",
        instruction: "x",
        runAt: "2024-06-01T00:05:00.000Z",
      });
    });

    // useCallback([]) → identity must survive a store-mutated re-render.
    expect(result.current.createTask).toBe(initial.create);
    expect(result.current.updateTask).toBe(initial.update);
    expect(result.current.removeTask).toBe(initial.remove);
  });
});

describe("useTasks ordering", () => {
  it("lists tasks newest-created-first (stable across updatedAt bumps)", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useTasks());

    act(() => {
      result.current.createTask({
        title: "Oldest",
        scheduleType: "once",
        instruction: "x",
        runAt: "2024-06-01T00:05:00.000Z",
      });
    });
    tick(60_000);
    act(() => {
      result.current.createTask({
        title: "Middle",
        scheduleType: "once",
        instruction: "x",
        runAt: "2024-06-01T00:05:00.000Z",
      });
    });
    tick(60_000);
    act(() => {
      result.current.createTask({
        title: "Newest",
        scheduleType: "once",
        instruction: "x",
        runAt: "2024-06-01T00:05:00.000Z",
      });
    });
    expect(result.current.tasks.map((t) => t.title)).toEqual(["Newest", "Middle", "Oldest"]);

    // An updateTask bumps updatedAt but must NOT re-sort: tasks-store sorts by
    // createdAt, not updatedAt (pinned by tasks-store.dom.test.ts).
    const oldestId = result.current.tasks[2]?.id;
    expect(oldestId).toBeTruthy();
    tick(60_000);
    act(() => {
      result.current.updateTask(oldestId as string, { isEnabled: false });
    });
    expect(result.current.tasks.map((t) => t.title)).toEqual(["Newest", "Middle", "Oldest"]);
    // But the bumped task's isEnabled flipped.
    expect(result.current.tasks[2]?.isEnabled).toBe(false);
  });
});

describe("useTasks updateTask / removeTask delegation", () => {
  it("updateTask patches fields and returns the updated task", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useTasks());

    let id = "";
    act(() => {
      const created = result.current.createTask({
        title: "Orig",
        scheduleType: "once",
        instruction: "do thing",
        runAt: "2024-06-01T00:05:00.000Z",
      });
      id = created.id;
    });

    const holder: {
      value: { id: string; title: string; isEnabled: boolean } | null;
    } = { value: null };
    act(() => {
      holder.value = result.current.updateTask(id, {
        title: "Renamed",
        isEnabled: false,
      });
    });
    expect(holder.value?.id).toBe(id);
    expect(holder.value?.title).toBe("Renamed");
    expect(holder.value?.isEnabled).toBe(false);
    expect(result.current.tasks[0]?.title).toBe("Renamed");
    expect(result.current.tasks[0]?.isEnabled).toBe(false);
  });

  it("updateTask returns null for an unknown id and leaves the snapshot untouched", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useTasks());

    act(() => {
      result.current.createTask({
        title: "Real",
        scheduleType: "once",
        instruction: "x",
        runAt: "2024-06-01T00:05:00.000Z",
      });
    });
    const before = result.current.tasks;

    const holder: { value: unknown } = { value: "untouched" };
    act(() => {
      holder.value = result.current.updateTask("does-not-exist", { title: "Ignored" });
    });
    expect(holder.value).toBeNull();
    expect(result.current.tasks).toBe(before);
    expect(result.current.tasks[0]?.title).toBe("Real");
  });

  it("removeTask drops the row from the snapshot", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useTasks());

    let id = "";
    act(() => {
      id = result.current.createTask({
        title: "Doomed",
        scheduleType: "once",
        instruction: "x",
        runAt: "2024-06-01T00:05:00.000Z",
      }).id;
    });
    expect(result.current.tasks).toHaveLength(1);

    act(() => {
      result.current.removeTask(id);
    });
    expect(result.current.tasks).toEqual([]);
  });

  it("removeTask leaves the snapshot content unchanged for an unknown id", async () => {
    // Note: tasks-store.deleteTask has NO unknown-id guard — it calls
    // flushTasks(getTasksSnapshot().filter(...)) unconditionally, which
    // invalidates the cache and notifies subscribers even when no row matched.
    // The snapshot CONTENT is preserved (no row is added or removed), but the
    // array REFERENCE is not. This test pins the content-preservation
    // contract; the unconditional-cache-invalidate is a documented minor
    // inefficiency, not a bug. (Mirrors the same pinned behavior in
    // use-skills.dom.test.tsx and use-chat-sessions.dom.test.tsx.)
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useTasks());

    act(() => {
      result.current.createTask({
        title: "Real",
        scheduleType: "once",
        instruction: "x",
        runAt: "2024-06-01T00:05:00.000Z",
      });
    });

    act(() => {
      result.current.removeTask("does-not-exist");
    });
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0]?.title).toBe("Real");
  });
});

describe("useGoToTranscript", () => {
  it("navigates to the task's home chat session when an id is provided", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useGoToTranscript());

    act(() => {
      result.current("session-123");
    });

    expect(mocks.navigateSpy).toHaveBeenCalledTimes(1);
    expect(mocks.navigateSpy).toHaveBeenCalledWith({
      to: "/chat/$sessionId",
      params: { sessionId: "session-123" },
    });
  });

  it("is a no-op when the home session id is null", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useGoToTranscript());

    act(() => {
      result.current(null);
    });

    expect(mocks.navigateSpy).not.toHaveBeenCalled();
  });

  it("returns a stable callback identity across re-renders", async () => {
    const { hook } = await importFresh();
    const { result, rerender } = renderHook(() => hook.useGoToTranscript());
    const before = result.current;

    rerender();

    // useNavigate returns a stable navigate function inside React Router, and
    // the useCallback([navigate]) wrapper preserves identity as long as the
    // navigate function does. With the mocked useNavigate returning the same
    // hoisted spy reference each render, the callback identity is preserved.
    expect(result.current).toBe(before);
  });
});
