/**
 * Token-estimation + tool-search trace + input-token-allocation types and
 * helpers, ported from the reference's lib/token-usage.ts with all AI-SDK
 * types stripped. The bridge consumes the schema-cost estimate; the chat
 * route consumes the richer request-estimate + breakdown to surface the
 * "Estimated input-token split" panel in the header. Everything here is pure.
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
/** Per-tool schema-cost estimate, for the tool-schema breakdown panel. */
export type RequestToolEstimate = {
  name: string;
  chars: number;
};

/**
 * Per-request prompt-cost estimate. The bridge reads only `toolChars` (for the
 * deferred-vs-all schema-savings math); the chat route reads the full shape to
 * build the input-token allocation bar (system prompt / tools / messages).
 */
export type RequestTokenEstimate = {
  systemPromptChars: number;
  messageChars: number;
  toolChars: number;
  requestOptionChars: number;
  messageCount: number;
  toolCount: number;
  tools: RequestToolEstimate[];
};

/** The three prompt-content categories the allocation bar splits across. */
export type TokenUsageBreakdownCategoryId = "systemPrompt" | "messages" | "tools";

export type TokenUsageBreakdownCategory = {
  id: TokenUsageBreakdownCategoryId;
  label: string;
  tokens: number;
  percentage: number;
  chars: number;
};

export type TokenUsageToolBreakdown = {
  name: string;
  tokens: number;
  percentage: number;
  chars: number;
};

/**
 * The estimated split of one assistant turn's input tokens across
 * system-prompt / tool-schema / conversation content, plus the per-tool schema
 * breakdown. Built by allocating the real provider `inputTokens` across the
 * aggregated per-request char estimates (proportional, largest-remainder).
 */
