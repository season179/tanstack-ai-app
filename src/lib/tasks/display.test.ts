import { describe, expect, it } from "vitest";

import {
  extractStatusUpdate,
  formatDuration,
  getRunResult,
  payloadKindLabel,
  runStatusClasses,
  scheduleLabel,
} from "~/lib/tasks/display";
import type { ScheduledTaskRun } from "~/lib/tasks/types";

const RUN_BASE = {
  id: "r1",
  taskId: "t1",
  taskTitle: "T",
  scheduleType: "once" as const,
  payloadKind: "instruction" as const,
  homeSessionId: null,
};

function run(overrides: Partial<ScheduledTaskRun> = {}): ScheduledTaskRun {
  return {
    ...RUN_BASE,
    status: "completed",
    output: null,
    error: null,
    startedAt: "2026-06-18T12:00:00.000Z",
    completedAt: "2026-06-18T12:00:05.000Z",
    ...overrides,
  };
}

describe("formatDuration", () => {
  it("returns '—' while a run is still in flight (no completedAt)", () => {
    expect(formatDuration("2026-06-18T12:00:00.000Z", null)).toBe("—");
  });

  it("returns '—' for a negative or non-finite span", () => {
    expect(formatDuration("2026-06-18T12:00:05.000Z", "2026-06-18T12:00:00.000Z")).toBe("—");
  });

  it("returns '<1s' for a sub-second span", () => {
    expect(formatDuration("2026-06-18T12:00:00.000Z", "2026-06-18T12:00:00.500Z")).toBe("<1s");
  });

  it("rounds sub-minute spans to whole seconds", () => {
    expect(formatDuration("2026-06-18T12:00:00.000Z", "2026-06-18T12:00:05.000Z")).toBe("5s");
  });

  it("formats minute+second spans", () => {
    expect(formatDuration("2026-06-18T12:00:00.000Z", "2026-06-18T12:02:30.000Z")).toBe("2m 30s");
  });

  it("formats hour+minute spans", () => {
    expect(formatDuration("2026-06-18T12:00:00.000Z", "2026-06-18T14:05:00.000Z")).toBe("2h 5m");
  });
});

describe("extractStatusUpdate", () => {
  it("returns the statusUpdate string from an instruction verdict object", () => {
    expect(extractStatusUpdate({ statusUpdate: "All good" })).toBe("All good");
  });

  it("trims and returns null for a blank statusUpdate", () => {
    expect(extractStatusUpdate({ statusUpdate: "   " })).toBeNull();
  });

  it("returns null when statusUpdate is not a string", () => {
    expect(extractStatusUpdate({ statusUpdate: 42 })).toBeNull();
  });

  it("returns null for null/undefined/primitive output", () => {
    expect(extractStatusUpdate(null)).toBeNull();
    expect(extractStatusUpdate(undefined)).toBeNull();
    expect(extractStatusUpdate("just a string")).toBeNull();
  });

  it("returns null for an object without statusUpdate", () => {
    expect(extractStatusUpdate({ other: "thing" })).toBeNull();
  });
});

describe("getRunResult", () => {
  it("surfaces the run error first (failed runs)", () => {
    expect(getRunResult(run({ status: "failed", error: "boom" }))).toBe("boom");
  });

  it("surfaces a statusUpdate verdict when there is no error", () => {
    expect(getRunResult(run({ output: { statusUpdate: "Ran ok" } }))).toBe("Ran ok");
  });

  it("returns null for a completed run with null/undefined output", () => {
    expect(getRunResult(run({ output: null }))).toBeNull();
    expect(getRunResult(run({ output: undefined }))).toBeNull();
  });

  it("JSON-stringifies any other output, truncating past 240 chars", () => {
    const long = "x".repeat(300);
    const out = getRunResult(run({ output: { detail: long } }));
    expect(out).not.toBeNull();
    expect(out?.endsWith("…")).toBe(true);
    expect(out?.length).toBeLessThan(JSON.stringify({ detail: long }).length);
  });

  it("does not truncate a short JSON output", () => {
    expect(getRunResult(run({ output: { count: 3 } }))).toBe('{"count":3}');
  });
});

describe("runStatusClasses", () => {
  it("maps each status to a non-empty tailwind class string", () => {
    expect(runStatusClasses("running")).toBe("bg-primary/10 text-primary");
    expect(runStatusClasses("completed")).toBe("bg-primary/10 text-primary");
    expect(runStatusClasses("failed")).toBe("bg-destructive/10 text-destructive");
    expect(runStatusClasses("skipped")).toBe("bg-muted text-muted-foreground");
  });
});

describe("payloadKindLabel", () => {
  it("labels an instruction payload as 'check-in'", () => {
    expect(payloadKindLabel("instruction")).toBe("check-in");
  });
});

describe("scheduleLabel", () => {
  it("returns 'One-off' for a once schedule with null cron", () => {
    expect(scheduleLabel({ scheduleType: "once", cron: null })).toBe("One-off");
  });

  it("returns 'Recurring · cron <expr>' for a cron schedule", () => {
    expect(scheduleLabel({ scheduleType: "cron", cron: "0 9 * * *" })).toBe(
      "Recurring · cron 0 9 * * *",
    );
  });

  it("preserves the cron expression verbatim (no normalization)", () => {
    expect(scheduleLabel({ scheduleType: "cron", cron: "*/15 * * * *" })).toBe(
      "Recurring · cron */15 * * * *",
    );
  });

  it("accepts a structurally-compatible ScheduledTask shape", () => {
    // Mirrors the board's PausedSection call site: scheduleLabel(task) where
    // task is a full ScheduledTask carrying the common {scheduleType, cron}.
    const task = {
      id: "t1",
      title: "Standup",
      scheduleType: "cron" as const,
      cron: "0 9 * * MON",
    };
    expect(scheduleLabel(task)).toBe("Recurring · cron 0 9 * * MON");
  });

  it("accepts a structurally-compatible UpcomingScheduledJob shape", () => {
    // Mirrors the board's UpcomingSection call site: scheduleLabel(job) where
    // job is a full UpcomingScheduledJob carrying the common {scheduleType, cron}.
    const job = {
      taskId: "t1",
      taskTitle: "Standup",
      scheduleType: "once" as const,
      cron: null,
      nextRunAt: "2026-06-18T12:00:00.000Z",
    };
    expect(scheduleLabel(job)).toBe("One-off");
  });

  it("renders the literal cron even when it is null under a cron schedule type", () => {
    // The data-model contract guarantees cron is non-null when scheduleType is
    // 'cron', but the function does not enforce it — a null cron renders as the
    // string 'null'. Pinned so a future tightening (null-guard or assertion) is
    // a deliberate behavior change, not a silent one.
    expect(scheduleLabel({ scheduleType: "cron", cron: null })).toBe("Recurring · cron null");
  });
});
