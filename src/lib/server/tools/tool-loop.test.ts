import { describe, expect, it } from "vitest";
import { mockToolCount } from "~/lib/server/tools/mock-tools";
import type { ToolExposureMode } from "~/lib/server/tools/token-usage";
import { sentToolCountForMode } from "~/lib/server/tools/tool-loop";

describe("sentToolCountForMode", () => {
  it("counts the 3 bridge tools in search mode (the deferred-tool-search thesis)", () => {
    expect(sentToolCountForMode("search")).toBe(3);
  });

  it("counts every catalog tool in all mode (the token-cost baseline)", () => {
    expect(sentToolCountForMode("all")).toBe(mockToolCount);
    expect(sentToolCountForMode("all")).toBe(200);
  });

  it("counts zero tools in none mode (plain streaming, no tool loop)", () => {
    expect(sentToolCountForMode("none")).toBe(0);
  });

  it("adds the extras count to the mode's base count", () => {
    // Skill tools ride alongside the bridge/catalog; the header must reflect
    // what the model actually sees this turn.
    expect(sentToolCountForMode("search", 2)).toBe(5);
    expect(sentToolCountForMode("all", 2)).toBe(mockToolCount + 2);
    expect(sentToolCountForMode("none", 2)).toBe(2);
  });

  it("treats extrasCount=0 the same as omitting it (the default)", () => {
    const modes: ToolExposureMode[] = ["search", "all", "none"];
    for (const mode of modes) {
      expect(sentToolCountForMode(mode)).toBe(sentToolCountForMode(mode, 0));
    }
  });

  it("preserves the search < all ordering the verification contract depends on", () => {
    // The deferred-vs-all savings thesis is only observable if all > search.
    expect(sentToolCountForMode("all")).toBeGreaterThan(sentToolCountForMode("search"));
    expect(sentToolCountForMode("none")).toBeLessThan(sentToolCountForMode("search"));
  });

  it("is additive across all three modes with the same extras count", () => {
    // A 2-tool skill snapshot adds 2 regardless of mode.
    expect(sentToolCountForMode("search", 2) - sentToolCountForMode("search")).toBe(2);
    expect(sentToolCountForMode("all", 2) - sentToolCountForMode("all")).toBe(2);
    expect(sentToolCountForMode("none", 2) - sentToolCountForMode("none")).toBe(2);
  });
});
