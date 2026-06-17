/**
 * Client-side scheduled-task scheduler.
 *
 * The reference app runs scheduled tasks on a server-side pg-boss queue with
 * dedicated workers. This port has no server workers (the brief is browser +
 * TanStack only), so the scheduler is a singleton ticker that runs while the
 * app tab is open:
 *
 *   - `projectNextFire` computes when an enabled task should next fire — the
 *     one-off's `runAt`, or the next cron fire after `lastFiredAt`/createdAt
 *     (parsed with cron-parser in the task's timezone, matching the reference).
 *   - `tickTasks` promotes any task whose projected fire is now due into a
 *     `running` run, advances `lastFiredAt`, and fast-forwards past missed
 *     cron fires so a long browser absence can't backfill dozens of runs.
 *   - promoting a run fires `executeScheduledRun` (run-instruction.ts), which
 *     runs the task's instruction against `/api/chat`, appends the agent's
 *     reply to the task's home chat session, and settles the run with the real
 *     assistant text (or `failed` on error). It owns its own timeout +
 *     completion, so this ticker does NOT settle runs itself — except for a
 *     safety net that mops up runs stranded by a crashed/aborted executor.
 *
 * The ticker is started lazily by the use-tasks hook; if no tab is open, no
 * fires happen (a fundamental limit of browser-only scheduling).
 */

import { CronExpressionParser } from "cron-parser";
import { executeScheduledRun } from "./run-instruction";
import {
  completeRun,
  ensureRun,
  getRunsSnapshot,
  getTasksSnapshot,
  markTaskFired,
  updateTask,
} from "./tasks-store";
import type {
  ScheduledJobsOverview,
  ScheduledTask,
  ScheduledTaskRun,
  UpcomingScheduledJob,
} from "./types";

/** Safety net: a run stranded "running" longer than this is settled as
 *  failed — the executor died (tab closed mid-run, an unhandled throw) or the
 *  run predates the real-execution wiring. Far longer than run-instruction's
 *  own RUN_TIMEOUT_MS so live executions are never mopped up. */
export const RUN_TIMEOUT_FALLBACK_MS = 10 * 60_000;
/** Ticker interval — short enough that a fire looks live on the board. */
const TICK_INTERVAL_MS = 4000;

/** Project the next fire for a task strictly after its last fire (or
 *  creation). Null = nothing scheduled. */
export function projectNextFire(task: ScheduledTask): Date | null {
  if (!task.isEnabled) {
    return null;
  }

  if (task.scheduleType === "once") {
    // Consumed once it has fired.
    if (!task.runAt || task.lastFiredAt) {
      return null;
    }
    return new Date(task.runAt);
  }

  if (!task.cron) {
    return null;
  }

  // Anchor catch-up at the last fire (or creation) so recurring fires advance.
  const anchor = task.lastFiredAt ? new Date(task.lastFiredAt) : new Date(task.createdAt);
  try {
    const iterator = CronExpressionParser.parse(task.cron, {
      tz: task.timezone || "UTC",
      currentDate: anchor,
    });
    return iterator.next().toDate();
  } catch {
    // Invalid cron expression — treat as never firing.
    return null;
  }
}

/**
 * Promote due tasks into runs (firing real execution) and mop up stranded
 * runs. Returns the count of runs mutated, purely for diagnostics. Safe to
 * call on the server (no-op).
 */
export function tickTasks(now: Date = new Date()): number {
  if (typeof window === "undefined") {
    return 0;
  }

  let mutated = 0;
  const nowMs = now.getTime();

  // 1. Fire due tasks: promote to a running run and kick off real execution.
  for (const task of getTasksSnapshot()) {
    if (!task.isEnabled) {
      continue;
    }
    const fire = projectNextFire(task);
    if (!fire || fire.getTime() > nowMs) {
      continue;
    }

    const fireIso = fire.toISOString();
    const run = ensureRun(task, fireIso);
    markTaskFired(task.id, fireIso);
    mutated += 1;

    // Fire the real agent run for this turn. Fire-and-forget: the executor
    // owns its own timeout + completion (and is idempotent per run id, so a
    // duplicate fire or re-tick can't double-run it).
    void executeScheduledRun(run, task).catch((error) => {
      // Belt-and-suspenders: executeScheduledRun is fail-soft (it always
      // settles the run itself), but guard so an unexpected throw can never
      // leave the run stuck "running" past the fallback timeout below.
      completeRun(
        run.id,
        "failed",
        null,
        error instanceof Error ? error.message : "Scheduled run crashed.",
      );
    });

    if (task.scheduleType === "once") {
      // A one-off is consumed by its single fire.
      updateTask(task.id, { isEnabled: false });
    } else {
      // Fast-forward past missed cron fires: if the *next* projection after
      // this fire is already in the past too, the tab was closed across many
      // intervals — skip the backfill and resume scheduling from now.
      const replayed: ScheduledTask = { ...task, lastFiredAt: fireIso };
      const next = projectNextFire(replayed);
      if (next && next.getTime() <= nowMs) {
        markTaskFired(task.id, now.toISOString());
      }
    }
  }

  // 2. Safety net: settle any run still "running" past the fallback horizon.
  //    The executor settles its own runs on success/error/timeout, so this only
  //    catches runs whose executor died (tab closed mid-run, a crash) or legacy
  //    runs created before real execution landed.
  for (const run of getRunsSnapshot()) {
    if (run.status !== "running") {
      continue;
    }
    const ageMs = nowMs - new Date(run.startedAt).getTime();
    if (ageMs < RUN_TIMEOUT_FALLBACK_MS) {
      continue;
    }
    completeRun(run.id, "failed", null, "Run did not complete.");
    mutated += 1;
  }

  return mutated;
}

/** Build the running/upcoming/past overview the board renders. Pure read:
 *  takes the task and run snapshots so callers can memoize on identity. */
export function buildOverview(
  tasks: ScheduledTask[] = getTasksSnapshot(),
  runs: ScheduledTaskRun[] = getRunsSnapshot(),
  now: Date = new Date(),
): ScheduledJobsOverview {
  const nowMs = now.getTime();

  const running = runs.filter((run) => run.status === "running").slice(0, 50);
  const past = runs.filter((run) => run.status !== "running").slice(0, 100);

  const upcoming: UpcomingScheduledJob[] = [];
  for (const task of tasks) {
    if (!task.isEnabled) {
      continue;
    }
    const fire = projectNextFire(task);
    if (!fire) {
      continue;
    }
    // A fire already due is about to become a run — don't list it as upcoming.
    if (fire.getTime() <= nowMs) {
      continue;
    }
    upcoming.push({
      taskId: task.id,
      taskTitle: task.title,
      scheduleType: task.scheduleType,
      payload: task.payload,
      cron: task.cron,
      timezone: task.timezone,
      nextRunAt: fire.toISOString(),
      homeSessionId: task.homeSessionId,
    });
  }
  upcoming.sort((a, b) => (a.nextRunAt ?? "").localeCompare(b.nextRunAt ?? ""));

  return { running, upcoming, past };
}

// --- Singleton ticker -------------------------------------------------------

let tickTimer: ReturnType<typeof setInterval> | null = null;

/** Start the background ticker exactly once per tab. Idempotent. */
export function startTaskScheduler(): void {
  if (typeof window === "undefined" || tickTimer !== null) {
    return;
  }
  // Fire immediately so a due task is promoted without waiting a full interval.
  tickTasks();
  tickTimer = setInterval(() => {
    tickTasks();
  }, TICK_INTERVAL_MS);
}

/** Stop the ticker (test/teardown helper). */
export function stopTaskScheduler(): void {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}
