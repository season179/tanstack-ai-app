import { createFileRoute } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";

import { SiteHeader, SiteHeaderStatus } from "~/components/site-header";

export const Route = createFileRoute("/")({
  component: ChatRoute,
});

function ChatRoute() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Chat</h1>
      <SiteHeader status={<SiteHeaderStatus>Ready</SiteHeaderStatus>} />

      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="mx-auto w-full max-w-md text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <MessageSquare aria-hidden="true" className="size-6" />
          </div>
          <p className="text-lg font-semibold text-foreground">How can I help?</p>
          <p className="mt-2 text-sm text-muted-foreground">
            The streaming chat surface lands next. The scaffold, design system, and app chrome are
            in place.
          </p>
        </div>
      </div>
    </div>
  );
}
