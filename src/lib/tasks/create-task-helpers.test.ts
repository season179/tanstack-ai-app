import { describe, expect, it } from "vitest";

import {
  type Draft,
  EMPTY_DRAFT,
  INSTRUCTION_MAX,
  localInputToIso,
  TITLE_MAX,
  toLocalInputValue,
  validate,
} from "./create-task-helpers";

// Use a fixed local-time `now` so the future-time branch of `validate` is
// deterministic (the production caller passes no argument and gets the real
// clock; tests inject an explicit Date to pin the boundary). Constructed via
// the local-time Date ctor so the comparison is timezone-independent.
const NOW = new Date(2026, 0, 15, 12, 0, 0); // 2026-01-15 12:00:00 local

function draft(overrides: Partial<Draft> = {}): Draft {
  return { ...EMPTY_DRAFT, ...overrides };
}

describe("create-task-helpers constants", () => {
  it("exposes the title and instruction length limits", () => {
    expect(TITLE_MAX).toBe(120);
    expect(INSTRUCTION_MAX).toBe(2000);
  });

  it("EMPTY_DRAFT defaults to a one-off with an empty title/instruction and a sane cron", () => {
    expect(EMPTY_DRAFT).toEqual({
      title: "",
      instruction: "",
      scheduleType: "once",
      runAtLocal: "",
      cron: "*/5 * * * *",
    });
  });
});

describe("toLocalInputValue", () => {
  it("formats a Date as a datetime-local value WITH seconds (the sub-minute-offset gotcha)", () => {
    // Local-time ctor keeps the assertion TZ-independent.
    const value = toLocalInputValue(new Date(2026, 0, 15, 12, 30, 45));
    expect(value).toBe("2026-01-15T12:30:45");
  });

  it("zero-pads each component (month/day/hour/minute/second)", () => {
    const value = toLocalInputValue(new Date(2026, 2, 7, 5, 9, 3));
    expect(value).toBe("2026-03-07T05:09:03");
  });

  it("round-trips a +10s quick offset so the sub-minute value is representable", () => {
    // The dialog's +10s quick offset adds 10s to now and formats the result;
    // the seconds component MUST survive or the datetime-local control (which
    // has minute granularity by default) rounds it into the past and
    // future-time validation rejects it (iteration-5 gotcha).
    const offset = new Date(NOW.getTime() + 10_000);
    const value = toLocalInputValue(offset);
    expect(value.endsWith(":10")).toBe(true);
  });
});

describe("localInputToIso", () => {
  it("parses a datetime-local value (with seconds) into an ISO string", () => {
    const iso = localInputToIso("2026-01-15T12:30:45");
    expect(iso).not.toBeNull();
    // Round-trips back to the same local instant.
    expect(toLocalInputValue(new Date(iso ?? 0))).toBe("2026-01-15T12:30:45");
  });

  it("parses a minute-granularity value (no seconds) too", () => {
    const iso = localInputToIso("2026-01-15T12:30");
    expect(iso).not.toBeNull();
    expect(new Date(iso ?? 0).getMinutes()).toBe(30);
  });

  it("returns null for an empty string", () => {
    expect(localInputToIso("")).toBeNull();
  });

  it("returns null for a malformed value", () => {
    expect(localInputToIso("not-a-date")).toBeNull();
  });

  it("returns null for a whitespace-only value", () => {
    expect(localInputToIso("   ")).toBeNull();
  });
});

