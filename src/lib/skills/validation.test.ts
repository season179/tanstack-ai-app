import { describe, expect, it } from "vitest";

import {
  countLines,
  DESCRIPTION_MAX,
  NAME_MAX,
  SKILL_BODY_MAX_CHARS,
  SKILL_BODY_MAX_LINES,
  validateDescription,
  validateName,
  validateReferenceBody,
  validateSkillBody,
} from "~/lib/skills/validation";

describe("countLines", () => {
  it("counts 0 for an empty string", () => {
    expect(countLines("")).toBe(0);
  });

  it("counts 1 for a single line with no trailing newline", () => {
    expect(countLines("hello")).toBe(1);
  });

  it("counts N for N newline-separated rows", () => {
    expect(countLines("a\nb\nc")).toBe(3);
    expect(countLines("a\nb\nc\n")).toBe(4);
  });
});

describe("validateName", () => {
  it("errors on empty", () => {
    expect(validateName("")).toMatch(/required/i);
  });

  it("errors on over-length names", () => {
    expect(validateName("a".repeat(NAME_MAX + 1))).toMatch(/characters or fewer/);
  });

  it("accepts a name exactly NAME_MAX long", () => {
    expect(validateName("a".repeat(NAME_MAX))).toBeNull();
  });

  it("errors on a leading or trailing hyphen", () => {
    expect(validateName("-pig")).toMatch(/hyphen/i);
    expect(validateName("pig-")).toMatch(/hyphen/i);
  });

  it("errors on consecutive hyphens", () => {
    expect(validateName("pig--latin")).toMatch(/consecutive/i);
  });

  it("errors on uppercase or non-alphanumeric", () => {
    expect(validateName("Pig")).toMatch(/lowercase/i);
    expect(validateName("pig_latin")).toMatch(/lowercase/i);
    expect(validateName("pig.latin")).toMatch(/lowercase/i);
  });

  it("accepts lowercase alphanumeric with hyphen separators", () => {
    expect(validateName("pig-latin")).toBeNull();
    expect(validateName("gpt-4o")).toBeNull();
    expect(validateName("a")).toBeNull();
  });
});

describe("validateDescription", () => {
  it("errors on empty", () => {
    expect(validateDescription("")).toMatch(/required/i);
  });

  it("errors on over-length", () => {
    expect(validateDescription("x".repeat(DESCRIPTION_MAX + 1))).toMatch(/characters or fewer/);
  });

  it("accepts any non-empty string within the limit", () => {
    expect(validateDescription("Translates text to pig latin.")).toBeNull();
  });
});

describe("validateSkillBody", () => {
  it("errors on empty", () => {
    expect(validateSkillBody("")).toMatch(/required/i);
  });

  it("errors on over-length characters", () => {
    expect(validateSkillBody("x".repeat(SKILL_BODY_MAX_CHARS + 1))).toMatch(/characters or fewer/);
  });

  it("errors on over-length line count", () => {
    const tooManyLines = `${"x\n".repeat(SKILL_BODY_MAX_LINES)}x`;
    expect(validateSkillBody(tooManyLines)).toMatch(/lines or fewer/);
  });

  it("accepts a non-empty body within both limits", () => {
    expect(validateSkillBody("You reply in pig latin.")).toBeNull();
  });
});

describe("validateReferenceBody", () => {
  it("errors on empty", () => {
    expect(validateReferenceBody("")).toMatch(/required/i);
  });

  it("accepts any non-empty string (no length cap)", () => {
    expect(validateReferenceBody("x".repeat(50_000))).toBeNull();
  });
});
