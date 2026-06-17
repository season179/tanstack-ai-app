/**
 * Background executor for scheduled tasks: runs a task's instruction against
 * `/api/chat` and writes the resulting assistant turn into the task's home chat
 * session, so a scheduled fire produces a REAL agent reply the user can read
 * via the board's "View transcript" button — not a synthetic placeholder.
 *
 * This closes the no-backend fidelity gap documented in iteration 5 (the
 * reference runs scheduled tasks on a server-side pg-boss queue with workers;
 * this port has no server workers, so the scheduler's ticker — which only runs
 * while a tab is open — kicks off execution here, client-side, reusing the same
 * `/api/chat` endpoint and the same SSE frame protocol the interactive chat
 * surface uses). The transcript is persisted to the same localStorage sessions
 * store, so "View transcript" lands on a real conversation.
 *
 * Lifecycle (owned here, fire-and-forget from the scheduler):
 *   - idempotent per run id (a re-tick or duplicate fire never double-runs)
 *   - bounded by RUN_TIMEOUT_MS so a hung upstream still settles the run
 *   - on success: completeRun("completed", { statusUpdate: assistantText })
 *   - on failure: completeRun("failed", null, error)
 */

import { readMessages, touchSession, writeMessages } from "~/lib/chat/sessions-store";
import { type ChatStreamEvent, readChatStream } from "~/lib/chat/sse-reader";
import {
  applyToolCall,
  applyToolResult,
  type TokenUsageBreakdown,
  type ToolSearchSummary,
  type TurnTokenUsage,
} from "~/lib/chat/tool-events";
import type { ChatMessage } from "~/lib/hooks/use-chat-stream";
import { completeRun } from "~/lib/tasks/tasks-store";
import type { ScheduledTask, ScheduledTaskRun } from "~/lib/tasks/types";

/** Hard cap on a single scheduled turn so a hung provider can't strand a run. */
const RUN_TIMEOUT_MS = 90_000;

/** Run ids with an executor currently in flight (idempotency guard). */
const inFlight = new Set<string>();

export type RunResult = { ok: true; text: string } | { ok: false; error: string };

function makeMessageId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown };
    if (typeof data.error === "string" && data.error.length > 0) {
      return data.error;
    }
  } catch {
    // Non-JSON error body — fall through to the status text.
  }
  return `Chat request failed with status ${response.status}.`;
}

/** Fold one streamed frame into the assistant turn in place (accumulating). */
function foldEvent(assistant: ChatMessage, event: ChatStreamEvent): void {
  switch (event.type) {
    case "text":
      assistant.content += event.text;
      return;
    case "reasoning":
      assistant.reasoning = (assistant.reasoning ?? "") + event.text;
      return;
    case "tool_call":
      assistant.toolSteps = applyToolCall(assistant.toolSteps ?? [], event);
      return;
    case "tool_result":
      assistant.toolSteps = applyToolResult(assistant.toolSteps ?? [], event);
      return;
    case "usage":
      assistant.tokenUsage = event.usage as TurnTokenUsage;
      return;
    case "breakdown":
      assistant.tokenUsageBreakdown = event.breakdown as TokenUsageBreakdown;
      return;
    case "metadata":
      assistant.toolSearch = event.metadata as ToolSearchSummary;
      return;
    case "error":
      // Surfaced by the caller via the returned error string.
      return;
    default: {
      // Exhaustiveness: any future frame type is silently ignored.
      const _exhaustive: never = event;
      void _exhaustive;
    }
  }
}

/**
 * Run a single scheduled instruction turn: stream the reply, fold it into an
 * assistant message, and append the user instruction + assistant turn to the
 * home session's transcript. Returns the assistant text on success or an error
 * message on failure. The abort signal bounds the turn (see RUN_TIMEOUT_MS).
 */
async function runInstructionTurn(task: ScheduledTask, signal: AbortSignal): Promise<RunResult> {
  const instruction = task.payload.instruction.trim();
  if (instruction.length === 0) {
    return { ok: false, error: "Task has no instruction." };
  }
  const homeSessionId = task.homeSessionId;
  if (!homeSessionId) {
    // Defensive: createTask always mints a home session, so this only happens
    // for legacy tasks created before that wiring. Don't strand the run.
    return { ok: false, error: "Task has no home session to write its transcript to." };
  }

  // Wire history = the home session's existing transcript + this fire's
  // instruction as the trailing user message. The server prepends the system
  // prompt; we send only the conversation (matches the interactive client).
  const history = readMessages(homeSessionId)
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({ role: message.role, content: message.content }));

  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: homeSessionId,
        messages: [...history, { role: "user", content: instruction }],
      }),
      signal,
    });
  } catch (fetchError) {
    if (signal.aborted) {
      return { ok: false, error: "Run timed out before the model replied." };
    }
    return {
      ok: false,
      error: fetchError instanceof Error ? fetchError.message : "Network request failed.",
    };
  }

  if (!response.ok || !response.body) {
    return { ok: false, error: await readErrorMessage(response) };
  }

  // Fold the stream into a fresh assistant turn. toolSteps/toolSearch/usage/
  // reasoning all land on the same message, mirroring the interactive client.
  const assistant: ChatMessage = { id: makeMessageId(), role: "assistant", content: "" };
  let streamError: string | null = null;
  try {
    await readChatStream(response.body, (event) => {
      if (event.type === "error") {
        streamError = event.message;
        return;
      }
      foldEvent(assistant, event);
    });
  } catch (streamError_) {
    if (signal.aborted) {
      return { ok: false, error: "Run timed out while streaming." };
    }
    return {
      ok: false,
      error: streamError_ instanceof Error ? streamError_.message : "Stream failed.",
    };
  }
  if (streamError) {
    return { ok: false, error: streamError };
  }

  // Append the user instruction + assistant turn to the home session. Re-read
  // immediately before writing so a concurrent writer (the user chatting in the
  // transcript, or another task's run) isn't clobbered — read-modify-write.
  const userMessage: ChatMessage = { id: makeMessageId(), role: "user", content: instruction };
  const latest = readMessages(homeSessionId);
  writeMessages(homeSessionId, [...latest, userMessage, assistant]);
  // Float the transcript to the top of the sidebar so a fresh scheduled reply
  // is discoverable, and bump updatedAt for the "ago" timestamp.
  touchSession(homeSessionId);

  return { ok: true, text: assistant.content };
}

/**
 * Execute a scheduled run end to end and settle it. Idempotent per run id and
 * bounded by RUN_TIMEOUT_MS. Fire-and-forget: the scheduler calls this once
 * when a run is promoted; it owns its own completion.
 */
export async function executeScheduledRun(
  run: ScheduledTaskRun,
  task: ScheduledTask,
): Promise<void> {
  if (inFlight.has(run.id)) {
    return;
  }
  inFlight.add(run.id);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

  let result: RunResult;
  try {
    result = await runInstructionTurn(task, controller.signal);
  } finally {
    clearTimeout(timer);
    inFlight.delete(run.id);
  }

  if (result.ok) {
    completeRun(
      run.id,
      "completed",
      { statusUpdate: result.text.trim().length > 0 ? result.text : "Completed." },
      null,
    );
  } else {
    completeRun(run.id, "failed", null, result.error);
  }
}
