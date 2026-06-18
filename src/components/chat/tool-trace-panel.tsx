/**
 * Inline tool-activity panel rendered beneath an assistant message bubble.
 *
 * Surfaces the deferred tool-search loop's work — the tool_call/tool_result
 * pairs the server streamed plus the final token-savings metadata — so the
 * reference app's core thesis (send a 3-tool bridge instead of all 200 tool
 * schemas) is visible in the UI, not just measurable server-side.
 *
 * The panel is a <details> disclosure so it stays out of the way until the
 * user wants to inspect what the model did. The one-line summary (mode, tools
 * sent, schema tokens, % saved) is always visible.
 */

import { ChevronDown, Wrench } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  formatSavingsLine,
  formatTokenCount,
  type ToolSearchSummary,
  type ToolStep,
  truncateForPreview,
} from "~/lib/chat/tool-events";
import { formatArgsPreview, statusVisual } from "~/lib/chat/tool-trace-display";
import { cn } from "~/lib/utils";

export function ToolTracePanel({
  steps,
  summary,
  isStreaming,
}: {
  steps: ToolStep[];
  summary?: ToolSearchSummary;
  /** While the turn is still streaming, show the panel open by default. */
  isStreaming?: boolean;
}) {
  if (steps.length === 0 && !summary) {
    return null;
  }

  return <ToolTracePanelInner isStreaming={isStreaming} steps={steps} summary={summary} />;
}

/**
 * Split inner component so the auto-open effect only mounts when there is
 * activity to show (the guard above short-circuits the empty case).
 *
 * The <details> is uncontrolled: a one-shot effect opens it the first time a
 * streaming turn produces tool steps, then never touches `open` again so the
 * user can freely expand/collapse it afterwards (a controlled `open` would
 * force-close the panel when streaming ends and trap the user out of it).
 */
function ToolTracePanelInner({
  steps,
  summary,
  isStreaming,
}: {
  steps: ToolStep[];
  summary?: ToolSearchSummary;
  isStreaming?: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    if (autoOpenedRef.current || !isStreaming || steps.length === 0) {
      return;
    }
    if (detailsRef.current) {
      detailsRef.current.open = true;
      autoOpenedRef.current = true;
    }
  }, [isStreaming, steps.length]);

  return (
    <div className="ml-1 w-full max-w-[85%] rounded-lg border border-border/70 bg-muted/30 text-xs text-muted-foreground">
      <details ref={detailsRef} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-primary/30 [&::-webkit-details-marker]:hidden">
          <Wrench aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground">
            {steps.length} tool {steps.length === 1 ? "step" : "steps"}
          </span>
          {summary ? (
            <span className="min-w-0 truncate text-muted-foreground">
              · {formatSavingsLine(summary)}
            </span>
          ) : null}
          <ChevronDown
            aria-hidden="true"
            className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>

        <div className="space-y-1.5 border-t border-border/60 px-3 py-2.5">
          {steps.map((step, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: read-only, append-only trace rows; the same tool may legitimately appear twice (e.g. two tool_search calls), so list position is the only stable discriminator.
            <ToolStepRow index={index} key={`${index}-${step.name}`} step={step} />
          ))}

          {summary ? <SavingsGrid summary={summary} /> : null}
        </div>
      </details>
    </div>
  );
}

function ToolStepRow({ step, index }: { step: ToolStep; index: number }) {
  const { Icon, className: iconClassName } = statusVisual(step.status);
  const label = step.title || step.name;
  const sublabel = step.service ? `${step.service}` : null;

  const argsPreview = formatArgsPreview(step.arguments);
  const outputPreview =
    typeof step.output === "string" && step.output.length > 0
      ? truncateForPreview(step.output, 160)
      : null;

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
      <Icon aria-hidden="true" className={cn("mt-0.5 size-3.5 shrink-0", iconClassName)} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="font-medium text-foreground">{label}</span>
          {sublabel ? (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
              {sublabel}
            </span>
          ) : null}
        </div>
        {argsPreview ? (
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {argsPreview}
          </p>
        ) : null}
        {outputPreview ? (
          <p className="mt-0.5 break-words font-mono text-[11px] text-muted-foreground/90">
            → {outputPreview}
          </p>
        ) : null}
        {step.status === "running" ? (
          <p className="mt-0.5 text-[11px] italic text-muted-foreground">running…</p>
        ) : null}
        <span className="sr-only">Step {index + 1}</span>
      </div>
    </div>
  );
}

function SavingsGrid({ summary }: { summary: ToolSearchSummary }) {
  const rows = [
    { label: "Sent", value: `${formatTokenCount(summary.sentToolCount)} tools` },
    { label: "Schema sent", value: `${formatTokenCount(summary.sentSchemaTokens)} tokens` },
    { label: "Saved", value: `${formatTokenCount(summary.savedSchemaTokens)} tokens` },
    { label: "Baseline", value: `${formatTokenCount(summary.baselineSchemaTokens)} tokens` },
  ];

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-foreground">Tool search</p>
        <p className="text-[10px] text-muted-foreground">
          {summary.mode === "search" ? "Search bridge" : "All tools"} · {summary.requestCount}{" "}
          request{summary.requestCount === 1 ? "" : "s"}
        </p>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {rows.map((row) => (
          <div className="rounded-md bg-muted/45 px-2 py-1.5" key={row.label}>
            <p className="text-[10px] font-medium text-muted-foreground">{row.label}</p>
            <p className="mt-0.5 tabular-nums text-[11px] font-semibold text-foreground">
              {row.value}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        <span>{summary.searchCount} searches</span>
        <span>{summary.describeCount} describes</span>
        <span>{summary.callCount} calls</span>
        <span>{summary.deferredToolCount} deferred</span>
      </div>
    </div>
  );
}
