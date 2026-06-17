import { describe, expect, it } from "vitest";
import {
  formatRelative,
  groupSessions,
  isSameDay,
  parseActiveSessionId,
} from "~/lib/chat/sidebar-grouping";
import type { SessionSummary } from "~/lib/hooks/use-chat-sessions";

/** Build a SessionSummary with sensible defaults for test fixtures. */
function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "s1",
    title: "Test",
    createdAt: "2025-06-18T12:00:00.000Z",
    updatedAt: "2025-06-18T12:00:00.000Z",
    ...overrides,
  };
}

describe("parseActiveSessionId", () => {
  it("extracts the id from /chat/<id>", () => {
    expect(parseActiveSessionId("/chat/abc-123")).toBe("abc-123");
  });

  it("extracts an id that looks like a path segment with no slashes", () => {
    expect(parseActiveSessionId("/chat/550e8400-e29b-41d4-a716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("returns null for the index route", () => {
    expect(parseActiveSessionId("/")).toBeNull();
  });

  it("returns null for /tasks and /skills", () => {
    expect(parseActiveSessionId("/tasks")).toBeNull();
    expect(parseActiveSessionId("/skills")).toBeNull();
  });

  it("returns null for a deeper /chat/<id>/<sub> path (anchored, no trailing segment)", () => {
    expect(parseActiveSessionId("/chat/abc/messages")).toBeNull();
  });

  it("returns null for a path that merely contains /chat/ elsewhere", () => {
    expect(parseActiveSessionId("/foo/chat/abc")).toBeNull();
  });

  it("returns null for an empty pathname", () => {
    expect(parseActiveSessionId("")).toBeNull();
  });

  it("returns null for /chat with no id segment", () => {
    expect(parseActiveSessionId("/chat")).toBeNull();
    expect(parseActiveSessionId("/chat/")).toBeNull();
  });

  it("does not require a UUID-shaped id (any non-slash segment matches)", () => {
    expect(parseActiveSessionId("/chat/anything-here")).toBe("anything-here");
  });
});

describe("formatRelative", () => {
  // Pin a fixed `now` so assertions are deterministic regardless of wall clock.
  const NOW = new Date("2025-06-18T12:00:00.000Z").getTime();

  it("returns '' for an unparseable timestamp", () => {
    expect(formatRelative("not-a-date", NOW)).toBe("");
  });

  it("returns '' for the empty string", () => {
    expect(formatRelative("", NOW)).toBe("");
  });

  it("returns 'just now' for a timestamp less than 30 seconds ago (rounds to nearest minute)", () => {
    // Math.round(diffMs / 60_000) < 1 only when diff < 30s; at 30s it rounds up
    // to 1m. This boundary is the load-bearing cutoff for 'just now'.
    expect(formatRelative(new Date(NOW - 1_000).toISOString(), NOW)).toBe("just now");
    expect(formatRelative(new Date(NOW - 29_000).toISOString(), NOW)).toBe("just now");
  });

  it("returns 'just now' for exactly now", () => {
    expect(formatRelative(new Date(NOW).toISOString(), NOW)).toBe("just now");
  });

  it("rounds up to '1m ago' at exactly 30 seconds (nearest-minute boundary)", () => {
    expect(formatRelative(new Date(NOW - 30_000).toISOString(), NOW)).toBe("1m ago");
    expect(formatRelative(new Date(NOW - 59_000).toISOString(), NOW)).toBe("1m ago");
  });

  it("returns 'Nm ago' for minutes (rounds to nearest minute)", () => {
    expect(formatRelative(new Date(NOW - 60_000).toISOString(), NOW)).toBe("1m ago");
    expect(formatRelative(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe("5m ago");
    expect(formatRelative(new Date(NOW - 59 * 60_000).toISOString(), NOW)).toBe("59m ago");
  });

  it("rounds sub-minute remainders to the nearest whole minute", () => {
    // 90s rounds to 2m (Math.round(1.5) === 2)
    expect(formatRelative(new Date(NOW - 90_000).toISOString(), NOW)).toBe("2m ago");
    // 100s rounds to 2m
    expect(formatRelative(new Date(NOW - 100_000).toISOString(), NOW)).toBe("2m ago");
  });

  it("does not cross into hours until 30 minutes past the 59m threshold", () => {
    // minutes >= 60 → hours. 89m rounds to 1h (Math.round(89/60) === 1).
    expect(formatRelative(new Date(NOW - 89 * 60_000).toISOString(), NOW)).toBe("1h ago");
  });

  it("returns 'Nh ago' for hours (rounds to nearest hour)", () => {
    expect(formatRelative(new Date(NOW - 60 * 60_000).toISOString(), NOW)).toBe("1h ago");
    expect(formatRelative(new Date(NOW - 3 * 60 * 60_000).toISOString(), NOW)).toBe("3h ago");
    expect(formatRelative(new Date(NOW - 23 * 60 * 60_000).toISOString(), NOW)).toBe("23h ago");
  });

  it("returns 'Nd ago' for days between 1 and 6 (rounds to nearest day)", () => {
    expect(formatRelative(new Date(NOW - 24 * 60 * 60_000).toISOString(), NOW)).toBe("1d ago");
    expect(formatRelative(new Date(NOW - 6 * 24 * 60 * 60_000).toISOString(), NOW)).toBe("6d ago");
  });

  it("falls back to a locale date string once a week has passed", () => {
    const then = new Date(NOW - 7 * 24 * 60 * 60_000);
    expect(formatRelative(then.toISOString(), NOW)).toBe(then.toLocaleDateString());
  });

  it("uses the default Date.now() when `now` is omitted (smoke test)", () => {
    // Only assert it produces one of the expected prefixes; the exact value
    // depends on the wall clock, but a recent timestamp must be 'just now'.
    expect(formatRelative(new Date().toISOString())).toBe("just now");
  });
});

describe("isSameDay", () => {
  // isSameDay reads the LOCAL calendar fields (getFullYear/getMonth/getDate),
  // so tests construct dates via the local-time constructor new Date(y,m,d,...)
  // for deterministic results regardless of the runner's timezone. Constructing
  // from UTC instants (new Date('...Z')) would make the assertion TZ-dependent.

  it("is true for the same instant", () => {
    const d = new Date(2025, 5, 18, 15, 30, 0, 0);
    expect(isSameDay(d, new Date(d))).toBe(true);
  });

  it("is true across different hours of the same local calendar day", () => {
    const a = new Date(2025, 5, 18, 0, 0, 0, 0);
    const b = new Date(2025, 5, 18, 23, 59, 59, 999);
    expect(isSameDay(a, b)).toBe(true);
  });

  it("is false across a local-midnight boundary even when <24h apart", () => {
    // 23:59 and 00:01 the next local day are ~2 minutes apart but on different
    // local calendar days.
    const a = new Date(2025, 5, 18, 23, 59, 0, 0);
    const b = new Date(2025, 5, 19, 0, 1, 0, 0);
    expect(isSameDay(a, b)).toBe(false);
  });

  it("is false for different months", () => {
    expect(isSameDay(new Date(2025, 5, 18, 12), new Date(2025, 6, 18, 12))).toBe(false);
  });

  it("is false for different years", () => {
    expect(isSameDay(new Date(2025, 5, 18, 12), new Date(2024, 5, 18, 12))).toBe(false);
  });

  it("is false when only the day-of-month coincides across month/year", () => {
    // Same day-of-month (18) but different month → not the same day.
    expect(isSameDay(new Date(2025, 5, 18, 12), new Date(2025, 6, 18, 12))).toBe(false);
  });
});

describe("groupSessions", () => {
  // Fixed "now" at local noon on 2025-06-18 for deterministic day boundaries.
  const NOW = new Date(2025, 5, 18, 12, 0, 0, 0); // months are 0-indexed

  it("returns [] for an empty input (no noise rows)", () => {
    expect(groupSessions([], NOW)).toEqual([]);
  });

  it("filters out the Older group when all sessions are today", () => {
    const today = session({
      id: "t1",
      updatedAt: new Date(2025, 5, 18, 10, 0, 0, 0).toISOString(),
      createdAt: new Date(2025, 5, 18, 10, 0, 0, 0).toISOString(),
    });
    const groups = groupSessions([today], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Today");
    expect(groups[0]?.items).toEqual([today]);
  });

  it("filters out the Today group when all sessions are older", () => {
    const older = session({
      id: "o1",
      updatedAt: new Date(2025, 5, 10, 10, 0, 0, 0).toISOString(),
      createdAt: new Date(2025, 5, 10, 10, 0, 0, 0).toISOString(),
    });
    const groups = groupSessions([older], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Older");
    expect(groups[0]?.items).toEqual([older]);
  });

  it("returns [Today, Older] (in that order) when both groups are non-empty", () => {
    const today = session({
      id: "t1",
      updatedAt: new Date(2025, 5, 18, 8, 0, 0, 0).toISOString(),
      createdAt: new Date(2025, 5, 18, 8, 0, 0, 0).toISOString(),
    });
    const older = session({
      id: "o1",
      updatedAt: new Date(2025, 5, 17, 8, 0, 0, 0).toISOString(),
      createdAt: new Date(2025, 5, 17, 8, 0, 0, 0).toISOString(),
    });
    const groups = groupSessions([today, older], NOW);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Older"]);
    expect(groups[0]?.items).toEqual([today]);
    expect(groups[1]?.items).toEqual([older]);
  });

  it("preserves the input order within each group (no re-sorting)", () => {
    const t1 = session({ id: "t1", updatedAt: new Date(2025, 5, 18, 8).toISOString() });
    const o1 = session({ id: "o1", updatedAt: new Date(2025, 5, 16, 8).toISOString() });
    const t2 = session({ id: "t2", updatedAt: new Date(2025, 5, 18, 9).toISOString() });
    const o2 = session({ id: "o2", updatedAt: new Date(2025, 5, 15, 8).toISOString() });
    // Input is interleaved; output should preserve per-group relative order.
    const groups = groupSessions([t1, o1, t2, o2], NOW);
    expect(groups[0]?.items.map((s) => s.id)).toEqual(["t1", "t2"]);
    expect(groups[1]?.items.map((s) => s.id)).toEqual(["o1", "o2"]);
  });

  it("partitions by calendar day, not a 24h window (session 5h ago but yesterday → Older)", () => {
    // NOW is local noon 2025-06-18; a session at 23:00 the prior day is 13h ago
    // (still <24h) but on a different calendar day, so it lands in Older.
    const recentButYesterday = session({
      id: "edge",
      updatedAt: new Date(2025, 5, 17, 23, 0, 0, 0).toISOString(),
      createdAt: new Date(2025, 5, 17, 23, 0, 0, 0).toISOString(),
    });
    const groups = groupSessions([recentButYesterday], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Older");
  });

  it("falls back to createdAt when updatedAt is missing/empty", () => {
    // A session persisted before updatedAt was set: createdAt determines the day.
    const onlyCreated = session({
      id: "c1",
      updatedAt: "",
      createdAt: new Date(2025, 5, 18, 6, 0, 0, 0).toISOString(),
    });
    const groups = groupSessions([onlyCreated], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Today");
  });

  it("prefers updatedAt over createdAt when both are present", () => {
    // createdAt is yesterday, updatedAt is today → Today.
    const both = session({
      id: "b1",
      createdAt: new Date(2025, 5, 17, 6, 0, 0, 0).toISOString(),
      updatedAt: new Date(2025, 5, 18, 6, 0, 0, 0).toISOString(),
    });
    const groups = groupSessions([both], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Today");
  });

  it("treats a session whose stamp is exactly at local midnight as Today", () => {
    // Local midnight is the first instant of the calendar day, so it's Today.
    const midnight = session({
      id: "m1",
      updatedAt: new Date(2025, 5, 18, 0, 0, 0, 0).toISOString(),
      createdAt: new Date(2025, 5, 18, 0, 0, 0, 0).toISOString(),
    });
    const groups = groupSessions([midnight], NOW);
    expect(groups[0]?.label).toBe("Today");
  });

  it("uses the wall clock when `now` is omitted (smoke test, no throw)", () => {
    const today = session({ id: "t1" });
    const groups = groupSessions([today]);
    // The fixture's stamp is 2025-06-18; either it lands under Today or Older
    // depending on the real wall clock, but it must not throw and must produce
    // exactly one non-empty group.
    expect(groups).toHaveLength(1);
    expect(["Today", "Older"]).toContain(groups[0]?.label);
  });
});
