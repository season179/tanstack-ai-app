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
