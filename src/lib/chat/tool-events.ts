/**
 * Client-side mirror of the server's tool activity + deferred-search metadata.
 *
 * The chat route streams three extra SSE frame types alongside `text`:
 *   data: {"type":"tool_call","call":{name,arguments,service?,title?}}
 *   data: {"type":"tool_result","result":{name,ok,output}}
 *   data: {"type":"metadata","metadata": ToolSearchMetadata}
 *
 * This module owns the client's view of those frames: the per-assistant-turn
 * "tool steps" (a tool_call paired with its tool_result), the token-savings
 * summary surfaced under the bubble, and the formatting helpers. Only the
 * fields the UI renders live here; the full per-request TokenUsage breakdown
 * (input/output/reasoning/cache, category allocation) stays server-side.
 */

/** Status of a single tool invocation within an assistant turn. */
export type ToolStepStatus = "running" | "ok" | "error";

/** One tool_call + its tool_result, shown as a row in the tool trace. */
export type ToolStep = {
  name: string;
  service?: string;
  title?: string;
  /** Raw arguments object the model supplied (may be {} for bridge queries). */
  arguments?: unknown;
  status: ToolStepStatus;
  /** Model-facing result string (JSON output or an error message). */
  output?: string;
};

/**
 * The deferred-tool-search summary for one assistant turn. A faithful subset
 * of the server's ToolSearchMetadata; `trace` is dropped (the steps already
 * render it) and unknown fields are tolerated so the wire shape can grow.
 */
export type ToolSearchSummary = {
  mode: "search" | "all";
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
};

/**
 * Real per-turn token usage compacted from OpenRouter's terminal usage chunk.
 * The tool loop sums it across all its round-trips (the user sees one reply
 * that may have cost several upstream requests); the plain path sends one.
 * All fields default to 0 so a turn rendered before/without usage still parses.
 */
export type TurnTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
};

/** The three non-text frame shapes read off the SSE channel. */
export type ToolCallFrame = {
  type: "tool_call";
  call: { name: string; arguments?: unknown; service?: string; title?: string };
};

export type ToolResultFrame = {
  type: "tool_result";
  result: { name: string; ok: boolean; output?: unknown };
};

export type MetadataFrame = {
  type: "metadata";
  metadata: ToolSearchSummary;
};

/** A usage frame from the server, carrying the per-turn OpenRouter totals. */
export type UsageFrame = {
  type: "usage";
  usage: TurnTokenUsage;
};

/** The union of frame types the chat stream parser may now hand us. */
export type ToolFrame = ToolCallFrame | ToolResultFrame | MetadataFrame | UsageFrame;

export function isToolFrame(value: { type?: unknown }): value is ToolFrame {
  return (
    value.type === "tool_call" ||
    value.type === "tool_result" ||
    value.type === "metadata" ||
    value.type === "usage"
  );
}

/**
 * Fold a tool_call frame into the assistant turn's step list: append a fresh
 * `running` step. The server emits tool_call immediately followed by its
 * tool_result (sequential dispatch), so appending preserves order.
 */
export function applyToolCall(steps: ToolStep[], frame: ToolCallFrame): ToolStep[] {
  return [
    ...steps,
    {
      name: frame.call.name,
      service: frame.call.service,
      title: frame.call.title,
      arguments: frame.call.arguments,
      status: "running",
    },
  ];
}

/**
 * Fold a tool_result frame: complete the most recent step that is still
 * `running`. The server's sequential dispatch guarantees this is the matching
 * call; matching by name as well keeps it robust if ordering ever changes.
 */
export function applyToolResult(steps: ToolStep[], frame: ToolResultFrame): ToolStep[] {
  const name = frame.result.name;
  let completed = false;
  const next = [...steps];

  for (let i = next.length - 1; i >= 0; i -= 1) {
    const step = next[i];
    if (step.status === "running" && (name.length === 0 || step.name === name)) {
      next[i] = {
        ...step,
        status: frame.result.ok ? "ok" : "error",
        output: stringifyOutput(frame.result.output),
      };
      completed = true;
      break;
    }
  }

  // No matching running step (e.g. an orphaned result): record it standalone so
  // the activity is never silently lost.
  if (!completed) {
    next.push({
      name,
      status: frame.result.ok ? "ok" : "error",
      output: stringifyOutput(frame.result.output),
    });
  }

  return next;
}

/**
 * Number formatters for the token-savings readout. Commas for thousands,
 * percent with no decimals, and a compact "1.2k" form for big baselines.
 */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return "0";
  }
  return tokens.toLocaleString("en-US");
}

export function formatTokenCompact(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return "0";
  }
  if (tokens < 1000) {
    return String(tokens);
  }
  if (tokens < 1_000_000) {
    const k = tokens / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export function formatTokenPercentage(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction <= 0) {
    return "0%";
  }
  return `${Math.round(fraction * 100)}%`;
}

/**
 * One-line label for the savings readout, e.g.
 *   "Search bridge · 3 tools sent · 1,560 tokens · 98.7% saved (118.5k baseline)"
 */
export function formatSavingsLine(summary: ToolSearchSummary): string {
  const modeLabel = summary.mode === "search" ? "Search bridge" : "All tools";
  const savedFraction =
    summary.baselineSchemaTokens > 0 ? summary.savedSchemaTokens / summary.baselineSchemaTokens : 0;
  const parts = [
    modeLabel,
    `${summary.sentToolCount} tool${summary.sentToolCount === 1 ? "" : "s"} sent`,
    `${formatTokenCount(summary.sentSchemaTokens)} schema tokens`,
  ];

  if (summary.savedSchemaTokens > 0) {
    parts.push(
      `${formatTokenPercentage(savedFraction)} saved · ${formatTokenCompact(summary.baselineSchemaTokens)} baseline`,
    );
  }
  return parts.join(" · ");
}

/**
 * Truncate a tool argument/result blob for inline display. Long JSON is
 * collapsed to the first line + an ellipsis; the full value is still available
 * via the <details> disclosure in the UI.
 */
export function truncateForPreview(text: string, max = 140): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max - 1)}…`;
}

/** A usage record with every field at 0 is the "provider omitted usage" shape. */
export function isUsageEmpty(usage: TurnTokenUsage): boolean {
  return (
    usage.totalTokens === 0 &&
    usage.inputTokens === 0 &&
    usage.outputTokens === 0 &&
    usage.reasoningTokens === 0 &&
    usage.cachedInputTokens === 0
  );
}

/**
 * Compact inline label for one assistant turn's token usage, e.g.
 *   "↑ 1,234 · ↓ 567 · 1,801 total" (with "· cached 42" and "· reasoning 88"
 *    appended when those buckets were non-zero). Returns "" for an empty
 *    usage record so the UI can gate the caption on truthiness.
 */
export function formatUsageLine(usage: TurnTokenUsage): string {
  if (isUsageEmpty(usage)) {
    return "";
  }
  const parts = [
    `↑ ${formatTokenCount(usage.inputTokens)}`,
    `↓ ${formatTokenCount(usage.outputTokens)}`,
    `${formatTokenCount(usage.totalTokens)} total`,
  ];
  if (usage.cachedInputTokens > 0) {
    parts.push(`cached ${formatTokenCount(usage.cachedInputTokens)}`);
  }
  if (usage.reasoningTokens > 0) {
    parts.push(`reasoning ${formatTokenCount(usage.reasoningTokens)}`);
  }
  return parts.join(" · ");
}

/** Coerce a tool_result's `output` (already a model-facing string) for display. */
function stringifyOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (output === undefined || output === null) {
    return "";
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}
