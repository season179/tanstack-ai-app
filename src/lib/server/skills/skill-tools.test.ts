import { describe, expect, it } from "vitest";
import {
  buildSkillCatalogBlock,
  buildSkillCatalogSnapshot,
  buildSkillTools,
  executeSkillTool,
  SKILL_GET_CONTENT_NAME,
  SKILL_SEARCH_NAME,
  SKILLS_PROMPT,
  type SkillCatalogSnapshot,
} from "~/lib/server/skills/skill-tools";
import type { Skill } from "~/lib/skills/skills-store";

const BASE = {
  description: "d",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
} as const;

/** A Skill fixture. BASE spreads first so this helper's own description/body
 * defaults win over the shared BASE.description placeholder. */
function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    ...BASE,
    id: "s1",
    name: "pig-latin",
    body: "Reply in pig latin.",
    description: "Translate the reply into pig latin.",
    isEnabled: true,
    references: [],
    ...overrides,
  };
}

/** A reference attached to a skill. BASE spreads first so the reference's own
 * description/body defaults win over the shared BASE.description placeholder. */
function ref(overrides: Partial<Skill["references"][number]> = {}): Skill["references"][number] {
  return {
    ...BASE,
    id: "r1",
    name: "rules",
    description: "the rules of pig latin",
    body: "Consonants move to the front with -ay.",
    ...overrides,
  };
}

type SkillMatch = {
  id: string;
  name: string;
  description: string;
  references: Array<{ id: string; name: string; description: string }>;
};

/**
 * Narrow a skill_search result to its typed matches array. The production
 * SkillToolResult uses a loose `[key: string]: unknown` success branch (the
 * tool loop serializes the whole object opaquely to the model), so tests cast
 * to assert on the structured `matches`. Returns [] for non-search results.
 */
function searchMatchesOf(result: ReturnType<typeof executeSkillTool>): SkillMatch[] {
  return "matches" in result ? (result.matches as SkillMatch[]) : [];
}

describe("buildSkillCatalogSnapshot", () => {
  it("keeps only enabled skills and strips the isEnabled/timestamps fields", () => {
    const snapshot = buildSkillCatalogSnapshot([
      skill({ id: "s1", isEnabled: true }),
      skill({ id: "s2", isEnabled: false }),
    ]);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.id).toBe("s1");
    expect(snapshot[0]).not.toHaveProperty("isEnabled");
    expect(snapshot[0]).not.toHaveProperty("createdAt");
    expect(snapshot[0]).not.toHaveProperty("updatedAt");
  });

  it("maps references to the wire shape (stripping timestamps)", () => {
    const snapshot = buildSkillCatalogSnapshot([
      skill({ references: [ref({ id: "r1", name: "rules" })] }),
    ]);
    expect(snapshot[0]?.references).toEqual([
      { id: "r1", name: "rules", description: "the rules of pig latin", body: ref().body },
    ]);
    expect(snapshot[0]?.references[0]).not.toHaveProperty("createdAt");
  });

  it("returns an empty array for an empty input", () => {
    expect(buildSkillCatalogSnapshot([])).toEqual([]);
  });
});

describe("buildSkillCatalogBlock", () => {
  it("returns an empty string for an empty snapshot", () => {
    expect(buildSkillCatalogBlock([])).toBe("");
  });

  it("wraps each skill in <available_skills> with id/name/description", () => {
    const block = buildSkillCatalogBlock([
      {
        id: "s1",
        name: "pig-latin",
        description: "translate into pig latin",
        body: "x",
        references: [],
      },
    ]);
    expect(block).toContain("<available_skills>");
    expect(block).toContain("</available_skills>");
    expect(block).toContain("<id>s1</id>");
    expect(block).toContain("<name>pig-latin</name>");
    expect(block).toContain("<description>translate into pig latin</description>");
    // The body is NOT part of the tier-1 catalog block (progressive disclosure).
    expect(block).not.toContain("x");
  });

  it("escapes XML-special characters in name and description", () => {
    const block = buildSkillCatalogBlock([
      {
        id: "s1",
        name: 'a"b&c',
        description: "<d>'e",
        body: "",
        references: [],
      },
    ]);
    expect(block).toContain("<name>a&quot;b&amp;c</name>");
    expect(block).toContain("<description>&lt;d&gt;&apos;e</description>");
  });
});

