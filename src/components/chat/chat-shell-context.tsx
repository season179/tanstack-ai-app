import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { setChatBusySignal } from "~/lib/chat/busy-signal";
import type { ChatUsageSummary, TurnTokenUsage } from "~/lib/chat/tool-events";

/**
 * Lifts the chat's streaming status + running token totals up to the route so
 * the SiteHeader can show "Responding"/"Ready" and the cumulative Session
 * Tokens menu without re-rendering the whole message list on every token.
 *
 * The usage summary is computed in ChatSurface from the message list (with
 * signature-based identity preservation) and reported up via setUsage; the
 * header reads it back through useChatShell. Kept small: only busy + usage
 * cross the boundary (sessions live in their own store/hook).
 */
export type ChatShellValue = {
  chatBusy: boolean;
  setBusy: (busy: boolean) => void;
  usage: ChatUsageSummary;
  setUsage: (usage: ChatUsageSummary) => void;
};

const EMPTY_USAGE: TurnTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
};

const ChatShellContext = createContext<ChatShellValue | null>(null);

export function ChatShellProvider({ children }: { children: ReactNode }) {
  const [chatBusy, setChatBusy] = useState(false);
  const [usage, setUsageState] = useState<ChatUsageSummary>({ sessionUsage: EMPTY_USAGE });
  // Stable identities so ChatSurface's effect dependencies don't refire per render.
  const setBusy = useCallback((busy: boolean) => setChatBusy(busy), []);
  const setUsage = useCallback((next: ChatUsageSummary) => setUsageState(next), []);

  // Mirror the per-session busy flag into a module-level signal so the sidebar
  // (which lives outside this provider, in the root AppShell) can guard against
  // tearing down an in-flight stream — the reference's chatBusy guard on
  // startNewSession / selectSession / deleteSession. Reset on unmount (e.g. a
  // chat switch) so a stale true can never leak into the next session's view.
  useEffect(() => {
    setChatBusySignal(chatBusy);
    return () => setChatBusySignal(false);
  }, [chatBusy]);

  const value = useMemo<ChatShellValue>(
    () => ({ chatBusy, setBusy, usage, setUsage }),
    [chatBusy, setBusy, usage, setUsage],
  );
  return <ChatShellContext value={value}>{children}</ChatShellContext>;
}

export function useChatShell(): ChatShellValue {
  const value = useContext(ChatShellContext);
  if (!value) {
    throw new Error("useChatShell must be used inside <ChatShellProvider>.");
  }
  return value;
}
