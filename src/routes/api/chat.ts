import { createFileRoute } from "@tanstack/react-router";

import {
  type ChatMessage,
  compactUsage,
  MissingEnvironmentVariableError,
  OpenRouterError,
  type OpenRouterMessage,
  type OpenRouterTurnUsage,
  requireEnv,
  resolveChatModel,
  streamChatCompletion,
} from "~/lib/server/openrouter";
import {
  buildSkillCatalogBlock,
  buildSkillTools,
  executeSkillTool,
  SKILLS_PROMPT,
  type SkillCatalogSnapshot,
} from "~/lib/server/skills/skill-tools";
import { pumpChatCompletion, SSE_DONE, sseData } from "~/lib/server/sse";
import { mockToolCount } from "~/lib/server/tools/mock-tools";
import {
  estimateRequestTokenUsage,
  resolveToolExposureMode,
  type TokenUsageBreakdown,
  type ToolExposureMode,
  toTokenUsageBreakdown,
} from "~/lib/server/tools/token-usage";
import { runToolLoop, sentToolCountForMode } from "~/lib/server/tools/tool-loop";
import { isUuid } from "~/lib/utils";

/**
 * Standard SSE response headers plus the reference's documented `/api/chat`
 * verification contract — `x-openrouter-model`, `x-mock-tools`, `x-total-tools`,
 * and `x-tool-exposure-mode` — so the active tool-routing configuration is
 * inspectable on every chat response (curl -i or the Network tab) without
 * waiting for the stream to complete. `extrasCount` adds skill (and any future
 * non-bridge) tools to `x-total-tools` so it reflects what the model sees.
 */
function chatStreamHeaders(
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

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return handleChat(request);
      },
    },
  },
});

const SYSTEM_PROMPT = [
  "Be friendly, concise, and helpful.",
  "If a request is ambiguous, ask one focused follow-up question before doing the work.",
].join(" ");

type ChatRequestBody = {
  id?: unknown;
  messages?: unknown;
  model?: unknown;
  skills?: unknown;
};

type IncomingMessage = { role?: unknown; content?: unknown };

type IncomingSkillReference = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  body?: unknown;
};

type IncomingSkill = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  body?: unknown;
  references?: unknown;
};

/**
 * Validate the client's per-request skills snapshot. Fails soft — any
 * malformed row is dropped, never the whole request — so a buggy client
 * payload can't 400 the chat. The snapshot is already pre-filtered to enabled
 * skills by the client, but we re-check `body` since callers downstream assume
 * a non-empty instruction payload.
 */
function toSkillSnapshot(skills: unknown): SkillCatalogSnapshot[] {
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

function toChatMessages(messages: unknown): ChatMessage[] | null {
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

async function handleChat(request: Request): Promise<Response> {
  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  // The optional chat id is accepted for parity with the reference's
  // server-authoritative contract but isn't persisted yet (no DB this iteration).
  // Validate it up front so a malformed id still 400s rather than streaming.
  if (body.id != null) {
    if (typeof body.id !== "string" || !isUuid(body.id)) {
      return Response.json({ error: "Chat id must be a UUID." }, { status: 400 });
    }
  }

  const messages = toChatMessages(body.messages);
  if (!messages) {
    return Response.json(
      { error: "Request body must include a non-empty messages array." },
      { status: 400 },
    );
  }

  const requestedModel =
    typeof body.model === "string" && body.model.trim().length > 0 ? body.model.trim() : null;

  let apiKey: string;
  let defaultModel: string;
  try {
    apiKey = requireEnv("OPENROUTER_API_KEY");
    defaultModel = requireEnv("OPENROUTER_DEFAULT_MODEL");
  } catch (error) {
    if (error instanceof MissingEnvironmentVariableError) {
      return Response.json(
        {
          error: `${error.variableName} is missing. Add it to .env and restart the dev server.`,
        },
        { status: 500 },
      );
    }
    throw error;
  }

  const model = await resolveChatModel({
    requested: requestedModel,
    apiKey,
    fallback: defaultModel,
  });

  // The client sends its current skills catalog snapshot (enabled skills from
  // localStorage) so the server-side tool loop can expose skill_search /
  // skill_get_content as agent tools over that snapshot. Fails soft to empty —
  // a malformed payload just means no skill tools this turn, not a 400.
  const skillsSnapshot = toSkillSnapshot(body.skills);
  const skillTools = skillsSnapshot.length > 0 ? buildSkillTools() : [];
  const skillCatalogBlock = buildSkillCatalogBlock(skillsSnapshot);

  const runMessages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(skillCatalogBlock) },
    ...messages,
  ];

  const exposureMode = resolveToolExposureMode(process.env.TOOL_EXPOSURE_MODE);

  // `none` keeps the original AI-SDK-free plain streaming path byte-identical
  // (a safe baseline / opt-out). Skill tools are only exposed on the tool-loop
  // paths (search/all) — the plain path has no tool dispatch, so a user who
  // wants skill activation in `none` mode falls back to the /skill-name
  // composer command (which injects the instructions directly on the wire).
  if (exposureMode === "none") {
    return streamPlainChat({ apiKey, model, runMessages, request, exposureMode });
  }

  return streamToolChat({
    apiKey,
    model,
    messages,
    exposureMode,
    request,
    skillTools,
    skillsSnapshot,
    skillCatalogBlock,
  });
}