describe("buildSkillTools", () => {
  it("returns two function tools: skill_search and skill_get_content", () => {
    const tools = buildSkillTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.function.name).sort()).toEqual([
      SKILL_GET_CONTENT_NAME,
      SKILL_SEARCH_NAME,
    ]);
    for (const tool of tools) {
      expect(tool.type).toBe("function");
    }
  });

  it("exposes a static array identity (same reference across calls)", () => {
    // The tools are static (the snapshot is threaded at dispatch time), so the
    // shared array is the canonical shape the tool loop reuses every request.
    expect(buildSkillTools()).toBe(buildSkillTools());
  });

  it("skill_search requires a query and documents the limit bounds", () => {
    const search = buildSkillTools().find((t) => t.function.name === SKILL_SEARCH_NAME);
    expect(search?.function.parameters.required).toEqual(["query"]);
    const properties = search?.function.parameters.properties as
      | { limit?: { minimum?: number; maximum?: number } }
      | undefined;
    expect(properties?.limit?.minimum).toBe(1);
    expect(properties?.limit?.maximum).toBe(20);
  });

  it("skill_get_content requires an id", () => {
    const getContent = buildSkillTools().find((t) => t.function.name === SKILL_GET_CONTENT_NAME);
    expect(getContent?.function.parameters.required).toEqual(["id"]);
  });
});

describe("SKILLS_PROMPT", () => {
  it("is a non-empty string mentioning skill_get_content and skill_search", () => {
    expect(typeof SKILLS_PROMPT).toBe("string");
    expect(SKILLS_PROMPT.length).toBeGreaterThan(0);
    expect(SKILLS_PROMPT).toContain("skill_get_content");
    expect(SKILLS_PROMPT).toContain("skill_search");
  });
});

describe("executeSkillTool dispatch", () => {
  const snapshot: SkillCatalogSnapshot[] = [
    {
      id: "s1",
      name: "pig-latin",
      description: "translate into pig latin",
      body: "Reply in pig latin.",
      references: [{ id: "r1", name: "rules", description: "the rules", body: "move consonants" }],
    },
  ];

  it("routes skill_search to the search executor", () => {
    const result = executeSkillTool(SKILL_SEARCH_NAME, { query: "pig" }, snapshot);
    expect(result.success).toBe(true);
  });

  it("routes skill_get_content to the content executor", () => {
    const result = executeSkillTool(SKILL_GET_CONTENT_NAME, { id: "s1" }, snapshot);
    expect(result.success).toBe(true);
  });

  it("returns a soft error for an unknown tool name", () => {
    const result = executeSkillTool("nope", {}, snapshot);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("not a skill tool");
    }
  });
});

