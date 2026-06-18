import { describe, expect, it } from "vitest";

import { messageContentClassName } from "~/lib/chat/message-display";

describe("messageContentClassName", () => {
  it("shares the same inner padding + text metrics for both senders", () => {
    const shared = "px-4 py-3 text-sm leading-6";
    expect(messageContentClassName("user")).toContain(shared);
    expect(messageContentClassName("assistant")).toContain(shared);
  });

  it("gives the user turn a primary-colored bubble capped at 82% width", () => {
    const cls = messageContentClassName("user");
    const classes = new Set(cls.split(/\s+/));
    expect(classes.has("bg-primary")).toBe(true);
    expect(classes.has("text-primary-foreground")).toBe(true);
    expect(classes.has("rounded-lg")).toBe(true);
    expect(cls).toContain("max-w-[min(46rem,82%)]");
    // User input is plain text — whitespace must be preserved.
    expect(classes.has("whitespace-pre-wrap")).toBe(true);
    expect(classes.has("break-words")).toBe(true);
  });

  it("renders the assistant turn as borderless text (the modern chat-app pattern)", () => {
    const cls = messageContentClassName("assistant");
    const classes = new Set(cls.split(/\s+/));
    expect(classes.has("text-card-foreground")).toBe(true);
    // No bubble chrome on the assistant turn.
    expect(classes.has("bg-card")).toBe(false);
    expect(classes.has("bg-primary")).toBe(false);
    expect(classes.has("rounded-lg")).toBe(false);
    expect(classes.has("rounded-2xl")).toBe(false);
    expect(classes.has("shadow-sm")).toBe(false);
    expect(cls).toContain("max-w-[min(72rem,100%)]");
  });

  it("does not apply whitespace-pre-wrap to the assistant turn (markdown owns its own formatting)", () => {
    expect(messageContentClassName("assistant")).not.toContain("whitespace-pre-wrap");
    expect(messageContentClassName("assistant")).not.toContain("break-words");
  });

  it("produces distinct class strings for user vs assistant", () => {
    expect(messageContentClassName("user")).not.toBe(messageContentClassName("assistant"));
  });

  it("is deterministic (same sender → same string)", () => {
    expect(messageContentClassName("user")).toBe(messageContentClassName("user"));
    expect(messageContentClassName("assistant")).toBe(messageContentClassName("assistant"));
  });

  it("returns a non-empty trimmed string for both senders", () => {
    for (const sender of ["user", "assistant"] as const) {
      const cls = messageContentClassName(sender);
      expect(cls.trim()).toBe(cls);
      expect(cls.length).toBeGreaterThan(0);
    }
  });
});
