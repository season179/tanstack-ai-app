import {
  type ChatUsageSummary,
  formatPercentageValue,
  formatTokenCount,
  formatTokenPercentage,
  isUsageEmpty,
  type TokenUsageBreakdown,
  type TokenUsageBreakdownCategoryId,
  type TurnTokenUsage,
} from "~/lib/chat/tool-events";

/**
 * Header popover showing the session's cumulative OpenRouter token spend plus a
 * breakdown of the most recent request. A faithful port of the reference's
 * TokenUsageMenu: the provider totals grid (input/output/reasoning/cache), the
 * estimated input-token allocation bar (system prompt / tool schemas /
 * conversation) with a per-tool schema breakdown, and the deferred-tool-search
 * summary.
 *
 * The <details> is uncontrolled: the summary trigger always reflects live
 * session totals, and the popover opens on click and stays where the user
 * leaves it (no controlled-open footgun during streaming).
 */
export function TokenUsageMenu({ summary }: { summary: ChatUsageSummary }) {
  const { sessionUsage, latestUsage, latestToolSearch, latestBreakdown } = summary;
  const hasAny = !isUsageEmpty(sessionUsage);

  return (
    <details className="relative shrink-0">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/30 [&::-webkit-details-marker]:hidden">
        Session tokens
        <span className="font-semibold tabular-nums text-foreground">
          {formatTokenCount(sessionUsage.totalTokens)}
        </span>
      </summary>
      <div className="absolute right-0 top-full z-20 mt-3 w-[min(calc(100vw-2rem),34rem)] rounded-lg border border-border bg-background p-4 text-left shadow-[0_24px_70px_-36px_rgba(15,23,42,0.45)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Last request</p>
            <p className="mt-1 text-xs text-muted-foreground">
              OpenRouter totals are exact, summed across every round-trip in the turn (tool calls
              included). The input split estimates model-readable content.
            </p>
          </div>
          <p className="shrink-0 tabular-nums text-sm font-semibold text-foreground">
            {formatTokenCount(latestUsage?.totalTokens ?? 0)}
          </p>
        </div>

        {latestUsage && !isUsageEmpty(latestUsage) ? (
          <ProviderUsageGrid usage={latestUsage} />
        ) : null}
        {latestBreakdown ? <PromptAllocation breakdown={latestBreakdown} /> : null}
        {latestToolSearch ? <ToolSearchPanel metadata={latestToolSearch} /> : null}

        {!hasAny ? (
          <p className="mt-4 text-xs text-muted-foreground">Send a message to see usage.</p>
        ) : null}
      </div>
    </details>
  );
}

function ProviderUsageGrid({ usage }: { usage: TurnTokenUsage }) {
  const rows = [
    {
      description: "Prompt tokens: conversation, instructions, and tool definitions",
      label: "Sent to model",
      value: usage.inputTokens,
    },
    {
      description: "Completion tokens: visible answer plus any thinking",
      label: "Generated output",
      value: usage.outputTokens,
    },
    {
      description: "Reasoning tokens inside generated output",
      label: "Thinking subset",
      value: usage.reasoningTokens,
    },
    {
      description: "Input tokens reused from provider cache",
      label: "Cache read",
      value: usage.cachedInputTokens,
    },
  ];

  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {rows.map((row) => (
        <div
          className="min-h-[5.75rem] rounded-md border border-border/80 px-3 py-2"
          key={row.label}
        >
          <p className="text-[11px] font-medium text-foreground">{row.label}</p>
          <p className="mt-1 tabular-nums text-sm font-semibold text-foreground">
            {formatTokenCount(row.value)}
          </p>
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{row.description}</p>
        </div>
      ))}
    </div>
  );
}

