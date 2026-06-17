/**
 * Pure helpers that drive the chat sidebar's session list rendering: active-
 * session highlight parsing, relative timestamps, and Today/Older grouping.
 *
 * Extracted from {@link ../../components/app-sidebar} so the load-bearing
 * grouping/timestamp contracts — which iteration 22 only ad-hoc verified —
 * have co-located regression coverage. These functions take no React state
 * and depend only on `Date.now()` (groupSessions/formatRelative) or their
 * arguments (parseActiveSessionId/isSameDay), so they test cleanly under a
 * deterministic fake clock.
 */

import type { SessionSummary } from "~/lib/hooks/use-chat-sessions";

/** `/chat/<id>` → <id>; everything else → null (no active session highlight). */
export function parseActiveSessionId(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/]+)$/);
  return match?.[1] ?? null;
}

/**
 * Compact relative-time label for a session row: 'just now' / 'Nm ago' /
 * 'Nh ago' / 'Nd ago', falling back to a locale date once a week has passed.
 * Returns '' for an unparseable timestamp so the UI can omit the caption
 * rather than render 'Invalid Date'.
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "";
  }
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

/** Calendar-day equality (year + month + date), not a 24h window. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export type SessionGroup = {
  label: string;
  items: SessionSummary[];
};

/**
 * Partition the already-sorted (newest-first) list into Today / Older, keeping
 * order within each group. Matches the reference's sidebar grouping so a long
 * session history stays navigable: today's chats float under a clear label and
 * older ones collapse into a second section instead of one long flat list.
 *
 * Empty groups are filtered out so the sidebar never renders a permanent
 * 'Older 0' noise row.
 */
export function groupSessions(sessions: SessionSummary[], now: Date = new Date()): SessionGroup[] {
  const today: SessionSummary[] = [];
  const older: SessionSummary[] = [];

  for (const session of sessions) {
    const stamp = new Date(session.updatedAt || session.createdAt);
    if (isSameDay(stamp, now)) {
      today.push(session);
    } else {
      older.push(session);
    }
  }

  return [
    { label: "Today", items: today },
    { label: "Older", items: older },
  ].filter((group) => group.items.length > 0);
}
