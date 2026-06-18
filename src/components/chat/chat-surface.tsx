import { AlertCircle, ArrowDown, ArrowUp, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MessageRow } from "~/components/chat/chat-message";
import { useChatShell } from "~/components/chat/chat-shell-context";
import { ModelPicker } from "~/components/chat/model-picker";
import { Button } from "~/components/ui/button";
import { dedupeMessagesById } from "~/lib/chat/messages";
import { type ChatUsageSummary, sumUsage } from "~/lib/chat/tool-events";
import { useChatStream } from "~/lib/hooks/use-chat-stream";
import { useModels } from "~/lib/hooks/use-models";
import { useSkills } from "~/lib/hooks/use-skills";
import { findActivatableSkill } from "~/lib/skills/activation";
import { parsePartialSkillCommand, parseSkillCommand } from "~/lib/skills/slash-command";
import { cn } from "~/lib/utils";

// Shared horizontal framing: same centered column + gutters the rest of the app
// uses (max-w-7xl + px-4/8/10).
const SHELL_COLUMN = "mx-auto w-full max-w-7xl px-4 sm:px-8 lg:px-10";

/** If the user is within this many px of the bottom, treat them as "pinned"
 * and keep auto-following the stream; further up, leave them in place and
 * surface a jump-to-latest button instead of yanking them down per token. */
const SCROLL_PIN_THRESHOLD = 80;

