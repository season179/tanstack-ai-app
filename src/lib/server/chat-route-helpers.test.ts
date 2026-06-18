import { describe, expect, it } from "vitest";

import {
  buildSystemPrompt,
  chatStreamHeaders,
  SYSTEM_PROMPT,
  toChatMessages,
  toSkillSnapshot,
} from "~/lib/server/chat-route-helpers";

const UUID = "11111111-1111-1111-1111-111111111111";

describe("chatStreamHeaders", () => {
  it("emits the SSE content-type + the four documented x-* verification headers", () => {
    const headers = chatStreamHeaders("openai/gpt-4o", "search", 0) as Record<string, string>;

    expect(headers["Content-Type"]).toBe("text/event-stream; charset=utf-8");
    expect(headers["Cache-Control"]).toBe("no-cache, no-transform");
    // biome-ignore lint/complexity/useLiteralKeys: bracket access kept for consistency with the other header keys (all but `Connection` contain hyphens and require bracket access)
    expect(headers["Connection"]).toBe("keep-alive");
    expect(headers["x-openrouter-model"]).toBe("openai/gpt-4o");
    expect(headers["x-tool-exposure-mode"]).toBe("search");
  });

  it("x-mock-tools is the constant mock catalog size (always 200) regardless of mode", () => {
    const searchHeaders = chatStreamHeaders("m", "search", 0) as Record<string, string>;
    const allHeaders = chatStreamHeaders("m", "all", 5) as Record<string, string>;
    const noneHeaders = chatStreamHeaders("m", "none", 0) as Record<string, string>;

    // The verification contract reports the MOCK catalog size separately from
    // the per-mode sent count so the deferred-vs-all contrast is observable.
    expect(Number(searchHeaders["x-mock-tools"])).toBe(200);
    expect(Number(allHeaders["x-mock-tools"])).toBe(200);
    expect(Number(noneHeaders["x-mock-tools"])).toBe(200);
  });

  it("x-total-tools reflects the per-mode sent schemas: 3 bridge / 200 all / 0 none", () => {
    expect(
      Number((chatStreamHeaders("m", "search", 0) as Record<string, string>)["x-total-tools"]),
    ).toBe(3);
    expect(
      Number((chatStreamHeaders("m", "all", 0) as Record<string, string>)["x-total-tools"]),
    ).toBe(200);
    expect(
      Number((chatStreamHeaders("m", "none", 0) as Record<string, string>)["x-total-tools"]),
    ).toBe(0);
  });

  it("x-total-tools adds extrasCount (skill tools) on top of the per-mode base", () => {
    // search + 2 skill tools = 5 sent schemas (the iteration-25 contract).
    expect(
      Number((chatStreamHeaders("m", "search", 2) as Record<string, string>)["x-total-tools"]),
    ).toBe(5);
    // all + 2 skill tools = 202 sent schemas.
    expect(
      Number((chatStreamHeaders("m", "all", 2) as Record<string, string>)["x-total-tools"]),
    ).toBe(202);
    // extrasCount is additive on EVERY mode (the function is mode-base + extras),
    // though the chat route only ever passes extras on the tool-loop (search/all)
    // paths — the plain path calls chatStreamHeaders(model, "none", 0).
    expect(
      Number((chatStreamHeaders("m", "none", 2) as Record<string, string>)["x-total-tools"]),
    ).toBe(2);
  });

  it("extrasCount defaults to 0", () => {
    expect(
      Number((chatStreamHeaders("m", "search") as Record<string, string>)["x-total-tools"]),
    ).toBe(3);
  });

  it("preserves the model string verbatim (no trim/normalize)", () => {
    // A path-like model id must survive unchanged.
    const headers = chatStreamHeaders("anthropic/claude-3.5-sonnet", "all", 0) as Record<
      string,
      string
    >;
    expect(headers["x-openrouter-model"]).toBe("anthropic/claude-3.5-sonnet");
  });
});

