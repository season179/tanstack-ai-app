/**
 * Session title generation — no AI SDK. A single non-streaming OpenRouter chat
 * completion call that names a conversation from its first user+assistant
 * exchange. Deliberately isolated from the chat route so it can be tuned or
 * swapped independently: its own model env (OPENROUTER_TITLE_MODEL, falling
 * back to OPENROUTER_DEFAULT_MODEL), its own prompt, and its own limits.
 *
 * Fully fail-soft: returns null on any problem (missing env, network error,
 * non-2xx, malformed body, empty result) so the caller never blocks on or
 * fails because of titling. Mirrors the reference's generateSessionTitle
 * contract, minus the `ai` SDK's generateText.
 */

const CHAT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const TITLE_SYSTEM_PROMPT =
  "Return only a 3-5 word title for this conversation. No quotes, no punctuation, no trailing period.";

const MAX_TITLE_CHARS = 60;
const MAX_SOURCE_CHARS = 2000;
// Generous on purpose: when the configured model is a reasoning model (e.g.
// deepseek-v4-pro), it spends many tokens on chain-of-thought BEFORE emitting
// the title content. A tight cap (the reference's 24 works only for
// non-reasoning models) truncates mid-reasoning with finish_reason "length"
// and a null content, so every other title silently fails. This is a one-shot
// call per session, so the extra headroom costs nothing meaningful.
const MAX_OUTPUT_TOKENS = 1024;

export type GenerateSessionTitleInput = {
  firstUserText: string;
  firstAssistantText: string;
};

/**
 * Names a chat session via one non-streaming OpenRouter round-trip. Returns the
 * normalized title, or null if anything went wrong (including nothing-to-name
 * inputs) so callers can fall back to a first-message title without special
 * casing.
 */
export async function generateSessionTitle({
  firstUserText,
  firstAssistantText,
}: GenerateSessionTitleInput): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = (
    process.env.OPENROUTER_TITLE_MODEL ?? process.env.OPENROUTER_DEFAULT_MODEL
  )?.trim();

  if (!apiKey || !model) {
    return null;
  }

  // Nothing to name (e.g. a tool-only first turn with no visible text) — don't
  // spend a model call prompting on empty strings.
  if (!firstUserText.trim() && !firstAssistantText.trim()) {
    return null;
  }

  let response: Response;
  try {
    response = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: "system", content: TITLE_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              "Conversation to title:",
              `User: ${firstUserText.slice(0, MAX_SOURCE_CHARS)}`,
              `Assistant: ${firstAssistantText.slice(0, MAX_SOURCE_CHARS)}`,
            ].join("\n\n"),
          },
        ],
      }),
    });
  } catch (error) {
    console.error("Session title generation fetch failed", error);
    return null;
  }

  if (!response.ok) {
    console.error(
      `Session title generation failed with status ${response.status}: ${await response
        .text()
        .catch(() => "")}`,
    );
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    console.error("Session title generation returned malformed JSON", error);
    return null;
  }

  const text = extractContentText(body);
  return text == null ? null : normalizeTitle(text);
}

/** Pull `choices[0].message.content` (string) off a chat-completions body. */
function extractContentText(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

/**
 * Tidy a model-produced title: strip wrapping quotes/backticks, collapse
 * internal whitespace, drop a trailing run of periods, cap at MAX_TITLE_CHARS.
 * Empty after cleaning → null so the caller falls back.
 */
function normalizeTitle(raw: string): string | null {
  const cleaned = raw
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.]+$/, "")
    .slice(0, MAX_TITLE_CHARS)
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}
