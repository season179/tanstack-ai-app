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
 *   - a completion pass then flips runs that have been "running" longer than
 *     `RUN_DURATION_MS` to `completed` with a synthetic verdict (there is no
 *     agent tool loop to actually execute the instruction — the verdict is
 *     deterministic placeholder text, the documented fidelity tradeoff).
 *
 * The ticker is started lazily by the use-tasks hook; if no tab is open, no
 * fires happen (a fundamental limit of browser-only scheduling).
 */

import { CronExpressionParser } from "cron-parser";

import {
  completeRun,
  ensureRun,
  getRunsSnapshot,
  getTask,
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

/** How long a run stays "running" before the completion pass settles it. */
export const RUN_DURATION_MS = 3000;
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
 * Promote due tasks into runs and settle aged runs. Returns the count of runs
 * mutated, purely for diagnostics. Safe to call on the server (no-op).
 */
export function tickTasks(now: Date = new Date()): number {
  if (typeof window === "undefined") {
    return 0;
  }

  let mutated = 0;
  const nowMs = now.getTime();

  // 1. Fire due tasks.
  for (const task of getTasksSnapshot()) {
    if (!task.isEnabled) {
      continue;
    }
    const fire = projectNextFire(task);
    if (!fire || fire.getTime() > nowMs) {
      continue;
    }

    const fireIso = fire.toISOString();
    ensureRun(task, fireIso);
    markTaskFired(task.id, fireIso);
    mutated += 1;

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

  // 2. Settle aged runs with a synthetic verdict.
  for (const run of getRunsSnapshot()) {
    if (run.status !== "running") {
      continue;
    }
    const ageMs = nowMs - new Date(run.startedAt).getTime();
    if (ageMs < RUN_DURATION_MS) {
      continue;
    }
    const task = getTask(run.taskId);
    const instruction = task?.payload.instruction ?? "";
    const summary = instruction.length > 80 ? `${instruction.slice(0, 80)}…` : instruction;
    completeRun(
      run.id,
      "completed",
      { statusUpdate: summary ? `Acknowledged: ${summary}` : "Check-in completed." },
      null,
    );
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
