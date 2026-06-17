import { describe, expect, it } from "vitest";

import { appendNewMessagesById, dedupeMessagesById } from "~/lib/chat/messages";

const msg = (id: string, content = id) => ({ id, content, role: "assistant" as const });

describe("dedupeMessagesById", () => {
  it("returns an empty array (filter always allocates; no same-ref contract)", () => {
    expect(dedupeMessagesById([])).toEqual([]);
    // Unlike appendNewMessagesById (which bails out with the same reference),
    // dedupe uses .filter() and so may return a fresh array even when empty.
    const singleton = [msg("a")];
    expect(dedupeMessagesById(singleton)).toEqual(singleton);
  });

  it("keeps the first occurrence of each id and drops later duplicates", () => {
    const a = msg("a");
    const b = msg("b");
    const aDup = { ...msg("a"), content: "dup" };
    expect(dedupeMessagesById([a, b, aDup])).toEqual([a, b]);
  });

  it("preserves the original order of first occurrences", () => {
    expect(
      dedupeMessagesById([msg("c"), msg("a"), msg("c"), msg("b"), msg("a")]).map((m) => m.id),
    ).toEqual(["c", "a", "b"]);
  });

  it("returns an array with unique ids as-is (value-equal, not same ref)", () => {
    const a = msg("a");
    const b = msg("b");
    // No duplicates, but the helper still builds a new array via filter —
    // verify the contents are unchanged.
    expect(dedupeMessagesById([a, b])).toEqual([a, b]);
  });
});

describe("appendNewMessagesById", () => {
  it("returns the same `current` reference when nothing new is added", () => {
    const current = [msg("a"), msg("b")];
    expect(appendNewMessagesById(current, [msg("a"), msg("b")])).toBe(current);
  });

  it("returns the same `current` reference for empty incoming", () => {
    const current = [msg("a")];
    expect(appendNewMessagesById(current, [])).toBe(current);
  });

  it("appends only ids not already present, preserving incoming order", () => {
    const current = [msg("a")];
    expect(appendNewMessagesById(current, [msg("a"), msg("c"), msg("b")])).toEqual([
      msg("a"),
      msg("c"),
      msg("b"),
    ]);
  });

  it("appends every incoming id when current is empty", () => {
    expect(appendNewMessagesById([], [msg("x"), msg("y")])).toEqual([msg("x"), msg("y")]);
  });

  it("skips incoming items without an id", () => {
    const current = [msg("a")];
    const noId = { content: "nope" } as unknown as ReturnType<typeof msg>;
    expect(appendNewMessagesById(current, [noId, msg("b")])).toEqual([msg("a"), msg("b")]);
  });
});
