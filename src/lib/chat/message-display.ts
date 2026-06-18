import { cn } from "~/lib/utils";

export type MessageSender = "user" | "assistant";

/**
 * The per-turn message content className, ported from the reference app's
 * `ai-elements/message.tsx` `MessageContent`. Both turns share the same inner
 * padding + text metrics (`px-4 py-3 text-sm leading-6`); only the chrome
 * differs:
 *
 * - user: a primary-colored bubble capped at 82% width with whitespace
 *   preservation (the user's input is plain text, never markdown).
 * - assistant: borderless text on the card foreground at up to 100% width —
 *   no background, rounding, or shadow (the modern chat-app pattern where only
 *   the user's input gets a bubble).
 *
 * Extracted from `chat-surface.tsx`'s `MessageBubble` so the fidelity contract
 * (user = bubble, assistant = borderless) is unit-testable and pinned against
 * a silent regression that re-bubbles the assistant turn.
 */
export function messageContentClassName(sender: MessageSender): string {
  return cn(
    "px-4 py-3 text-sm leading-6",
    sender === "user"
      ? "max-w-[min(46rem,82%)] whitespace-pre-wrap break-words rounded-lg bg-primary text-primary-foreground"
      : "max-w-[min(72rem,100%)] text-card-foreground",
  );
}
