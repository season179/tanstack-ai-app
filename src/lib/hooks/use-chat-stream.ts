import { useCallback, useEffect, useRef, useState } from "react";

import {
  readMessages,
  setGeneratedSessionTitle,
  setSessionTitleFromMessage,
  touchSession,
  writeMessages,
} from "~/lib/chat/sessions-store";
import {
  applyToolCall,
  applyToolResult,
  type BreakdownFrame,
  type MetadataFrame,
  type TokenUsageBreakdown,
  type ToolCallFrame,
  type ToolFrame,
  type ToolResultFrame,
  type ToolSearchSummary,
  type ToolStep,
  type TurnTokenUsage,
  type UsageFrame,
} from "~/lib/chat/tool-events";
import { buildActivatedSkillContent } from "~/lib/skills/activation";
import type { Skill } from "~/lib/skills/skills-store";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /**
   * Assistant turns only: the model's chain-of-thought / thinking text streamed
   * ahead of (or interleaved with) its visible answer by reasoning models
   * (OpenAI o-series, Claude w/ thinking, DeepSeek-R1, …). Rendered in a
   * collapsible panel above the bubble; persisted so a reload keeps it.
   */
  reasoning?: string;
  /**
   * Set on a user turn that activated a skill via /skill-name. Stored with the
   * transcript so the activation badge survives reloads; the injected skill
   * instructions are never persisted (only sent on the wire, see send()).
   */
  activatedSkill?: string;
  /**
   * Assistant turns only: the tool_call/tool_result pairs the server emitted
   * while producing this reply (the deferred tool-search loop). Empty/omitted
   * for plain text turns. Persisted so a reload keeps the activity trace.
   */
  toolSteps?: ToolStep[];
  /**
   * Assistant turns only: the deferred-vs-all token-savings summary emitted as
   * a final metadata frame. Surfaced under the bubble; persisted with the turn.
   */
  toolSearch?: ToolSearchSummary;
  /**
   * Assistant turns only: real OpenRouter token usage for this turn. For the
   * tool loop this is the SUM across every round-trip (search → describe → call
   * → final answer); for the plain path it's the single upstream request's
   * usage. Persisted so a reload keeps the per-turn token readout.
   */
  tokenUsage?: TurnTokenUsage;
  /**
   * Assistant turns only: the estimated input-token split (system prompt /
   * tool schemas / conversation) for this turn, surfaced in the header's
   * Session Tokens menu. Persisted so a reload keeps the allocation bar.
   */
  tokenUsageBreakdown?: TokenUsageBreakdown;
};

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";

export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | ToolFrame;

type SendOptions = {
  /** The model id the composer's picker chose, or null for the server default. */
  model?: string | null;
  /**
   * A skill activated by a leading /skill-name command. Its instructions are
   * prepended to this user turn on the wire (only); null/undefined sends the
   * raw text. Disabled or empty-body skills are ignored by the caller.
   */
  skill?: Skill | null;
};

type WireMessage = { role: ChatMessage["role"]; content: string };

type RegenerateOptions = {
  /** The model id the composer's picker chose, or null for the server default. */
  model?: string | null;
  /**
   * Resolves a skill name back to its Skill object so a regenerated turn can
   * re-inject the activation block the original user turn carried (the block is
   * never persisted, only the name is). Optional — without it a turn whose user
   * message activated a skill regenerates without the instructions.
   */
  resolveSkill?: (name: string) => Skill | null;
};

export type UseChatStream = {
  messages: ChatMessage[];
  status: ChatStatus;
  error: string | null;
  send: (text: string, options?: SendOptions) => void;
  /** Re-runs the last user turn, replacing the trailing assistant reply. */
  regenerate: (options?: RegenerateOptions) => void;
  stop: () => void;
};

function makeId(): string {
  // Avoid a hard crypto dependency; a timestamp + counter is unique enough for
  // client-side React keys within a session.
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Streaming chat client bound to a single persisted session. Owns the message
 * list, streaming status, and an AbortController so the composer can cancel a
 * run. Reads the server's SSE protocol directly (data: {"type":"text","text":
 * "..."} and a terminal data: [DONE]).
 *
 * Turns are mirrored to localStorage (under the session id) at send-time and on
 * stream completion, plus on unmount, so a reload mid- or post-conversation
 * restores the transcript. The empty assistant placeholder is never persisted.
 */
