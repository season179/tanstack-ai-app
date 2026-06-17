import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

/**
 * Lifts the chat's streaming status up to the route so the SiteHeader can show
 * "Responding"/"Ready" without re-rendering the whole message list on every
 * token. Kept deliberately small: busy state only (sessions, usage, and live
 * updates land in later iterations).
 */
export type ChatShellValue = {
  chatBusy: boolean;
  setBusy: (busy: boolean) => void;
};

const ChatShellContext = createContext<ChatShellValue | null>(null);

export function ChatShellProvider({ children }: { children: ReactNode }) {
  const [chatBusy, setChatBusy] = useState(false);
  // Stable identity so ChatSurface's effect dependency doesn't refire per render.
  const setBusy = useCallback((busy: boolean) => setChatBusy(busy), []);
  const value = useMemo<ChatShellValue>(() => ({ chatBusy, setBusy }), [chatBusy, setBusy]);
  return <ChatShellContext value={value}>{children}</ChatShellContext>;
}

export function useChatShell(): ChatShellValue {
  const value = useContext(ChatShellContext);
  if (!value) {
    throw new Error("useChatShell must be used inside <ChatShellProvider>.");
  }
  return value;
}