describe("toChatMessages", () => {
  it("returns null for non-array / empty input (so the route can 400)", () => {
    expect(toChatMessages(undefined)).toBeNull();
    expect(toChatMessages(null)).toBeNull();
    expect(toChatMessages("hello")).toBeNull();
    expect(toChatMessages({ role: "user", content: "x" })).toBeNull();
    expect(toChatMessages([])).toBeNull();
  });

  it("accepts a single user turn", () => {
    expect(toChatMessages([{ role: "user", content: "Hello" }])).toEqual([
      { role: "user", content: "Hello" },
    ]);
  });

  it("accepts user / assistant / system roles in a multi-turn transcript", () => {
    const input = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ];
    expect(toChatMessages(input)).toEqual(input);
  });

  it("rejects an unknown role", () => {
    expect(toChatMessages([{ role: "tool", content: "x" }])).toBeNull();
    expect(toChatMessages([{ role: "function", content: "x" }])).toBeNull();
    expect(toChatMessages([{ role: "developer", content: "x" }])).toBeNull();
    expect(toChatMessages([{ role: "", content: "x" }])).toBeNull();
  });

  it("rejects missing/non-string role or content", () => {
    expect(toChatMessages([{ content: "x" }])).toBeNull();
    expect(toChatMessages([{ role: "user" }])).toBeNull();
    expect(toChatMessages([{ role: "user", content: 42 }])).toBeNull();
    expect(toChatMessages([{ role: 42, content: "x" }])).toBeNull();
  });

  it("rejects empty-string content but accepts whitespace (the validator only checks length===0)", () => {
    // The contract is strictly `content.length === 0`, NOT `trim().length === 0`.
    // A future tightening to whitespace-trim would be a behavior change worth
    // a deliberate decision, so this pins the current lenient behavior.
    expect(toChatMessages([{ role: "user", content: "" }])).toBeNull();
    expect(toChatMessages([{ role: "assistant", content: "   " }])).toEqual([
      { role: "assistant", content: "   " },
    ]);
  });

  it("rejects a non-object entry anywhere in the array (fail-fast, not partial)", () => {
    expect(toChatMessages([{ role: "user", content: "x" }, null])).toBeNull();
    expect(toChatMessages([{ role: "user", content: "x" }, "bad"])).toBeNull();
    expect(toChatMessages([undefined, { role: "user", content: "x" }])).toBeNull();
  });

  it("strips extra fields off valid rows (only role+content survive)", () => {
    const out = toChatMessages([
      {
        content: "Hi",
        id: UUID,
        reasoning: "thinking",
        role: "user",
        toolSteps: [],
      } as unknown,
    ]);
    expect(out).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("preserves multi-line / special-char content verbatim", () => {
    const content = 'Line 1\nLine 2\t<skill_content name="x">quoted</skill_content>';
    expect(toChatMessages([{ role: "user", content }])).toEqual([{ role: "user", content }]);
  });
});

describe("toSkillSnapshot", () => {
  it("returns [] for non-array input (fails soft, never throws)", () => {
    expect(toSkillSnapshot(undefined)).toEqual([]);
    expect(toSkillSnapshot(null)).toEqual([]);
    expect(toSkillSnapshot("not-an-array")).toEqual([]);
    expect(toSkillSnapshot({ id: "x" })).toEqual([]);
  });

  it("returns [] for an empty array", () => {
    expect(toSkillSnapshot([])).toEqual([]);
  });

  it("accepts a fully-formed skill with no references", () => {
    const skill = { body: "Be terse.", description: "d", id: UUID, name: "Terse" };
    expect(toSkillSnapshot([skill])).toEqual([
      { body: "Be terse.", description: "d", id: UUID, name: "Terse", references: [] },
    ]);
  });

  it("accepts a skill with nested references", () => {
    const skill = {
      body: "Body.",
      description: "d",
      id: UUID,
      name: "S",
      references: [
        { body: "rb1", description: "rd1", id: "ref1", name: "R1" },
        { body: "rb2", description: "rd2", id: "ref2", name: "R2" },
      ],
    };
    expect(toSkillSnapshot([skill])).toEqual([skill]);
  });

  it("drops a skill row missing any required top-level string field", () => {
    const valid = { body: "b", description: "d", id: UUID, name: "n" };
    // Each fixture below drops / corrupts exactly one required field.
    expect(toSkillSnapshot([{ ...valid, id: undefined }])).toEqual([]);
    expect(toSkillSnapshot([{ ...valid, name: 5 }])).toEqual([]);
    expect(toSkillSnapshot([{ ...valid, description: null }])).toEqual([]);
    expect(toSkillSnapshot([{ ...valid, body: "" }])).toEqual([
      { ...valid, body: "", references: [] },
    ]);
    // Empty body IS accepted (the validator only checks it's a string; downstream
    // callers treat a blank body as a no-op activation).
    expect(toSkillSnapshot([{ ...valid, body: 0 }])).toEqual([]);
  });

  it("keeps the valid skills and drops only malformed rows (fails soft per row)", () => {
    const good = { body: "b", description: "d", id: UUID, name: "g" };
    const bad = { body: "b", id: "x", name: "noDesc" }; // description missing
    const alsoGood = { body: "x", description: "y", id: "z", name: "g2" };
    expect(toSkillSnapshot([good, bad, alsoGood])).toEqual([
      { ...good, references: [] },
      { ...alsoGood, references: [] },
    ]);
  });

  it("drops a non-object skill row without throwing", () => {
    const valid = { body: "b", description: "d", id: UUID, name: "n" };
    expect(toSkillSnapshot([null, valid, "oops", 42, undefined, valid])).toEqual([
      { ...valid, references: [] },
      { ...valid, references: [] },
    ]);
  });

  it("drops malformed references while keeping the parent skill", () => {
    const skill = {
      body: "b",
      description: "d",
      id: UUID,
      name: "n",
      references: [
        { body: "rb1", description: "rd1", id: "r1", name: "R1" },
        null, // non-object → dropped
        { body: "rb2", id: "r2", name: "R2" }, // description missing → dropped
        { body: "rb3", description: "rd3", id: "r3", name: "R3", extra: "ignored" },
      ],
    };
    expect(toSkillSnapshot([skill])).toEqual([
      {
        body: "b",
        description: "d",
        id: UUID,
        name: "n",
        references: [
          { body: "rb1", description: "rd1", id: "r1", name: "R1" },
          { body: "rb3", description: "rd3", id: "r3", name: "R3" },
        ],
      },
    ]);
  });

  it("treats a non-array references field as no references", () => {
    const skill = { body: "b", description: "d", id: UUID, name: "n", references: "wrong" };
    expect(toSkillSnapshot([skill])).toEqual([
      { body: "b", description: "d", id: UUID, name: "n", references: [] },
    ]);
    // Also when references is missing entirely.
    expect(toSkillSnapshot([{ body: "b", description: "d", id: UUID, name: "n" }])).toEqual([
      { body: "b", description: "d", id: UUID, name: "n", references: [] },
    ]);
  });

  it("strips extra fields off valid references (only id/name/description/body survive)", () => {
    const skill = {
      body: "b",
      description: "d",
      id: UUID,
      name: "n",
      references: [
        {
          body: "rb",
          description: "rd",
          extra: "drop me",
          id: "r1",
          isEnabled: true,
          name: "R1",
        },
      ],
    };
    expect(toSkillSnapshot([skill])).toEqual([
      {
        body: "b",
        description: "d",
        id: UUID,
        name: "n",
        references: [{ body: "rb", description: "rd", id: "r1", name: "R1" }],
      },
    ]);
  });
});

describe("buildSystemPrompt", () => {
  it("returns the base SYSTEM_PROMPT when the skills catalog block is empty", () => {
    expect(buildSystemPrompt("")).toBe(SYSTEM_PROMPT);
  });

  it("appends SKILLS_PROMPT + the catalog block (newline-separated) when skills are present", () => {
    const catalogBlock = '<available_skills><skill id="x" name="S"/></available_skills>';
    const out = buildSystemPrompt(catalogBlock);

    // The skills block joins with the base prompt and SKILLS_PROMPT in order.
    expect(out.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(out).toContain(catalogBlock);
    // The three pieces are joined by exactly two blank-line-separated blocks.
    expect(out.split("\n\n").length).toBe(3);
  });

  it("the empty-block path returns the exact base prompt (no trailing joiners)", () => {
    // A guard against a future refactor that does [SYSTEM_PROMPT, "", ""].join
    // and accidentally introduces a trailing newline pair on the no-skills path.
    expect(buildSystemPrompt("")).not.toContain("\n\n");
  });
});