/**
 * Build the run's system prompt. The base prompt is always present; when the
 * client sent a non-empty skills snapshot, the SKILLS_PROMPT and the
 * `<available_skills>` catalog block are appended so the model knows skill
 * tools are available and which skills to consider.
 */
function buildSystemPrompt(skillCatalogBlock: string): string {
  if (skillCatalogBlock.length === 0) {
    return SYSTEM_PROMPT;
  }
  return [SYSTEM_PROMPT, SKILLS_PROMPT, skillCatalogBlock].join("\n\n");
}

/** Plain streaming path: re-emit OpenRouter text deltas as our minimal SSE. */
async function streamPlainChat({
  apiKey,
  model,
  runMessages,
  request,
  exposureMode,
}: {
  apiKey: string;
  model: string;
  runMessages: ChatMessage[];
  request: Request;
  exposureMode: ToolExposureMode;
}): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await streamChatCompletion({
      apiKey,
      model,
      messages: runMessages,
      signal: request.signal,
    });
  } catch (error) {
    return upstreamErrorResponse(error);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (frame: string) => {
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          // The client may have disconnected; the controller is already closed.
        }
      };

      // Plain path makes exactly one upstream request, so at most one usage
      // chunk lands; keep the latest and emit it once at the end (zeros if the
      // provider omitted it or the request aborted).
      let usage: OpenRouterTurnUsage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
      };
      // One prompt-cost estimate for the single upstream request, used to build
      // the input-token split (system prompt / messages / request options).
      const requestEstimate = estimateRequestTokenUsage({
        model,
        messages: runMessages,
        stream: true,
        stream_options: { include_usage: true },
      });

      try {
        await pumpChatCompletion(
          upstream.body,
          (event) => {
            send(sseData(event));
          },
          request.signal,
          (rawUsage) => {
            usage = compactUsage(rawUsage);
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Chat stream failed.";
        send(sseData({ type: "error", message }));
      } finally {
        send(sseData({ type: "usage", usage }));
        const breakdown: TokenUsageBreakdown | undefined = requestEstimate
          ? toTokenUsageBreakdown(usage.inputTokens, [requestEstimate])
          : undefined;
        if (breakdown) {
          send(sseData({ type: "breakdown", breakdown }));
        }
        send(SSE_DONE);
        try {
          controller.close();
        } catch {
          // Already closed by a disconnect; safe to ignore.
        }
      }
    },
    cancel(reason) {
      // Propagate client disconnects upstream so OpenRouter stops billing tokens.
      upstream.body?.cancel(reason).catch(() => {});
    },
  });

  return new Response(stream, { headers: chatStreamHeaders(model, exposureMode) });
}

/**
 * Tool-loop streaming path. Drives runToolLoop, mapping its events onto the
 * SSE channel: text deltas keep the existing {type:"text"} shape (so the
 * current client renders them unchanged), while tool_call/tool_result and a
 * final metadata frame are emitted as new event types the client ignores for
 * now (forward-compatible with the chat-UI surfacing iteration).
 */
async function streamToolChat({
  apiKey,
  model,
  messages,
  exposureMode,
  request,
  skillTools,
  skillsSnapshot,
  skillCatalogBlock,
}: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  exposureMode: Exclude<ReturnType<typeof resolveToolExposureMode>, "none">;
  request: Request;
  skillTools: ReturnType<typeof buildSkillTools>;
  skillsSnapshot: SkillCatalogSnapshot[];
  skillCatalogBlock: string;
}): Promise<Response> {
  const runMessages: OpenRouterMessage[] = [
    { role: "system", content: buildSystemPrompt(skillCatalogBlock) },
    ...messages,
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (frame: string) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          closed = true;
        }
      };

      try {
        await runToolLoop({
          apiKey,
          model,
          messages: runMessages,
          mode: exposureMode,
          signal: request.signal,
          onEvent: (event) => {
            send(sseData(event));
          },
          // Skill tools ride alongside the bridge / mock catalog; calls to
          // them dispatch over the per-request snapshot (no Postgres, no
          // client round-trip — the snapshot is already in the request body).
          ...(skillTools.length > 0
            ? {
                extraTools: skillTools,
                extraToolHandler: (name: string, args: Record<string, unknown>) =>
                  executeSkillTool(name, args, skillsSnapshot),
              }
            : {}),
        });
      } catch (error) {
        if (!request.signal.aborted) {
          const message =
            error instanceof OpenRouterError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Chat stream failed.";
          send(sseData({ type: "error", message }));
          console.error("Tool loop failed", error);
        }
      } finally {
        send(SSE_DONE);
        try {
          controller.close();
        } catch {
          // Already closed by a disconnect; safe to ignore.
        }
        closed = true;
      }
    },
    cancel(reason) {
      // The loop reads request.signal; aborting it propagates to OpenRouter.
      // No upstream handle to cancel here — runToolLoop owns the fetch.
      void reason;
    },
  });

  return new Response(stream, {
    headers: chatStreamHeaders(model, exposureMode, skillTools.length),
  });
}

/** Map a pre-stream OpenRouter error to the right HTTP response. */
function upstreamErrorResponse(error: unknown): Response {
  if (error instanceof OpenRouterError) {
    return Response.json({ error: error.message }, { status: 502 });
  }
  console.error("Chat stream failed to start", error);
  return Response.json(
    { error: "Chat request failed before the stream could start." },
    { status: 500 },
  );
}