export function useChatStream(sessionId: string): UseChatStream {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Keep the latest messages in a ref so the unmount/abort persistence path
  // always sees the final transcript without depending on the state closure.
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // True once this session has been (or is being) titled, so the AI titler
  // fires at most once per session and never re-titles a loaded/renamed one.
  // Reset per-session via the keyed remount at the call site.
  const titledRef = useRef(false);

  // Load any persisted transcript for this session once on mount, and mark it
  // already-titled when it has history so a loaded session is never re-titled.
  useEffect(() => {
    const loaded = readMessages(sessionId);
    setMessages(loaded);
    titledRef.current = loaded.length > 0;
    // Re-read on sessionId change is handled by the keyed remount at the call
    // site (ChatSurface key={sessionId}); this effect therefore runs per-mount.
  }, [sessionId]);

  // First-turn titling: once the first user+assistant exchange completes (the
  // assistant reply has visible content and the stream settled to 'ready'),
  // ask the server to name the session and upgrade the instant first-message
  // title. Driven from an effect (not the streaming finalize) because React's
  // automatic batching defers the finalize's setMessages updater past any code
  // that runs right after it; an effect runs post-commit and reliably sees the
  // finalized transcript. Guarded by titledRef so it fires once and skips
  // loaded sessions (titledRef set in the load effect above).
  useEffect(() => {
    if (titledRef.current) {
      return;
    }
    if (status !== "ready" || messages.length !== 2) {
      return;
    }
    const [firstUser, firstAssistant] = messages;
    if (
      !firstUser ||
      !firstAssistant ||
      firstUser.role !== "user" ||
      firstAssistant.role !== "assistant" ||
      firstAssistant.content.length === 0
    ) {
      return;
    }
    titledRef.current = true;
    void generateTitleForSession(sessionId, firstUser.content, firstAssistant.content);
  }, [messages, status, sessionId]);

  /** Persist a snapshot, dropping any trailing empty assistant placeholder. */
  const persist = useCallback(
    (snapshot: ChatMessage[]) => {
      const stable = snapshot.filter(
        (message) => !(message.role === "assistant" && message.content.length === 0),
      );
      writeMessages(sessionId, stable);
    },
    [sessionId],
  );

  // On unmount, flush whatever transcript we have so a tab close mid-stream
  // still keeps the user turn and any partial assistant reply. Guarded: an
  // empty ref means there is no unsaved content to flush, so we skip — this
  // is essential under React StrictMode (TanStack Start's default), which
  // double-invokes mount/unmount in dev: on the first unmount the load effect
  // hasn't committed yet (messagesRef is still []), so an unconditional flush
  // would overwrite persisted history with empty and silently wipe the chat.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (messagesRef.current.length > 0) {
        persist(messagesRef.current);
      }
    };
  }, [persist]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("ready");
    persist(messagesRef.current);
  }, [persist]);

  /**
   * Shared streaming core: fetch /api/chat with the already-built wire payload
   * and fold the SSE frames into the empty assistant placeholder identified by
   * `assistantId`. Both send() and regenerate() set up their message arrays +
   * persisted history first, then hand off here so the fetch/parse/finalize
   * path is written once.
   */
  const streamTurn = useCallback(
    (params: { assistantId: string; model?: string | null; wireMessages: WireMessage[] }) => {
      const { assistantId, model, wireMessages } = params;
      const controller = new AbortController();
      abortRef.current = controller;

      void (async () => {
        let response: Response;
        try {
          response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: sessionId,
              model: model ?? undefined,
              messages: wireMessages,
            }),
            signal: controller.signal,
          });
        } catch (fetchError) {
          if (controller.signal.aborted) {
            return;
          }
          setStatus("error");
          setError(fetchError instanceof Error ? fetchError.message : "Network request failed.");
          return;
        }

        if (!response.ok || !response.body) {
          const message = await readErrorMessage(response);
          setStatus("error");
          setError(message);
          return;
        }

        setStatus("streaming");

        try {
          await readChatStream(response.body, (event) => {
            if (event.type === "error") {
              setError(event.message);
              return;
            }
            if (event.type === "text") {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? { ...message, content: message.content + event.text }
                    : message,
                ),
              );
              return;
            }
            if (event.type === "reasoning") {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? { ...message, reasoning: (message.reasoning ?? "") + event.text }
                    : message,
                ),
              );
              return;
            }
            // tool_call / tool_result / metadata / usage: fold into the assistant turn.
            setMessages((current) =>
              current.map((message) => {
                if (message.id !== assistantId) {
                  return message;
                }
                if (event.type === "tool_call") {
                  const steps = applyToolCall(message.toolSteps ?? [], event);
                  return { ...message, toolSteps: steps };
                }
                if (event.type === "tool_result") {
                  const steps = applyToolResult(message.toolSteps ?? [], event);
                  return { ...message, toolSteps: steps };
                }
                if (event.type === "usage") {
                  return { ...message, tokenUsage: event.usage };
                }
                if (event.type === "breakdown") {
                  return { ...message, tokenUsageBreakdown: event.breakdown };
                }
                // metadata
                return { ...message, toolSearch: event.metadata };
              }),
            );
          });
        } catch (streamError) {
          if (controller.signal.aborted) {
            return;
          }
          setStatus("error");
          setError(streamError instanceof Error ? streamError.message : "Stream failed.");
          return;
        }

        // Drop the placeholder if the assistant turn stayed empty (no tokens
        // landed), then persist the final transcript + float the chat. The
        // updater's `current` is authoritative (the final streamed token may not
        // have reached messagesRef yet). persist() only writes localStorage
        // (no subscriber notify, idempotent under StrictMode's double-invoke) so
        // it's safe inside the updater; touchSession() notifies AppSidebar's
        // subscription, so it MUST run outside — calling it during this state
        // update triggers React's "Cannot update a component while rendering a
        // different component" warning.
        //
        // First-turn titling is NOT fired here: React 18's automatic batching
        // defers this updater to the render phase, so any code reading a
        // closure variable populated inside it would run before the updater
        // commits. Titling is driven by a post-commit useEffect below (guarded
        // by a ref) which reliably sees the finalized transcript.
        setMessages((current) => {
          const finalized = current.filter(
            (message) => !(message.id === assistantId && message.content.length === 0),
          );
          persist(finalized);
          return finalized;
        });
        touchSession(sessionId);
        setStatus("ready");
      })();
    },
    [persist, sessionId],
  );

  const send = useCallback(
    (text: string, options: SendOptions = {}) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || status === "submitted" || status === "streaming") {
        return;
      }

      setError(null);

      const activatedSkill = options.skill?.isEnabled ? options.skill.name : undefined;
      const userMessage: ChatMessage = {
        id: makeId(),
        role: "user",
        content: trimmed,
        activatedSkill,
      };
      const assistantMessage: ChatMessage = { id: makeId(), role: "assistant", content: "" };

      // Skill activation: the instruction block is prepended to this user turn
      // on the wire only. It is never stored in `content` (the UI and the
      // transcript keep the raw /skill-name text), so a reload shows the
      // original message and the activation badge rather than a wall of XML.
      const skillBlock = options.skill?.isEnabled
        ? buildActivatedSkillContent(options.skill)
        : null;

      // Capture the outbound history before we append the placeholder assistant
      // turn: the server reconstructs nothing, so we send the full conversation
      // minus the empty streaming reply.
      const outbound = [...messages, userMessage];

      setMessages([...outbound, assistantMessage]);
      setStatus("submitted");

      // Persist the user turn immediately and float the chat to the top of the
      // sidebar; auto-title from this first user message as instant feedback
      // (the AI titler upgrades it once the reply resolves, if still overridable).
      persist(outbound);
      touchSession(sessionId);
      setSessionTitleFromMessage(sessionId, trimmed);

      streamTurn({
        assistantId: assistantMessage.id,
        model: options.model,
        wireMessages: outbound.map(({ id, role, content }) => ({
          role,
          content: id === userMessage.id && skillBlock ? `${skillBlock}\n\n${content}` : content,
        })),
      });
    },
    [messages, status, streamTurn, persist, sessionId],
  );

  /**
   * Re-run the last user turn. Drops the trailing assistant reply (whether a
   * failed/partial turn from an error, or a complete one the user wants
   * regenerated), rebuilds the wire payload from history, and streams a fresh
   * reply. Skill activation is re-injected if the last user message carried one
   * and a resolver is supplied (the injected block is never persisted, only the
   * name is). No-op while a turn is in flight or when there is no user turn.
   */
  const regenerate = useCallback(
    (options: RegenerateOptions = {}) => {
      if (status === "submitted" || status === "streaming") {
        return;
      }

      // Find the last user turn; everything after it (the assistant reply,
      // partial or complete) is what we replace.
      let lastUserIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index].role === "user") {
          lastUserIndex = index;
          break;
        }
      }
      if (lastUserIndex === -1) {
        return;
      }

      const lastUserMessage = messages[lastUserIndex];
      const history = messages.slice(0, lastUserIndex + 1);
      const assistantMessage: ChatMessage = { id: makeId(), role: "assistant", content: "" };

      setError(null);
      setMessages([...history, assistantMessage]);
      setStatus("submitted");
      persist(history);
      touchSession(sessionId);

      // Re-inject the activation block if the original user turn carried a
      // skill and the caller can resolve it back to a Skill object.
      const skillName = lastUserMessage.activatedSkill;
      const skill = skillName ? (options.resolveSkill?.(skillName) ?? null) : null;
      const skillBlock = skill?.isEnabled ? buildActivatedSkillContent(skill) : null;

      streamTurn({
        assistantId: assistantMessage.id,
        model: options.model,
        wireMessages: history.map(({ id, role, content }) => ({
          role,
          content:
            id === lastUserMessage.id && skillBlock ? `${skillBlock}\n\n${content}` : content,
        })),
      });
    },
    [messages, status, streamTurn, persist, sessionId],
  );

  return { messages, status, error, send, regenerate, stop };
}

