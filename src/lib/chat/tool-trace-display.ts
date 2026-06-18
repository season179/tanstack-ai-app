/**
 * Pure display helpers backing the inline tool-trace panel rendered beneath an
 * assistant message bubble.
 *
 * Extracted from src/components/chat/tool-trace-panel.tsx so the per-step
 * visual mapping (status → icon + className) and the arguments-preview
 * formatter are unit-testable without a React/DOM harness, mirroring the
 * sidebar-grouping (iteration 56) and chat-route-helpers (iteration 58)
 * extraction pattern. The panel component renders through these helpers; the
 * helpers own no React state and produce no JSX.
 */

import { CircleCheck, CircleX, Loader, type LucideIcon } from "lucide-react";

import { type ToolStepStatus, truncateForPreview } from "~/lib/chat/tool-events";

/** Visual treatment for one tool-step row: the status icon + tailwind class. */
export type ToolStepVisual = {
  Icon: LucideIcon;
  className: string;
};

/**
 * Map a step's status to its icon + className. `ok` is emerald (success),
 * `error` is destructive (failure), and `running` is the primary brand color
 * with the tailwind `animate-spin` class so the loader rotates — lucide-react
 * has no `spin` prop (iteration 11), so the spin must come from a class.
 */
export function statusVisual(status: ToolStepStatus): ToolStepVisual {
  switch (status) {
    case "ok":
      return { Icon: CircleCheck, className: "text-emerald-500" };
    case "error":
      return { Icon: CircleX, className: "text-destructive" };
    case "running":
      return { Icon: Loader, className: "text-primary animate-spin" };
  }
}

/**
 * Render a tool's arguments as a compact preview string for the trace row.
 * Returns null when there's nothing worth showing (absent, empty, "{}") so the
 * row omits the preview line entirely. Object arguments are JSON-stringified;
 * a thrown stringify falls back to String(args). The result is collapsed to
 * one line and truncated to `max` chars with an ellipsis (via the shared
 * truncateForPreview in tool-events so the two stay in sync).
 */
export function formatArgsPreview(args: unknown, max = 140): string | null {
  if (args === undefined || args === null) {
    return null;
  }
  let text: string;
  if (typeof args === "string") {
    text = args;
  } else {
    try {
      text = JSON.stringify(args);
    } catch {
      text = String(args);
    }
  }
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed === "{}") {
    return null;
  }
  return truncateForPreview(trimmed, max);
}