describe("validate", () => {
  describe("title", () => {
    it("requires a non-empty title (whitespace-only is rejected)", () => {
      const errors = validate(draft({ title: "   ", instruction: "do it" }), NOW);
      expect(errors.title).toBe("Title is required.");
    });

    it("rejects a title over TITLE_MAX characters", () => {
      const errors = validate(
        draft({ title: "x".repeat(TITLE_MAX + 1), instruction: "do it" }),
        NOW,
      );
      expect(errors.title).toBe(`Keep it under ${TITLE_MAX} characters.`);
    });

    it("accepts a title exactly at TITLE_MAX characters", () => {
      const errors = validate(
        draft({
          title: "x".repeat(TITLE_MAX),
          instruction: "do it",
          runAtLocal: toLocalInputValue(new Date(NOW.getTime() + 60_000)),
        }),
        NOW,
      );
      expect(errors.title).toBeUndefined();
    });

    it("accepts a normal title", () => {
      const errors = validate(
        draft({
          title: "Daily standup",
          instruction: "do it",
          runAtLocal: toLocalInputValue(new Date(NOW.getTime() + 60_000)),
        }),
        NOW,
      );
      expect(errors.title).toBeUndefined();
    });
  });

  describe("instruction", () => {
    it("requires a non-empty instruction (whitespace-only is rejected)", () => {
      const errors = validate(draft({ title: "t", instruction: "   " }), NOW);
      expect(errors.instruction).toBe("An instruction is required.");
    });

    it("rejects an instruction over INSTRUCTION_MAX characters", () => {
      const errors = validate(
        draft({ title: "t", instruction: "x".repeat(INSTRUCTION_MAX + 1) }),
        NOW,
      );
      expect(errors.instruction).toBe(
        `Keep it under ${INSTRUCTION_MAX.toLocaleString()} characters.`,
      );
    });

    it("accepts an instruction exactly at INSTRUCTION_MAX characters", () => {
      const errors = validate(
        draft({
          title: "t",
          instruction: "x".repeat(INSTRUCTION_MAX),
          runAtLocal: toLocalInputValue(new Date(NOW.getTime() + 60_000)),
        }),
        NOW,
      );
      expect(errors.instruction).toBeUndefined();
    });
  });

  describe("one-off schedule (scheduleType: once)", () => {
    it("requires a runAt when empty", () => {
      const errors = validate(
        draft({ title: "t", instruction: "do it", scheduleType: "once", runAtLocal: "" }),
        NOW,
      );
      expect(errors.runAt).toBe("Pick a date and time.");
    });

    it("requires a runAt when malformed", () => {
      const errors = validate(
        draft({ title: "t", instruction: "do it", scheduleType: "once", runAtLocal: "garbage" }),
        NOW,
      );
      expect(errors.runAt).toBe("Pick a date and time.");
    });

    it("rejects a runAt in the past", () => {
      const errors = validate(
        draft({
          title: "t",
          instruction: "do it",
          scheduleType: "once",
          runAtLocal: toLocalInputValue(new Date(NOW.getTime() - 60_000)),
        }),
        NOW,
      );
      expect(errors.runAt).toBe("Choose a time in the future.");
    });

    it("rejects a runAt exactly at now (boundary: future must be strictly greater)", () => {
      const errors = validate(
        draft({
          title: "t",
          instruction: "do it",
          scheduleType: "once",
          runAtLocal: toLocalInputValue(NOW),
        }),
        NOW,
      );
      expect(errors.runAt).toBe("Choose a time in the future.");
    });

    it("accepts a runAt strictly in the future", () => {
      const errors = validate(
        draft({
          title: "t",
          instruction: "do it",
          scheduleType: "once",
          runAtLocal: toLocalInputValue(new Date(NOW.getTime() + 60_000)),
        }),
        NOW,
      );
      expect(errors.runAt).toBeUndefined();
    });

    it("does not validate cron when scheduleType is once", () => {
      const errors = validate(
        draft({
          title: "t",
          instruction: "do it",
          scheduleType: "once",
          runAtLocal: toLocalInputValue(new Date(NOW.getTime() + 60_000)),
          cron: "not even close to valid cron",
        }),
        NOW,
      );
      expect(errors.cron).toBeUndefined();
    });
  });

  describe("cron schedule (scheduleType: cron)", () => {
    it("requires a non-empty cron expression (whitespace-only is rejected)", () => {
      const errors = validate(
        draft({ title: "t", instruction: "do it", scheduleType: "cron", cron: "   " }),
        NOW,
      );
      expect(errors.cron).toBe("A cron expression is required.");
    });

    it("accepts a valid 5-field cron expression", () => {
      const errors = validate(
        draft({ title: "t", instruction: "do it", scheduleType: "cron", cron: "*/5 * * * *" }),
        NOW,
      );
      expect(errors.cron).toBeUndefined();
    });

    it("accepts and trims a valid cron expression with surrounding whitespace", () => {
      const errors = validate(
        draft({ title: "t", instruction: "do it", scheduleType: "cron", cron: "  0 9 * * *  " }),
        NOW,
      );
      expect(errors.cron).toBeUndefined();
    });

    it("rejects an invalid cron expression with the parser's error message", () => {
      const errors = validate(
        draft({ title: "t", instruction: "do it", scheduleType: "cron", cron: "not valid" }),
        NOW,
      );
      expect(typeof errors.cron).toBe("string");
      expect(errors.cron?.length).toBeGreaterThan(0);
      // The raw parser message bubbles up (not the generic fallback) for a
      // real Error instance.
      expect(errors.cron).not.toBe("Invalid cron expression.");
    });

    it("rejects a cron with an out-of-range field (constraint error)", () => {
      // 64 is outside the 0-59 minute range, so cron-parser throws a
      // constraint error (it is lenient about field COUNT — `* * *` is
      // accepted — but strict about per-field value ranges).
      const errors = validate(
        draft({ title: "t", instruction: "do it", scheduleType: "cron", cron: "64 9 * * *" }),
        NOW,
      );
      expect(errors.cron).toBeTruthy();
      expect(errors.cron).not.toBe("Invalid cron expression.");
    });

    it("does not validate runAt when scheduleType is cron", () => {
      const errors = validate(
        draft({
          title: "t",
          instruction: "do it",
          scheduleType: "cron",
          cron: "*/5 * * * *",
          runAtLocal: "",
        }),
        NOW,
      );
      expect(errors.runAt).toBeUndefined();
    });
  });

  describe("full-draft validity", () => {
    it("returns an empty Errors object for a fully-valid one-off draft", () => {
      const errors = validate(
        draft({
          title: "Standup",
          instruction: "Summarize yesterday.",
          scheduleType: "once",
          runAtLocal: toLocalInputValue(new Date(NOW.getTime() + 86_400_000)),
        }),
        NOW,
      );
      expect(errors).toEqual({});
      expect(Object.keys(errors)).toHaveLength(0);
    });

    it("returns an empty Errors object for a fully-valid cron draft", () => {
      const errors = validate(
        draft({
          title: "Standup",
          instruction: "Summarize yesterday.",
          scheduleType: "cron",
          cron: "0 9 * * *",
        }),
        NOW,
      );
      expect(errors).toEqual({});
      expect(Object.keys(errors)).toHaveLength(0);
    });

    it("accumulates errors across multiple fields", () => {
      const errors = validate(
        draft({
          title: "",
          instruction: "",
          scheduleType: "once",
          runAtLocal: "",
        }),
        NOW,
      );
      expect(errors.title).toBe("Title is required.");
      expect(errors.instruction).toBe("An instruction is required.");
      expect(errors.runAt).toBe("Pick a date and time.");
    });

    it("defaults `now` to the real clock when omitted (smoke)", () => {
      // A far-future runAt is valid regardless of the real clock, so this only
      // confirms the default-arg path doesn't throw and returns no runAt error.
      const errors = validate(
        draft({
          title: "t",
          instruction: "do it",
          scheduleType: "once",
          runAtLocal: toLocalInputValue(new Date(Date.now() + 365 * 86_400_000)),
        }),
      );
      expect(errors.runAt).toBeUndefined();
    });
  });
});
