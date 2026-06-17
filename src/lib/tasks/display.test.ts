import { describe, expect, it } from "vitest";

import {
  extractStatusUpdate,
  formatDuration,
  getRunResult,
  payloadKindLabel,
  runStatusClasses,
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
