import { describe, expect, it } from "vitest";

import { buildOverview, canFire, projectNextFire } from "~/lib/tasks/scheduler";
import type { ScheduledTask, ScheduledTaskRun } from "~/lib/tasks/types";

const BASE = {
  id: "t1",
  title: "T",
  payload: { kind: "instruction" as const, instruction: "do thing" },
  timezone: "UTC",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  lastFiredAt: null,
  homeSessionId: null,
};

function onceTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    ...BASE,
    scheduleType: "once",
    cron: null,
    runAt: "2026-06-18T12:00:00.000Z",
    isEnabled: true,
    ...overrides,
  };
}

function cronTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    ...BASE,
    scheduleType: "cron",
    cron: "0 9 * * *", // 09:00 UTC daily
    runAt: null,
    isEnabled: true,
    ...overrides,
  };
}

describe("canFire", () => {
  it("a one-off with a runAt and no fire yet can fire", () => {
    expect(canFire(onceTask())).toBe(true);
  });

  it("a fired one-off can no longer fire", () => {
    expect(canFire(onceTask({ lastFiredAt: "2026-06-18T12:00:00.000Z" }))).toBe(false);
  });

  it("a one-off without a runAt cannot fire", () => {
    expect(canFire(onceTask({ runAt: null }))).toBe(false);
  });

  it("canFire ignores the isEnabled gate (the whole point of the helper)", () => {
    expect(canFire(onceTask({ isEnabled: false }))).toBe(true);
    expect(canFire(cronTask({ isEnabled: false }))).toBe(true);
  });

  it("a recurring task with a cron expression can fire", () => {
    expect(canFire(cronTask())).toBe(true);
  });

  it("a recurring task without a cron expression cannot fire", () => {
    expect(canFire(cronTask({ cron: null }))).toBe(false);
  });

  it("a recurring task still can fire after it has fired (cron keeps projecting)", () => {
    expect(canFire(cronTask({ lastFiredAt: "2026-06-18T09:00:00.000Z" }))).toBe(true);
  });
});

describe("projectNextFire", () => {
  it("respects the isEnabled gate: disabled tasks project null", () => {
    expect(projectNextFire(onceTask({ isEnabled: false }))).toBeNull();
    expect(projectNextFire(cronTask({ isEnabled: false }))).toBeNull();
  });

  it("projects a one-off's runAt when unfired", () => {
    expect(projectNextFire(onceTask())).toEqual(new Date("2026-06-18T12:00:00.000Z"));
  });

  it("projects null for a one-off that already fired", () => {
    expect(projectNextFire(onceTask({ lastFiredAt: "2026-06-18T12:00:00.000Z" }))).toBeNull();
  });

  it("projects null for a one-off with no runAt", () => {
    expect(projectNextFire(onceTask({ runAt: null }))).toBeNull();
  });

  it("projects the next cron fire after the createdAt anchor", () => {
    // cron "0 9 * * *" anchored at 2026-06-01T00:00:00Z → next is 2026-06-01T09:00:00Z.
    expect(projectNextFire(cronTask({ createdAt: "2026-06-01T00:00:00.000Z" }))).toEqual(
      new Date("2026-06-01T09:00:00.000Z"),
    );
  });

  it("anchors cron catch-up at the last fire, not createdAt", () => {
    const task = cronTask({
      createdAt: "2026-06-01T00:00:00.000Z",
      lastFiredAt: "2026-06-05T09:00:00.000Z",
    });
    expect(projectNextFire(task)).toEqual(new Date("2026-06-06T09:00:00.000Z"));
  });

  it("projects null for an invalid cron expression", () => {
    expect(projectNextFire(cronTask({ cron: "not a cron" }))).toBeNull();
  });

  it("projects null for a cron task with no cron expression", () => {
    expect(projectNextFire(cronTask({ cron: null }))).toBeNull();
  });
});

// --- buildOverview fixtures ----------------------------------------------
// `now` is fixed at 2026-06-18T12:00:00Z so the once-task's 12:00 runAt is
// exactly due (== nowMs) — the boundary case buildOverview must exclude from
// upcoming ("about to become a run").
const NOW = new Date("2026-06-18T12:00:00.000Z");
const NOW_MS = NOW.getTime();

const RUN_BASE = {
  taskId: "t1",
  taskTitle: "T",
  scheduleType: "once" as const,
  payloadKind: "instruction" as const,
  homeSessionId: null,
};

function run(overrides: Partial<ScheduledTaskRun>): ScheduledTaskRun {
  return {
    id: "r1",
    status: "completed",
    output: null,
    error: null,
    startedAt: "2026-06-18T11:00:00.000Z",
    completedAt: "2026-06-18T11:00:30.000Z",
    ...RUN_BASE,
    ...overrides,
  };
}

