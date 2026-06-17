// Tests for the no-AI-SDK session titler (title.ts). This is the last
// side-effect server module driving a user-visible feature (AI-generated chat
// titles) that had no co-located coverage: it was implemented in iteration 23
// and verified live, but never pinned. The function reads process.env and hits
// the network (one non-streaming OpenRouter round-trip), so the harness mocks
// global `fetch` to return scripted Responses and controls `process.env`,
// exercising both the public contract (fail-soft null returns + the normalized
// title) and the private helpers (extractContentText + normalizeTitle) through
// the single exported entry point.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateSessionTitle } from "~/lib/server/title";

/** Restore process.env + globals after each test so mutations don't leak. */
afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_TITLE_MODEL;
  delete process.env.OPENROUTER_DEFAULT_MODEL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A successful OpenRouter non-streaming body carrying the given content. */
function okBody(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** A scripted fetch whose `.json()` resolves to the given parsed body. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Set the env the titler reads; apiKey/model may be omitted to test guards. */
function setEnv(opts: { apiKey?: string; titleModel?: string; defaultModel?: string } = {}) {
  if (opts.apiKey !== undefined) process.env.OPENROUTER_API_KEY = opts.apiKey;
  if (opts.titleModel !== undefined) process.env.OPENROUTER_TITLE_MODEL = opts.titleModel;
  if (opts.defaultModel !== undefined) process.env.OPENROUTER_DEFAULT_MODEL = opts.defaultModel;
}

describe("generateSessionTitle — env guards", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okBody("A Real Title")));
  });

  it("returns null and never calls fetch when OPENROUTER_API_KEY is unset", async () => {
    setEnv({ defaultModel: "m" });
    const result = await generateSessionTitle({
      firstUserText: "hi",
      firstAssistantText: "hello",
    });
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns null and never calls fetch when OPENROUTER_API_KEY is whitespace", async () => {
    setEnv({ apiKey: "   ", defaultModel: "m" });
    const result = await generateSessionTitle({
      firstUserText: "hi",
      firstAssistantText: "hello",
    });
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns null and never calls fetch when no model env is set", async () => {
    setEnv({ apiKey: "k" });
    const result = await generateSessionTitle({
      firstUserText: "hi",
      firstAssistantText: "hello",
    });
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("prefers OPENROUTER_TITLE_MODEL over OPENROUTER_DEFAULT_MODEL on the wire", async () => {
    setEnv({ apiKey: "k", titleModel: "title-model", defaultModel: "default-model" });
    await generateSessionTitle({ firstUserText: "hi", firstAssistantText: "hello" });
    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as { model: string };
    expect(body.model).toBe("title-model");
  });

  it("falls back to OPENROUTER_DEFAULT_MODEL when TITLE_MODEL is unset", async () => {
    setEnv({ apiKey: "k", defaultModel: "default-model" });
    await generateSessionTitle({ firstUserText: "hi", firstAssistantText: "hello" });
    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as { model: string };
    expect(body.model).toBe("default-model");
  });

  it("trims a whitespace-padded model env before sending", async () => {
    setEnv({ apiKey: "k", defaultModel: "  trimmed-model  " });
    await generateSessionTitle({ firstUserText: "hi", firstAssistantText: "hello" });
    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as { model: string };
    expect(body.model).toBe("trimmed-model");
  });
});

describe("generateSessionTitle — empty-input guard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okBody("A Real Title")));
  });

  it("returns null and never calls fetch when both texts are empty", async () => {
    setEnv({ apiKey: "k", defaultModel: "m" });
    const result = await generateSessionTitle({ firstUserText: "", firstAssistantText: "" });
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns null and never calls fetch when both texts are whitespace-only", async () => {
    setEnv({ apiKey: "k", defaultModel: "m" });
    const result = await generateSessionTitle({
      firstUserText: "   \t",
      firstAssistantText: "\n",
    });
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still names a session when only the user text is non-empty", async () => {
    setEnv({ apiKey: "k", defaultModel: "m" });
    const result = await generateSessionTitle({ firstUserText: "hello", firstAssistantText: "" });
    expect(result).toBe("A Real Title");
  });
});

