/**
 * Client-side chat session store, backed by localStorage with an in-memory
 * pub/sub so every hook instance in the tab stays in sync (the native `storage`
 * event only fires in *other* tabs, not the one that wrote). No database — the
 * brief is "no Next.js, no AI SDK", and a Postgres/Drizzle layer would dwarf
 * the feature; localStorage gives the same multi-session UX self-contained.
 *
 * Sessions and their messages are stored under separate keys so a streaming
 * token never rewrites the whole sessions blob, and deleting a session drops
 * its transcript in one removeItem.
 */
import type { ChatMessage } from "~/lib/hooks/use-chat-stream";

const SESSIONS_KEY = "tanstack-ai-app:sessions";
const MESSAGES_PREFIX = "tanstack-ai-app:messages:";

/** Cap for auto/manual titles (chars). Matches the reference's spirit, trimmed. */
export const TITLE_MAX = 80;
export const DEFAULT_TITLE = "New chat";

/**
 * Provenance of a session's title, so an AI-generated title can upgrade an
 * auto first-message title without ever clobbering a manual rename. Omitted on
 * legacy localStorage sessions, which are treated as 'auto' (overridable).
 */
export type TitleSource = "auto" | "generated" | "manual";

export type SessionSummary = {
  id: string;
  title: string;
  /**
   * 'auto' for the default/first-message title, 'generated' once the AI titler
   * has named the session, 'manual' once the user renames. Undefined (treated
   * as 'auto') on sessions persisted before this field existed.
   */
  titleSource?: TitleSource;
  createdAt: string;
  updatedAt: string;
};

type Listener = () => void;

const listeners = new Set<Listener>();
let cache: SessionSummary[] | null = null;
let crossTabWired = false;

function isClient(): boolean {
  return typeof window !== "undefined";
}

function parse(raw: string | null, fallback: unknown): unknown {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function isValidSummary(value: unknown): value is SessionSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string"
  );
}

function isValidMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    (v.role === "user" || v.role === "assistant") &&
    typeof v.content === "string"
  );
}

function messagesKey(id: string): string {
  return `${MESSAGES_PREFIX}${id}`;
}

function readSessionsRaw(): SessionSummary[] {
  if (!isClient()) {
    return [];
  }
  const parsed = parse(window.localStorage.getItem(SESSIONS_KEY), []);
  if (!Array.isArray(parsed)) {
    return [];
  }
  // Newest activity first; localeCompare on ISO strings is monotonic.
  return parsed.filter(isValidSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function flush(next: SessionSummary[]): void {
  if (!isClient()) {
    return;
  }
  try {
    window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — best effort; in-memory subscribers still update.
  }
  cache = null;
  notify();
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Wire the cross-tab `storage` listener exactly once per tab. */
function ensureCrossTab(): void {
  if (!isClient() || crossTabWired) {
    return;
  }
  crossTabWired = true;
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === SESSIONS_KEY) {
      cache = null;
      notify();
    }
  });
}

function newId(): string {
  if (isClient() && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// --- Snapshot for useSyncExternalStore (must be referentially stable) -----

export function getSessionsSnapshot(): SessionSummary[] {
  ensureCrossTab();
  if (cache === null) {
    cache = readSessionsRaw();
  }
  return cache;
}

export function subscribeSessions(listener: Listener): () => void {
  ensureCrossTab();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// --- Public mutators -------------------------------------------------------

export function getSession(id: string): SessionSummary | null {
  return getSessionsSnapshot().find((session) => session.id === id) ?? null;
}

export function getMostRecentSessionId(): string | null {
  return getSessionsSnapshot()[0]?.id ?? null;
}

export function createSession(title: string = DEFAULT_TITLE): SessionSummary {
  const now = nowIso();
  const trimmed = title.trim().slice(0, TITLE_MAX) || DEFAULT_TITLE;
  const session: SessionSummary = {
    id: newId(),
    title: trimmed,
    titleSource: "auto",
    createdAt: now,
    updatedAt: now,
  };
  flush([session, ...getSessionsSnapshot()]);
  writeMessages(session.id, []);
  return session;
}

export function deleteSession(id: string): void {
  flush(getSessionsSnapshot().filter((session) => session.id !== id));
  if (isClient()) {
    try {
      window.localStorage.removeItem(messagesKey(id));
    } catch {
      // Best effort.
    }
  }
}

export function renameSession(id: string, title: string): void {
  const trimmed = title.trim().slice(0, TITLE_MAX);
  if (!trimmed) {
    return;
  }
  const next = getSessionsSnapshot().map((session) =>
    session.id === id ? { ...session, title: trimmed, titleSource: "manual" as const } : session,
  );
  flush(next);
}

/**
 * Auto-title from the first user message (instant sidebar feedback): only
 * writes while the session is still on an 'auto' (default/first-message)
 * title — never clobbers a generated or manual rename, and concurrent
 * completions don't fight each other.
 */
export function setSessionTitleFromMessage(id: string, firstUserText: string): void {
  const current = getSession(id);
  if (!current || !isAutoTitle(current)) {
    return;
  }
  const normalized = firstUserText.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return;
  }
  const title =
    normalized.length > TITLE_MAX ? `${normalized.slice(0, TITLE_MAX - 1)}…` : normalized;
  setSessionTitle(id, title, "auto");
}

/**
 * AI-generated title: upgrades an 'auto' (default/first-message) title to the
 * model's 3-5 word name once the first turn resolves. Never overwrites a
 * manual rename or a prior generated title, so a re-run of the first turn or
 * a slow-arriving second completion can't clobber what's already named.
 */
export function setGeneratedSessionTitle(id: string, title: string): void {
  const current = getSession(id);
  if (!current || !isAutoTitle(current)) {
    return;
  }
  const trimmed = title.trim().slice(0, TITLE_MAX);
  if (!trimmed) {
    return;
  }
  setSessionTitle(id, trimmed, "generated");
}

/** True iff the session title is still overridable by auto/generated setters. */
function isAutoTitle(session: SessionSummary): boolean {
  return session.titleSource === undefined || session.titleSource === "auto";
}

function setSessionTitle(id: string, title: string, source: TitleSource): void {
  flush(
    getSessionsSnapshot().map((session) =>
      session.id === id ? { ...session, title, titleSource: source } : session,
    ),
  );
}

/** Bump updatedAt and re-sort so the active chat floats to the top of the list. */
export function touchSession(id: string): void {
  const current = getSession(id);
  if (!current) {
    return;
  }
  const now = nowIso();
  flush(
    getSessionsSnapshot().map((session) =>
      session.id === id ? { ...session, updatedAt: now } : session,
    ),
  );
}

// --- Per-session messages --------------------------------------------------

export function readMessages(id: string): ChatMessage[] {
  if (!isClient()) {
    return [];
  }
  const parsed = parse(window.localStorage.getItem(messagesKey(id)), []);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(isValidMessage);
}

export function writeMessages(id: string, messages: ChatMessage[]): void {
  if (!isClient()) {
    return;
  }
  try {
    window.localStorage.setItem(messagesKey(id), JSON.stringify(messages));
  } catch {
    // Best effort.
  }
}
