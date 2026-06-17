import { useCallback, useSyncExternalStore } from "react";

import {
  createSession as createSessionInStore,
  deleteSession as deleteSessionInStore,
  getSessionsSnapshot,
  renameSession as renameSessionInStore,
  type SessionSummary,
  subscribeSessions,
  touchSession as touchSessionInStore,
} from "~/lib/chat/sessions-store";

export type { SessionSummary };

export type UseChatSessions = {
  /** Newest-activity-first; referentially stable between mutations. */
  sessions: SessionSummary[];
  /** Mints a session and returns its id (caller navigates to it). */
  createSession: (title?: string) => string;
  removeSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  /** Bump a session to the top of the list (call on send/stream completion). */
  touch: (id: string) => void;
};

/**
 * Live view of the localStorage session store. Backed by useSyncExternalStore
 * so every consumer (sidebar, redirect logic, routes) shares one source of
 * truth and updates the instant any writer mutates the store.
 */
export function useChatSessions(): UseChatSessions {
  const sessions = useSyncExternalStore(
    subscribeSessions,
    getSessionsSnapshot,
    getSessionsSnapshot,
  );

  const createSession = useCallback((title?: string) => createSessionInStore(title).id, []);
  const removeSession = useCallback((id: string) => deleteSessionInStore(id), []);
  const renameSession = useCallback(
    (id: string, title: string) => renameSessionInStore(id, title),
    [],
  );
  const touch = useCallback((id: string) => touchSessionInStore(id), []);

  return { sessions, createSession, removeSession, renameSession, touch };
}
