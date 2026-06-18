// Unit tests for the pure display helpers backing the inline tool-trace panel,
// extracted from src/components/chat/tool-trace-panel.tsx (iteration 59) so
// the status → icon+className mapping and the arguments-preview formatter are
// unit-testable without a React/DOM harness — mirroring the sidebar-grouping
// (iteration 56) and chat-route-helpers (iteration 58) extraction pattern.
import { CircleCheck, CircleX, Loader } from "lucide-react";
import { describe, expect, it } from "vitest";

import { formatArgsPreview, statusVisual } from "~/lib/chat/tool-trace-display";

describe("statusVisual", () => {
  it("maps ok → CircleCheck + emerald class", () => {
    const result = statusVisual("ok");
    expect(result.Icon).toBe(CircleCheck);
    expect(result.className).toBe("text-emerald-500");
  });

  it("maps error → CircleX + destructive class", () => {
    const result = statusVisual("error");
    expect(result.Icon).toBe(CircleX);
    expect(result.className).toBe("text-destructive");
  });

  it("maps running → Loader + primary class with animate-spin", () => {
    const result = statusVisual("running");
    expect(result.Icon).toBe(Loader);
    // lucide-react has no spin prop (iteration 11); spin must come from a class.
    expect(result.className).toBe("text-primary animate-spin");
    expect(result.className).toContain("animate-spin");
  });

  it("returns a distinct className per status (no overlap)", () => {
    const classNames = new Set([
      statusVisual("ok").className,
      statusVisual("error").className,
      statusVisual("running").className,
    ]);
    expect(classNames.size).toBe(3);
  });

  it("returns a distinct icon component per status", () => {
    const icons = new Set([
      statusVisual("ok").Icon,
      statusVisual("error").Icon,
      statusVisual("running").Icon,
    ]);
    expect(icons.size).toBe(3);
  });
});

describe("formatArgsPreview", () => {
  it("returns null for undefined", () => {
    expect(formatArgsPreview(undefined)).toBeNull();
  });

  it("returns null for null", () => {
    expect(formatArgsPreview(null)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(formatArgsPreview("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(formatArgsPreview("   \n\t  ")).toBeNull();
  });

  it("returns null for an empty object ({})", () => {
    expect(formatArgsPreview({})).toBeNull();
  });

  it('returns null for a stringified "{}"', () => {
    // A string literally containing "{}" trims to "{}" → suppressed.
    expect(formatArgsPreview("{}")).toBeNull();
  });

  it("returns null for a stringified empty object with whitespace", () => {
    expect(formatArgsPreview("{ }")).not.toBeNull();
    // "{ }" is not equal to "{}" after trim, so it survives — pinned so a future
    // trim-aware normalization doesn't silently drop it.
    expect(formatArgsPreview("{ }")).toBe("{ }");
  });

  it("passes a simple non-empty string through (trimmed)", () => {
    expect(formatArgsPreview("  hello world  ")).toBe("hello world");
  });

  it("JSON-stringifies an object argument", () => {
    expect(formatArgsPreview({ query: "weather", limit: 5 })).toBe('{"query":"weather","limit":5}');
  });

  it("JSON-stringifies an array argument", () => {
    expect(formatArgsPreview(["a", "b", "c"])).toBe('["a","b","c"]');
  });

  it("JSON-stringifies a number argument", () => {
    expect(formatArgsPreview(42)).toBe("42");
  });

  it("JSON-stringifies a boolean argument", () => {
    expect(formatArgsPreview(true)).toBe("true");
  });

  it("falls back to String(args) when JSON.stringify throws (circular ref)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    // JSON.stringify throws on circular refs; String() yields "[object Object]".
    const result = formatArgsPreview(circular);
    expect(result).toBe(String(circular));
  });

  it("collapses multi-line/whitespace-heavy args to a single line", () => {
    const result = formatArgsPreview("line one\n  line two\t\tline three");
    expect(result).toBe("line one line two line three");
    expect(result).not.toContain("\n");
    expect(result).not.toContain("\t");
  });

  it("truncates long args to the default 140-char cap with an ellipsis", () => {
    const long = "x".repeat(300);
    const result = formatArgsPreview(long);
    expect(result).toHaveLength(140);
    expect(result?.endsWith("…")).toBe(true);
    expect(result?.startsWith("x")).toBe(true);
  });

  it("honors an explicit max cap", () => {
    const long = "abcdefgh".repeat(10); // 80 chars
    const result = formatArgsPreview(long, 20);
    expect(result).toHaveLength(20);
    expect(result?.endsWith("…")).toBe(true);
  });

  it("does not add an ellipsis when under the cap", () => {
    const result = formatArgsPreview("short", 140);
    expect(result).toBe("short");
    expect(result?.includes("…")).toBe(false);
  });

  it("truncates at exactly max-1 chars before the ellipsis (cap = 140 → 139 chars + …)", () => {
    const long = "y".repeat(300);
    const result = formatArgsPreview(long, 140);
    expect(result).toBe(`${"y".repeat(139)}…`);
  });

  it("treats a single-line collapse + truncation together for object args", () => {
    // Object with nested whitespace gets stringified (no inner newlines from
    // JSON.stringify anyway) and is well under the cap.
    const result = formatArgsPreview({ a: 1 });
    expect(result).toBe('{"a":1}');
  });
});
