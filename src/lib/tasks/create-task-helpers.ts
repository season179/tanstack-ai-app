/**
 * Pure helpers for the Create Task dialog, extracted from
 * `src/components/tasks/create-task-dialog.tsx` so the validation rules and
 * datetime-local formatting/parsing are unit-testable without rendering the
 * component.
 *
 * The datetime-local helpers carry a documented gotcha (iteration 5): the
 * control has minute granularity by default, so to represent sub-minute
 * quick offsets (+10s / +30s) the value MUST be formatted with seconds AND
 * the input sets `step={1}`. `toLocalInputValue` therefore always emits the
 * seconds component.
 */

import { CronExpressionParser } from "cron-parser";

import type { ScheduleType } from "./types";

export const TITLE_MAX = 120;
export const INSTRUCTION_MAX = 2000;

export type Draft = {
  title: string;
  instruction: string;
  scheduleType: ScheduleType;
  /** `yyyy-MM-ddTHH:mm` (or with seconds) for the datetime-local control. */
  runAtLocal: string;
  cron: string;
};

export const EMPTY_DRAFT: Draft = {
  title: "",
  instruction: "",
  scheduleType: "once",
  runAtLocal: "",
  cron: "*/5 * * * *",
};

export type Errors = {
  title?: string;
  instruction?: string;
  runAt?: string;
  cron?: string;
};

/**
 * Format a Date as the value a datetime-local input expects (local time,
 * with seconds so sub-minute quick offsets like +10s are representable).
 */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Parse a datetime-local value into an ISO string (interpreted as local time). */
export function localInputToIso(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Validate the dialog draft. Returns an `Errors` object; an empty object means
 * the draft is valid.
 *
 * `now` is injectable so the "future time" check is deterministically
 * testable (the production caller passes no argument and gets `new Date()`).
 */
export function validate(draft: Draft, now: Date = new Date()): Errors {
  const errors: Errors = {};

  if (!draft.title.trim()) {
    errors.title = "Title is required.";
  } else if (draft.title.length > TITLE_MAX) {
    errors.title = `Keep it under ${TITLE_MAX} characters.`;
  }

  if (!draft.instruction.trim()) {
    errors.instruction = "An instruction is required.";
  } else if (draft.instruction.length > INSTRUCTION_MAX) {
    errors.instruction = `Keep it under ${INSTRUCTION_MAX.toLocaleString()} characters.`;
  }

  if (draft.scheduleType === "once") {
    const iso = localInputToIso(draft.runAtLocal);
    if (!iso) {
      errors.runAt = "Pick a date and time.";
    } else if (new Date(iso).getTime() <= now.getTime()) {
      errors.runAt = "Choose a time in the future.";
    }
  } else if (!draft.cron.trim()) {
    errors.cron = "A cron expression is required.";
  } else {
    try {
      CronExpressionParser.parse(draft.cron.trim(), { tz: "UTC" });
    } catch (error) {
      errors.cron = error instanceof Error ? error.message : "Invalid cron expression.";
    }
  }

  return errors;
}
