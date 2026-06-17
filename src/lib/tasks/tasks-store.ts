/**
 * Client-side scheduled-task store, backed by localStorage with an in-memory
 * pub/sub. Mirrors the sessions/skills store pattern: a referentially-stable
 * cached snapshot, cross-tab storage-event wiring, and an in-memory listener
 * set for same-tab sync.
 *
 * Tasks and runs live under separate keys so a busy run log can't bloat the
 * task list read path. The snapshot exposed to React is the task list; runs
 * are read on demand by the overview builder.
 */

import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  ScheduledTaskRun,
  UpdateScheduledTaskInput,
} from "./types";

const TASKS_KEY = "tanstack-ai-app:scheduled-tasks";
const RUNS_KEY = "tanstack-ai-app:scheduled-task-runs";
const MAX_RUNS = 200;

type Listener = () => void;

const listeners = new Set<Listener>();
let taskCache: ScheduledTask[] | null = null;
let runCache: ScheduledTaskRun[] | null = null;
let crossTabWired = false;

function isClient(): boolean {
  return typeof window !== "undefined";
}

function parse(raw: string | null, fallback: unknown): unknown {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function isValidTask(value: unknown): value is ScheduledTask {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    (v.scheduleType === "once" || v.scheduleType === "cron") &&
    typeof v.payload === "object" &&
    v.payload !== null &&
    (v.cron === null || typeof v.cron === "string") &&
    typeof v.timezone === "string" &&
    (v.runAt === null || typeof v.runAt === "string") &&
    typeof v.isEnabled === "boolean" &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string" &&
    (v.lastFiredAt === null || typeof v.lastFiredAt === "string") &&
    (v.homeSessionId === null || typeof v.homeSessionId === "string")
  );
}

function isValidRun(value: unknown): value is ScheduledTaskRun {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.taskId === "string" &&
    typeof v.taskTitle === "string" &&
    (v.scheduleType === "once" || v.scheduleType === "cron") &&
    typeof v.payloadKind === "string" &&
    typeof v.status === "string" &&
    (v.error === null || typeof v.error === "string") &&
    typeof v.startedAt === "string" &&
    (v.completedAt === null || typeof v.completedAt === "string") &&
    (v.homeSessionId === null || typeof v.homeSessionId === "string")
  );
}

