import { useSyncExternalStore } from "react";

import { getChatBusySnapshot, subscribeChatBusy } from "~/lib/chat/busy-signal";

/**
 * True while any chat is actively streaming. Subscribes to the module-level
 * busy signal so components outside the per-session ChatShellProvider (notably
 * the sidebar) can mirror the reference's chatBusy guards. Returns false during
 * SSR and before any chat has started streaming.
 */
export function useChatBusy(): boolean {
  return useSyncExternalStore(subscribeChatBusy, getChatBusySnapshot, getChatBusySnapshot);
}