/**
 * Ask the server to name the session from its first user+assistant exchange
 * and apply the result. Fail-soft: on any error, non-ok response, or null
 * title, nothing happens — the instant first-message title set in send()
 * (titleSource 'auto') already covers the fallback, so a silent skip is the
 * correct behavior, not a missing title.
 */
async function generateTitleForSession(
  sessionId: string,
  firstUserText: string,
  firstAssistantText: string,
): Promise<void> {
  try {
    const response = await fetch("/api/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstUserText, firstAssistantText }),
    });
    if (response.ok) {
      const body = (await response.json()) as { title?: unknown };
      if (typeof body.title === "string" && body.title.trim().length > 0) {
        setGeneratedSessionTitle(sessionId, body.title);
      }
    }
  } catch {
    // Network/abort failure — leave the instant first-message title in place.
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length > 0) {
      return body.error;
    }
  } catch {
    // Non-JSON error body; fall through to the status message.
  }
  return `Chat request failed with status ${response.status}.`;
}

/** Parse our SSE protocol from a byte stream, invoking onEvent per frame. */
async function readChatStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");

      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }

      const payload = trimmed.slice("data:".length).trim();
      if (payload.length === 0 || payload === "[DONE]") {
        continue;
      }

      let parsed: {
        type?: unknown;
        text?: unknown;
        message?: unknown;
        call?: unknown;
        result?: unknown;
        metadata?: unknown;
        usage?: unknown;
        breakdown?: unknown;
      };
      try {
        parsed = JSON.parse(payload) as typeof parsed;
      } catch {
        continue;
      }

      if (parsed.type === "text" && typeof parsed.text === "string") {
        onEvent({ type: "text", text: parsed.text });
      } else if (parsed.type === "reasoning" && typeof parsed.text === "string") {
        onEvent({ type: "reasoning", text: parsed.text });
      } else if (parsed.type === "error" && typeof parsed.message === "string") {
        onEvent({ type: "error", message: parsed.message });
      } else if (parsed.type === "tool_call") {
        const frame = parseToolCallFrame(parsed.call);
        if (frame) {
          onEvent(frame);
        }
      } else if (parsed.type === "tool_result") {
        const frame = parseToolResultFrame(parsed.result);
        if (frame) {
          onEvent(frame);
        }
      } else if (parsed.type === "usage") {
        const frame = parseUsageFrame(parsed.usage);
        if (frame) {
          onEvent(frame);
        }
      } else if (parsed.type === "breakdown") {
        const frame = parseBreakdownFrame(parsed.breakdown);
        if (frame) {
          onEvent(frame);
        }
      } else if (parsed.type === "metadata") {
        const frame = parseMetadataFrame(parsed.metadata);
        if (frame) {
          onEvent(frame);
        }
      }
    }
  }
}