describe("buildOverview", () => {
  it("returns empty sections for empty inputs", () => {
    expect(buildOverview([], [], NOW)).toEqual({
      running: [],
      upcoming: [],
      past: [],
    });
  });

  it("partitions runs: status 'running' → running, all others → past", () => {
    const runs = [
      run({ id: "r1", status: "running" }),
      run({ id: "r2", status: "completed" }),
      run({ id: "r3", status: "failed" }),
      run({ id: "r4", status: "skipped" }),
    ];
    const overview = buildOverview([], runs, NOW);
    expect(overview.running.map((r) => r.id)).toEqual(["r1"]);
    expect(overview.past.map((r) => r.id)).toEqual(["r2", "r3", "r4"]);
  });

  it("caps the running section at 50 runs", () => {
    const runs = Array.from({ length: 60 }, (_, i) => run({ id: `r${i}`, status: "running" }));
    expect(buildOverview([], runs, NOW).running).toHaveLength(50);
  });

  it("caps the past section at 100 runs", () => {
    const runs = Array.from({ length: 150 }, (_, i) => run({ id: `r${i}`, status: "completed" }));
    expect(buildOverview([], runs, NOW).past).toHaveLength(100);
  });

  it("excludes disabled tasks from upcoming (the isEnabled gate)", () => {
    const tasks = [
      cronTask({
        id: "t-enabled",
        // next fire is tomorrow 09:00 (clearly in the future)
        createdAt: "2026-06-18T10:00:00.000Z",
        lastFiredAt: "2026-06-18T09:00:00.000Z",
      }),
      cronTask({
        id: "t-disabled",
        isEnabled: false,
        createdAt: "2026-06-18T10:00:00.000Z",
        lastFiredAt: "2026-06-18T09:00:00.000Z",
      }),
    ];
    const overview = buildOverview(tasks, [], NOW);
    expect(overview.upcoming.map((job) => job.taskId)).toEqual(["t-enabled"]);
  });

  it("excludes a task whose projected fire is null (consumed one-off / no cron)", () => {
    const tasks = [
      // one-off that already fired → projectNextFire is null
      onceTask({ id: "consumed", lastFiredAt: "2026-06-18T11:00:00.000Z" }),
      // cron task with no cron → projectNextFire is null
      cronTask({ id: "no-cron", cron: null }),
    ];
    expect(buildOverview(tasks, [], NOW).upcoming).toEqual([]);
  });

  it("excludes a task whose fire is already due (fire time <= now)", () => {
    // The default once-task runAt (12:00) is exactly == NOW_MS, so it must be
    // excluded — it is about to be promoted to a run by tickTasks.
    const tasks = [
      onceTask({ id: "due-now", runAt: new Date(NOW_MS).toISOString() }),
      // A future-dated cron task is still listed for contrast.
      cronTask({
        id: "future",
        createdAt: "2026-06-18T10:00:00.000Z",
        lastFiredAt: "2026-06-18T09:00:00.000Z",
      }),
    ];
    const overview = buildOverview(tasks, [], NOW);
    expect(overview.upcoming.map((job) => job.taskId)).toEqual(["future"]);
  });

  it("sorts upcoming by nextRunAt ascending (ISO string localeCompare)", () => {
    const tasks = [
      // fires at 09:00 tomorrow
      cronTask({
        id: "later",
        createdAt: "2026-06-18T10:00:00.000Z",
        lastFiredAt: "2026-06-18T09:00:00.000Z",
      }),
      // one-off 1 minute from now (earlier)
      onceTask({ id: "sooner", runAt: new Date(NOW_MS + 60_000).toISOString() }),
    ];
    const overview = buildOverview(tasks, [], NOW);
    expect(overview.upcoming.map((job) => job.taskId)).toEqual(["sooner", "later"]);
  });

  it("carries the task's payload/cron/timezone/homeSessionId onto the upcoming job", () => {
    // Use UTC timezone so the projected next fire is a stable, predictable
    // value (09:00 UTC tomorrow) rather than a tz-shifted one — the assertion
    // here is about the carried fields, not cron timezone math.
    const task = cronTask({
      id: "t-rich",
      payload: { kind: "instruction", instruction: "do the thing" },
      timezone: "UTC",
      homeSessionId: "session-42",
      createdAt: "2026-06-18T10:00:00.000Z",
      lastFiredAt: "2026-06-18T09:00:00.000Z",
    });
    const [job] = buildOverview([task], [], NOW).upcoming;
    expect(job).toMatchObject({
      taskId: "t-rich",
      taskTitle: task.title,
      scheduleType: "cron",
      payload: { kind: "instruction", instruction: "do the thing" },
      cron: task.cron,
      timezone: "UTC",
      homeSessionId: "session-42",
    });
    expect(job.nextRunAt).toBe("2026-06-19T09:00:00.000Z");
  });
});
