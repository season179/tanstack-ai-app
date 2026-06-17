import { CalendarClock, Pause, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";

import { SiteHeader, SiteHeaderStatus } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import { useGoToTranscript, useTasks } from "~/lib/hooks/use-tasks";
import {
  formatDuration,
  formatRelative,
  formatTimestamp,
  getRunResult,
  payloadKindLabel,
  runStatusClasses,
} from "~/lib/tasks/display";
import { buildOverview } from "~/lib/tasks/scheduler";
import { getRunsSnapshot, getTasksSnapshot, subscribeTasks } from "~/lib/tasks/tasks-store";
import type { ScheduledTaskRun, UpcomingScheduledJob } from "~/lib/tasks/types";
import { cn } from "~/lib/utils";

import { CreateTaskDialog } from "./create-task-dialog";

export function ScheduledJobsBoard() {
  const { createTask, removeTask, updateTask } = useTasks();
  const goToTranscript = useGoToTranscript();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Live subscription: re-renders on every task/run mutation — including the
  // scheduler's background ticks (running→completed). The data lives in
  // localStorage in this same tab, so a direct subscription is instant and
  // avoids the polling-cadence misses a server-backed board would need.
  const tasks = useSyncExternalStore(subscribeTasks, getTasksSnapshot, getTasksSnapshot);
  const runs = useSyncExternalStore(subscribeTasks, getRunsSnapshot, getRunsSnapshot);
  const overview = useMemo(() => buildOverview(tasks, runs), [tasks, runs]);

  const isEmpty =
    overview.running.length === 0 && overview.upcoming.length === 0 && overview.past.length === 0;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background">
      <SiteHeader
        actions={
          <Button onClick={() => setDialogOpen(true)} size="sm" type="button">
            <Plus aria-hidden="true" className="size-3.5" />
            New task
          </Button>
        }
        status={<SiteHeaderStatus>Live</SiteHeaderStatus>}
      />

      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
        {isEmpty ? (
          <BoardEmptyState onNewTask={() => setDialogOpen(true)} />
        ) : (
          <div className="space-y-8">
            <RunningSection runs={overview.running} onViewTranscript={goToTranscript} />
            <UpcomingSection
              jobs={overview.upcoming}
              onDeleteTask={removeTask}
              onDisableTask={(taskId) => updateTask(taskId, { isEnabled: false })}
              onViewTranscript={goToTranscript}
            />
            <PastSection runs={overview.past} onViewTranscript={goToTranscript} />
          </div>
        )}
      </div>

      <CreateTaskDialog
        onClose={() => setDialogOpen(false)}
        onCreate={createTask}
        open={dialogOpen}
      />
    </main>
  );
}

