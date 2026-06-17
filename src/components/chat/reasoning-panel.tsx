/**
 * Inline reasoning (chain-of-thought) panel rendered ABOVE an assistant message
 * bubble for turns produced by reasoning models (OpenAI o-series, Claude w/
 * thinking, DeepSeek-R1, …).
 *
 * Mirrors the reference app's MessageReasoning surface: the model's thinking
 * text streams ahead of (or interleaved with) its visible answer and is shown
 * in a collapsible disclosure so it stays quiet by default but is always
 * inspectable. The summary line carries a live "Thinking…" pulse while the
 * turn is still streaming reasoning before any visible content has landed.
 *
 * Like ToolTracePanel, the <details> is uncontrolled: a one-shot effect opens
 * it the first time reasoning appears during a streaming turn, then never
 * touches `open` again — a controlled `open` would force-close the panel when
 * streaming ends and trap the user out of it.
 */

import { Brain, ChevronDown } from "lucide-react";
import { useEffect, useRef } from "react";

import { Markdown } from "~/components/ui/markdown";

export function ReasoningPanel({
  reasoning,
  isStreaming,
  hasContent,
}: {
  reasoning: string;
  /** While the turn is still streaming, the panel auto-opens on first delta. */
  isStreaming?: boolean;
  /** Whether the visible answer has started. Used for the summary label. */
  hasContent?: boolean;
}) {
  const trimmed = reasoning.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return (
    <ReasoningPanelInner hasContent={hasContent} isStreaming={isStreaming} reasoning={trimmed} />
  );
}

function ReasoningPanelInner({
  reasoning,
  isStreaming,
  hasContent,
}: {
  reasoning: string;
  isStreaming?: boolean;
  hasContent?: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const autoOpenedRef = useRef(false);

  // Auto-open once while reasoning streams, then hand toggle control to the
  // user. Runs only on the first appearance so a later re-render during the
  // same turn can't yank the panel back open after the user closed it.
  useEffect(() => {
    if (autoOpenedRef.current || !isStreaming) {
      return;
    }
    if (detailsRef.current) {
      detailsRef.current.open = true;
      autoOpenedRef.current = true;
    }
  }, [isStreaming]);

  const thinkingLive = isStreaming === true && !hasContent;

  return (
    <div className="ml-1 w-full max-w-[85%] rounded-lg border border-border/70 bg-muted/30 text-xs text-muted-foreground">
      <details ref={detailsRef} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-primary/30 [&::-webkit-details-marker]:hidden">
          <Brain aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground">
            {thinkingLive ? "Thinking…" : "Reasoning"}
          </span>
          {thinkingLive ? (
            <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />
          ) : null}
          <ChevronDown
            aria-hidden="true"
            className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>

        <div className="border-t border-border/60 px-3 py-2.5">
          {/*
           * Reasoning text is model-generated, so render it as markdown for
           * legibility (lists / paragraphs / inline code). The Markdown
           * component maps every tag to design tokens and inherits the panel's
           * muted text color via text-inherit.
           */}
          <Markdown>{reasoning}</Markdown>
        </div>
      </details>
    </div>
  );
}
