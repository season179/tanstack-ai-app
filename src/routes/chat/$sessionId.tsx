import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { ChatShellProvider, useChatShell } from "~/components/chat/chat-shell-context";
import { ChatSurface } from "~/components/chat/chat-surface";
import { TokenUsageMenu } from "~/components/chat/token-usage-menu";
import { SiteHeader, SiteHeaderStatus } from "~/components/site-header";
import { useChatSessions } from "~/lib/hooks/use-chat-sessions";
import { useHydrated } from "~/lib/hooks/use-hydrated";

export const Route = createFileRoute("/chat/$sessionId")({
  component: ChatSessionRoute,
});

function ChatSessionRoute() {
  const { sessionId } = Route.useParams();
  const navigate = useNavigate();
  const hydrated = useHydrated();
  const { sessions } = useChatSessions();

  const exists = sessions.some((session) => session.id === sessionId);

  // Only after hydration: if this id was deleted (or hand-typed wrong), bail to
  // "/", which itself redirects to the most recent or a fresh session.
  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (!exists) {
      void navigate({ to: "/", replace: true });
    }
  }, [hydrated, exists, navigate]);

  return (
    <ChatShellProvider key={sessionId}>
      <ChatSessionRouteInner sessionId={sessionId} />
    </ChatShellProvider>
  );
}

function ChatSessionRouteInner({ sessionId }: { sessionId: string }) {
  const { chatBusy, usage } = useChatShell();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Chat</h1>
      <SiteHeader
        status={
          <SiteHeaderStatus pulse={chatBusy}>{chatBusy ? "Responding" : "Ready"}</SiteHeaderStatus>
        }
        actions={<TokenUsageMenu summary={usage} />}
      />

      {/* key={sessionId} forces a clean remount (and a fresh transcript read)
          when switching chats, so the previous session's stream never leaks. */}
      <ChatSurface key={sessionId} sessionId={sessionId} />
    </div>
  );
}
