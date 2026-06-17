/**
 * A module-level "is a chat streaming right now" signal.
 *
 * The per-session {@link ChatShellProvider} owns `chatBusy` for the header, but
 * it lives inside the `/chat/$sessionId` route — whereas `AppSidebar` lives in
 * the root `AppShell`, outside that provider. The reference's `AppShell` owns a
 * single `chatBusy` and uses it to guard three sidebar actions (start a new
 * chat / select a session / delete the active one) so the user can't tear down
 * an in-flight stream. This signal mirrors the active session's busy flag into
 * a process-wide pub/sub so the sidebar can apply the same guards.
 *
 * Only the currently-viewed chat writes to it; the provider resets it on
 * unmount (e.g. on chat switch) so a stale `true` can never leak.
 */
let current = false;
const listeners = new Set<() => void>();

export function getChatBusySnapshot(): boolean {
  return current;
}

export function setChatBusySignal(next: boolean): void {
  if (next === current) {
    return;
  }
  current = next;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeChatBusy(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
