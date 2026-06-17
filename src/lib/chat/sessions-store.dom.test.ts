// @vitest-environment jsdom
//
// DOM-environment tests for the localStorage-backed chat sessions store. The
// store guards every access on `typeof window !== "undefined"` and no-ops in a
// node env, so coverage of its persistence + pub/sub contract requires a DOM
// (jsdom) that supplies `window.localStorage`, `window.addEventListener`, and
// `crypto.randomUUID`. Module-level caches (`cache`, `crossTabWired`,
// `listeners`, the per-session `messageCache`/`messageListeners`) make the
// store stateful across tests, so each test re-imports a FRESH module via
// `vi.resetModules()` + dynamic `import(...)` and clears localStorage in
// beforeEach — otherwise a prior test's cached snapshot would leak in (the
// same in-tab cache-invisibility problem iteration 24 documented for direct
// localStorage writes).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "~/lib/hooks/use-chat-stream";

const importStore = async () => import("~/lib/chat/sessions-store");

const userMsg = (id: string, content = id): ChatMessage => ({
  id,
  role: "user",
  content,
});

const assistantMsg = (id: string, content = id): ChatMessage => ({
  id,
  role: "assistant",
  content,
});

describe("sessions-store (DOM)", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    // Deterministic clock: `new Date().toISOString()` underlies every
    // createdAt/updatedAt stamp, so without a controlled clock two rapid
    // createSession() calls share a millisecond and sort ties are
    // implementation-defined. useFakeTimers lets each test advance time
    // explicitly for ordering-sensitive assertions.
    vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-06-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Advance the controlled clock by `ms` milliseconds. */
  const tick = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));

  // --- snapshot basics -----------------------------------------------------

  it("returns an empty list when nothing is persisted", async () => {
    const { getSessionsSnapshot } = await importStore();
    expect(getSessionsSnapshot()).toEqual([]);
  });

  it("caches the snapshot and returns a referentially-stable reference", async () => {
    const { createSession, getSessionsSnapshot } = await importStore();
    createSession("First");
    const a = getSessionsSnapshot();
    const b = getSessionsSnapshot();
    expect(b).toBe(a); // same reference — useSyncExternalStore relies on this
  });

  // --- create / persist ----------------------------------------------------

  it("createSession persists to localStorage and shows up in the snapshot", async () => {
    const { createSession, getSessionsSnapshot } = await importStore();
    const session = createSession("My chat");
    expect(session.title).toBe("My chat");
    expect(session.titleSource).toBe("auto");
    expect(getSessionsSnapshot()).toHaveLength(1);
    expect(getSessionsSnapshot()[0]).toMatchObject({ id: session.id, title: "My chat" });

    const raw = localStorage.getItem("tanstack-ai-app:sessions");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "[]")).toHaveLength(1);
  });

  it("createSession falls back to the default title for blank/whitespace input", async () => {
    const { createSession } = await importStore();
    expect(createSession("   ").title).toBe("New chat");
    expect(createSession("").title).toBe("New chat");
  });

  it("createSession trims and caps titles at TITLE_MAX", async () => {
    const { createSession, TITLE_MAX } = await importStore();
    const long = "x".repeat(TITLE_MAX + 50);
    expect(createSession(`  ${long}  `).title).toBe("x".repeat(TITLE_MAX));
  });

  it("createSession initializes an empty messages transcript under its key", async () => {
    const { createSession, readMessages } = await importStore();
    const session = createSession();
    expect(readMessages(session.id)).toEqual([]);
    expect(localStorage.getItem(`tanstack-ai-app:messages:${session.id}`)).toBe("[]");
  });

  // --- ordering / touch ----------------------------------------------------

  it("sorts the snapshot newest-updated-first", async () => {
    const { createSession, getSessionsSnapshot, touchSession } = await importStore();
    const first = createSession("first");
    tick(1000);
    const second = createSession("second");
    // createSession stamps createdAt; second is strictly newer so it floats up.
    expect(getSessionsSnapshot().map((s) => s.id)).toEqual([second.id, first.id]);

    // Touch the older one and it should float to the top.
    tick(1000);
    touchSession(first.id);
    expect(getSessionsSnapshot().map((s) => s.id)).toEqual([first.id, second.id]);
  });

  it("touchSession is a no-op for an unknown session id", async () => {
    const { createSession, touchSession, getSessionsSnapshot } = await importStore();
    const session = createSession("only");
    const before = getSessionsSnapshot();
    touchSession("does-not-exist");
    // Unknown id → flush is never called, so the cached snapshot reference is
    // unchanged and the list contents are identical.
    expect(getSessionsSnapshot()).toBe(before);
    expect(getSessionsSnapshot()).toHaveLength(1);
    expect(getSessionsSnapshot()[0].id).toBe(session.id);
  });

  it("getMostRecentSessionId returns the top of the snapshot (null when empty)", async () => {
    const { getMostRecentSessionId, createSession, touchSession } = await importStore();
    expect(getMostRecentSessionId()).toBeNull();
    const a = createSession("a");
    tick(1000);
    const b = createSession("b");
    expect(getMostRecentSessionId()).toBe(b.id);
    tick(1000);
    touchSession(a.id);
    expect(getMostRecentSessionId()).toBe(a.id);
  });

  // --- delete --------------------------------------------------------------

  it("deleteSession removes the summary and its transcript key", async () => {
    const { createSession, deleteSession, getSessionsSnapshot } = await importStore();
    const session = createSession();
    localStorage.setItem(
      `tanstack-ai-app:messages:${session.id}`,
      JSON.stringify([userMsg("m1", "hi")]),
    );

    deleteSession(session.id);
    expect(getSessionsSnapshot()).toEqual([]);
    expect(localStorage.getItem(`tanstack-ai-app:messages:${session.id}`)).toBeNull();
  });

  // --- rename / title provenance ------------------------------------------

  it("renameSession marks the title as 'manual' and is respected", async () => {
    const { createSession, renameSession, getSessionsSnapshot } = await importStore();
    const session = createSession("auto");
    renameSession(session.id, "Renamed by user");
    const updated = getSessionsSnapshot().find((s) => s.id === session.id);
    expect(updated?.title).toBe("Renamed by user");
    expect(updated?.titleSource).toBe("manual");
  });

  it("renameSession ignores blank / whitespace-only input", async () => {
    const { createSession, renameSession, getSession } = await importStore();
    const session = createSession("keepme");
    renameSession(session.id, "   ");
    expect(getSession(session.id)?.title).toBe("keepme");
    expect(getSession(session.id)?.titleSource).toBe("auto");
  });

  it("setSessionTitleFromMessage upgrades an auto title and normalizes whitespace", async () => {
    const { createSession, setSessionTitleFromMessage, getSession } = await importStore();
    const session = createSession();
    setSessionTitleFromMessage(session.id, "  hello\n\nworld  ");
    expect(getSession(session.id)?.title).toBe("hello world");
    expect(getSession(session.id)?.titleSource).toBe("auto");
  });

  it("setSessionTitleFromMessage truncates over-long text with an ellipsis", async () => {
    const { createSession, setSessionTitleFromMessage, getSession, TITLE_MAX } =
      await importStore();
    const session = createSession();
    const long = "y".repeat(TITLE_MAX + 40);
    setSessionTitleFromMessage(session.id, long);
    const title = getSession(session.id)?.title ?? "";
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBe(TITLE_MAX);
  });

  it("setSessionTitleFromMessage never clobbers a manual rename", async () => {
    const { createSession, renameSession, setSessionTitleFromMessage, getSession } =
      await importStore();
    const session = createSession();
    renameSession(session.id, "Manual");
    setSessionTitleFromMessage(session.id, "should not apply");
    expect(getSession(session.id)?.title).toBe("Manual");
    expect(getSession(session.id)?.titleSource).toBe("manual");
  });

  it("setGeneratedSessionTitle upgrades an auto title to 'generated'", async () => {
    const { createSession, setGeneratedSessionTitle, getSession } = await importStore();
    const session = createSession();
    setGeneratedSessionTitle(session.id, "Ocean Haiku");
    expect(getSession(session.id)?.title).toBe("Ocean Haiku");
    expect(getSession(session.id)?.titleSource).toBe("generated");
  });

  it("setGeneratedSessionTitle never overwrites a manual or prior generated title", async () => {
    const { createSession, renameSession, setGeneratedSessionTitle, getSession } =
      await importStore();
    const session = createSession();
    // 'generated' upgrades 'auto' once…
    setGeneratedSessionTitle(session.id, "First AI title");
    expect(getSession(session.id)?.titleSource).toBe("generated");
    // …but a second generated title must NOT replace the first.
    setGeneratedSessionTitle(session.id, "Second AI title");
    expect(getSession(session.id)?.title).toBe("First AI title");

    // And a manual rename blocks any later generated title.
    renameSession(session.id, "Manual");
    setGeneratedSessionTitle(session.id, "Third AI title");
    expect(getSession(session.id)?.title).toBe("Manual");
    expect(getSession(session.id)?.titleSource).toBe("manual");
  });

  it("a legacy session (titleSource undefined) is treated as overridable 'auto'", async () => {
    const { getSessionsSnapshot, setGeneratedSessionTitle, getSession } = await importStore();
    // Inject a legacy session lacking titleSource directly, then force a cache
    // bust by clearing the key + re-reading through a create (which flushes).
    const legacy = {
      id: "legacy-1",
      title: "Legacy",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    localStorage.setItem("tanstack-ai-app:sessions", JSON.stringify([legacy]));
    // Bypass the in-memory cache: force a snapshot read by creating then
    // deleting a throwaway session (flush nulls the cache each time).
    const { createSession, deleteSession } = await importStore();
    const tmp = createSession("tmp");
    deleteSession(tmp.id);
    expect(getSessionsSnapshot()).toHaveLength(1);
    setGeneratedSessionTitle("legacy-1", "Upgraded");
    expect(getSession("legacy-1")?.title).toBe("Upgraded");
    expect(getSession("legacy-1")?.titleSource).toBe("generated");
  });

  // --- message transcript pub/sub -----------------------------------------

  it("readMessages returns an empty list for a session with no transcript", async () => {
    const { readMessages } = await importStore();
    expect(readMessages("nope")).toEqual([]);
  });

  it("writeMessages persists and re-reads the transcript", async () => {
    const { writeMessages, readMessages } = await importStore();
    const messages = [userMsg("u1", "hello"), assistantMsg("a1", "hi there")];
    writeMessages("s1", messages);
    expect(readMessages("s1")).toEqual(messages);
  });

  it("writeMessages filters out malformed entries on re-read", async () => {
    const { writeMessages } = await importStore();
    writeMessages("s1", [userMsg("u1"), assistantMsg("a1")]);
    // Corrupt the persisted blob with a malformed entry.
    const key = "tanstack-ai-app:messages:s1";
    const existing = JSON.parse(localStorage.getItem(key) ?? "[]");
    localStorage.setItem(
      key,
      JSON.stringify([...existing, { nope: true }, { id: 5, role: "x", content: 1 }]),
    );
    // readMessages bypasses the cache only via notify; force a fresh module to
    // drop messageCache, mirroring a cold load.
    vi.resetModules();
    const fresh = await importStore();
    expect(fresh.readMessages("s1")).toEqual([userMsg("u1"), assistantMsg("a1")]);
  });

  it("subscribeMessages fires when writeMessages lands for that session", async () => {
    const { createSession, writeMessages, subscribeMessages, getMessagesSnapshot } =
      await importStore();
    const session = createSession();
    let calls = 0;
    const unsubscribe = subscribeMessages(session.id, () => {
      calls += 1;
    });

    writeMessages(session.id, [userMsg("u1")]);
    expect(calls).toBe(1);
    expect(getMessagesSnapshot(session.id)).toEqual([userMsg("u1")]);

    // A write to a DIFFERENT session does not notify this subscriber.
    const other = createSession();
    writeMessages(other.id, [userMsg("other")]);
    expect(calls).toBe(1);

    unsubscribe();
    writeMessages(session.id, [userMsg("u2")]);
    expect(calls).toBe(1); // unsubscribed — no further notifications
  });

  it("getMessagesSnapshot returns a referentially-stable reference until the next write", async () => {
    const { createSession, writeMessages, subscribeMessages, getMessagesSnapshot } =
      await importStore();
    const session = createSession();
    writeMessages(session.id, [userMsg("u1")]);
    const a = getMessagesSnapshot(session.id);
    const b = getMessagesSnapshot(session.id);
    expect(b).toBe(a); // cached
    writeMessages(session.id, [userMsg("u1"), userMsg("u2")]);
    // subscribe so the notify path runs (mirrors the real hook).
    subscribeMessages(session.id, () => {});
    writeMessages(session.id, [userMsg("u1"), userMsg("u2"), userMsg("u3")]);
    const c = getMessagesSnapshot(session.id);
    expect(c).not.toBe(a); // cache was invalidated + repopulated
    expect(c.map((m) => m.id)).toEqual(["u1", "u2", "u3"]);
  });

  // --- sessions pub/sub ----------------------------------------------------

  it("subscribeSessions fires on create/delete/rename", async () => {
    const { createSession, deleteSession, renameSession, subscribeSessions, getSessionsSnapshot } =
      await importStore();
    const events: number[] = [];
    const unsubscribe = subscribeSessions(() => events.push(events.length));
    const session = createSession("one");
    renameSession(session.id, "renamed");
    deleteSession(session.id);
    unsubscribe();
    const after = createSession("after-unsubscribe"); // not observed
    expect(events.length).toBe(3);
    // The unsubscribed listener did not fire, but the session still landed.
    expect(getSessionsSnapshot()).toHaveLength(1);
    expect(getSessionsSnapshot()[0]).toMatchObject({ id: after.id, title: "after-unsubscribe" });
  });

  it("unsubscribe removes the listener (no double-fire)", async () => {
    const { createSession, subscribeSessions } = await importStore();
    let calls = 0;
    const unsubscribe = subscribeSessions(() => {
      calls += 1;
    });
    createSession("a");
    unsubscribe();
    createSession("b");
    expect(calls).toBe(1);
  });

  // --- cross-tab storage event --------------------------------------------

  it("invalidates the cache on a cross-tab storage event for the sessions key", async () => {
    const { getSessionsSnapshot } = await importStore();
    expect(getSessionsSnapshot()).toEqual([]); // primes the cache
    // Simulate another tab writing a session.
    const external = [
      {
        id: "ext-1",
        title: "From another tab",
        titleSource: "auto",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    ];
    localStorage.setItem("tanstack-ai-app:sessions", JSON.stringify(external));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "tanstack-ai-app:sessions",
        newValue: JSON.stringify(external),
      }),
    );
    expect(getSessionsSnapshot()).toHaveLength(1);
    expect(getSessionsSnapshot()[0].id).toBe("ext-1");
  });

  it("forwards a per-session messages storage event to that session's subscribers", async () => {
    const { subscribeMessages } = await importStore();
    let calls = 0;
    subscribeMessages("cross-tab-session", () => {
      calls += 1;
    });
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "tanstack-ai-app:messages:cross-tab-session",
        newValue: "[]",
      }),
    );
    expect(calls).toBe(1);
    // An unrelated key does not notify.
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "tanstack-ai-app:messages:other",
        newValue: "[]",
      }),
    );
    expect(calls).toBe(1);
  });

  it("a null key storage event (clear()) invalidates the sessions cache", async () => {
    const { createSession, getSessionsSnapshot } = await importStore();
    createSession("one");
    expect(getSessionsSnapshot()).toHaveLength(1);
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null, newValue: null }));
    expect(getSessionsSnapshot()).toEqual([]);
  });
});