/** Validate a tool_call frame payload off the wire; null if malformed. */
function parseToolCallFrame(raw: unknown): ToolCallFrame | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const call = raw as { name?: unknown; arguments?: unknown; service?: unknown; title?: unknown };
  if (typeof call.name !== "string" || call.name.length === 0) {
    return null;
  }
  return {
    type: "tool_call",
    call: {
      name: call.name,
      arguments: call.arguments,
      service: typeof call.service === "string" ? call.service : undefined,
      title: typeof call.title === "string" ? call.title : undefined,
    },
  };
}

/** Validate a tool_result frame payload off the wire; null if malformed. */
function parseToolResultFrame(raw: unknown): ToolResultFrame | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const result = raw as { name?: unknown; ok?: unknown; output?: unknown };
  if (typeof result.name !== "string" || result.name.length === 0) {
    return null;
  }
  return {
    type: "tool_result",
    result: {
      name: result.name,
      ok: result.ok === true,
      output: result.output,
    },
  };
}

/**
 * Validate a usage frame payload off the wire; null if malformed or missing
 * the numeric fields the UI reads. Defaults any missing field to 0 so the
 * provider's partial usage (e.g. only prompt/completion, no cached/reasoning)
 * still surfaces without crashing the parser.
 */
function parseUsageFrame(raw: unknown): UsageFrame | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const u = raw as Record<string, unknown>;
  const num = (key: string): number =>
    typeof u[key] === "number" && Number.isFinite(u[key] as number) && (u[key] as number) >= 0
      ? (u[key] as number)
      : 0;
  return {
    type: "usage",
    usage: {
      inputTokens: num("inputTokens"),
      outputTokens: num("outputTokens"),
      totalTokens: num("totalTokens"),
      reasoningTokens: num("reasoningTokens"),
      cachedInputTokens: num("cachedInputTokens"),
    },
  };
}