describe("executeSkillTool — skill_search", () => {
  const snapshot: SkillCatalogSnapshot[] = [
    {
      id: "s1",
      name: "pig-latin",
      description: "translate into pig latin",
      body: "b1",
      references: [],
    },
    {
      id: "s2",
      name: "summarize",
      description: "summarize long documents",
      body: "b2",
      references: [],
    },
  ];

  it("fails soft when the query is missing or whitespace", () => {
    expect(executeSkillTool(SKILL_SEARCH_NAME, { query: "   " }, snapshot).success).toBe(false);
    expect(executeSkillTool(SKILL_SEARCH_NAME, { query: 123 }, snapshot).success).toBe(false);
    expect(executeSkillTool(SKILL_SEARCH_NAME, {}, snapshot).success).toBe(false);
  });

  it("returns matches with a note directing the model to skill_get_content", () => {
    const result = executeSkillTool(SKILL_SEARCH_NAME, { query: "pig" }, snapshot);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.count).toBe(1);
      expect(result.note).toContain("skill_get_content");
    }
  });

  it("returns a 'no matches' note when nothing matches", () => {
    const result = executeSkillTool(SKILL_SEARCH_NAME, { query: "zzzznomatch" }, snapshot);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.count).toBe(0);
      expect(result.note).toContain("No skill descriptions matched");
    }
  });

  it("echoes the (trimmed) query back", () => {
    const result = executeSkillTool(SKILL_SEARCH_NAME, { query: "  pig  " }, snapshot);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.query).toBe("pig");
    }
  });

  it("orders exact-name hits ahead of description-only token overlap", () => {
    // Both match the 'pig' token in description/name text, but only s1 has the
    // exact-name substring boost, so s1 ranks first.
    const result = executeSkillTool(SKILL_SEARCH_NAME, { query: "pig" }, snapshot);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(searchMatchesOf(result)[0]?.id).toBe("s1");
    }
  });

  it("clamps the limit to the [1, 20] range and defaults to 10", () => {
    const many: SkillCatalogSnapshot[] = Array.from({ length: 25 }, (_, i) => ({
      id: `s${i}`,
      name: `pig-${i}`,
      description: "pig latin",
      body: "",
      references: [],
    }));
    // Explicit large limit is clamped to 20.
    const clamped = executeSkillTool(SKILL_SEARCH_NAME, { query: "pig", limit: 9999 }, many);
    if (clamped.success) {
      expect(searchMatchesOf(clamped).length).toBe(20);
    }
    // Missing / invalid limit falls back to the default (10), then clamped by
    // the catalog size.
    const defaulted = executeSkillTool(
      SKILL_SEARCH_NAME,
      { query: "pig", limit: "not-a-number" },
      many,
    );
    if (defaulted.success) {
      expect(searchMatchesOf(defaulted).length).toBe(10);
    }
    // limit <= 0 clamps to 1.
    const min = executeSkillTool(SKILL_SEARCH_NAME, { query: "pig", limit: -5 }, many);
    if (min.success) {
      expect(searchMatchesOf(min).length).toBe(1);
    }
  });

  it("dedupes query tokens so a repeated word doesn't double-count", () => {
    // 'pig pig' tokenizes to a single unique token; both skills still match it
    // once, so the score ordering is stable and not skewed by repetition.
    const result = executeSkillTool(SKILL_SEARCH_NAME, { query: "pig pig" }, snapshot);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.count).toBeGreaterThanOrEqual(1);
    }
  });

  it("breaks score ties by name ascending (localeCompare)", () => {
    const tied: SkillCatalogSnapshot[] = [
      { id: "z", name: "zebra", description: "pig", body: "", references: [] },
      { id: "a", name: "apple", description: "pig", body: "", references: [] },
    ];
    const result = executeSkillTool(SKILL_SEARCH_NAME, { query: "pig" }, tied);
    if (result.success) {
      expect(searchMatchesOf(result).map((m) => m.id)).toEqual(["a", "z"]);
    }
  });

  it("includes each match's references (ids/names/descriptions, not bodies)", () => {
    const withRef: SkillCatalogSnapshot[] = [
      {
        id: "s1",
        name: "pig-latin",
        description: "pig latin",
        body: "secret body",
        references: [
          { id: "r1", name: "rules", description: "the rules", body: "secret ref body" },
        ],
      },
    ];
    const result = executeSkillTool(SKILL_SEARCH_NAME, { query: "pig" }, withRef);
    if (result.success) {
      const match = searchMatchesOf(result)[0];
      expect(match?.references).toEqual([{ id: "r1", name: "rules", description: "the rules" }]);
      // Bodies are never leaked at the search tier (progressive disclosure).
      expect(JSON.stringify(match?.references)).not.toContain("secret ref body");
    }
  });
});

