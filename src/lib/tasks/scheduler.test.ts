import { describe, expect, it } from "vitest";

import { canFire, projectNextFire } from "~/lib/tasks/scheduler";
import type { ScheduledTask } from "~/lib/tasks/types";

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
