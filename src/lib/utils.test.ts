import { clsx } from "clsx";
import { describe, expect, it } from "vitest";

import { cn, isUuid, UUID_PATTERN } from "~/lib/utils";

/** Split a className string into a Set so order-insensitive assertions survive
 *  tailwind-merge's class reordering. */
function classSet(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter(Boolean));
}

describe("UUID_PATTERN", () => {
  it("is a RegExp with the case-insensitive flag", () => {
    expect(UUID_PATTERN).toBeInstanceOf(RegExp);
    expect(UUID_PATTERN.flags).toContain("i");
  });

  it("is anchored (no partial matches inside a larger string)", () => {
    // A valid UUID surrounded by extra characters must NOT match.
    const valid = "550e8400-e29b-41d4-a716-446655440000";
    expect(UUID_PATTERN.test(`prefix ${valid}`)).toBe(false);
    expect(UUID_PATTERN.test(`${valid} suffix`)).toBe(false);
  });
});

describe("isUuid", () => {
  it("accepts a canonical lowercase UUID", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("accepts an uppercase UUID (the pattern is case-insensitive)", () => {
    expect(isUuid("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });

  it("accepts a mixed-case UUID", () => {
    expect(isUuid("550e8400-E29b-41D4-A716-446655440000")).toBe(true);
  });

  it("accepts the all-zeros UUID", () => {
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
  });

  it("accepts the all-fs UUID", () => {
    expect(isUuid("ffffffff-ffff-ffff-ffff-ffffffffffff")).toBe(true);
  });

  it("rejects the empty string", () => {
    expect(isUuid("")).toBe(false);
  });

  it("rejects an arbitrary non-UUID string", () => {
    expect(isUuid("hello")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
  });

  it("rejects a UUID missing a segment", () => {
    expect(isUuid("e29b-41d4-a716-446655440000")).toBe(false);
  });

  it("rejects a UUID with a wrong-length segment", () => {
    // First segment is 7 hex chars instead of 8.
    expect(isUuid("550e840-e29b-41d4-a716-446655440000")).toBe(false);
    // Last segment is 11 hex chars instead of 12.
    expect(isUuid("550e8400-e29b-41d4-a716-44665544000")).toBe(false);
  });

  it("rejects a UUID with non-hex characters", () => {
    // 'g' is not a hex digit.
    expect(isUuid("550g8400-e29b-41d4-a716-446655440000")).toBe(false);
  });

  it("rejects a UUID missing hyphens", () => {
    expect(isUuid("550e8400e29b41d4a716446655440000")).toBe(false);
  });

  it("rejects a UUID with extra surrounding whitespace", () => {
    const valid = "550e8400-e29b-41d4-a716-446655440000";
    expect(isUuid(` ${valid}`)).toBe(false);
    expect(isUuid(`${valid} `)).toBe(false);
    expect(isUuid(`\t${valid}\n`)).toBe(false);
  });

  it("rejects a UUID with uppercase hex but wrong hyphenation", () => {
    expect(isUuid("550E8400E29B41D4A716446655440000")).toBe(false);
  });
});

describe("cn", () => {
  it("returns an empty string for no inputs", () => {
    expect(cn()).toBe("");
  });

  it("joins multiple plain string classes with a single space", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("passes a single class through unchanged", () => {
    expect(cn("only")).toBe("only");
  });

  it("drops falsy values (false, null, undefined, 0, empty string)", () => {
    expect(cn("a", false, null, undefined, 0, "", "b")).toBe("a b");
  });

  it("accepts arrays (clsx feature)", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("accepts conditional objects (clsx feature)", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });

  it("combines strings, arrays, and conditional objects", () => {
    expect(cn("base", ["x", "y"], { z: true, w: false })).toBe("base x y z");
  });

  it("delegates to tailwind-merge: later conflicting utility wins", () => {
    // px-2 and px-4 are both padding-x; the later px-4 must win and px-2 drop.
    const result = cn("px-2", "px-4");
    expect(classSet(result)).toEqual(new Set(["px-4"]));
  });

  it("keeps non-conflicting utilities while resolving conflicts", () => {
    // py-2 and m-2 don't conflict with px-*; only the px-* pair collapses.
    const result = cn("px-2 py-2 m-2", "px-4");
    expect(classSet(result)).toEqual(new Set(["py-2", "m-2", "px-4"]));
  });

  it("resolves font-size conflicts across class groups", () => {
    const result = cn("text-sm", "text-lg");
    expect(classSet(result)).toEqual(new Set(["text-lg"]));
  });

  it("resolves conflicts while preserving unrelated classes from the same arg", () => {
    // text-sm (font-size) conflicts with text-lg; text-red-500 (color) does not.
    const result = cn("text-sm text-red-500", "text-lg");
    expect(classSet(result)).toEqual(new Set(["text-red-500", "text-lg"]));
  });

  it("produces output equivalent to clsx when there are no tailwind conflicts", () => {
    // cn = twMerge(clsx(...)); with no mergeable conflicts the output matches clsx.
    expect(cn("flex", "items-center", "gap-2")).toBe(clsx("flex", "items-center", "gap-2"));
  });

  it("handles a large conditional mix without dropping truthy classes", () => {
    const isActive = true;
    const isDisabled = false;
    const result = cn(
      "inline-flex items-center justify-center",
      isActive && "bg-primary text-primary-foreground",
      isDisabled && "opacity-50",
      "rounded-md",
    );
    expect(classSet(result)).toEqual(
      new Set([
        "inline-flex",
        "items-center",
        "justify-center",
        "bg-primary",
        "text-primary-foreground",
        "rounded-md",
      ]),
    );
  });

  it("returns an empty string when every input is falsy", () => {
    expect(cn(false, null, undefined, 0, "", [])).toBe("");
  });
});