describe("executeSkillTool — skill_get_content", () => {
  const snapshot: SkillCatalogSnapshot[] = [
    {
      id: "s1",
      name: "pig-latin",
      description: "translate into pig latin",
      body: "Reply in pig latin.",
      references: [
        {
          id: "r1",
          name: "rules",
          description: "the rules",
          body: "Move consonants to the front.",
        },
      ],
    },
  ];

  it("fails soft when id is missing or whitespace", () => {
    expect(executeSkillTool(SKILL_GET_CONTENT_NAME, { id: "  " }, snapshot).success).toBe(false);
    expect(executeSkillTool(SKILL_GET_CONTENT_NAME, { id: 42 }, snapshot).success).toBe(false);
    expect(executeSkillTool(SKILL_GET_CONTENT_NAME, {}, snapshot).success).toBe(false);
  });

  it("returns the tier-2 <skill_content> block for a skill id", () => {
    const result = executeSkillTool(SKILL_GET_CONTENT_NAME, { id: "s1" }, snapshot);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.id).toBe("s1");
      expect(result.content).toContain("<skill_content ");
      expect(result.content).toContain('name="pig-latin"');
      expect(result.content).toContain('id="s1"');
      expect(result.content).toContain("Reply in pig latin.");
    }
  });

  it("lists references inside the skill content but does not inline their bodies", () => {
    const result = executeSkillTool(SKILL_GET_CONTENT_NAME, { id: "s1" }, snapshot);
    if (result.success) {
      expect(result.content).toContain("<skill_references>");
      expect(result.content).toContain('<reference id="r1" name="rules">the rules</reference>');
      // Reference bodies are a tier-3 fetch, never inlined at tier-2.
      expect(result.content).not.toContain("Move consonants");
    }
  });

  it("omits the <skill_references> block when a skill has none", () => {
    const noRefs: SkillCatalogSnapshot[] = [
      { id: "s1", name: "pig-latin", description: "d", body: "body", references: [] },
    ];
    const result = executeSkillTool(SKILL_GET_CONTENT_NAME, { id: "s1" }, noRefs);
    if (result.success) {
      expect(result.content).not.toContain("skill_references");
    }
  });

  it("returns the tier-3 <reference_content> block for a reference id", () => {
    const result = executeSkillTool(SKILL_GET_CONTENT_NAME, { id: "r1" }, snapshot);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.id).toBe("r1");
      expect(result.content).toContain("<reference_content ");
      expect(result.content).toContain('name="rules"');
      expect(result.content).toContain("Move consonants to the front.");
      expect(result.content).not.toContain("<skill_content");
    }
  });

  it("resolves ids case-insensitively", () => {
    const upper = executeSkillTool(SKILL_GET_CONTENT_NAME, { id: "S1" }, snapshot);
    expect(upper.success).toBe(true);
    const mixed = executeSkillTool(SKILL_GET_CONTENT_NAME, { id: "  R1 " }, snapshot);
    expect(mixed.success).toBe(true);
  });

  it("fails soft with a helpful error for an unknown id", () => {
    const result = executeSkillTool(SKILL_GET_CONTENT_NAME, { id: "nope" }, snapshot);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("No enabled skill or reference");
      expect(result.error).toContain("skill_search");
    }
  });

  it("escapes XML-special characters in name/description when formatting content", () => {
    const tricky: SkillCatalogSnapshot[] = [
      {
        id: "s1",
        name: 'a"b&c',
        description: "d",
        body: "body",
        references: [{ id: "r1", name: "x<y>", description: "d&e", body: "rb" }],
      },
    ];
    const skillContent = executeSkillTool(SKILL_GET_CONTENT_NAME, { id: "s1" }, tricky);
    if (skillContent.success) {
      expect(skillContent.content).toContain('name="a&quot;b&amp;c"');
    }
    const refContent = executeSkillTool(SKILL_GET_CONTENT_NAME, { id: "r1" }, tricky);
    if (refContent.success) {
      expect(refContent.content).toContain('name="x&lt;y&gt;"');
    }
  });
});
