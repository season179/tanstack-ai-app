import { createFileRoute } from "@tanstack/react-router";

import {
  type ChatMessage,
  MissingEnvironmentVariableError,
  OpenRouterError,
  requireEnv,
  resolveChatModel,
  streamChatCompletion,
} from "~/lib/server/openrouter";
import { pumpChatCompletion, SSE_DONE, SSE_HEADERS, sseData } from "~/lib/server/sse";
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

  let upstream: Response;
  try {
    upstream = await streamChatCompletion({
      apiKey,
      model,
      messages: runMessages,
      signal: request.signal,
    });
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return Response.json({ error: error.message }, { status: 502 });
    }
    console.error("Chat stream failed to start", error);
    return Response.json(
      { error: "Chat request failed before the stream could start." },
      { status: 500 },
    );
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
