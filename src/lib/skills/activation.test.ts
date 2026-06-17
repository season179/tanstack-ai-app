import { describe, expect, it } from "vitest";

import { buildActivatedSkillContent, findActivatableSkill } from "~/lib/skills/activation";
import type { Skill } from "~/lib/skills/skills-store";

const BASE = {
  description: "d",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
} as const;

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "s1",
    name: "pig-latin",
    body: "Reply in pig latin.",
    isEnabled: true,
    references: [],
    ...BASE,
    ...overrides,
  };
}

describe("buildActivatedSkillContent", () => {
  it("wraps the body in a <skill_content> block tagged with name and id", () => {
    const out = buildActivatedSkillContent(skill());
    expect(out).toBe(
      `<skill_content name="pig-latin" id="s1">\nReply in pig latin.\n</skill_content>`,
    );
  });

  it("returns null when the body is blank (whitespace-only)", () => {
    expect(buildActivatedSkillContent(skill({ body: "   \n\t " }))).toBeNull();
    expect(buildActivatedSkillContent(skill({ body: "" }))).toBeNull();
  });

  it("appends a <skill_references> block when the skill has references", () => {
    const out = buildActivatedSkillContent(
      skill({
        references: [
          {
            id: "r1",
            name: "rules",
            description: "the rules",
            body: "body",
            createdAt: BASE.createdAt,
            updatedAt: BASE.updatedAt,
          },
        ],
      }),
    );
    expect(out).toBe(
      `<skill_content name="pig-latin" id="s1">\nReply in pig latin.\n\n<skill_references>\n  <reference id="r1" name="rules">the rules</reference>\n</skill_references>\n</skill_content>`,
    );
  });

  it("omits the <skill_references> block entirely when there are no references", () => {
    const out = buildActivatedSkillContent(skill({ references: [] }));
    expect(out?.includes("skill_references")).toBe(false);
  });

  it("escapes XML-special characters in name, id, and reference fields", () => {
    const out = buildActivatedSkillContent(
      skill({
        id: 'a"b&c<d>',
        name: `x'y`,
        references: [
          {
            id: "r<1>",
            name: 'r"1',
            description: "d & co",
            body: "b",
            createdAt: BASE.createdAt,
            updatedAt: BASE.updatedAt,
          },
        ],
      }),
    );
    expect(out).toContain('name="x&apos;y"');
    expect(out).toContain('id="a&quot;b&amp;c&lt;d&gt;"');
    expect(out).toContain('<reference id="r&lt;1&gt;" name="r&quot;1">d &amp; co</reference>');
  });

  it("preserves the body verbatim (no escaping of ordinary text)", () => {
    const out = buildActivatedSkillContent(skill({ body: "Line 1\nLine 2\ttabbed" }));
    expect(out).toContain("Line 1\nLine 2\ttabbed");
  });
});

describe("findActivatableSkill", () => {
  const catalog: Skill[] = [
    skill({ id: "s1", name: "pig-latin" }),
    skill({ id: "s2", name: "summarize", isEnabled: false }),
    skill({ id: "s3", name: "gpt-4o" }),
  ];

  it("matches a stored name case-insensitively", () => {
    expect(findActivatableSkill(catalog, "Pig-Latin")?.id).toBe("s1");
    expect(findActivatableSkill(catalog, "PIG-LATIN")?.id).toBe("s1");
  });

  it("returns null for an unknown name", () => {
    expect(findActivatableSkill(catalog, "nope")).toBeNull();
  });

  it("returns null for a disabled skill (only enabled skills activate)", () => {
    expect(findActivatableSkill(catalog, "summarize")).toBeNull();
  });

  it("returns null for an empty catalog", () => {
    expect(findActivatableSkill([], "pig-latin")).toBeNull();
  });
});