function ToolSearchPanel({ metadata }: { metadata: ChatUsageSummary["latestToolSearch"] }) {
  if (!metadata) {
    return null;
  }
  const modeLabel = metadata.mode === "search" ? "Search bridge" : "All tools";
  const savedFraction =
    metadata.baselineSchemaTokens > 0
      ? metadata.savedSchemaTokens / metadata.baselineSchemaTokens
      : 0;
  const rows = [
    { label: "Catalog", value: `${formatTokenCount(metadata.availableToolCount)} tools` },
    { label: "Sent", value: `${formatTokenCount(metadata.sentToolCount)} tools` },
    { label: "Schema sent", value: `${formatTokenCount(metadata.sentSchemaTokens)} tokens` },
    { label: "Saved", value: `${formatTokenCount(metadata.savedSchemaTokens)} tokens` },
  ];

  return (
    <div className="mt-4 rounded-md border border-border/80 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-foreground">Tool search</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {modeLabel} · {metadata.requestCount} request
            {metadata.requestCount === 1 ? "" : "s"}
          </p>
        </div>
        <p className="shrink-0 text-[11px] text-muted-foreground">
          baseline {formatTokenCount(metadata.baselineSchemaTokens)}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {rows.map((row) => (
          <div className="rounded-md bg-muted/45 px-2.5 py-2" key={row.label}>
            <p className="text-[10px] font-medium text-muted-foreground">{row.label}</p>
            <p className="mt-0.5 tabular-nums text-xs font-semibold text-foreground">{row.value}</p>
          </div>
        ))}
      </div>

      {metadata.savedSchemaTokens > 0 ? (
        <p className="mt-3 text-[11px] tabular-nums text-muted-foreground">
          {formatTokenPercentage(savedFraction)} of the baseline schema kept off the wire.
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span>{metadata.searchCount} searches</span>
        <span>{metadata.describeCount} describes</span>
        <span>{metadata.callCount} calls</span>
        <span>{metadata.deferredToolCount} deferred</span>
      </div>
    </div>
  );
}

/**
 * Estimated input-token split: a proportional bar across system prompt /
 * tool definitions / conversation, each with a token + percentage readout, and
 * a nested per-tool schema breakdown. Ported from the reference; the server
 * allocates the real provider inputTokens across the per-request prompt-char
 * estimates (largest-remainder), so the numbers reflect the actual bill.
 */
function PromptAllocation({ breakdown }: { breakdown: TokenUsageBreakdown }) {
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold text-foreground">Estimated input-token split</p>
        <p className="text-[11px] text-muted-foreground">
          {breakdown.requestCount} request{breakdown.requestCount === 1 ? "" : "s"} · {""}
          {breakdown.toolCount} tool{breakdown.toolCount === 1 ? "" : "s"}
        </p>
      </div>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted">
        {breakdown.categories.map((category) => (
          <span
            className={getBreakdownBarColor(category.id)}
            key={category.id}
            style={{
              minWidth: category.tokens > 0 ? 2 : 0,
              width: `${category.percentage}%`,
            }}
          />
        ))}
      </div>
      <div className="mt-3 space-y-2">
        {breakdown.categories.map((category) => {
          const copy = getBreakdownCategoryCopy(category.id, breakdown);

          return (
            <div className="flex items-start justify-between gap-4 text-xs" key={category.id}>
              <span className="flex min-w-0 items-start gap-2">
                <span
                  className={`mt-1 size-2 shrink-0 rounded-sm ${getBreakdownDotColor(category.id)}`}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{copy.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    {copy.description}
                  </span>
                </span>
              </span>
              <span className="shrink-0 pt-0.5 tabular-nums text-foreground">
                {formatTokenCount(category.tokens)} · {formatPercentageValue(category.percentage)}
              </span>
            </div>
          );
        })}
      </div>

      {breakdown.excludedRequestOptionTokens > 0 ? (
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
          API options excluded: model, streaming, routing, and generation settings are request
          metadata, not prompt content.
        </p>
      ) : null}

      {breakdown.tools.length > 0 ? <ToolSchemaBreakdown breakdown={breakdown} /> : null}
    </div>
  );
}

function ToolSchemaBreakdown({ breakdown }: { breakdown: TokenUsageBreakdown }) {
  const visibleTools = breakdown.tools.slice(0, 8);
  const hiddenTools = breakdown.tools.slice(8);
  const hiddenTokens = hiddenTools.reduce((sum, tool) => sum + tool.tokens, 0);
  const hiddenPercentage = hiddenTools.reduce((sum, tool) => sum + tool.percentage, 0);

  return (
    <details className="mt-4 rounded-md border border-border/80 px-3 py-2">
      <summary className="cursor-pointer list-none text-xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/30 [&::-webkit-details-marker]:hidden">
        <span>Tool schema breakdown</span>
        <span className="ml-2 font-normal text-muted-foreground">
          top {visibleTools.length} of {breakdown.tools.length}
        </span>
      </summary>
      <div className="mt-3 space-y-2">
        {visibleTools.map((tool) => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-xs" key={tool.name}>
            <span className="min-w-0 truncate text-muted-foreground" title={tool.name}>
              {tool.name}
            </span>
            <span className="shrink-0 tabular-nums text-foreground">
              {formatTokenCount(tool.tokens)} · {formatPercentageValue(tool.percentage)}
            </span>
          </div>
        ))}
        {hiddenTools.length > 0 ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-border/70 pt-2 text-xs">
            <span className="min-w-0 text-muted-foreground">
              Other {hiddenTools.length} tool schema{hiddenTools.length === 1 ? "" : "s"}
            </span>
            <span className="shrink-0 tabular-nums text-foreground">
              {formatTokenCount(hiddenTokens)} · {formatPercentageValue(hiddenPercentage)}
            </span>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function getBreakdownCategoryCopy(
  id: TokenUsageBreakdownCategoryId,
  breakdown: TokenUsageBreakdown,
): { label: string; description: string } {
  switch (id) {
    case "tools":
      return {
        description: `${formatTokenCount(breakdown.toolCount)} available tool schema${
          breakdown.toolCount === 1 ? "" : "s"
        } sent to the provider`,
        label: "Tool definitions",
      };
    case "messages":
      return {
        description: "User, assistant, and tool-result messages in the conversation",
        label: "Conversation",
      };
    case "systemPrompt":
      return {
        description: "Hidden app and system instructions, when present",
        label: "System instructions",
      };
  }
}

function getBreakdownBarColor(id: TokenUsageBreakdownCategoryId) {
  switch (id) {
    case "tools":
      return "bg-amber-500";
    case "messages":
      return "bg-sky-500";
    case "systemPrompt":
      return "bg-violet-500";
  }
}

function getBreakdownDotColor(id: TokenUsageBreakdownCategoryId) {
  return getBreakdownBarColor(id);
}
