import {
  type ChatUsageSummary,
  formatTokenCount,
  formatTokenPercentage,
  isUsageEmpty,
  type TurnTokenUsage,
} from "~/lib/chat/tool-events";

/**
 * Header popover showing the session's cumulative OpenRouter token spend plus a
 * breakdown of the most recent request. A faithful subset of the reference's
 * TokenUsageMenu: the provider totals grid (input/output/reasoning/cache) and
 * the deferred-tool-search summary, but not the estimated input-token
 * allocation bar (that needs the full server-side breakdown machinery).
 *
 * The <details> is uncontrolled: the summary trigger always reflects live
 * session totals, and the popover opens on click and stays where the user
 * leaves it (no controlled-open footgun during streaming).
 */
export function TokenUsageMenu({ summary }: { summary: ChatUsageSummary }) {
  const { sessionUsage, latestUsage, latestToolSearch } = summary;
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
              included).
            </p>
          </div>
          <p className="shrink-0 tabular-nums text-sm font-semibold text-foreground">
            {formatTokenCount(latestUsage?.totalTokens ?? 0)}
          </p>
        </div>

        {latestUsage && !isUsageEmpty(latestUsage) ? (
          <ProviderUsageGrid usage={latestUsage} />
        ) : null}
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
