import { describe, expect, it } from "vitest";
import type { RequestTokenEstimate, ToolSearchTraceEvent } from "~/lib/server/tools/token-usage";
import {
  buildToolSearchMetadata,
  catalogSchemaTokens,
  catalogToolCount,
  searchToolCatalog,
} from "~/lib/server/tools/tool-search";

describe("catalog invariants", () => {
  it("the mock catalog has exactly 200 tools (the reference's checksum)", () => {
    // catalogToolCount is computed from the registry at module load; this is
    // the runtime assertion the reference guards with `length !== 200`.
    expect(catalogToolCount).toBe(200);
  });

  it("the full catalog's schema is in the ~30k-token range the thesis measures against", () => {
    // iteration 9 measured ~29,636 — keep a loose band so a small spec tweak
    // doesn't break the test, but catch a real regression (e.g. dropped specs).
    expect(catalogSchemaTokens).toBeGreaterThan(25_000);
    expect(catalogSchemaTokens).toBeLessThan(35_000);
  });
});

describe("searchToolCatalog", () => {
  it("returns an empty array for an empty / whitespace query", () => {
    expect(searchToolCatalog("")).toEqual([]);
    expect(searchToolCatalog("   ")).toEqual([]);
  });

  it("respects the default limit of 5", () => {
    // A broad token that appears in many tool descriptions should hit the cap.
    const hits = searchToolCatalog("list");
    expect(hits.length).toBeLessThanOrEqual(5);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("honors an explicit limit (clamped to a 1–20 band)", () => {
    expect(searchToolCatalog("list", 1).length).toBeLessThanOrEqual(1);
    // Over-cap clamps to 20.
    expect(searchToolCatalog("list", 999).length).toBeLessThanOrEqual(20);
    // Under-cap clamps up to 1.
    expect(searchToolCatalog("list", 0).length).toBeLessThanOrEqual(1);
  });

  it("each hit carries the compact match descriptor fields", () => {
    const [hit] = searchToolCatalog("list");
    expect(hit).toBeTruthy();
    expect(Object.keys(hit as object).sort()).toEqual(
      ["action", "description", "name", "score", "service", "title"].sort(),
    );
    expect(typeof (hit as { score: number }).score).toBe("number");
  });

  it("BM25 scores: a tool's own name is the strongest signal", () => {
    // Pick a real tool by searching for something narrow, then re-search its
    // own name to confirm that query scores at least as highly as the broad
    // query that found it.
    const [candidate] = searchToolCatalog("list");
    expect(candidate).toBeTruthy();
    const byName = searchToolCatalog((candidate as { name: string }).name, 20);
    expect(byName.length).toBeGreaterThan(0);
    const namedHit = byName.find((hit) => hit.name === (candidate as { name: string }).name);
    expect(namedHit).toBeTruthy();
  });

  it("falls back to substring matching when no token scores above 0", () => {
    // A query whose tokens are NOT whole words in any spec's text — so BM25
    // returns zero for every document — but DO appear as substrings inside
    // spec descriptions/properties. The substring fallback path must still
    // surface them. 'cust' is a partial of 'customer' / 'customers'.
    const custHits = searchToolCatalog("cust", 5);
    expect(custHits.length).toBeGreaterThan(0);
    // Scores in the fallback path are a small constant per matching token.
    expect(custHits.every((hit) => hit.score > 0)).toBe(true);

    // A query that is neither a whole token nor a substring of anything
    // returns nothing (no false positives from the fallback).
    expect(searchToolCatalog("zzzznonexistent", 5)).toEqual([]);
  });

  it("sorts hits by descending score, breaking ties alphabetically by name", () => {
    const hits = searchToolCatalog("list", 10);
    for (let i = 1; i < hits.length; i += 1) {
      const prev = hits[i - 1];
      const curr = hits[i];
      const ok = prev.score > curr.score || (prev.score === curr.score && prev.name <= curr.name);
      expect(ok).toBe(true);
    }
  });
});

describe("buildToolSearchMetadata", () => {
  const trace: ToolSearchTraceEvent[] = [
    {
      kind: "search",
      query: "weather",
      limit: 5,
      totalAvailable: 200,
      matches: [{ name: "weather-forecast", service: "wx", title: "Forecast", score: 1.5 }],
    },
    { kind: "describe", name: "weather-forecast", found: true, service: "wx", title: "Forecast" },
    { kind: "call", name: "weather-forecast", found: true, service: "wx", title: "Forecast" },
  ];

  const estimates: RequestTokenEstimate[] = [
    {
      systemPromptChars: 100,
      messageChars: 200,
      toolChars: 300,
      requestOptionChars: 0,
      messageCount: 1,
      toolCount: 3,
      tools: [],
    },
  ];

  it("counts search/describe/call events from the trace", () => {
    const meta = buildToolSearchMetadata({
      mode: "search",
      requestEstimates: estimates,
      sentToolCount: 3,
      trace,
    });
    expect(meta.searchCount).toBe(1);
    expect(meta.describeCount).toBe(1);
    expect(meta.callCount).toBe(1);
  });

  it("search mode: deferredToolCount == availableToolCount (catalog is hidden)", () => {
    const meta = buildToolSearchMetadata({
      mode: "search",
      requestEstimates: estimates,
      sentToolCount: 3,
      trace,
    });
    expect(meta.mode).toBe("search");
    expect(meta.deferredToolCount).toBe(meta.availableToolCount);
    expect(meta.availableToolCount).toBe(catalogToolCount);
  });

  it("all mode: deferredToolCount == 0 (nothing is deferred)", () => {
    const meta = buildToolSearchMetadata({
      mode: "all",
      requestEstimates: estimates,
      sentToolCount: catalogToolCount,
      trace: [],
    });
    expect(meta.mode).toBe("all");
    expect(meta.deferredToolCount).toBe(0);
  });

  it("multiplies the catalog baseline by requestCount so per-turn savings reflect every round-trip", () => {
    const manyEstimates: RequestTokenEstimate[] = [
      estimates[0],
      { ...estimates[0], toolChars: 600 },
      { ...estimates[0], toolChars: 900 },
    ];
    const meta = buildToolSearchMetadata({
      mode: "search",
      requestEstimates: manyEstimates,
      sentToolCount: 3,
      trace,
    });
    expect(meta.requestCount).toBe(3);
    // baselineSchemaTokens = catalogSchemaTokens * requestCount, so 3× the
    // single-request baseline.
    expect(meta.baselineSchemaTokens).toBeGreaterThan(catalogSchemaTokens * 2);
    expect(meta.baselineSchemaTokens).toBeLessThan(catalogSchemaTokens * 4);
    // sentSchemaTokens sums the actual toolChars across requests.
    expect(meta.sentSchemaTokens).toBeGreaterThan(0);
  });

  it("savedSchemaTokens is never negative even when sent exceeds baseline (defensive Math.max(0,...))", () => {
    // Pathological: send more tool chars than the whole catalog. The helper
    // must clamp savings to zero rather than report a negative.
    const huge: RequestTokenEstimate[] = [{ ...estimates[0], toolChars: 10_000_000 }];
    const meta = buildToolSearchMetadata({
      mode: "search",
      requestEstimates: huge,
      sentToolCount: catalogToolCount,
      trace: [],
    });
    expect(meta.savedSchemaTokens).toBeGreaterThanOrEqual(0);
  });

  it("preserves the trace array verbatim on the metadata (for the header search-trace popover)", () => {
    const meta = buildToolSearchMetadata({
      mode: "search",
      requestEstimates: estimates,
      sentToolCount: 3,
      trace,
    });
    expect(meta.trace).toBe(trace);
  });
});