describe("generateSessionTitle — request construction", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okBody("A Real Title")));
  });

  it("POSTs to the OpenRouter chat endpoint with Bearer auth + JSON content-type", async () => {
    setEnv({ apiKey: "secret-key", defaultModel: "m" });
    await generateSessionTitle({ firstUserText: "hi", firstAssistantText: "hello" });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sends the title system prompt + a user message labeling both turns", async () => {
    setEnv({ apiKey: "k", defaultModel: "m" });
    await generateSessionTitle({ firstUserText: "What is 2+2?", firstAssistantText: "4" });
    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as {
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.max_tokens).toBe(1024);
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toMatch(/3-5 word title/);
    expect(body.messages[1]?.role).toBe("user");
    expect(body.messages[1]?.content).toContain("Conversation to title:");
    expect(body.messages[1]?.content).toContain("User: What is 2+2?");
    expect(body.messages[1]?.content).toContain("Assistant: 4");
  });

  it("truncates each source text to the 2000-char cap on the wire", async () => {
    setEnv({ apiKey: "k", defaultModel: "m" });
    const longUser = "u".repeat(3000);
    const longAssistant = "a".repeat(3000);
    await generateSessionTitle({ firstUserText: longUser, firstAssistantText: longAssistant });
    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as { messages: Array<{ content: string }> };
    expect(body.messages[1]?.content).toContain(`User: ${"u".repeat(2000)}`);
    expect(body.messages[1]?.content).not.toContain(`User: ${"u".repeat(2001)}`);
    expect(body.messages[1]?.content).toContain(`Assistant: ${"a".repeat(2000)}`);
    expect(body.messages[1]?.content).not.toContain(`Assistant: ${"a".repeat(2001)}`);
  });
});

describe("generateSessionTitle — failure modes (fail-soft → null)", () => {
  beforeEach(() => {
    // Silence the executor's diagnostic console.error calls during failure tests.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns null when fetch rejects", async () => {
    setEnv({ apiKey: "k", defaultModel: "m" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await generateSessionTitle({
      firstUserText: "hi",
      firstAssistantText: "hello",
    });
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("returns null on a non-2xx response", async () => {
    setEnv({ apiKey: "k", defaultModel: "m" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, { error: "rate limited" })));
    const result = await generateSessionTitle({
      firstUserText: "hi",
      firstAssistantText: "hello",
    });
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("returns null when the response body is not valid JSON", async () => {
    setEnv({ apiKey: "k", defaultModel: "m" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("not json at all", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );
    const result = await generateSessionTitle({
      firstUserText: "hi",
      firstAssistantText: "hello",
    });
    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("returns null when the body is missing the choices array", async () => {
    setEnv({ apiKey: "k", defaultModel: "m" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})));
    const result = await generateSessionTitle({
      firstUserText: "hi",
      firstAssistantText: "hello",
    });
    expect(result).toBeNull();
  });

  it("returns null when choices is empty", async () => {
    setEnv({ apiKey: "k", defaultModel: "m" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { choices: [] })));
    const result = await generateSessionTitle({
      firstUserText: "hi",
      firstAssistantText: "hello",
    });
    expect(result).toBeNull();
  });

  it("returns null when message.content is not a string", async () => {
    setEnv({ apiKey: "k", defaultModel: "m" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: null } }] })),
    );
    const result = await generateSessionTitle({
      firstUserText: "hi",
      firstAssistantText: "hello",
    });
    expect(result).toBeNull();
  });
});

describe("generateSessionTitle — title normalization", () => {
  beforeEach(() => {
    setEnv({ apiKey: "k", defaultModel: "m" });
  });

  /** Stub fetch to return the given content string from a success body. */
  function stubContent(content: string) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okBody(content)));
  }

  it("strips wrapping double quotes", async () => {
    stubContent('"Ocean Haiku Creation"');
    expect(await generateSessionTitle({ firstUserText: "hi", firstAssistantText: "hello" })).toBe(
      "Ocean Haiku Creation",
    );
  });

  it("strips wrapping single quotes", async () => {
    stubContent("'Ocean Haiku Creation'");
    expect(await generateSessionTitle({ firstUserText: "hi", firstAssistantText: "hello" })).toBe(
      "Ocean Haiku Creation",
    );
  });

  it("strips backticks", async () => {
    stubContent("`Ocean Haiku Creation`");
    expect(await generateSessionTitle({ firstUserText: "hi", firstAssistantText: "hello" })).toBe(
      "Ocean Haiku Creation",
    );
  });

  it("collapses internal whitespace runs into single spaces", async () => {
    stubContent("Ocean   Haiku\t\tCreation\n\nNow");
    expect(await generateSessionTitle({ firstUserText: "hi", firstAssistantText: "hello" })).toBe(
      "Ocean Haiku Creation Now",
    );
  });

  it("drops a trailing run of periods", async () => {
    stubContent("Ocean Haiku Creation...");
    expect(await generateSessionTitle({ firstUserText: "hi", firstAssistantText: "hello" })).toBe(
      "Ocean Haiku Creation",
    );
  });

  it("caps the title at 60 characters", async () => {
    stubContent("x".repeat(80));
    const result = await generateSessionTitle({
      firstUserText: "hi",
      firstAssistantText: "hello",
    });
    expect(result).toHaveLength(60);
    expect(result).toBe("x".repeat(60));
  });

  it("returns null when the content is only punctuation that normalizes away", async () => {
    stubContent('""`...   ');
    const result = await generateSessionTitle({
      firstUserText: "hi",
      firstAssistantText: "hello",
    });
    expect(result).toBeNull();
  });

  it("passes through an already-clean title unchanged", async () => {
    stubContent("A Clean Title");
    expect(await generateSessionTitle({ firstUserText: "hi", firstAssistantText: "hello" })).toBe(
      "A Clean Title",
    );
  });
});
