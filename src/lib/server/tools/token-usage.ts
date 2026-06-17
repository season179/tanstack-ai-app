/**
 * Minimal token-estimation + tool-search trace types, ported from the
 * reference's lib/token-usage.ts. Only the subset the deferred tool-search
 * bridge needs lives here; the full TokenUsage/breakdown machinery (input /
 * output token accounting, category allocation) is deferred to the iteration
 * that wires the bridge into the chat UI. Everything here is pure.
 */

/**
 * Metadata-level exposure mode: `search` sends only the 3-tool bridge,
 * `all` sends every catalog tool. `none` never reaches metadata because the
 * chat loop is skipped entirely; it lives on ToolExposureMode instead.
 */
export type ToolSearchMode = "all" | "search";

/**
 * Decision-level exposure mode resolved from TOOL_EXPOSURE_MODE. `none`
 * disables the tool loop entirely (plain streaming, the safe baseline);
 * `search`/`all` match ToolSearchMode and run the deferred bridge loop.
 */
export type ToolExposureMode = "none" | ToolSearchMode;

export type ToolSearchMatch = {
  name: string;
  title: string;
  service: string;
  score: number;
};

export type ToolSearchTraceEvent =
  | {
      kind: "search";
      query: string;
      limit: number;
      totalAvailable: number;
      matches: ToolSearchMatch[];
    }
  | {
      kind: "describe";
      name: string;
      found: boolean;
      title?: string;
      service?: string;
    }
  | {
      kind: "call";
      name: string;
      found: boolean;
      title?: string;
      service?: string;
      action?: string;
    };

/**
 * Per-request schema-cost estimate. Only `toolChars` is consumed by the bridge
 * today (to compute deferred vs. all-tools token savings); the richer fields
 * arrive when the chat loop measures each upstream request body.
 */
export type RequestTokenEstimate = {
  toolChars: number;
};

export type ToolSearchMetadata = {
  mode: ToolSearchMode;
  availableToolCount: number;
  sentToolCount: number;
  deferredToolCount: number;
  requestCount: number;
  catalogSchemaTokens: number;
  sentSchemaTokens: number;
  baselineSchemaTokens: number;
  savedSchemaTokens: number;
  searchCount: number;
  describeCount: number;
  callCount: number;
  trace: ToolSearchTraceEvent[];
};

/**
 * Resolve the tool exposure mode from an env value. Defaults to `search`
 * (the reference's thesis: the model sees only the bridge). `all` exposes
 * every catalog tool; `none`/`off` disables the tool loop entirely so the
 * chat falls back to plain streaming without function-calling.
 */
export function resolveToolExposureMode(value: string | undefined): ToolExposureMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "all") {
    return "all";
  }
  if (normalized === "none" || normalized === "off") {
    return "none";
  }
  return "search";
}

export function estimateTokensFromChars(chars: number) {
  if (chars <= 0) {
    return 0;
  }

  return Math.max(1, Math.round(chars / 4));
}
