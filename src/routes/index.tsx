import { createFileRoute } from "@tanstack/react-router";

import { ChatShellProvider, useChatShell } from "~/components/chat/chat-shell-context";
import { ChatSurface } from "~/components/chat/chat-surface";
import { SiteHeader, SiteHeaderStatus } from "~/components/site-header";

export const Route = createFileRoute("/")({
  component: ChatRoute,
});

function ChatRoute() {
  return (
    <ChatShellProvider>
      <ChatRouteInner />
    </ChatShellProvider>
  );
}

function ChatRouteInner() {
  const { chatBusy } = useChatShell();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Chat</h1>
      <SiteHeader
        status={
          <SiteHeaderStatus pulse={chatBusy}>{chatBusy ? "Responding" : "Ready"}</SiteHeaderStatus>
        }
      />

      <ChatSurface />
    </div>
  );
}
