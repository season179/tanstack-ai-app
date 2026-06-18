// @vitest-environment jsdom
//
// DOM-environment hook tests for useSkills — the live view of the localStorage
// skills store that the Skills page (CRUD UI) and the chat composer
// (/skill-name autocomplete + per-request snapshot) both read through. The
// hook is a thin useSyncExternalStore + useCallback wrapper over
// skills-store, so the store itself is already covered
// (skills-store.dom.test.ts); these tests pin the hook-layer contract that the
// UI depends on: snapshot shape + reactivity across hook instances,
// referential stability of the snapshot between mutations (the cache invariant
// the store pins, verified to propagate through useSyncExternalStore),
// referential stability of the action callbacks, newest-created-first
// ordering, enabled-by-default semantics, CRUD delegation through the hook,
// unknown-id updateSkill returns null, and cross-tab storage-event
// reactivity.
//
// Harness mirrors use-chat-sessions.dom.test.tsx and use-chat-stream.dom.test
// .tsx (iteration 53): vi.resetModules + dynamic import for a fresh
// store/hook singleton per test, localStorage cleared in beforeEach,
// deterministic fake clock so ordering assertions don't hit sub-millisecond
// ties.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SkillsStore = typeof import("~/lib/skills/skills-store");
type UseSkillsModule = typeof import("~/lib/hooks/use-skills");

async function importFresh(): Promise<{
  store: SkillsStore;
  hook: UseSkillsModule;
}> {
  vi.resetModules();
  return {
    store: await import("~/lib/skills/skills-store"),
    hook: await import("~/lib/hooks/use-skills"),
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

describe("useSkills initial state", () => {
  it("starts with an empty skills list", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useSkills());
    expect(result.current.skills).toEqual([]);
  });
});

describe("useSkills createSkill delegation", () => {
  it("mints a skill through the store and surfaces it in the snapshot", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useSkills());

    let skill: { id: string; name: string; isEnabled: boolean } | undefined;
    act(() => {
      skill = result.current.createSkill({
        name: "Pig latin",
        description: "Translates text into pig latin.",
        body: "Respond in pig latin.",
      });
    });
    expect(skill).toBeDefined();
    expect(skill?.id).toBeTruthy();
    expect(skill?.isEnabled).toBe(true);
    expect(result.current.skills).toHaveLength(1);
    expect(result.current.skills[0]).toMatchObject({
      id: skill?.id,
      name: "Pig latin",
      isEnabled: true,
    });
  });

  it("persists through to localStorage so the snapshot survives a fresh import", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useSkills());

    act(() => {
      result.current.createSkill({
        name: "Persisted",
        description: "d",
        body: "b",
      });
    });

    const fresh = await importFresh();
    const { result: freshResult } = renderHook(() => fresh.hook.useSkills());
    expect(freshResult.current.skills).toHaveLength(1);
    expect(freshResult.current.skills[0]?.name).toBe("Persisted");
  });
});

describe("useSkills reactivity across hook instances", () => {
  it("shares one source of truth: a write in one instance surfaces in another", async () => {
    const { hook } = await importFresh();
    const { result: a } = renderHook(() => hook.useSkills());
    const { result: b } = renderHook(() => hook.useSkills());

    expect(a.current.skills).toEqual([]);
    expect(b.current.skills).toEqual([]);

    act(() => {
      a.current.createSkill({ name: "Shared", description: "d", body: "b" });
    });

    expect(a.current.skills).toHaveLength(1);
    expect(b.current.skills).toHaveLength(1);
    expect(b.current.skills[0]?.id).toBe(a.current.skills[0]?.id);
  });

  it("reflects a write performed directly through the store module (other-writer sync)", async () => {
    const { hook, store } = await importFresh();
    const { result } = renderHook(() => hook.useSkills());

    act(() => {
      store.createSkill({ name: "Direct", description: "d", body: "b" });
    });
    expect(result.current.skills).toHaveLength(1);
    expect(result.current.skills[0]?.name).toBe("Direct");
  });

  it("re-renders on a cross-tab storage event for the skills key", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useSkills());
    expect(result.current.skills).toEqual([]);

    // Simulate another tab writing the skills blob. The store's cross-tab
    // handler invalidates the in-memory cache on the storage event, then the
    // next snapshot read re-reads from window.localStorage (NOT from
    // event.newValue) — so the payload must land in localStorage before the
    // event is dispatched. jsdom doesn't auto-fire storage events on direct
    // writes, so we dispatch one manually.
    act(() => {
      const external = [
        {
          id: "from-other-tab",
          name: "Other tab",
          description: "d",
          body: "b",
          isEnabled: true,
          references: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      localStorage.setItem("tanstack-ai-app:skills", JSON.stringify(external));
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "tanstack-ai-app:skills",
          newValue: JSON.stringify(external),
        }),
      );
    });
    expect(result.current.skills).toHaveLength(1);
    expect(result.current.skills[0]?.id).toBe("from-other-tab");
  });
});

