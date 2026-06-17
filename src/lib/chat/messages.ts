/**
 * Helpers for reconciling chat message lists by id.
 *
 * Two async writers feed the chat surface's message state — the interactive
 * streaming hook (useChatStream) and the scheduled-task executor
 * (run-instruction, which appends a real agent turn to the task's home
 * session when a task fires) — so a scheduled fire can land while the user is
 * viewing that session's transcript. React crashes on duplicate list keys,
 * so id-uniqueness has to be enforced at the merge boundary. Centralizing the
 * Set-based bookkeeping here keeps each call site from re-implementing it.
 *
 * Ported from the reference's lib/chat/messages.ts (same helpers, same
 * semantics): the reference reconciles the AI SDK's own streaming writer with
 * its server-SSE live-merge writer; here the two writers are the interactive
 * hook and the localStorage-backed scheduler executor, but the merge contract
 * is identical.
 */

/** Minimal shape these helpers need: anything carrying a string id. */
type MessageLike = { id: string };

/**
 * Return the messages with each id appearing once, keeping the first
 * occurrence so every message stays at the position where it first appeared.
 * Use this at the render boundary so React always sees unique keys.
 */
export function dedupeMessagesById<T extends MessageLike>(messages: T[]): T[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message.id)) {
      return false;
    }
    seen.add(message.id);
    return true;
  });
}

/**
 * Append the incoming messages whose id is not already present in `current`,
 * preserving incoming order. Returns the existing `current` reference unchanged
 * when nothing new is added so React can bail out of the re-render (essential:
 * the interactive writer persists on every send/finalize, which notifies this
 * merge path — returning the same reference when the persist was a self-write
 * avoids a re-render storm during streaming). Incoming messages without an id
 * are skipped.
 */
export function appendNewMessagesById<T extends MessageLike>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((message) => message.id));
  const additions = incoming.filter((message) => message.id && !seen.has(message.id));
  return additions.length === 0 ? current : [...current, ...additions];
}
