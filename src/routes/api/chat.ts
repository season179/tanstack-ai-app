import { createFileRoute } from "@tanstack/react-router";

import {
  type ChatMessage,
  MissingEnvironmentVariableError,
  OpenRouterError,
  type OpenRouterMessage,
  requireEnv,
  resolveChatModel,
  streamChatCompletion,
} from "~/lib/server/openrouter";
import { pumpChatCompletion, SSE_DONE, SSE_HEADERS, sseData } from "~/lib/server/sse";
import { resolveToolExposureMode } from "~/lib/server/tools/token-usage";
import { runToolLoop } from "~/lib/server/tools/tool-loop";
import { isUuid } from "~/lib/utils";

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
};

type IncomingMessage = { role?: unknown; content?: unknown };

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

  const runMessages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...messages];

  const exposureMode = resolveToolExposureMode(process.env.TOOL_EXPOSURE_MODE);

  // `none` keeps the original AI-SDK-free plain streaming path byte-identical
  // (a safe baseline / opt-out). `search` (default) and `all` drive the
  // deferred tool-search loop, emitting text + tool_call/tool_result/metadata
  // frames over the same SSE channel.
  if (exposureMode === "none") {
    return streamPlainChat({ apiKey, model, runMessages, request });
  }

  return streamToolChat({ apiKey, model, messages, exposureMode, request });
}

/** Plain streaming path: re-emit OpenRouter text deltas as our minimal SSE. */
async function streamPlainChat({
  apiKey,
  model,
  runMessages,
  request,
}: {
  apiKey: string;
  model: string;
  runMessages: ChatMessage[];
  request: Request;
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

      try {
        await pumpChatCompletion(
          upstream.body,
          (event) => {
            send(sseData(event));
          },
          request.signal,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Chat stream failed.";
        send(sseData({ type: "error", message }));
      } finally {
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

  return new Response(stream, { headers: SSE_HEADERS });
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
}: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  exposureMode: Exclude<ReturnType<typeof resolveToolExposureMode>, "none">;
  request: Request;
}): Promise<Response> {
  const runMessages: OpenRouterMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
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

  return new Response(stream, { headers: SSE_HEADERS });
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