/**
 * Validate a breakdown frame payload off the wire; null if malformed or
 * missing the categories array the UI renders. Numeric fields default sanely
 * so a partial breakdown still surfaces; unknown extra fields are dropped so
 * the persisted shape stays the client's own.
 */
function parseBreakdownFrame(raw: unknown): BreakdownFrame | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const b = raw as Record<string, unknown>;
  if (!Array.isArray(b.categories)) {
    return null;
  }
  const categories = b.categories
    .map(parseBreakdownCategory)
    .filter((category): category is NonNullable<typeof category> => category !== null);
  if (categories.length === 0) {
    return null;
  }
  const tools = Array.isArray(b.tools)
    ? b.tools
        .map(parseToolBreakdown)
        .filter((tool): tool is NonNullable<typeof tool> => tool !== null)
    : [];
  const num = (key: string): number =>
    typeof b[key] === "number" && Number.isFinite(b[key] as number) && (b[key] as number) >= 0
      ? (b[key] as number)
      : 0;
  const inputTokens =
    typeof b.inputTokens === "number" && Number.isFinite(b.inputTokens) ? b.inputTokens : undefined;
  return {
    type: "breakdown",
    breakdown: {
      inputTokens,
      estimated: true,
      requestCount: num("requestCount") || 1,
      messageCount: num("messageCount"),
      toolCount: num("toolCount"),
      excludedRequestOptionTokens: num("excludedRequestOptionTokens"),
      categories,
      tools,
    },
  };
}

function parseBreakdownCategory(
  raw: unknown,
): import("~/lib/chat/tool-events").TokenUsageBreakdownCategory | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const c = raw as Record<string, unknown>;
  if (c.id !== "systemPrompt" && c.id !== "messages" && c.id !== "tools") {
    return undefined;
  }
  const id = c.id;
  const num = (key: string): number =>
    typeof c[key] === "number" && Number.isFinite(c[key] as number) && (c[key] as number) >= 0
      ? (c[key] as number)
      : 0;
  return {
    id,
    label: typeof c.label === "string" && c.label.length > 0 ? c.label : id,
    tokens: num("tokens"),
    percentage: num("percentage"),
    chars: num("chars"),
  };
}

function parseToolBreakdown(
  raw: unknown,
): import("~/lib/chat/tool-events").TokenUsageToolBreakdown | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const t = raw as Record<string, unknown>;
  if (typeof t.name !== "string" || t.name.length === 0) {
    return undefined;
  }
  const num = (key: string): number =>
    typeof t[key] === "number" && Number.isFinite(t[key] as number) && (t[key] as number) >= 0
      ? (t[key] as number)
      : 0;
  return {
    name: t.name,
    tokens: num("tokens"),
    percentage: num("percentage"),
    chars: num("chars"),
  };
}

/**
 * Validate a metadata frame payload off the wire; null if malformed or missing
 * the numeric fields the UI reads. Unknown extra fields (e.g. `trace`) are
 * tolerated and dropped so the persisted shape stays the client's own.
 */
function parseMetadataFrame(raw: unknown): MetadataFrame | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const m = raw as Record<string, unknown>;
  const mode = m.mode === "all" || m.mode === "search" ? m.mode : null;
  if (!mode) {
    return null;
  }
  const num = (key: string): number => (typeof m[key] === "number" ? (m[key] as number) : 0);
  return {
    type: "metadata",
    metadata: {
      mode,
      availableToolCount: num("availableToolCount"),
      sentToolCount: num("sentToolCount"),
      deferredToolCount: num("deferredToolCount"),
      requestCount: num("requestCount"),
      catalogSchemaTokens: num("catalogSchemaTokens"),
      sentSchemaTokens: num("sentSchemaTokens"),
      baselineSchemaTokens: num("baselineSchemaTokens"),
      savedSchemaTokens: num("savedSchemaTokens"),
      searchCount: num("searchCount"),
      describeCount: num("describeCount"),
      callCount: num("callCount"),
    },
  };
}
