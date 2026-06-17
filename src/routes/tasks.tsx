import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock } from "lucide-react";

import { SiteHeader } from "~/components/site-header";

export const Route = createFileRoute("/tasks")({
  component: TasksRoute,
});

function TasksRoute() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Scheduled tasks</h1>
      <SiteHeader />

      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="mx-auto w-full max-w-md rounded-lg border border-dashed border-border p-8 text-center">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CalendarClock aria-hidden="true" className="size-5" />
          </div>
          <p className="text-sm font-medium text-foreground">No scheduled tasks yet</p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Real scheduler-backed tools arrive in a later iteration.
          </p>
        </div>
      </div>
    </div>
  );
}