describe("useSkills referential stability", () => {
  it("returns the same snapshot reference between non-mutating renders", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useSkills());

    act(() => {
      result.current.createSkill({ name: "A", description: "d", body: "b" });
    });
    const before = result.current.skills;

    // updateSkill has an unknown-id early-return guard (returns null without
    // calling flush), so the cache stays valid and the snapshot reference is
    // preserved — the contract useSyncExternalStore's Object.is bailout
    // relies on. (deleteSkill, by contrast, flushes unconditionally — see the
    // dedicated content-preservation test below.) A holder object dodges TS's
    // control-flow narrowing of `let x: T | null = null` to `null` across the
    // act() callback's separate function scope.
    const holder: { value: unknown } = { value: "untouched" };
    act(() => {
      holder.value = result.current.updateSkill("nonexistent-id", { name: "Ignored" });
    });
    expect(holder.value).toBeNull();
    expect(result.current.skills).toBe(before);
  });

  it("returns a fresh snapshot reference after a real mutation", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useSkills());

    act(() => {
      result.current.createSkill({ name: "A", description: "d", body: "b" });
    });
    const before = result.current.skills;

    act(() => {
      result.current.createSkill({ name: "B", description: "d", body: "b" });
    });
    expect(result.current.skills).not.toBe(before);
    expect(result.current.skills).toHaveLength(2);
  });

  it("keeps the action callbacks referentially stable across renders", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useSkills());
    const initial = {
      create: result.current.createSkill,
      update: result.current.updateSkill,
      remove: result.current.removeSkill,
    };

    act(() => {
      result.current.createSkill({ name: "Trigger", description: "d", body: "b" });
    });

    // useCallback([]) → identity must survive a store-mutated re-render.
    expect(result.current.createSkill).toBe(initial.create);
    expect(result.current.updateSkill).toBe(initial.update);
    expect(result.current.removeSkill).toBe(initial.remove);
  });
});

describe("useSkills ordering", () => {
  it("lists skills newest-created-first (stable across updatedAt bumps)", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useSkills());

    act(() => {
      result.current.createSkill({ name: "Oldest", description: "d", body: "b" });
    });
    tick(60_000);
    act(() => {
      result.current.createSkill({ name: "Middle", description: "d", body: "b" });
    });
    tick(60_000);
    act(() => {
      result.current.createSkill({ name: "Newest", description: "d", body: "b" });
    });
    expect(result.current.skills.map((s) => s.name)).toEqual(["Newest", "Middle", "Oldest"]);

    // An updateSkill bumps updatedAt but must NOT re-sort: skills-store sorts by
    // createdAt, not updatedAt (pinned by skills-store.dom.test.ts).
    const oldestId = result.current.skills[2]?.id;
    expect(oldestId).toBeTruthy();
    tick(60_000);
    act(() => {
      result.current.updateSkill(oldestId as string, { isEnabled: false });
    });
    expect(result.current.skills.map((s) => s.name)).toEqual(["Newest", "Middle", "Oldest"]);
    // But the bumped skill's isEnabled flipped.
    expect(result.current.skills[2]?.isEnabled).toBe(false);
  });
});

describe("useSkills updateSkill / removeSkill delegation", () => {
  it("updateSkill patches fields and returns the updated skill", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useSkills());

    let id = "";
    act(() => {
      const created = result.current.createSkill({
        name: "Orig",
        description: "d",
        body: "b",
      });
      id = created.id;
    });

    const holder: {
      value: { id: string; name: string; description: string } | null;
    } = { value: null };
    act(() => {
      holder.value = result.current.updateSkill(id, {
        name: "Renamed",
        description: "New desc",
      });
    });
    expect(holder.value?.id).toBe(id);
    expect(holder.value?.name).toBe("Renamed");
    expect(holder.value?.description).toBe("New desc");
    expect(result.current.skills[0]?.name).toBe("Renamed");
    expect(result.current.skills[0]?.description).toBe("New desc");
  });

  it("updateSkill returns null for an unknown id and leaves the snapshot untouched", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useSkills());

    act(() => {
      result.current.createSkill({ name: "Real", description: "d", body: "b" });
    });
    const before = result.current.skills;

    let updated: unknown = "untouched";
    act(() => {
      updated = result.current.updateSkill("does-not-exist", { name: "Ignored" });
    });
    expect(updated).toBeNull();
    expect(result.current.skills).toBe(before);
    expect(result.current.skills[0]?.name).toBe("Real");
  });

  it("removeSkill drops the row from the snapshot", async () => {
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useSkills());

    let id = "";
    act(() => {
      id = result.current.createSkill({ name: "Doomed", description: "d", body: "b" }).id;
    });
    expect(result.current.skills).toHaveLength(1);

    act(() => {
      result.current.removeSkill(id);
    });
    expect(result.current.skills).toEqual([]);
  });

  it("removeSkill leaves the snapshot content unchanged for an unknown id", async () => {
    // Note: skills-store.deleteSkill has NO unknown-id guard — it calls
    // flush(getSkillsSnapshot().filter(...)) unconditionally, which
    // invalidates the cache and notifies subscribers even when no row matched.
    // The snapshot CONTENT is preserved (no row is added or removed), but the
    // array REFERENCE is not. This test pins the content-preservation
    // contract; the unconditional-cache-invalidate is a documented minor
    // inefficiency, not a bug.
    const { hook } = await importFresh();
    const { result } = renderHook(() => hook.useSkills());

    act(() => {
      result.current.createSkill({ name: "Real", description: "d", body: "b" });
    });

    act(() => {
      result.current.removeSkill("does-not-exist");
    });
    expect(result.current.skills).toHaveLength(1);
    expect(result.current.skills[0]?.name).toBe("Real");
  });
});
