// @vitest-environment jsdom
//
// DOM-environment tests for the localStorage-backed scheduled-task store.
// Same jsdom + vi.resetModules() + localStorage.clear() + deterministic-clock
// harness as the sessions/skills store tests. The tasks store additionally
// cascades into the sessions store (createTask mints a home chat session;
// deleteTask drops it + its transcript), so the cross-store coupling is part
// of the contract under test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const importStore = async () => import("~/lib/tasks/tasks-store");
const importSessions = async () => import("~/lib/chat/sessions-store");

describe("tasks-store (DOM)", () => {
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

  it("returns empty task + run snapshots when nothing is persisted", async () => {
    const { getTasksSnapshot, getRunsSnapshot } = await importStore();
    expect(getTasksSnapshot()).toEqual([]);
    expect(getRunsSnapshot()).toEqual([]);
  });

  it("caches the task snapshot with a referentially-stable reference", async () => {
    const { createTask, getTasksSnapshot } = await importStore();
    createTask({
      title: "t",
      scheduleType: "once",
      instruction: "do thing",
      runAt: "2024-06-01T00:01:00.000Z",
    });
    const a = getTasksSnapshot();
    const b = getTasksSnapshot();
    expect(b).toBe(a);
  });

  // --- create --------------------------------------------------------------

  it("createTask persists a one-off task with the right shape and a home session", async () => {
    const { createTask, getTasksSnapshot } = await importStore();
    const task = createTask({
      title: "Daily standup",
      scheduleType: "once",
      instruction: "Summarize yesterday",
      runAt: "2024-06-01T00:05:00.000Z",
    });
    expect(task.scheduleType).toBe("once");
    expect(task.cron).toBeNull();
    expect(task.runAt).toBe("2024-06-01T00:05:00.000Z");
    expect(task.isEnabled).toBe(true);
    expect(task.lastFiredAt).toBeNull();
    expect(task.homeSessionId).not.toBeNull();
    expect(task.payload).toEqual({ kind: "instruction", instruction: "Summarize yesterday" });
    expect(getTasksSnapshot()).toHaveLength(1);
    expect(getTasksSnapshot()[0].id).toBe(task.id);
  });

  it("createTask for a cron task stores the cron expression and null runAt", async () => {
    const { createTask, getTask } = await importStore();
    const task = createTask({
      title: "Hourly",
      scheduleType: "cron",
      instruction: "ping",
      cron: "0 * * * *",
    });
    expect(task.cron).toBe("0 * * * *");
    expect(task.runAt).toBeNull();
    expect(getTask(task.id)?.cron).toBe("0 * * * *");
  });

  it("createTask mints + names a home chat session tied to the task", async () => {
    const { createTask } = await importStore();
    const { getSession } = await importSessions();
    const task = createTask({
      title: "My task",
      scheduleType: "once",
      instruction: "x",
      runAt: "2024-06-01T00:05:00.000Z",
    });
    const home = getSession(task.homeSessionId ?? "");
    expect(home).not.toBeNull();
    expect(home?.title).toBe("My task");
    // The home session is pinned so the AI titler can't clobber it.
    expect(home?.titleSource).toBe("manual");
  });

  it("createTask honors an explicit homeSessionId instead of minting one", async () => {
    const { createSession } = await importSessions();
    const existing = createSession("Pre-existing");
    const { createTask, getTask } = await importStore();
    const task = createTask({
      title: "Reuses session",
      scheduleType: "once",
      instruction: "x",
      runAt: "2024-06-01T00:05:00.000Z",
      homeSessionId: existing.id,
    });
    expect(task.homeSessionId).toBe(existing.id);
    expect(getTask(task.id)?.homeSessionId).toBe(existing.id);
  });

  // --- update --------------------------------------------------------------

  it("updateTask applies partial updates and bumps updatedAt", async () => {
    const { createTask, updateTask, getTask } = await importStore();
    const task = createTask({
      title: "t",
      scheduleType: "once",
      instruction: "x",
      runAt: "2024-06-01T00:05:00.000Z",
    });
    tick(2000);
    const updated = updateTask(task.id, { title: "renamed", isEnabled: false, instruction: "y" });
    expect(updated?.title).toBe("renamed");
    expect(updated?.isEnabled).toBe(false);
    expect(updated?.payload.instruction).toBe("y");
    expect(updated?.updatedAt).not.toBe(task.updatedAt);
    expect(getTask(task.id)?.isEnabled).toBe(false);
  });

  it("updateTask returns null for an unknown id", async () => {
    const { updateTask } = await importStore();
    expect(updateTask("nope", { title: "x" })).toBeNull();
  });

  // --- delete + cascade ----------------------------------------------------

  it("deleteTask removes the task", async () => {
    const { createTask, deleteTask, getTasksSnapshot } = await importStore();
    const task = createTask({
      title: "t",
      scheduleType: "once",
      instruction: "x",
      runAt: "2024-06-01T00:05:00.000Z",
    });
    deleteTask(task.id);
    expect(getTasksSnapshot()).toEqual([]);
  });

  it("deleteTask cascades: drops the task's runs AND its home chat session", async () => {
    const { createTask, deleteTask, ensureRun, getRunsSnapshot } = await importStore();
    const { getSession, getSessionsSnapshot } = await importSessions();
    const task = createTask({
      title: "t",
      scheduleType: "cron",
      instruction: "x",
      cron: "0 * * * *",
    });
    ensureRun(task, "2024-06-01T01:00:00.000Z");
    ensureRun(task, "2024-06-01T02:00:00.000Z");
    expect(getRunsSnapshot()).toHaveLength(2);
    const homeId = task.homeSessionId ?? "";
    expect(getSession(homeId)).not.toBeNull();

    deleteTask(task.id);
    // Runs gone.
    expect(getRunsSnapshot()).toEqual([]);
    // Home session gone (and its transcript key removed).
    expect(getSession(homeId)).toBeNull();
    expect(getSessionsSnapshot()).toEqual([]);
    expect(localStorage.getItem(`tanstack-ai-app:messages:${homeId}`)).toBeNull();
  });

  // --- run log -------------------------------------------------------------

  it("ensureRun is idempotent for (taskId, firedAt): returns the existing run", async () => {
    const { createTask, ensureRun, getRunsSnapshot } = await importStore();
    const task = createTask({
      title: "t",
      scheduleType: "cron",
      instruction: "x",
      cron: "0 * * * *",
    });
    const first = ensureRun(task, "2024-06-01T01:00:00.000Z");
    const second = ensureRun(task, "2024-06-01T01:00:00.000Z");
    expect(second.id).toBe(first.id);
    expect(getRunsSnapshot()).toHaveLength(1);
  });

  it("ensureRun inserts distinct runs for distinct fire times in newest-first order", async () => {
    const { createTask, ensureRun, getRunsSnapshot } = await importStore();
    const task = createTask({
      title: "t",
      scheduleType: "cron",
      instruction: "x",
      cron: "0 * * * *",
    });
    ensureRun(task, "2024-06-01T01:00:00.000Z");
    ensureRun(task, "2024-06-01T02:00:00.000Z");
    const runs = getRunsSnapshot();
    expect(runs).toHaveLength(2);
    expect(runs[0].startedAt).toBe("2024-06-01T02:00:00.000Z"); // newest first
    expect(runs.every((r) => r.status === "running")).toBe(true);
    expect(runs.every((r) => r.homeSessionId === task.homeSessionId)).toBe(true);
  });

  it("completeRun flips a run to a terminal status with output + completedAt", async () => {
    const { createTask, ensureRun, completeRun, getRunsSnapshot } = await importStore();
    const task = createTask({
      title: "t",
      scheduleType: "cron",
      instruction: "x",
      cron: "0 * * * *",
    });
    const run = ensureRun(task, "2024-06-01T01:00:00.000Z");
    tick(5000);
    completeRun(run.id, "completed", { verdict: "ok" }, null);
    const stored = getRunsSnapshot().find((r) => r.id === run.id);
    expect(stored?.status).toBe("completed");
    expect(stored?.output).toEqual({ verdict: "ok" });
    expect(stored?.error).toBeNull();
    expect(stored?.completedAt).not.toBeNull();
  });

  it("completeRun is a no-op for an unknown run id", async () => {
    const { createTask, ensureRun, completeRun, getRunsSnapshot } = await importStore();
    const task = createTask({
      title: "t",
      scheduleType: "cron",
      instruction: "x",
      cron: "0 * * * *",
    });
    ensureRun(task, "2024-06-01T01:00:00.000Z");
    completeRun("does-not-exist", "failed", null, "boom");
    expect(getRunsSnapshot()).toHaveLength(1);
    expect(getRunsSnapshot()[0].status).toBe("running");
  });

  it("markTaskFired records the last fire time (advancing cron catch-up)", async () => {
    const { createTask, markTaskFired, getTask } = await importStore();
    const task = createTask({
      title: "t",
      scheduleType: "cron",
      instruction: "x",
      cron: "0 * * * *",
    });
    markTaskFired(task.id, "2024-06-01T03:00:00.000Z");
    expect(getTask(task.id)?.lastFiredAt).toBe("2024-06-01T03:00:00.000Z");
  });

  // --- MAX_RUNS trimming ---------------------------------------------------

  it("flushRuns trims the persisted run log to the most recent MAX_RUNS", async () => {
    const { createTask, ensureRun, completeRun, getRunsSnapshot } = await importStore();
    const task = createTask({
      title: "t",
      scheduleType: "cron",
      instruction: "x",
      cron: "0 * * * *",
    });
    const MAX_RUNS = 200;
    for (let i = 0; i < MAX_RUNS + 5; i += 1) {
      // Distinct firedAt per run + tick so startedAt strictly increases,
      // guaranteeing deterministic newest-first ordering.
      const firedAt = new Date(Date.now() + i * 1000).toISOString();
      const run = ensureRun(task, firedAt);
      completeRun(run.id, "completed", null, null);
      tick(1000);
    }
    const runs = getRunsSnapshot();
    expect(runs).toHaveLength(MAX_RUNS);
    const raw = JSON.parse(localStorage.getItem("tanstack-ai-app:scheduled-task-runs") ?? "[]");
    expect(raw).toHaveLength(MAX_RUNS);
  });

  // --- validation ----------------------------------------------------------

  it("filters out malformed tasks and runs on cold re-read", async () => {
    localStorage.setItem(
      "tanstack-ai-app:scheduled-tasks",
      JSON.stringify([
        {
          id: "ok",
          title: "ok",
          scheduleType: "once",
          payload: { kind: "instruction", instruction: "x" },
          cron: null,
          timezone: "UTC",
          runAt: null,
          isEnabled: true,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
          lastFiredAt: null,
          homeSessionId: null,
        },
        { nope: true },
        {
          id: "bad-schedule",
          title: "x",
          scheduleType: "weird",
          payload: { kind: "instruction", instruction: "x" },
          cron: null,
          timezone: "UTC",
          runAt: null,
          isEnabled: true,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
          lastFiredAt: null,
          homeSessionId: null,
        },
      ]),
    );
    localStorage.setItem(
      "tanstack-ai-app:scheduled-task-runs",
      JSON.stringify([
        {
          id: "rok",
          taskId: "t",
          taskTitle: "t",
          scheduleType: "once",
          payloadKind: "instruction",
          status: "completed",
          output: null,
          error: null,
          startedAt: "2024-01-01T00:00:00.000Z",
          completedAt: "2024-01-01T00:00:01.000Z",
          homeSessionId: null,
        },
        { garbage: true },
      ]),
    );
    const { getTasksSnapshot, getRunsSnapshot } = await importStore();
    expect(getTasksSnapshot()).toHaveLength(1);
    expect(getTasksSnapshot()[0].id).toBe("ok");
    expect(getRunsSnapshot()).toHaveLength(1);
    expect(getRunsSnapshot()[0].id).toBe("rok");
  });

  // --- pub/sub -------------------------------------------------------------

  it("subscribeTasks fires for task and run mutations", async () => {
    const { createTask, updateTask, ensureRun, completeRun, deleteTask, subscribeTasks } =
      await importStore();
    let calls = 0;
    const unsubscribe = subscribeTasks(() => {
      calls += 1;
    });
    const task = createTask({
      title: "t",
      scheduleType: "cron",
      instruction: "x",
      cron: "0 * * * *",
    });
    updateTask(task.id, { isEnabled: false });
    const run = ensureRun(task, "2024-06-01T01:00:00.000Z");
    completeRun(run.id, "completed", null, null);
    deleteTask(task.id);
    unsubscribe();
    // deleteTask notifies tasks-store subscribers TWICE: once for flushTasks
    // (the task itself) and once for flushRuns (the cascaded run history) —
    // so the count is create(1) + update(2) + ensureRun(3) + completeRun(4)
    // + delete-tasks(5) + delete-runs(6) = 6, not 5.
    expect(calls).toBe(6);
  });

  // --- cross-tab -----------------------------------------------------------

  it("invalidates both caches on a cross-tab storage event for either key", async () => {
    const { getTasksSnapshot, getRunsSnapshot } = await importStore();
    expect(getTasksSnapshot()).toEqual([]); // prime task cache
    expect(getRunsSnapshot()).toEqual([]); // prime run cache

    localStorage.setItem(
      "tanstack-ai-app:scheduled-tasks",
      JSON.stringify([
        {
          id: "ext",
          title: "ext",
          scheduleType: "once",
          payload: { kind: "instruction", instruction: "x" },
          cron: null,
          timezone: "UTC",
          runAt: null,
          isEnabled: true,
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
          lastFiredAt: null,
          homeSessionId: null,
        },
      ]),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: "tanstack-ai-app:scheduled-tasks", newValue: null }),
    );
    expect(getTasksSnapshot()).toHaveLength(1);

    localStorage.setItem(
      "tanstack-ai-app:scheduled-task-runs",
      JSON.stringify([
        {
          id: "r-ext",
          taskId: "ext",
          taskTitle: "ext",
          scheduleType: "once",
          payloadKind: "instruction",
          status: "completed",
          output: null,
          error: null,
          startedAt: "2024-01-01T00:00:00.000Z",
          completedAt: null,
          homeSessionId: null,
        },
      ]),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: "tanstack-ai-app:scheduled-task-runs", newValue: null }),
    );
    expect(getRunsSnapshot()).toHaveLength(1);
  });
});