export type TokenUsageBreakdown = {
  inputTokens?: number;
  estimated: true;
  requestCount: number;
  messageCount: number;
  toolCount: number;
  excludedRequestOptionChars: number;
  excludedRequestOptionTokens: number;
  categories: TokenUsageBreakdownCategory[];
  tools: TokenUsageToolBreakdown[];
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

/**
 * Estimate the prompt-cost split of one request body. Mirrors the reference's
 * estimateRequestTokenUsage: system messages, non-system messages, tool
 * schemas, and the leftover "request options" (model / stream flags / routing)
 * that are request metadata, not prompt content. Returns undefined when the
 * prompt is empty (nothing to allocate).
 */
export function estimateRequestTokenUsage(body: unknown): RequestTokenEstimate | undefined {
  const requestBody = parseRequestBody(body);

  if (!isRecord(requestBody)) {
    return undefined;
  }

  const messages = Array.isArray(requestBody.messages) ? requestBody.messages : [];
  const systemMessages = messages.filter(isSystemMessage);
  const nonSystemMessages = messages.filter((message) => !isSystemMessage(message));
  const tools = requestBody.tools ?? requestBody.functions;
  const requestOptions = { ...requestBody };

  delete requestOptions.messages;
  delete requestOptions.tools;
  delete requestOptions.functions;

  const toolEstimates = estimateToolSchemas(tools);

  const estimate: RequestTokenEstimate = {
    systemPromptChars: jsonLength(systemMessages),
    messageChars: jsonLength(nonSystemMessages),
    toolChars: jsonLength(tools),
    requestOptionChars: jsonLength(requestOptions),
    messageCount: messages.length,
    toolCount: countItems(tools),
    tools: toolEstimates,
  };

  return estimatePromptChars(estimate) > 0 ? estimate : undefined;
}

/**
 * Allocate the real provider input tokens across the aggregated per-request
 * prompt-char estimates, split into system prompt / tools / messages
 * categories (largest-remainder), then sub-allocate the tools slice across the
 * individual tool schemas. Returns undefined when there are no estimates or no
 * prompt chars to allocate.
 */
export function toTokenUsageBreakdown(
  inputTokens: number | undefined,
  requestEstimates: RequestTokenEstimate[],
): TokenUsageBreakdown | undefined {
  const aggregate = sumRequestTokenEstimates(requestEstimates);

  if (!aggregate || estimatePromptChars(aggregate) === 0) {
    return undefined;
  }

  const targetTokens = inputTokens ?? estimateTokensFromChars(estimatePromptChars(aggregate));
  const categories = allocateCategoryTokens(
    [
      { id: "systemPrompt", label: "System instructions", chars: aggregate.systemPromptChars },
      { id: "tools", label: "Tool definitions", chars: aggregate.toolChars },
      { id: "messages", label: "Conversation", chars: aggregate.messageChars },
    ],
    targetTokens,
  );
  const toolCategory = categories.find((category) => category.id === "tools");
  const tools = allocateToolTokens(aggregate.tools, toolCategory?.tokens ?? 0);

  return {
    inputTokens,
    estimated: true,
    requestCount: requestEstimates.length,
    messageCount: aggregate.messageCount,
    toolCount: aggregate.toolCount,
    excludedRequestOptionChars: aggregate.requestOptionChars,
    excludedRequestOptionTokens:
      aggregate.requestOptionChars > 0 ? estimateTokensFromChars(aggregate.requestOptionChars) : 0,
    categories,
    tools,
  };
}

/** Allocate `targetTokens` across the visible categories by char share. */
function allocateCategoryTokens(
  categories: Array<{
    id: TokenUsageBreakdownCategoryId;
    label: string;
    chars: number;
  }>,
  targetTokens: number,
): TokenUsageBreakdownCategory[] {
  const visibleCategories = categories.filter((category) => category.chars > 0);
  const totalChars = visibleCategories.reduce((sum, category) => sum + category.chars, 0);

  if (totalChars === 0 || targetTokens <= 0) {
    return [];
  }

  const allocations = visibleCategories.map((category) => {
    const exactTokens = (category.chars / totalChars) * targetTokens;
    const tokens = Math.floor(exactTokens);

    return { ...category, exactTokens, tokens };
  });
  let remainingTokens =
    targetTokens - allocations.reduce((sum, category) => sum + category.tokens, 0);

  for (const category of [...allocations].sort(
    (first, second) =>
      second.exactTokens -
      Math.floor(second.exactTokens) -
      (first.exactTokens - Math.floor(first.exactTokens)),
  )) {
    if (remainingTokens <= 0) {
      break;
    }

    category.tokens += 1;
    remainingTokens -= 1;
  }

  return allocations
    .map(({ exactTokens: _exactTokens, ...category }) => ({
      ...category,
      percentage: targetTokens > 0 ? (category.tokens / targetTokens) * 100 : 0,
    }))
    .sort((first, second) => second.tokens - first.tokens);
}

/** Sub-allocate the tool slice across individual tool schemas by char share. */
function allocateToolTokens(
  tools: RequestToolEstimate[],
  targetTokens: number,
): TokenUsageToolBreakdown[] {
  const visibleTools = tools.filter((tool) => tool.chars > 0);
  const totalChars = visibleTools.reduce((sum, tool) => sum + tool.chars, 0);

  if (totalChars === 0 || targetTokens <= 0) {
    return [];
  }

  const allocations = visibleTools.map((tool) => {
    const exactTokens = (tool.chars / totalChars) * targetTokens;
    const tokens = Math.floor(exactTokens);

    return { ...tool, exactTokens, tokens };
  });
  let remainingTokens = targetTokens - allocations.reduce((sum, tool) => sum + tool.tokens, 0);

  for (const tool of [...allocations].sort(
    (first, second) =>
      second.exactTokens -
      Math.floor(second.exactTokens) -
      (first.exactTokens - Math.floor(first.exactTokens)),
  )) {
    if (remainingTokens <= 0) {
      break;
    }

    tool.tokens += 1;
    remainingTokens -= 1;
  }

  return allocations
    .map(({ exactTokens: _exactTokens, ...tool }) => ({
      ...tool,
      percentage: targetTokens > 0 ? (tool.tokens / targetTokens) * 100 : 0,
    }))
    .sort((first, second) => second.tokens - first.tokens || first.name.localeCompare(second.name));
}

function parseRequestBody(body: unknown): unknown {
  if (typeof body !== "string") {
    return body;
  }

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function isSystemMessage(value: unknown): value is { role: "system" } {
  return isRecord(value) && value.role === "system";
}

function jsonLength(value: unknown): number {
  if (value == null) {
    return 0;
  }

  if (Array.isArray(value) && value.length === 0) {
    return 0;
  }

  if (isRecord(value) && Object.keys(value).length === 0) {
    return 0;
  }

  return JSON.stringify(value).length;
}

function countItems(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (isRecord(value)) {
    return Object.keys(value).length;
  }

  return value == null ? 0 : 1;
}

function estimateToolSchemas(value: unknown): RequestToolEstimate[] {
  if (Array.isArray(value)) {
    return value.map((toolSchema, index) => ({
      chars: jsonLength(toolSchema),
      name: readToolName(toolSchema) ?? `tool_${index + 1}`,
    }));
  }

  if (isRecord(value)) {
    return Object.entries(value).map(([key, toolSchema]) => ({
      chars: jsonLength({ [key]: toolSchema }),
      name: readToolName(toolSchema) ?? key,
    }));
  }

  return [];
}

function readToolName(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.name === "string" && value.name.trim()) {
    return value.name;
  }

  if (isRecord(value.function) && typeof value.function.name === "string") {
    const name = value.function.name.trim();

    return name || undefined;
  }

  return undefined;
}

function estimatePromptChars(estimate: RequestTokenEstimate) {
  return estimate.systemPromptChars + estimate.messageChars + estimate.toolChars;
}

function sumRequestTokenEstimates(
  estimates: RequestTokenEstimate[],
): RequestTokenEstimate | undefined {
  if (estimates.length === 0) {
    return undefined;
  }

  return estimates.reduce<RequestTokenEstimate>(
    (total, estimate) => ({
      systemPromptChars: total.systemPromptChars + estimate.systemPromptChars,
      messageChars: total.messageChars + estimate.messageChars,
      toolChars: total.toolChars + estimate.toolChars,
      requestOptionChars: total.requestOptionChars + estimate.requestOptionChars,
      messageCount: total.messageCount + estimate.messageCount,
      toolCount: Math.max(total.toolCount, estimate.toolCount),
      tools: sumToolEstimates(total.tools, estimate.tools),
    }),
    {
      systemPromptChars: 0,
      messageChars: 0,
      toolChars: 0,
      requestOptionChars: 0,
      messageCount: 0,
      toolCount: 0,
      tools: [],
    },
  );
}

function sumToolEstimates(
  first: RequestToolEstimate[],
  second: RequestToolEstimate[],
): RequestToolEstimate[] {
  const byName = new Map<string, number>();

  for (const tool of [...first, ...second]) {
    byName.set(tool.name, (byName.get(tool.name) ?? 0) + tool.chars);
  }

  return Array.from(byName, ([name, chars]) => ({ name, chars }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