function readTasksRaw(): ScheduledTask[] {
  if (!isClient()) {
    return [];
  }
  const parsed = parse(window.localStorage.getItem(TASKS_KEY), []);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isValidTask).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function readRunsRaw(): ScheduledTaskRun[] {
  if (!isClient()) {
    return [];
  }
  const parsed = parse(window.localStorage.getItem(RUNS_KEY), []);
  if (!Array.isArray(parsed)) {
    return [];
  }
  // Newest started first.
  return parsed.filter(isValidRun).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function flushTasks(next: ScheduledTask[]): void {
  if (!isClient()) {
    return;
  }
  try {
    window.localStorage.setItem(TASKS_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — best effort.
  }
  taskCache = null;
  notify();
}

function flushRuns(next: ScheduledTaskRun[]): void {
  if (!isClient()) {
    return;
  }
  // Trim to the most recent MAX_RUNS so a long-lived tab can't grow unbounded.
  const trimmed = next.length > MAX_RUNS ? next.slice(0, MAX_RUNS) : next;
  try {
    window.localStorage.setItem(RUNS_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota / private mode — best effort.
  }
  runCache = null;
  notify();
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Wire the cross-tab `storage` listener exactly once per tab. */
function ensureCrossTab(): void {
  if (!isClient() || crossTabWired) {
    return;
  }
  crossTabWired = true;
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === TASKS_KEY || event.key === RUNS_KEY) {
      taskCache = null;
      runCache = null;
      notify();
    }
  });
}

function newId(): string {
  if (isClient() && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// --- Snapshots for useSyncExternalStore (must be referentially stable) -----

export function getTasksSnapshot(): ScheduledTask[] {
  ensureCrossTab();
  if (taskCache === null) {
    taskCache = readTasksRaw();
  }
  return taskCache;
}

export function getRunsSnapshot(): ScheduledTaskRun[] {
  ensureCrossTab();
  if (runCache === null) {
    runCache = readRunsRaw();
  }
  return runCache;
}

export function subscribeTasks(listener: Listener): () => void {
  ensureCrossTab();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// --- Public mutators -------------------------------------------------------

export function getTask(id: string): ScheduledTask | null {
  return getTasksSnapshot().find((task) => task.id === id) ?? null;
}

export function createTask(input: CreateScheduledTaskInput): ScheduledTask {
  const now = nowIso();
  const task: ScheduledTask = {
    id: newId(),
    title: input.title,
    scheduleType: input.scheduleType,
    payload: { kind: "instruction", instruction: input.instruction },
    cron: input.scheduleType === "cron" ? (input.cron ?? null) : null,
    // Prefer the browser's IANA timezone so cron fires match the user's clock,
    // falling back to UTC where Intl is unavailable.
    timezone:
      typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        : "UTC",
    runAt: input.scheduleType === "once" ? (input.runAt ?? null) : null,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
    lastFiredAt: null,
    homeSessionId: input.homeSessionId ?? null,
  };
  flushTasks([task, ...getTasksSnapshot()]);
  return task;
}

export function updateTask(id: string, input: UpdateScheduledTaskInput): ScheduledTask | null {
  const current = getTask(id);
  if (!current) {
    return null;
  }
  const next: ScheduledTask = {
    ...current,
    title: input.title ?? current.title,
    isEnabled: input.isEnabled ?? current.isEnabled,
    payload:
      input.instruction !== undefined
        ? { kind: "instruction", instruction: input.instruction }
        : current.payload,
    updatedAt: nowIso(),
  };
  flushTasks(getTasksSnapshot().map((task) => (task.id === id ? next : task)));
  return next;
}

export function deleteTask(id: string): void {
  flushTasks(getTasksSnapshot().filter((task) => task.id !== id));
  // Cascade: drop this task's runs too so the board doesn't orphan history.
  flushRuns(getRunsSnapshot().filter((run) => run.taskId !== id));
}

// --- Run log (written by the scheduler tick) --------------------------------

/**
 * Idempotent: only inserts a run for (taskId, firedAt) when none exists yet.
 * Returns the run (existing or new) so the caller can decide whether to mark
 * it running/completed.
 */
export function ensureRun(task: ScheduledTask, firedAt: string): ScheduledTaskRun {
  const runs = getRunsSnapshot();
  const existing = runs.find((run) => run.taskId === task.id && run.startedAt === firedAt);
  if (existing) {
    return existing;
  }

  const run: ScheduledTaskRun = {
    id: newId(),
    taskId: task.id,
    taskTitle: task.title,
    scheduleType: task.scheduleType,
    payloadKind: "instruction",
    status: "running",
    output: null,
    error: null,
    startedAt: firedAt,
    completedAt: null,
    homeSessionId: task.homeSessionId,
  };
  flushRuns([run, ...runs]);
  return run;
}

/** Mark a run completed/failed/skipped with a synthetic verdict. */
export function completeRun(
  runId: string,
  status: "completed" | "failed" | "skipped",
  output: unknown,
  error: string | null,
): void {
  const runs = getRunsSnapshot();
  const target = runs.find((run) => run.id === runId);
  if (!target) {
    return;
  }
  const next: ScheduledTaskRun = {
    ...target,
    status,
    output,
    error,
    completedAt: nowIso(),
  };
  flushRuns(runs.map((run) => (run.id === runId ? next : run)));
}

/** Record that a task has fired at `firedAt` (advances cron catch-up). */
export function markTaskFired(id: string, firedAt: string): void {
  const current = getTask(id);
  if (!current) {
    return;
  }
  const next: ScheduledTask = { ...current, lastFiredAt: firedAt };
  flushTasks(getTasksSnapshot().map((task) => (task.id === id ? next : task)));
}
