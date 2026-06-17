// @vitest-environment jsdom
//
// DOM-environment tests for the localStorage-backed skills store. Same
// jsdom + vi.resetModules() + localStorage.clear() harness as the sessions
// store (see sessions-store.dom.test.ts): the store no-ops without a `window`,
// and its module-level caches/listeners make it stateful across tests, so each
// test re-imports a fresh module. The deterministic clock (toFake: ["Date"])
// pins createdAt ordering so the newest-created-first sort is testable without
// sub-millisecond timing assumptions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const importStore = async () => import("~/lib/skills/skills-store");

describe("skills-store (DOM)", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-06-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const tick = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

  // --- snapshot basics -----------------------------------------------------

  it("returns an empty list when nothing is persisted", async () => {
    const { getSkillsSnapshot } = await importStore();
    expect(getSkillsSnapshot()).toEqual([]);
  });

  it("caches the snapshot and returns a referentially-stable reference", async () => {
    const { createSkill, getSkillsSnapshot } = await importStore();
    createSkill({ name: "A", description: "d", body: "b" });
    const a = getSkillsSnapshot();
    const b = getSkillsSnapshot();
    expect(b).toBe(a);
  });

  // --- create --------------------------------------------------------------

  it("createSkill persists and appears in the snapshot, enabled by default", async () => {
    const { createSkill, getSkillsSnapshot } = await importStore();
    const skill = createSkill({ name: "Pig latin", description: "d", body: "b" });
    expect(skill.isEnabled).toBe(true);
    expect(skill.references).toEqual([]);
    expect(getSkillsSnapshot()).toHaveLength(1);
    expect(getSkillsSnapshot()[0]).toMatchObject({ id: skill.id, name: "Pig latin" });

    const raw = localStorage.getItem("tanstack-ai-app:skills");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "[]")).toHaveLength(1);
  });

  it("createSkill mints ids + timestamps for nested references", async () => {
    const { createSkill, getSkill } = await importStore();
    const skill = createSkill({
      name: "With refs",
      description: "d",
      body: "b",
      references: [
        { name: "ref-a", description: "rd", body: "rb" },
        { name: "ref-b", description: "rd2", body: "rb2" },
      ],
    });
    const stored = getSkill(skill.id);
    expect(stored?.references).toHaveLength(2);
    expect(stored?.references.every((r) => typeof r.id === "string" && r.id.length > 0)).toBe(true);
    expect(stored?.references.map((r) => r.name)).toEqual(["ref-a", "ref-b"]);
  });

  // --- validation ----------------------------------------------------------

  it("readSkillsRaw filters out malformed entries on cold re-read", async () => {
    // Inject a mix of valid + malformed skills directly into localStorage.
    localStorage.setItem(
      "tanstack-ai-app:skills",
      JSON.stringify([
        {
          id: "ok",
          name: "ok",
          description: "d",
          body: "b",
          isEnabled: true,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
          references: [],
        },
        { nope: true }, // not an object shape
        {
          id: "bad-ref",
          name: "x",
          description: "d",
          body: "b",
          isEnabled: true,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
          references: [{ id: "r", name: "r" }],
        }, // malformed reference invalidates whole skill
        {
          id: "bad-enabled",
          name: "x",
          description: "d",
          body: "b",
          isEnabled: "true",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
          references: [],
        }, // non-boolean isEnabled
      ]),
    );
    const { getSkillsSnapshot } = await importStore();
    expect(getSkillsSnapshot()).toHaveLength(1);
    expect(getSkillsSnapshot()[0].id).toBe("ok");
  });

  // --- update --------------------------------------------------------------

  it("updateSkill applies partial field updates and bumps updatedAt", async () => {
    const { createSkill, updateSkill, getSkill } = await importStore();
    const skill = createSkill({ name: "n", description: "d", body: "b" });
    tick(2000);
    const updated = updateSkill(skill.id, { body: "new body", isEnabled: false });
    expect(updated?.body).toBe("new body");
    expect(updated?.isEnabled).toBe(false);
    expect(updated?.name).toBe("n"); // untouched
    expect(updated?.updatedAt).not.toBe(skill.updatedAt);
    expect(getSkill(skill.id)?.isEnabled).toBe(false);
  });

  it("updateSkill returns null for an unknown id", async () => {
    const { updateSkill } = await importStore();
    expect(updateSkill("nope", { name: "x" })).toBeNull();
  });

  it("updateSkill references use replace-set semantics (keep-by-id, create-new, drop-missing)", async () => {
    const { createSkill, updateSkill, getSkill } = await importStore();
    const skill = createSkill({
      name: "s",
      description: "d",
      body: "b",
      references: [
        { name: "keep", description: "kd", body: "kb" },
        { name: "drop", description: "dd", body: "db" },
      ],
    });
    const keepId = skill.references[0].id;
    const dropId = skill.references[1].id;
    expect(dropId).toBeDefined();

    const updated = updateSkill(skill.id, {
      references: [
        { id: keepId, name: "keep-renamed", description: "kd2", body: "kb2" }, // kept by id
        { name: "fresh", description: "fd", body: "fb" }, // no id → created
        // `drop` omitted → dropped
      ],
    });
    const refs = updated?.references ?? [];
    expect(refs.map((r) => r.name)).toEqual(["keep-renamed", "fresh"]);
    expect(refs[0].id).toBe(keepId); // same id preserved
    const stored = getSkill(skill.id)?.references ?? [];
    expect(stored.find((r) => r.id === dropId)).toBeUndefined();
    expect(stored.find((r) => r.id === keepId)?.name).toBe("keep-renamed");
  });

  it("updateSkill without a references field leaves references untouched", async () => {
    const { createSkill, updateSkill, getSkill } = await importStore();
    const skill = createSkill({
      name: "s",
      description: "d",
      body: "b",
      references: [{ name: "r", description: "rd", body: "rb" }],
    });
    updateSkill(skill.id, { body: "changed" });
    expect(getSkill(skill.id)?.references).toHaveLength(1);
    expect(getSkill(skill.id)?.references[0].name).toBe("r");
  });

  // --- delete --------------------------------------------------------------

  it("deleteSkill removes the skill from the snapshot", async () => {
    const { createSkill, deleteSkill, getSkillsSnapshot, getSkill } = await importStore();
    const a = createSkill({ name: "a", description: "d", body: "b" });
    tick(1000);
    createSkill({ name: "b", description: "d", body: "b" });
    deleteSkill(a.id);
    expect(getSkillsSnapshot()).toHaveLength(1);
    expect(getSkill(a.id)).toBeNull();
  });

  // --- ordering ------------------------------------------------------------

  it("sorts the snapshot newest-created-first (stable across updatedAt bumps)", async () => {
    const { createSkill, getSkillsSnapshot, updateSkill } = await importStore();
    const first = createSkill({ name: "first", description: "d", body: "b" });
    tick(1000);
    const second = createSkill({ name: "second", description: "d", body: "b" });
    expect(getSkillsSnapshot().map((s) => s.id)).toEqual([second.id, first.id]);

    // Bumping the older skill's updatedAt must NOT reorder (sort is on createdAt).
    tick(1000);
    updateSkill(first.id, { body: "changed" });
    expect(getSkillsSnapshot().map((s) => s.id)).toEqual([second.id, first.id]);
  });

  // --- pub/sub -------------------------------------------------------------

  it("subscribeSkills fires on create/update/delete", async () => {
    const { createSkill, updateSkill, deleteSkill, subscribeSkills } = await importStore();
    let calls = 0;
    const unsubscribe = subscribeSkills(() => {
      calls += 1;
    });
    const skill = createSkill({ name: "s", description: "d", body: "b" });
    updateSkill(skill.id, { isEnabled: false });
    deleteSkill(skill.id);
    unsubscribe();
    expect(calls).toBe(3);
  });

  it("unsubscribe stops further notifications", async () => {
    const { createSkill, subscribeSkills } = await importStore();
    let calls = 0;
    const unsubscribe = subscribeSkills(() => {
      calls += 1;
    });
    createSkill({ name: "a", description: "d", body: "b" });
    unsubscribe();
    createSkill({ name: "b", description: "d", body: "b" });
    expect(calls).toBe(1);
  });

  // --- cross-tab -----------------------------------------------------------

  it("invalidates the cache on a cross-tab storage event for the skills key", async () => {
    const { getSkillsSnapshot } = await importStore();
    expect(getSkillsSnapshot()).toEqual([]); // primes the cache
    const external = [
      {
        id: "ext",
        name: "ext",
        description: "d",
        body: "b",
        isEnabled: true,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
        references: [],
      },
    ];
    localStorage.setItem("tanstack-ai-app:skills", JSON.stringify(external));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "tanstack-ai-app:skills",
        newValue: JSON.stringify(external),
      }),
    );
    expect(getSkillsSnapshot()).toHaveLength(1);
    expect(getSkillsSnapshot()[0].id).toBe("ext");
  });

  it("ignores cross-tab storage events for unrelated keys", async () => {
    const { createSkill, getSkillsSnapshot } = await importStore();
    createSkill({ name: "s", description: "d", body: "b" });
    const before = getSkillsSnapshot();
    window.dispatchEvent(
      new StorageEvent("storage", { key: "tanstack-ai-app:sessions", newValue: "[]" }),
    );
    expect(getSkillsSnapshot()).toBe(before); // cache untouched
  });
});
