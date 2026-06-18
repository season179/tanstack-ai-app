/**
 * Pure display helpers extracted from the header's `TokenUsageMenu` component
 * so they are unit-testable without rendering the popover. Mirrors the
 * extraction pattern established for `sidebar-grouping`,
 * `chat-route-helpers`, and `tool-trace-display`.
 *
 * Two families live here:
 *   1. Tool-search trace event rendering — the short label + one-line detail
 *      string the menu's "Search trace" disclosure renders for each
 *      search/describe/call event.
 *   2. Estimated input-token breakdown rendering — the human copy + tailwind
 *      color class for each of the three allocation categories
 *      (systemPrompt / messages / tools).
 */

import type {
  TokenUsageBreakdown,
  TokenUsageBreakdownCategoryId,
  ToolSearchTraceEvent,
} from "~/lib/chat/tool-events";
import { formatTokenCount } from "~/lib/chat/tool-events";

/**
 * Short, capitalized label for one bridge trace event kind. Drives the
 * leftmost column of the menu's "Search trace" rows.
 */
export function getToolSearchEventLabel(event: ToolSearchTraceEvent): string {
  switch (event.kind) {
    case "search":
      return "Search";
    case "describe":
      return "Describe";
    case "call":
      return "Call";
  }
}

/**
 * One-line detail string for one bridge trace event. For a search event the
 * detail is `"<query>" -> <top 3 match names | "no matches">`; for describe /
 * call events it is `<name> schema loaded | invoked | not found`.
 */
export function getToolSearchEventDetail(event: ToolSearchTraceEvent): string {
  switch (event.kind) {
    case "search": {
      const names = event.matches
        .slice(0, 3)
        .map((match) => match.name)
        .join(", ");
      return `"${event.query}" -> ${names || "no matches"}`;
    }
    case "describe":
      return event.found ? `${event.name} schema loaded` : `${event.name} not found`;
    case "call":
      return event.found ? `${event.name} invoked` : `${event.name} not found`;
  }
}

/** Human {label, description} copy for one allocation category. */
export function getBreakdownCategoryCopy(
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

/**
 * Tailwind background color class for one category's segment of the
 * proportional allocation bar. The three categories carry distinct hues so
 * the bar reads as a split at a glance.
 */
export function getBreakdownBarColor(id: TokenUsageBreakdownCategoryId): string {
  switch (id) {
    case "tools":
      return "bg-[var(--chart-tools)]";
    case "messages":
      return "bg-[var(--chart-messages)]";
    case "systemPrompt":
      return "bg-[var(--chart-system)]";
  }
}

/**
 * Tailwind dot color class for the legend swatch beside a category's readout.
 * Intentionally identical to the bar color so the legend matches its segment.
 */
export function getBreakdownDotColor(id: TokenUsageBreakdownCategoryId): string {
  return getBreakdownBarColor(id);
}
