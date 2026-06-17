/**
 * Display helpers for the scheduled-jobs board. Ported from the reference
 * app's lib/scheduler/display.ts plus the board-local formatters
 * (formatRelative / formatDuration / payloadKindLabel) so the board renders
 * identically.
 */

import type { ScheduledTaskRun, TaskPayloadKind } from "./types";

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Instruction runs store their verdict as run output; surface its statusUpdate. */
export function extractStatusUpdate(output: unknown): string | null {
  if (output && typeof output === "object" && "statusUpdate" in output) {
    const update = (output as { statusUpdate?: unknown }).statusUpdate;
    if (typeof update === "string" && update.trim()) {
      return update;
    }
  }
  return null;
}

export function formatRelative(value: string): string {
  const diffMs = new Date(value).getTime() - Date.now();
  if (Number.isNaN(diffMs)) {
    return "";
  }
  const seconds = Math.round(Math.abs(diffMs) / 1000);
  const text =
    seconds < 60
      ? `${seconds}s`
      : seconds < 3600
        ? `${Math.round(seconds / 60)}m`
        : seconds < 86400
          ? `${(seconds / 3600).toFixed(1)}h`
          : `${(seconds / 86400).toFixed(1)}d`;
  return diffMs < 0 ? `${text} ago` : `in ${text}`;
}

export function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) {
    return "—";
  }
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  const seconds = ms / 1000;
  if (seconds < 1) {
    return "<1s";
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${Math.round(seconds % 60)}s`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function payloadKindLabel(kind: TaskPayloadKind): string {
  return kind === "instruction" ? "check-in" : "tool call";
}

export function runStatusClasses(status: ScheduledTaskRun["status"]): string {
  switch (status) {
    case "running":
      return "bg-primary/10 text-primary";
    case "completed":
      return "bg-primary/10 text-primary";
    case "failed":
      return "bg-destructive/10 text-destructive";
    case "skipped":
      return "bg-muted text-muted-foreground";
  }
}

/** Failed runs show the error; instruction verdicts show their statusUpdate. */
export function getRunResult(run: ScheduledTaskRun): string | null {
  if (run.error) {
    return run.error;
  }
  const statusUpdate = extractStatusUpdate(run.output);
  if (statusUpdate) {
    return statusUpdate;
  }
  if (run.output === null || run.output === undefined) {
    return null;
  }
  const text = JSON.stringify(run.output);
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}
