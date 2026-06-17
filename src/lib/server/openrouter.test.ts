import { afterEach, describe, expect, it } from "vitest";
import {
  compactUsage,
  type MissingEnvironmentVariableError,
  MissingEnvironmentVariableError as MissingEnvVarError,
  OpenRouterError,
  type OpenRouterTurnUsage,
  requireEnv,
  sumUsage,
} from "~/lib/server/openrouter";
import type { OpenAiUsage } from "~/lib/server/sse";

/** Empty usage record reused across tests. */
const ZERO: OpenRouterTurnUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
};

/** Restore process.env after each test so env mutations don't leak. */
afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_DEFAULT_MODEL;
});

describe("compactUsage", () => {
  it("compacts a fully-populated OpenAiUsage into the client-facing shape", () => {
    const usage: OpenAiUsage = {
      promptTokens: 100,
      completionTokens: 32,
      totalTokens: 132,
      cachedPromptTokens: 12,
      reasoningTokens: 7,
    };
    expect(compactUsage(usage)).toEqual({
      inputTokens: 100,
      outputTokens: 32,
      totalTokens: 132,
      reasoningTokens: 7,
      cachedInputTokens: 12,
    });
  });

  it("defaults every field to 0 when usage is undefined", () => {
    expect(compactUsage(undefined)).toEqual(ZERO);
  });

  it("defaults every field to 0 when usage is null", () => {
    expect(compactUsage(null)).toEqual(ZERO);
  });

  it("defaults missing fields to 0 (providers differ in what they populate)", () => {
    // A provider that only populates prompt/completion/total.
    expect(compactUsage({ promptTokens: 10, completionTokens: 4, totalTokens: 14 })).toEqual({
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
      reasoningTokens: 0,
      cachedInputTokens: 0,
    });
  });

  it("treats an explicitly-empty usage object as all-zeros", () => {
    expect(compactUsage({})).toEqual(ZERO);
  });

  it("maps promptTokens → inputTokens and completionTokens → outputTokens (the cross-API rename)", () => {
    expect(compactUsage({ promptTokens: 5, completionTokens: 9, totalTokens: 14 })).toMatchObject({
      inputTokens: 5,
      outputTokens: 9,
    });
  });
});

describe("sumUsage", () => {
  it("sums every field across two per-turn records", () => {
    const a: OpenRouterTurnUsage = {
      inputTokens: 100,
      outputTokens: 32,
      totalTokens: 132,
      reasoningTokens: 7,
      cachedInputTokens: 12,
    };
    const b: OpenRouterTurnUsage = {
      inputTokens: 50,
      outputTokens: 8,
      totalTokens: 58,
      reasoningTokens: 3,
      cachedInputTokens: 4,
    };
    expect(sumUsage(a, b)).toEqual({
      inputTokens: 150,
      outputTokens: 40,
      totalTokens: 190,
      reasoningTokens: 10,
      cachedInputTokens: 16,
    });
  });

  it("is additive with zeros (the loop's seeded accumulator starts at all-zeros)", () => {
    const turn: OpenRouterTurnUsage = {
      inputTokens: 100,
      outputTokens: 32,
      totalTokens: 132,
      reasoningTokens: 7,
      cachedInputTokens: 12,
    };
    expect(sumUsage(ZERO, turn)).toEqual(turn);
    expect(sumUsage(turn, ZERO)).toEqual(turn);
  });

  it("accumulates across many round-trips via left-fold", () => {
    // Mirrors the tool loop's `usage = sumUsage(usage, compactUsage(turn.usage))`.
    let acc: OpenRouterTurnUsage = { ...ZERO };
    const turns: OpenRouterTurnUsage[] = [
      {
        inputTokens: 10,
        outputTokens: 1,
        totalTokens: 11,
        reasoningTokens: 0,
        cachedInputTokens: 0,
      },
      {
        inputTokens: 20,
        outputTokens: 2,
        totalTokens: 22,
        reasoningTokens: 5,
        cachedInputTokens: 1,
      },
      {
        inputTokens: 30,
        outputTokens: 3,
        totalTokens: 33,
        reasoningTokens: 0,
        cachedInputTokens: 0,
      },
    ];
    for (const turn of turns) {
      acc = sumUsage(acc, turn);
    }
    expect(acc).toEqual({
      inputTokens: 60,
      outputTokens: 6,
      totalTokens: 66,
      reasoningTokens: 5,
      cachedInputTokens: 1,
    });
  });

  it("does not mutate its accumulator argument", () => {
    const acc: OpenRouterTurnUsage = {
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      reasoningTokens: 1,
      cachedInputTokens: 0,
    };
    const snapshot = { ...acc };
    sumUsage(acc, { ...ZERO, inputTokens: 5 });
    expect(acc).toEqual(snapshot);
  });
});

describe("requireEnv", () => {
  it("returns the trimmed value when set", () => {
    process.env.OPENROUTER_API_KEY = "  sk-or-abc  ";
    expect(requireEnv("OPENROUTER_API_KEY")).toBe("sk-or-abc");
  });

  it("returns an untrimmed value verbatim after trim when no surrounding whitespace", () => {
    process.env.OPENROUTER_DEFAULT_MODEL = "deepseek/deepseek-v4-pro";
    expect(requireEnv("OPENROUTER_DEFAULT_MODEL")).toBe("deepseek/deepseek-v4-pro");
  });

  it("throws MissingEnvironmentVariableError when unset", () => {
    expect(() => requireEnv("OPENROUTER_API_KEY")).toThrow(MissingEnvVarError);
  });

  it("throws MissingEnvironmentVariableError when blank (whitespace only)", () => {
    process.env.OPENROUTER_API_KEY = "   ";
    expect(() => requireEnv("OPENROUTER_API_KEY")).toThrow(MissingEnvVarError);
  });

  it("throws MissingEnvironmentVariableError when empty string", () => {
    process.env.OPENROUTER_API_KEY = "";
    expect(() => requireEnv("OPENROUTER_API_KEY")).toThrow(MissingEnvVarError);
  });

  it("stamps the offending variable name on the thrown error", () => {
    try {
      requireEnv("OPENROUTER_DEFAULT_MODEL");
      expect.fail("expected requireEnv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MissingEnvVarError);
      expect((error as MissingEnvironmentVariableError).variableName).toBe(
        "OPENROUTER_DEFAULT_MODEL",
      );
    }
  });

  it("names the error 'MissingEnvironmentVariableError'", () => {
    try {
      requireEnv("OPENROUTER_API_KEY");
      expect.fail("expected requireEnv to throw");
    } catch (error) {
      expect((error as Error).name).toBe("MissingEnvironmentVariableError");
    }
  });

  it("mentions the variable name in the error message", () => {
    try {
      requireEnv("OPENROUTER_API_KEY");
      expect.fail("expected requireEnv to throw");
    } catch (error) {
      expect((error as Error).message).toContain("OPENROUTER_API_KEY");
    }
  });
});

describe("OpenRouterError", () => {
  it("carries the upstream status code", () => {
    const error = new OpenRouterError("rate limited", 429);
    expect(error.status).toBe(429);
    expect(error.message).toBe("rate limited");
  });

  it("names the error 'OpenRouterError'", () => {
    expect(new OpenRouterError("oops", 500).name).toBe("OpenRouterError");
  });

  it("is an Error instance (so existing catch handlers still match)", () => {
    expect(new OpenRouterError("oops", 500)).toBeInstanceOf(Error);
  });
});