export function ChatSurface({ sessionId }: { sessionId: string }) {
  // Skills are read BEFORE useChatStream so the hook can ship the enabled-skills
  // snapshot with each chat request (the server exposes skill_search /
  // skill_get_content as agent tools over that snapshot). Ordering matters:
  // hooks must be called unconditionally and in the same order every render,
  // and useChatStream's body references `skills`.
  const { skills } = useSkills();
  const { messages, status, error, send, stop, regenerate } = useChatStream(sessionId, skills);
  const { models, defaultModel, selectedModel, loading, setSelectedModel, ensureLoaded } =
    useModels();

  const [input, setInput] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Two async writers feed the message list: this hook's own streaming and
  // the per-session live-merge subscriber (which folds in turns appended by
  // the scheduled-task executor when a task fires into the viewed chat). When
  // a scheduled fire lands mid-turn, the same assistant turn can briefly
  // appear from both writers before they reconcile. Dedupe by id at this
  // single read boundary so React always sees unique keys (a duplicate key
  // crashes the list render) and the token-usage summary can't double-count.
  // First occurrence wins to keep each message at the position where it first
  // appeared. Ported from the reference's chat-surface render boundary.
  const renderedMessages = useMemo(() => dedupeMessagesById(messages), [messages]);

  // --- Skill slash-command autocomplete (/skill-name) ---------------------
  // The catalog is the user's enabled skills; only they can be activated.
  const activatableSkills = useMemo(() => skills.filter((skill) => skill.isEnabled), [skills]);
  const skillQuery = parsePartialSkillCommand(input);
  const skillMatches = useMemo(
    () =>
      skillQuery === null
        ? []
        : activatableSkills.filter((skill) => skill.name.startsWith(skillQuery)),
    [activatableSkills, skillQuery],
  );
  const [skillMenuDismissed, setSkillMenuDismissed] = useState(false);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const isSkillMenuOpen = skillQuery !== null && skillMatches.length > 0 && !skillMenuDismissed;
  const highlightedSkillIndex = Math.min(activeSkillIndex, Math.max(skillMatches.length - 1, 0));

  const acceptSkill = useCallback((name: string) => {
    setInput(`/${name} `);
    setSkillMenuDismissed(true);
    requestAnimationFrame(() => {
      const element = inputRef.current;
      if (!element || element.disabled) {
        return;
      }
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    });
  }, []);

  const isBusy = status === "submitted" || status === "streaming";
  const canSubmit = input.trim().length > 0 && !isBusy;
  const { setBusy, setUsage } = useChatShell();

  // Resolve a skill name back to its Skill object so a regenerated turn can
  // re-inject the activation block the original user turn carried (the block is
  // never persisted, only the name is). Stable across renders since the
  // underlying list identity is memoized above.
  const resolveSkill = useCallback(
    (name: string) => findActivatableSkill(activatableSkills, name),
    [activatableSkills],
  );
  const handleRegenerate = useCallback(
    () => regenerate({ model: selectedModel, resolveSkill }),
    [regenerate, selectedModel, resolveSkill],
  );

  // The last assistant message is the one a regenerate acts on; only surface
  // the affordance when the conversation ends on a real (non-empty) assistant
  // turn and nothing is in flight.
  const lastMessage = renderedMessages.at(-1);
  const canRegenerateLast =
    !isBusy && lastMessage?.role === "assistant" && lastMessage.content.trim().length > 0;

  // Mirror the streaming state up so the route header can show Ready/Responding.
  useEffect(() => {
    setBusy(isBusy);
  }, [isBusy, setBusy]);

  // Surface the running token totals to the header's Session Tokens menu.
  // `renderedMessages` gets a new reference on essentially every render during
  // streaming, so memoizing on it alone would mint a fresh summary object each
  // time — even though the numbers only move when a turn finishes (that's when
  // the usage frame lands). A signature guard preserves the prior identity so
  // the reporting effect doesn't loop (setUsage -> shell re-render -> us ->
  // recompute -> setUsage ...).
  const usageRef = useRef<ChatUsageSummary>({
    sessionUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
    },
  });
  const usageSignatureRef = useRef<string>("");
  const usageSummary = useMemo<ChatUsageSummary>(() => {
    const assistantMessages = renderedMessages.filter((message) => message.role === "assistant");
    const latest = assistantMessages.at(-1);
    const next: ChatUsageSummary = {
      sessionUsage: sumUsage(
        assistantMessages
          .map((message) => message.tokenUsage)
          .filter((usage): usage is NonNullable<typeof usage> => usage !== undefined),
      ),
      latestUsage: latest?.tokenUsage,
      latestToolSearch: latest?.toolSearch,
      latestBreakdown: latest?.tokenUsageBreakdown,
    };
    const signature = JSON.stringify(next);
    if (signature === usageSignatureRef.current) {
      return usageRef.current;
    }
    usageSignatureRef.current = signature;
    usageRef.current = next;
    return next;
  }, [renderedMessages]);

  useEffect(() => {
    setUsage(usageSummary);
  }, [usageSummary, setUsage]);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      const element = inputRef.current;
      if (!element || element.disabled) {
        return;
      }
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    });
  }, []);

  // Pin-to-bottom auto-scroll: only follow the stream when the user is already
  // near the latest message. If they've scrolled up to read history, leave them
  // there and surface a "jump to latest" button (below) instead of yanking them
  // down on every streamed token. The ref MUST sit on the element that actually
  // scrolls (overflow-y-auto) or scrollTo() is a silent no-op.
  const [isAtBottom, setIsAtBottom] = useState(true);
  const handleScroll = useCallback(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }
    const distanceFromBottom = content.scrollHeight - content.scrollTop - content.clientHeight;
    setIsAtBottom(distanceFromBottom <= SCROLL_PIN_THRESHOLD);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const content = contentRef.current;
    if (!content) {
      return;
    }
    content.scrollTo({ top: content.scrollHeight, behavior });
    setIsAtBottom(true);
  }, []);

  // Auto-follow the stream (instantly) only while pinned; on mount this also
  // lands a restored transcript at the most recent turn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages is an intentional trigger (not referenced in the body) so we re-scroll as new tokens arrive.
  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom("auto");
    }
  }, [isAtBottom, messages, scrollToBottom]);

  useEffect(() => {
    if (!isBusy) {
      focusInput();
    }
  }, [focusInput, isBusy]);

  function handleSubmit() {
    const text = input.trim();
    if (!text || isBusy) {
      focusInput();
      return;
    }
    // Resolve a leading /skill-name to an enabled skill; its instructions are
    // injected into this turn on the wire (see useChatStream.send). Unknown or
    // disabled names fail soft — the raw text is sent and the model treats the
    // /command as ordinary text.
    const skillName = parseSkillCommand(text);
    const skill = skillName ? findActivatableSkill(activatableSkills, skillName) : null;
    send(text, { model: selectedModel, skill });
    setInput("");
    setSkillMenuDismissed(false);
    // The user just sent: re-pin so the streaming reply stays in view even if
    // they had scrolled up to quote history.
    setIsAtBottom(true);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          aria-live="polite"
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={handleScroll}
          ref={contentRef}
        >
          <div className={`${SHELL_COLUMN} py-6 sm:py-10`}>
            {renderedMessages.length === 0 ? (
              <div className="mx-auto flex min-h-[60vh] max-w-xl flex-1 flex-col items-center justify-center text-center">
                <h1 className="text-2xl font-semibold tracking-normal text-foreground">
                  How can I help?
                </h1>
                <p className="mt-3 max-w-[44ch] text-sm leading-6 text-muted-foreground">
                  Ask anything. Responses stream live from OpenRouter.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {renderedMessages.map((message) => {
                  const isAssistantActive =
                    isBusy &&
                    message.id === renderedMessages.at(-1)?.id &&
                    message.role === "assistant";
                  return (
                    <MessageRow
                      key={message.id}
                      activatedSkill={message.activatedSkill}
                      content={message.content}
                      isLastAssistant={
                        canRegenerateLast &&
                        message.id === lastMessage?.id &&
                        message.role === "assistant"
                      }
                      isStreaming={isAssistantActive}
                      onRegenerate={handleRegenerate}
                      origin={message.origin}
                      reasoning={message.reasoning}
                      sender={message.role}
                      tokenUsage={message.tokenUsage}
                      toolSteps={message.toolSteps}
                      toolSearch={message.toolSearch}
                    />
                  );
                })}

                {status === "submitted" ? (
                  <MessageRow content="" isStreaming sender="assistant" />
                ) : null}
              </div>
            )}
          </div>
        </div>
        {renderedMessages.length > 0 && !isAtBottom ? (
          <Button
            aria-label="Scroll to latest message"
            className="absolute bottom-4 right-4 z-10 rounded-full shadow-md"
            onClick={() => scrollToBottom("smooth")}
            size="icon"
            type="button"
            variant="outline"
          >
            <ArrowDown className="size-4" />
          </Button>
        ) : null}
      </div>

      <div className="shrink-0 bg-background/95 py-3 backdrop-blur sm:py-5">
        <div className={`relative ${SHELL_COLUMN}`}>
          {isSkillMenuOpen ? (
            <div
              aria-label="Skills"
              className="absolute bottom-full left-0 z-50 mb-2 max-h-64 w-full max-w-md overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg"
              role="listbox"
            >
              {skillMatches.map((skill, index) => (
                <button
                  aria-selected={index === highlightedSkillIndex}
                  className={cn(
                    "flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm",
                    index === highlightedSkillIndex ? "bg-muted" : "hover:bg-muted/60",
                  )}
                  key={skill.id}
                  onClick={() => acceptSkill(skill.name)}
                  role="option"
                  type="button"
                >
                  <span className="shrink-0 font-medium text-foreground">/{skill.name}</span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {skill.description}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {error ? (
            <div
              className="mb-3 flex items-start gap-3 rounded-lg border border-destructive/30 bg-background px-4 py-3 text-sm text-destructive shadow-sm"
              role="alert"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Chat request failed</p>
                <p className="mt-1 break-words text-destructive/80">{error}</p>
              </div>
              <Button onClick={handleRegenerate} size="sm" type="button" variant="outline">
                Retry
              </Button>
            </div>
          ) : null}

          <div className="relative flex items-end gap-2 rounded-xl border border-border/80 bg-card/95 p-2 shadow-[var(--shadow-pop)] transition-shadow focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/10">
            <textarea
              aria-label="Message"
              className="max-h-48 min-h-6 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
              disabled={isBusy}
              onChange={(event) => {
                setInput(event.currentTarget.value);
                // Any keystroke re-opens a dismissed menu and resets the
                // highlight (Escape is the only dismiss; the next char reopens).
                setSkillMenuDismissed(false);
                setActiveSkillIndex(0);
              }}
              onKeyDown={(event) => {
                if (isSkillMenuOpen) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const delta = event.key === "ArrowDown" ? 1 : -1;
                    setActiveSkillIndex(
                      (highlightedSkillIndex + delta + skillMatches.length) % skillMatches.length,
                    );
                    return;
                  }

                  if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
                    event.preventDefault();
                    acceptSkill(skillMatches[highlightedSkillIndex].name);
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    setSkillMenuDismissed(true);
                    return;
                  }
                }

                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder="Send a message... (/skill-name to activate a skill)"
              ref={inputRef}
              rows={1}
              value={input}
            />

            <div className="flex shrink-0 items-center gap-1">
              <ModelPicker
                defaultModel={defaultModel}
                disabled={isBusy}
                loading={loading}
                models={models}
                onChange={setSelectedModel}
                onOpen={ensureLoaded}
                value={selectedModel}
              />
              {isBusy ? (
                <Button
                  aria-label="Stop"
                  onClick={stop}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <Square className="size-4 fill-current" />
                </Button>
              ) : (
                <Button
                  aria-label="Send message"
                  disabled={!canSubmit}
                  onClick={handleSubmit}
                  size="icon"
                  type="button"
                >
                  <ArrowUp className="size-4" />
                </Button>
              )}
            </div>
          </div>
          <p className="mt-1.5 pl-2 text-[11px] text-muted-foreground">
            Enter to send · Shift+Enter for a newline
          </p>
        </div>
      </div>
    </div>
  );
}
