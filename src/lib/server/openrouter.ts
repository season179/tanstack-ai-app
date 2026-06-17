/**
 * OpenRouter client helpers — no AI SDK. We call the REST API directly so the
 * project stays Next.js- and `ai`-free, as the objective requires.
 *
 * Two concerns live here:
 *  - the account-scoped model catalog (for the composer's picker), memoized with
 *    a short TTL so the list route and the chat route share one upstream request;
 *  - a streaming chat-completions helper that yields assistant text deltas and
 *    surfaces OpenRouter errors as structured failures.
 */

import { forEachOpenAiDelta } from "./sse";

const CHAT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_USER_ENDPOINT = "https://openrouter.ai/api/v1/models/user";
const CATALOG_TTL_MS = 5 * 60 * 1000;

/** Trimmed model shape sent to the client — just what the picker renders. */
export type OpenRouterModelSummary = {
  id: string;
  name: string;
  contextLength: number | null;
};

type RawModel = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
};

type CacheEntry = { models: OpenRouterModelSummary[]; expires: number };

// Keyed by API key so a future per-user key never serves another account's set.
const catalogCache = new Map<string, CacheEntry>();

/** A single turn in the conversation, in the OpenAI/OpenRouter chat shape. */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * A function-tool call emitted by the model. `arguments` is the raw JSON string
 * the model produced (possibly across many streaming fragments), parsed by the
 * caller before dispatch.
 */
export type OpenRouterToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/**
 * A function-tool definition handed to the model. `parameters` is a JSON Schema
 * object; matches `getMockToolFunctionSchema`'s `function.parameters` shape.
 */
export type OpenRouterFunctionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * The richer message shape the tool loop speaks: assistant turns can carry
 * tool_calls, and `tool`-role messages carry each tool result keyed by
 * tool_call_id so the model can correlate them on the next round.
 */
export type OpenRouterMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: OpenRouterToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Raised when the account isn't configured for chat; mapped to a 500 body. */
export class MissingEnvironmentVariableError extends Error {
  constructor(readonly variableName: "OPENROUTER_API_KEY" | "OPENROUTER_DEFAULT_MODEL") {
    super(`${variableName} is required before chat requests can be sent.`);
    this.name = "MissingEnvironmentVariableError";
  }
}

/** Thrown when OpenRouter returns a non-2xx streaming or catalog response. */
export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export function requireEnv(
  variableName: "OPENROUTER_API_KEY" | "OPENROUTER_DEFAULT_MODEL",
): string {
  const value = process.env[variableName]?.trim();
  if (!value) {
    throw new MissingEnvironmentVariableError(variableName);
  }
  return value;
}

function toSummary(raw: RawModel): OpenRouterModelSummary | null {
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    return null;
  }
  const name = typeof raw.name === "string" && raw.name.length > 0 ? raw.name : raw.id;
  const contextLength = typeof raw.context_length === "number" ? raw.context_length : null;
  return { id: raw.id, name, contextLength };
}