function RunningSection({
  runs,
  onViewTranscript,
}: {
  runs: ScheduledTaskRun[];
  onViewTranscript: (homeSessionId: string | null) => void;
}) {
  return (
    <section>
      <SectionHeading count={runs.length} title="Running now" />

      {runs.length === 0 ? (
        <EmptyNote>Nothing is running right now.</EmptyNote>
      ) : (
        <div className="mt-2 space-y-2">
          {runs.map((run) => (
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/80 px-3 py-2.5"
              key={run.id}
            >
              <span aria-hidden="true" className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              <p
                className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground"
                title={run.taskTitle}
              >
                {run.taskTitle}
              </p>
              <span className="text-[11px] text-muted-foreground">
                {payloadKindLabel(run.payloadKind)}
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                started {formatTimestamp(run.startedAt)} · {formatRelative(run.startedAt)}
              </span>
              {run.homeSessionId ? (
                <Button
                  className="h-7 px-2 text-[11px]"
                  onClick={() => onViewTranscript(run.homeSessionId)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  View transcript
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function UpcomingSection({
  jobs,
  onDeleteTask,
  onDisableTask,
  onViewTranscript,
}: {
  jobs: UpcomingScheduledJob[];
  onDeleteTask: (taskId: string) => void;
  onDisableTask: (taskId: string) => void;
  onViewTranscript: (homeSessionId: string | null) => void;
}) {
  return (
    <section>
      <SectionHeading count={jobs.length} title="Up next" />

      {jobs.length === 0 ? (
        <EmptyNote>No active tasks are scheduled to run.</EmptyNote>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border/80">
          <table className="w-full min-w-[40rem] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border/80 text-[11px] text-muted-foreground">
                <th className="px-3 py-2 font-medium">Task</th>
                <th className="px-3 py-2 font-medium">Schedule</th>
                <th className="px-3 py-2 font-medium">Next run</th>
                <th className="px-3 py-2 font-medium">{""}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {jobs.map((job) => (
                <tr key={job.taskId}>
                  <td
                    className="max-w-64 truncate px-3 py-2 font-medium text-foreground"
                    title={job.taskTitle}
                  >
                    {job.taskTitle}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{scheduleLabel(job)}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {job.nextRunAt ? (
                      <>
                        {formatTimestamp(job.nextRunAt)} · {formatRelative(job.nextRunAt)}
                      </>
                    ) : (
                      <span className="font-medium text-destructive">nothing queued</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {job.homeSessionId ? (
                        <Button
                          className="h-7 px-2 text-[11px]"
                          onClick={() => onViewTranscript(job.homeSessionId)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          View transcript
                        </Button>
                      ) : null}
                      <Button
                        aria-label="Disable task"
                        className="size-7 text-muted-foreground hover:text-foreground"
                        onClick={() => onDisableTask(job.taskId)}
                        size="icon"
                        title="Disable task"
                        type="button"
                        variant="ghost"
                      >
                        <Pause aria-hidden="true" className="size-3" />
                      </Button>
                      <Button
                        aria-label="Delete task"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete the task '${job.taskTitle}' and its run history?`,
                            )
                          ) {
                            onDeleteTask(job.taskId);
                          }
                        }}
                        size="icon"
                        title="Delete task"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 aria-hidden="true" className="size-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PastSection({
  runs,
  onViewTranscript,
}: {
  runs: ScheduledTaskRun[];
  onViewTranscript: (homeSessionId: string | null) => void;
}) {
  return (
    <section>
      <SectionHeading count={runs.length} title="Past runs" />

      {runs.length === 0 ? (
        <EmptyNote>No runs have finished yet.</EmptyNote>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border/80">
          <table className="w-full min-w-[48rem] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border/80 text-[11px] text-muted-foreground">
                <th className="px-3 py-2 font-medium">Task</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Result</th>
                <th className="px-3 py-2 font-medium">{""}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {runs.map((run) => (
                <tr key={run.id}>
                  <td
                    className="max-w-56 truncate px-3 py-2 font-medium text-foreground"
                    title={run.taskTitle}
                  >
                    {run.taskTitle}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        runStatusClasses(run.status),
                      )}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                    {formatTimestamp(run.startedAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                    {formatDuration(run.startedAt, run.completedAt)}
                  </td>
                  <td className="max-w-96 px-3 py-2 text-muted-foreground">
                    <span className="line-clamp-2" title={getRunResult(run) ?? undefined}>
                      {getRunResult(run) ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {run.homeSessionId ? (
                      <Button
                        className="h-7 px-2 text-[11px]"
                        onClick={() => onViewTranscript(run.homeSessionId)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        View transcript
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BoardEmptyState({ onNewTask }: { onNewTask: () => void }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <CalendarClock aria-hidden="true" className="size-8 text-muted-foreground" />
      <h2 className="text-sm font-semibold text-foreground">No scheduled tasks yet</h2>
      <p className="text-sm text-muted-foreground">
        Create a task to fire once or on a recurring cron schedule. The board shows live runs,
        upcoming fires, and history as they happen.
      </p>
      <Button onClick={onNewTask} size="sm" type="button">
        <Plus aria-hidden="true" className="size-3.5" />
        New task
      </Button>
    </div>
  );
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
      {title}
      <span className="text-xs font-normal tabular-nums text-muted-foreground">{count}</span>
    </h2>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function scheduleLabel(job: UpcomingScheduledJob): string {
  if (job.scheduleType === "cron") {
    return `Recurring · cron ${job.cron}`;
  }
  return "One-off";
}
