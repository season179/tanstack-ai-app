import { CalendarClock, Check, Copy, RotateCcw, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ReasoningPanel } from "~/components/chat/reasoning-panel";
import { ToolTracePanel } from "~/components/chat/tool-trace-panel";
import { Markdown } from "~/components/ui/markdown";
import { messageContentClassName } from "~/lib/chat/message-display";
import {
  formatUsageLine,
  isUsageEmpty,
  type ToolSearchSummary,
  type ToolStep,
  type TurnTokenUsage,
} from "~/lib/chat/tool-events";
import { cn } from "~/lib/utils";

/**
 * Per-message orchestrator: stacks the optional ReasoningPanel above the
 * MessageBubble, then the ToolTracePanel, the per-turn token-usage caption,
 * and a footer actions cluster (Copy on every completed assistant turn,
 * Regenerate only on the last one). Extracted from chat-surface.tsx so the
 * message-presentation contract is unit-testable in isolation.
 *
 * Ported from the reference's chat-surface MessageRow.
 */
export function MessageRow({
  activatedSkill,
  content,
  isLastAssistant,
  isStreaming,
  onRegenerate,
  origin,
  reasoning,
  sender,
  tokenUsage,
  toolSteps,
  toolSearch,
}: {
  activatedSkill?: string;
  content: string;
  isLastAssistant?: boolean;
  isStreaming?: boolean;
  onRegenerate?: () => void;
  origin?: "scheduled";
  reasoning?: string;
  sender: "user" | "assistant";
  tokenUsage?: TurnTokenUsage;
  toolSteps?: ToolStep[];
  toolSearch?: ToolSearchSummary;
}) {
  const isUser = sender === "user";
  const hasToolActivity =
    !isUser && ((toolSteps && toolSteps.length > 0) || toolSearch !== undefined);
  const hasReasoning = !isUser && typeof reasoning === "string" && reasoning.trim().length > 0;
  // Only surface real OpenRouter usage once the turn has stopped streaming
  // (and only if the provider actually returned one) so the caption never
  // flickers an empty "0 · 0 · 0 total" mid-stream.
  const usageLine =
    !isUser && !isStreaming && tokenUsage && !isUsageEmpty(tokenUsage)
      ? formatUsageLine(tokenUsage)
      : "";

  return (
    <div className={cn("flex flex-col gap-1.5", isUser ? "items-end" : "items-start")}>
      {hasReasoning ? (
        <ReasoningPanel
          hasContent={content.trim().length > 0}
          isStreaming={isStreaming}
          reasoning={reasoning ?? ""}
        />
      ) : null}
      <MessageBubble
        activatedSkill={activatedSkill}
        content={content}
        isStreaming={isStreaming}
        origin={origin}
        sender={sender}
      />
      {hasToolActivity ? (
        <ToolTracePanel isStreaming={isStreaming} steps={toolSteps ?? []} summary={toolSearch} />
      ) : null}
      {usageLine.length > 0 ? (
        <p className="px-1 text-[11px] tabular-nums text-muted-foreground/80">{usageLine}</p>
      ) : null}
      {!isUser && !isStreaming && content.trim().length > 0 ? (
        <div className="flex items-center gap-0.5 px-1">
          <MessageCopyButton content={content} />
          {isLastAssistant && onRegenerate ? (
            <button
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={onRegenerate}
              type="button"
            >
              <RotateCcw aria-hidden="true" className="size-3" />
              Regenerate
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The per-sender content bubble. Mirrors the reference's ai-elements
 * MessageContent split (user = primary bubble, assistant = borderless text)
 * via the shared messageContentClassName helper, then layers the provenance
 * badges (activatedSkill Zap for user, scheduled-origin CalendarClock for
 * assistant) and the streaming caret / "Thinking…" placeholder above the
 * content itself. User input is rendered verbatim (whitespace preserved,
 * never markdown); assistant replies render as markdown.
 */
export function MessageBubble({
  activatedSkill,
  content,
  isStreaming,
  origin,
  sender,
}: {
  activatedSkill?: string;
  content: string;
  isStreaming?: boolean;
  origin?: "scheduled";
  sender: "user" | "assistant";
}) {
  const isUser = sender === "user";
  const showCaret = isStreaming && content.length === 0;

  return (
    <div className={messageContentClassName(sender)}>
      {isUser && activatedSkill ? (
        <div className="mb-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary-foreground/15 px-2 py-0.5 text-[11px] font-medium">
            <Zap aria-hidden="true" className="size-3" />
            {activatedSkill}
          </span>
        </div>
      ) : null}
      {!isUser && origin === "scheduled" ? (
        <div className="mb-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <CalendarClock aria-hidden="true" className="size-3" />
            Ran scheduled task
          </span>
        </div>
      ) : null}
      {showCaret ? (
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-primary" />
          Thinking…
        </span>
      ) : isUser ? (
        // User input is rendered verbatim (whitespace preserved) — never
        // interpreted as markdown — so what the user typed is exactly what they
        // see and what the model receives on the wire stays unambiguous.
        <span className="whitespace-pre-wrap">
          {content}
          {isStreaming ? <span className="ml-0.5 inline-block animate-pulse">▋</span> : null}
        </span>
      ) : (
        // Assistant replies are markdown (the reference renders via Streamdown).
        // We stream into the same Markdown tree so fenced tables/code reflow as
        // tokens arrive; the trailing caret sits outside so it isn't parsed.
        <div>
          <Markdown>{content}</Markdown>
          {isStreaming ? <span className="ml-0.5 inline-block animate-pulse">▋</span> : null}
        </div>
      )}
    </div>
  );
}

/**
 * Copy-an-assistant-reply affordance. Writes the raw markdown content to the
 * clipboard (secure-context / localhost only — navigator.clipboard is gated to
 * https or localhost, which covers dev and the prod server). Flashes a
 * "Copied" confirmation for ~1.5s, mirroring the universal chat-app pattern.
 * Fails soft (no-op) when the clipboard API is unavailable.
 */
export function MessageCopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (non-secure context / permissions) — fail soft.
    }
  }

  return (
    <button
      aria-label={copied ? "Copied" : "Copy message"}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      onClick={handleCopy}
      type="button"
    >
      {copied ? (
        <Check aria-hidden="true" className="size-3" />
      ) : (
        <Copy aria-hidden="true" className="size-3" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
