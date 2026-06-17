/**
 * Scheduled-task domain types.
 *
 * The reference app models scheduled tasks as a server-side pg-boss queue
 * (Postgres + workers + cron) whose payloads are agent instructions or tool
 * calls. For this no-backend TanStack port we keep the same *shape* the board
 * UI renders — tasks, runs, and an overview of running/upcoming/past — but the
 * scheduler is a client-only ticker (see scheduler.ts) and run "execution" is
 * synthetic (there is no agent tool loop to drive). The data shapes mirror the
 * reference's scheduler/overview.ts so the board ports over directly.
 */

export type ScheduleType = "once" | "cron";

/** How a task is meant to fire. `instruction` is the only kind this port
 *  supports — the reference also has a `tool` payload for agent-scheduled
 *  tool calls, which has no analog without the tool loop. */
export type TaskPayloadKind = "instruction";

export type TaskPayload = {
  kind: TaskPayloadKind;
  /** The instruction text that a "run" represents. */
  instruction: string;
};

export type ScheduledTaskStatus = "running" | "completed" | "failed" | "skipped";

export type ScheduledTask = {
  id: string;
  title: string;
  scheduleType: ScheduleType;
  payload: TaskPayload;
  /** Cron expression for recurring tasks; null for one-offs. */
  cron: string | null;
  /** IANA timezone used to interpret `cron`. */
  timezone: string;
  /** ISO timestamp for a one-off fire; null for cron tasks. */
  runAt: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  /**
   * ISO timestamp of the most recent fire we have already created a run for.
   * Drives cron catch-up: the next projected fire after this is "upcoming".
   */
  lastFiredAt: string | null;
  /**
   * Optional link to a chat session the task's transcript belongs in
   * (mirrors the reference's home_session_id). Null for standalone tasks,
   * which simply omit the "View transcript" button.
   */
  homeSessionId: string | null;
};

export type ScheduledTaskRun = {
  id: string;
  taskId: string;
  taskTitle: string;
  scheduleType: ScheduleType;
  payloadKind: TaskPayloadKind;
  status: ScheduledTaskStatus;
  /** Synthetic verdict object; surfaced via extractStatusUpdate. */
  output: unknown;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  homeSessionId: string | null;
};

export type UpcomingScheduledJob = {
  taskId: string;
  taskTitle: string;
  scheduleType: ScheduleType;
  payload: TaskPayload;
  cron: string | null;
  timezone: string;
  /** Next projected fire, or null when there is nothing to project. */
  nextRunAt: string | null;
  homeSessionId: string | null;
};

export type ScheduledJobsOverview = {
  running: ScheduledTaskRun[];
  upcoming: UpcomingScheduledJob[];
  past: ScheduledTaskRun[];
};

export type CreateScheduledTaskInput = {
  title: string;
  scheduleType: ScheduleType;
  instruction: string;
  cron?: string | null;
  runAt?: string | null;
  homeSessionId?: string | null;
};

export type UpdateScheduledTaskInput = {
  title?: string;
  instruction?: string;
  isEnabled?: boolean;
};
