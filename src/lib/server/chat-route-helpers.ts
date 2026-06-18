/**
 * Pure helpers extracted from the `/api/chat` route so the input-validation
 * and response-header logic can be tested without spinning up the streaming
 * path (which needs a mocked OpenRouter network boundary).
 *
 * Everything in this module is a pure function over its arguments plus
 * `process.env` (only via the modules it imports) — no side effects, no
 * streaming, no network. The chat route imports these and stitches them
 * together with the streaming runtime.
 */

import type { ChatMessage } from "~/lib/server/openrouter";
import { SKILLS_PROMPT, type SkillCatalogSnapshot } from "~/lib/server/skills/skill-tools";
import { mockToolCount } from "~/lib/server/tools/mock-tools";
import type { ToolExposureMode } from "~/lib/server/tools/token-usage";
import { sentToolCountForMode } from "~/lib/server/tools/tool-loop";

export type IncomingMessage = { role?: unknown; content?: unknown };

export type IncomingSkillReference = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  body?: unknown;
};

export type IncomingSkill = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  body?: unknown;
  references?: unknown;
};

/** Base system prompt always sent on every chat turn. */
export const SYSTEM_PROMPT = [
  "Be friendly, concise, and helpful.",
  "If a request is ambiguous, ask one focused follow-up question before doing the work.",
].join(" ");

/**
 * Standard SSE response headers plus the reference's documented `/api/chat`
 * verification contract — `x-openrouter-model`, `x-mock-tools`, `x-total-tools`,
 * and `x-tool-exposure-mode` — so the active tool-routing configuration is
 * inspectable on every chat response (curl -i or the Network tab) without
 * waiting for the stream to complete. `extrasCount` adds skill (and any future
 * non-bridge) tools to `x-total-tools` so it reflects what the model sees.
 */
export function chatStreamHeaders(
  model: string,
  exposureMode: ToolExposureMode,
  extrasCount = 0,
): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "x-openrouter-model": model,
    "x-mock-tools": String(mockToolCount),
    "x-total-tools": String(sentToolCountForMode(exposureMode, extrasCount)),
    "x-tool-exposure-mode": exposureMode,
  };
}

/**
 * Validate the client's per-request skills snapshot. Fails soft — any
 * malformed row is dropped, never the whole request — so a buggy client
 * payload can't 400 the chat. The snapshot is already pre-filtered to enabled
 * skills by the client, but we re-check `body` since callers downstream assume
 * a non-empty instruction payload.
 */
export function toSkillSnapshot(skills: unknown): SkillCatalogSnapshot[] {
  if (!Array.isArray(skills)) {
    return [];
  }
  const out: SkillCatalogSnapshot[] = [];
  for (const raw of skills as IncomingSkill[]) {
    if (raw == null || typeof raw !== "object") {
      continue;
    }
    if (
      typeof raw.id !== "string" ||
      typeof raw.name !== "string" ||
      typeof raw.description !== "string" ||
      typeof raw.body !== "string"
    ) {
      continue;
    }
    const references = Array.isArray(raw.references) ? raw.references : [];
    const validReferences = references
      .map((reference) => reference as IncomingSkillReference)
      .filter(
        (reference) =>
          reference &&
          typeof reference === "object" &&
          typeof reference.id === "string" &&
          typeof reference.name === "string" &&
          typeof reference.description === "string" &&
          typeof reference.body === "string",
      )
      .map((reference) => ({
        body: reference.body as string,
        description: reference.description as string,
        id: reference.id as string,
        name: reference.name as string,
      }));
    out.push({
      body: raw.body,
      description: raw.description,
      id: raw.id,
      name: raw.name,
      references: validReferences,
    });
  }
  return out;
}

/**
 * Validate the client's message history. Returns null when the messages array
 * is missing/empty/malformed (so the route can 400), otherwise returns a
 * strictly-typed role+content array. Rejects any non-{user,assistant,system}
 * role or non-string / empty content.
 */
export function toChatMessages(messages: unknown): ChatMessage[] | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  const out: ChatMessage[] = [];
  for (const raw of messages as IncomingMessage[]) {
    if (raw == null || typeof raw !== "object") {
      return null;
    }
    const role = raw.role;
    const content = raw.content;
    if (role !== "user" && role !== "assistant" && role !== "system") {
      return null;
    }
    if (typeof content !== "string" || content.length === 0) {
      return null;
    }
    out.push({ role, content });
  }
  return out;
}

/**
 * Build the run's system prompt. The base prompt is always present; when the
 * client sent a non-empty skills catalog block, the SKILLS_PROMPT and the
 * `<available_skills>` block are appended so the model knows skill tools are
 * available and which skills to consider.
 */
export function buildSystemPrompt(skillCatalogBlock: string): string {
  if (skillCatalogBlock.length === 0) {
    return SYSTEM_PROMPT;
  }
  return [SYSTEM_PROMPT, SKILLS_PROMPT, skillCatalogBlock].join("\n\n");
}