async function fetchCatalogFromUpstream(apiKey: string): Promise<OpenRouterModelSummary[]> {
  const response = await fetch(MODELS_USER_ENDPOINT, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new OpenRouterError(
      `OpenRouter models request failed with status ${response.status}`,
      response.status,
    );
  }

  const body: { data?: unknown } = await response.json();
  const data = Array.isArray(body.data) ? body.data : [];

  return data
    .map((raw) => toSummary(raw as RawModel))
    .filter((model): model is OpenRouterModelSummary => model !== null)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * Fetch the account's models, trimmed and sorted by display name. Memoized for
 * CATALOG_TTL_MS; throws on a non-2xx upstream response (a failed fetch is not
 * cached, so the next call retries). Callers decide how to fail soft.
 */
export async function fetchAccountModels(apiKey: string): Promise<OpenRouterModelSummary[]> {
  const cached = catalogCache.get(apiKey);
  if (cached && cached.expires > Date.now()) {
    return cached.models;
  }

  const models = await fetchCatalogFromUpstream(apiKey);
  catalogCache.set(apiKey, { models, expires: Date.now() + CATALOG_TTL_MS });
  return models;
}

/**
 * Resolve the model id for a chat turn. A client-supplied model is honored only
 * if it's in the account's catalog; anything missing, malformed, or unknown
 * falls back to the env default. Fails soft: if the catalog can't be fetched,
 * the default is used (never trust the client, never 400 the chat over it).
 */
export async function resolveChatModel({
  requested,
  apiKey,
  fallback,
}: {
  requested: string | null;
  apiKey: string;
  fallback: string;
}): Promise<string> {
  if (!requested || requested === fallback) {
    return fallback;
  }
  try {
    const models = await fetchAccountModels(apiKey);
    return models.some((model) => model.id === requested) ? requested : fallback;
  } catch (error) {
    console.error("Model validation failed; falling back to the default model", error);
    return fallback;
  }
}

export type StreamChatOptions = {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
};

/** Result of one tool-aware streaming round-trip with the model. */
export type ToolAwareTurnResult = {
  /** Concatenated assistant text deltas across the whole turn (may be ""). */
  content: string;
  /** Tool calls the model wants executed, in `index` order. Empty if none. */
  toolCalls: OpenRouterToolCall[];
  /** OpenAI finish reason: "tool_calls", "stop", "length", etc. */
  finishReason: string | null;
};

export type StreamToolAwareTurnOptions = {
  apiKey: string;
  model: string;
  messages: OpenRouterMessage[];
  /** Function tools the model may call. Omit for a plain text turn. */
  tools?: OpenRouterFunctionTool[];
  signal?: AbortSignal;
  /** Streamed for each assistant text delta (already includes tool loops). */
  onText?: (delta: string) => void;
};

/**
 * Start a streaming chat completion and return the upstream Response. Callers
 * read `response.body` as a server-sent-events stream of OpenAI-style chunks
 * (`choices[0].delta.content`). Throws OpenRouterError on a non-2xx status.
 */
export async function streamChatCompletion({
  apiKey,
  model,
  messages,
  signal,
}: StreamChatOptions): Promise<Response> {
  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Optional but recommended by OpenRouter for ranking + attribution.
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "TanStack AI App",
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await readErrorDetail(response);
    throw new OpenRouterError(
      detail ?? `OpenRouter chat request failed with status ${response.status}`,
      response.status,
    );
  }

  return response;
}

/**
 * Run ONE streaming chat round-trip that may return text and/or tool calls.
 * Pumps the upstream OpenAI stream, invoking `onText` for every assistant text
 * delta, and reassembles the streaming tool_call fragments (keyed by `index`)
 * into final tool calls. Returns the assembled assistant turn; the caller
 * decides whether to loop (tool_calls present) or finish (text only).
 *
 * No AI SDK: this is the hand-rolled function-calling primitive the deferred
 * tool-search loop drives.
 */
export async function streamToolAwareTurn({
  apiKey,
  model,
  messages,
  tools,
  signal,
  onText,
}: StreamToolAwareTurnOptions): Promise<ToolAwareTurnResult> {
  const body: Record<string, unknown> = { model, messages, stream: true };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "TanStack AI App",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await readErrorDetail(response);
    throw new OpenRouterError(
      detail ?? `OpenRouter chat request failed with status ${response.status}`,
      response.status,
    );
  }

  let content = "";
  let finishReason: string | null = null;
  const callByIndex = new Map<number, { id?: string; name?: string; arguments: string }>();

  await forEachOpenAiDelta(
    response.body,
    (delta) => {
      if (delta.content) {
        content += delta.content;
        onText?.(delta.content);
      }
      if (delta.tool_calls) {
        for (const call of delta.tool_calls) {
          const entry = callByIndex.get(call.index) ?? { arguments: "" };
          if (call.id) {
            entry.id = call.id;
          }
          if (call.function?.name) {
            entry.name = call.function.name;
          }
          if (typeof call.function?.arguments === "string") {
            entry.arguments += call.function.arguments;
          }
          callByIndex.set(call.index, entry);
        }
      }
      if (delta.finishReason) {
        finishReason = delta.finishReason;
      }
    },
    signal,
  );

  const toolCalls: OpenRouterToolCall[] = Array.from(callByIndex.entries())
    .sort(([firstIndex], [secondIndex]) => firstIndex - secondIndex)
    .map(([, entry]) => ({
      id: entry.id ?? `call_${Math.random().toString(36).slice(2, 12)}`,
      type: "function" as const,
      function: { name: entry.name ?? "", arguments: entry.arguments },
    }))
    .filter((call) => call.function.name.length > 0);

  return { content, toolCalls, finishReason };
}

async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const body = (await response.clone().json()) as {
      error?: unknown;
      message?: unknown;
    };
    const message =
      typeof body.error === "object" && body.error !== null
        ? (body.error as { message?: unknown }).message
        : body.error;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
    if (typeof body.message === "string" && body.message.length > 0) {
      return body.message;
    }
  } catch {
    // Non-JSON error body; fall through to the status-only message.
  }
  return null;
}
