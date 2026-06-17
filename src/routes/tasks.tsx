import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "~/components/site-header";
import { ScheduledJobsBoard } from "~/components/tasks/scheduled-jobs-board";
import { useHydrated } from "~/lib/hooks/use-hydrated";

export const Route = createFileRoute("/tasks")({
  component: TasksRoute,
});

function TasksRoute() {
  const hydrated = useHydrated();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Scheduled tasks</h1>
      {hydrated ? <ScheduledJobsBoard /> : <SiteHeader />}
    </div>
  );
}
