import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { useEffect } from "react";

import { useChatSessions } from "~/lib/hooks/use-chat-sessions";
import { useHydrated } from "~/lib/hooks/use-hydrated";

export const Route = createFileRoute("/")({
  component: ChatIndexRoute,
});

/**
 * Chat entry: hydrate, then bounce to the most recent session (or mint a new
 * one) at /chat/$sessionId. Renders a neutral loading state during SSR and the
 * first client paint so the redirect only fires against the real session list.
 */
function ChatIndexRoute() {
  const navigate = useNavigate();
  const hydrated = useHydrated();
  const { sessions, createSession } = useChatSessions();

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const id = sessions[0]?.id ?? createSession();
    void navigate({ to: "/chat/$sessionId", params: { sessionId: id }, replace: true });
  }, [hydrated, sessions, createSession, navigate]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Chat</h1>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <MessageSquare aria-hidden="true" className="size-5 animate-pulse" />
        </div>
        <p className="text-sm text-muted-foreground">Loading chat…</p>
      </div>
    </div>
  );
}
