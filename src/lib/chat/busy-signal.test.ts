// @vitest-environment node
//
// The busy-signal is a tiny process-wide pub/sub: a single boolean `current`
// flag plus a listener Set, all held at module scope. These tests pin its
// contract (the no-op-on-identical-value guard, change-driven notification,
// unsubscribe semantics, and multi-subscriber fan-out) because it is the bridge
// that lets the root-level AppSidebar mirror the per-session ChatShellProvider's
// streaming flag and apply the reference's three chatBusy guards (new chat /
// select session / delete active are disabled mid-stream). Module-level state
// survives across tests, so each test registers its subscriptions through a
// tracked helper whose afterEach drains them, and beforeEach/afterEach reset the
// flag back to its default false so one test's terminal value can't leak.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getChatBusySnapshot, setChatBusySignal, subscribeChatBusy } from "~/lib/chat/busy-signal";

describe("busy-signal", () => {
  // Track every subscription made inside a test so afterEach can drain them
  // all (otherwise a listener added in an earlier test would receive the
  // afterEach reset's notification and pollute later assertions).
  const unsubs: Array<() => void> = [];

  /** subscribeChatBusy that auto-records its unsubscribe for afterEach cleanup. */
  function track(listener: () => void): () => void {
    const unsub = subscribeChatBusy(listener);
    unsubs.push(unsub);
    return unsub;
  }

  beforeEach(() => {
    // Reset the process-wide flag to its default before each test.
    setChatBusySignal(false);
  });

  afterEach(() => {
    while (unsubs.length > 0) {
      unsubs.pop()?.();
    }
    // Reset again so a test that ended on `true` can't leak into the next.
    setChatBusySignal(false);
  });

  describe("getChatBusySnapshot", () => {
    it("returns false by default", () => {
      expect(getChatBusySnapshot()).toBe(false);
    });

    it("reflects the most recent setChatBusySignal value", () => {
      setChatBusySignal(true);
      expect(getChatBusySnapshot()).toBe(true);
      setChatBusySignal(false);
      expect(getChatBusySnapshot()).toBe(false);
      setChatBusySignal(true);
      expect(getChatBusySnapshot()).toBe(true);
    });
  });

  describe("setChatBusySignal", () => {
    it("no-ops on an identical value without notifying subscribers", () => {
      // current is already false (beforeEach); re-asserting false must not fire.
      const listener = vi.fn();
      track(listener);
      setChatBusySignal(false);
      expect(listener).not.toHaveBeenCalled();
    });

    it("no-ops when re-asserting the current true value", () => {
      const listener = vi.fn();
      track(listener);
      setChatBusySignal(true);
      expect(listener).toHaveBeenCalledTimes(1);
      setChatBusySignal(true); // identical — no further notification
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("notifies subscribers on every real true↔false transition", () => {
      const listener = vi.fn();
      track(listener);
      setChatBusySignal(true);
      setChatBusySignal(false);
      setChatBusySignal(true);
      setChatBusySignal(false);
      expect(listener).toHaveBeenCalledTimes(4);
    });

    it("updates the snapshot synchronously before notifying (snapshot reads new value inside the listener)", () => {
      let seenInsideListener: boolean | null = null;
      track(() => {
        seenInsideListener = getChatBusySnapshot();
      });
      setChatBusySignal(true);
      expect(seenInsideListener).toBe(true);
    });
  });

  describe("subscribeChatBusy", () => {
    it("returns an unsubscribe function", () => {
      const unsub = subscribeChatBusy(() => {});
      expect(typeof unsub).toBe("function");
      unsub();
    });

    it("fires the listener only on a real change", () => {
      const listener = vi.fn();
      track(listener);
      setChatBusySignal(true); // change → fire
      setChatBusySignal(true); // no change → no fire
      setChatBusySignal(false); // change → fire
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it("stops notifying after unsubscribe", () => {
      const listener = vi.fn();
      const unsub = track(listener);
      unsub();
      setChatBusySignal(true);
      setChatBusySignal(false);
      expect(listener).not.toHaveBeenCalled();
    });

    it("notifies multiple independent subscribers", () => {
      const a = vi.fn();
      const b = vi.fn();
      track(a);
      track(b);
      setChatBusySignal(true);
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it("keeps notifying remaining subscribers after one unsubscribes", () => {
      const a = vi.fn();
      const b = vi.fn();
      const unsubA = track(a);
      track(b);
      unsubA();
      setChatBusySignal(true);
      expect(a).not.toHaveBeenCalled();
      expect(b).toHaveBeenCalledTimes(1);
    });

    it("is safe to call unsubscribe more than once (Set.delete is idempotent)", () => {
      const listener = vi.fn();
      const unsub = subscribeChatBusy(listener);
      unsub();
      unsub();
      unsub();
      setChatBusySignal(true);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("useSyncExternalStore contract", () => {
    // The hook (use-chat-busy) wires getChatBusySnapshot as both the
    // client + server snapshot and subscribeChatBusy as the subscription.
    // Pin the three pieces' interaction directly so a future refactor of the
    // signal can't silently break React's store subscription.

    it("snapshot is referentially stable for primitives (boolean reads compare by value)", () => {
      // Booleans are primitives; useSyncExternalStore re-renders only when the
      // snapshot value changes, so two reads at the same flag are === .
      setChatBusySignal(true);
      const first = getChatBusySnapshot();
      const second = getChatBusySnapshot();
      expect(first).toBe(second);
      expect(first).toBe(true);
    });

    it("subscribe returns a fn that, when invoked, produces no further notifications", () => {
      let count = 0;
      const unsub = subscribeChatBusy(() => {
        count++;
      });
      setChatBusySignal(true);
      expect(count).toBe(1);
      unsub();
      setChatBusySignal(false);
      setChatBusySignal(true);
      expect(count).toBe(1); // unchanged after unsubscribe
    });
  });
});
