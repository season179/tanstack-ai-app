import { describe, expect, it } from "vitest";

import {
  type DraftErrors,
  draftFromSkill,
  EMPTY_DRAFT,
  hasDraftErrors,
  type ReferenceDraft,
  type SkillDraft,
  validateDraft,
} from "~/lib/skills/skill-draft";
import type { Skill, SkillReference } from "~/lib/skills/skills-store";

const TS = "2026-06-01T00:00:00.000Z";

function reference(overrides: Partial<SkillReference> = {}): SkillReference {
  return {
    id: "r1",
    name: "ref-one",
    description: "A reference.",
    body: "Reference body.",
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "s1",
    name: "my-skill",
    description: "A useful skill.",
    body: "# Instructions\n\nDo the thing.",
    isEnabled: true,
    createdAt: TS,
    updatedAt: TS,
    references: [],
    ...overrides,
  };
}

function draftRef(overrides: Partial<ReferenceDraft> = {}): ReferenceDraft {
  return { key: "k1", name: "good-ref", description: "fine", body: "ok body", ...overrides };
}

describe("EMPTY_DRAFT", () => {
  it("is an empty-strings / no-references seed", () => {
    expect(EMPTY_DRAFT).toEqual({ name: "", description: "", body: "", references: [] });
  });

  it("has no references so it is a valid create-form seed (empty strings trim to required errors)", () => {
    const errors = validateDraft(EMPTY_DRAFT);
    expect(errors.name).toBe("Name is required.");
    expect(errors.description).toBe("Description is required.");
    expect(errors.body).toBe("Instructions are required.");
    expect(hasDraftErrors(errors)).toBe(true);
  });
});

describe("draftFromSkill", () => {
  it("copies the scalar fields verbatim", () => {
    const draft = draftFromSkill(skill({ name: "alpha", description: "desc", body: "b" }));
    expect(draft.name).toBe("alpha");
    expect(draft.description).toBe("desc");
    expect(draft.body).toBe("b");
  });

  it("maps each reference onto a draft, reusing the persisted id as the key", () => {
    const ref = reference({ id: "r9", name: "n", description: "d", body: "b" });
    const draft = draftFromSkill(skill({ references: [ref] }));
    expect(draft.references).toHaveLength(1);
    expect(draft.references[0]).toEqual({
      key: "r9",
      id: "r9",
      name: "n",
      description: "d",
      body: "b",
    });
  });

  it("drops isEnabled / timestamps (not part of the editable draft)", () => {
    const draft = draftFromSkill(skill({ isEnabled: false }));
    expect(draft).not.toHaveProperty("isEnabled");
    expect(draft).not.toHaveProperty("createdAt");
    expect(draft).not.toHaveProperty("updatedAt");
  });

  it("returns an empty references array when the skill has none", () => {
    expect(draftFromSkill(skill()).references).toEqual([]);
  });
});

describe("validateDraft", () => {
  it("returns undefined for every clean top-level field on a valid draft", () => {
    const draft: SkillDraft = {
      name: "valid-name",
      description: "a description",
      body: "some body",
      references: [],
    };
    const errors = validateDraft(draft);
    expect(errors.name).toBeUndefined();
    expect(errors.description).toBeUndefined();
    expect(errors.body).toBeUndefined();
    expect(errors.references).toEqual({});
    expect(hasDraftErrors(errors)).toBe(false);
  });

  it("always returns a references object (never undefined)", () => {
    const errors = validateDraft({ ...EMPTY_DRAFT });
    expect(errors.references).toEqual({});
  });

  it("trims each field before validating (whitespace-only is rejected)", () => {
    const draft: SkillDraft = {
      name: "   ",
      description: "\t\n",
      body: "   ",
      references: [],
    };
    const errors = validateDraft(draft);
    expect(errors.name).toBe("Name is required.");
    expect(errors.description).toBe("Description is required.");
    expect(errors.body).toBe("Instructions are required.");
  });

  it("surfaces the NAME_MAX length error", () => {
    const draft: SkillDraft = { name: "a".repeat(65), description: "d", body: "b", references: [] };
    expect(validateDraft(draft).name).toMatch(/64 characters or fewer/);
  });

  it("surfaces the name-pattern error for uppercase / invalid characters", () => {
    const draft: SkillDraft = {
      name: "BadName",
      description: "d",
      body: "b",
      references: [],
    };
    expect(validateDraft(draft).name).toMatch(/lowercase letters/);
  });

  it("surfaces the consecutive-hyphens name error", () => {
    const draft: SkillDraft = {
      name: "a--b",
      description: "d",
      body: "b",
      references: [],
    };
    expect(validateDraft(draft).name).toMatch(/consecutive hyphens/);
  });

  it("surfaces the DESCRIPTION_MAX length error", () => {
    const draft: SkillDraft = {
      name: "ok",
      description: "d".repeat(1025),
      body: "b",
      references: [],
    };
    expect(validateDraft(draft).description).toMatch(/1024 characters or fewer/);
  });

  it("surfaces the SKILL_BODY_MAX_CHARS error", () => {
    const draft: SkillDraft = {
      name: "ok",
      description: "d",
      body: "b".repeat(25001),
      references: [],
    };
    expect(validateDraft(draft).body).toMatch(/25,000 characters or fewer/);
  });

  it("surfaces the SKILL_BODY_MAX_LINES error (independent of char count)", () => {
    // validateDraft trims the body first, so a newlines-only body would trim
    // to empty and fail the required check before reaching the line count;
    // use non-empty lines so the body survives the trim and exceeds 500 lines.
    const draft: SkillDraft = {
      name: "ok",
      description: "d",
      body: "line\n".repeat(501),
      references: [],
    };
    expect(validateDraft(draft).body).toMatch(/500 lines or fewer/);
  });

  it("keys reference errors by the reference's draft key", () => {
    const draft: SkillDraft = {
      name: "ok",
      description: "d",
      body: "b",
      references: [draftRef({ key: "k-bad", name: "" })],
    };
    const errors = validateDraft(draft);
    expect(Object.keys(errors.references)).toEqual(["k-bad"]);
    expect(errors.references["k-bad"]?.name).toBe("Name is required.");
  });

  it("only includes a reference entry when it has at least one error", () => {
    const draft: SkillDraft = {
      name: "ok",
      description: "d",
      body: "b",
      references: [
        draftRef({ key: "k-clean", name: "good", description: "d", body: "b" }),
        draftRef({ key: "k-bad", name: "" }),
      ],
    };
    const errors = validateDraft(draft);
    expect(Object.keys(errors.references)).toEqual(["k-bad"]);
  });

  it("omits clean reference fields (undefined) rather than emitting them as null", () => {
    const draft: SkillDraft = {
      name: "ok",
      description: "d",
      body: "b",
      references: [draftRef({ key: "k1", description: "", body: "ok" })],
    };
    const errors = validateDraft(draft);
    // name is clean (good-ref), body is clean (ok), only description errors.
    expect(errors.references.k1).toEqual({ description: "Description is required." });
  });

  it("accumulates all three reference errors onto a single bad reference", () => {
    const draft: SkillDraft = {
      name: "ok",
      description: "d",
      body: "b",
      references: [draftRef({ key: "k1", name: "", description: "", body: "" })],
    };
    const errors = validateDraft(draft);
    expect(errors.references.k1).toEqual({
      name: "Name is required.",
      description: "Description is required.",
      body: "Reference content is required.",
    });
  });

  it("handles multiple bad references independently", () => {
    const draft: SkillDraft = {
      name: "ok",
      description: "d",
      body: "b",
      references: [
        draftRef({ key: "k1", name: "" }),
        draftRef({ key: "k2", body: "" }),
        draftRef({ key: "k3", description: "" }),
      ],
    };
    const errors = validateDraft(draft);
    expect(Object.keys(errors.references).sort()).toEqual(["k1", "k2", "k3"]);
    expect(errors.references.k1?.name).toBe("Name is required.");
    expect(errors.references.k2?.body).toBe("Reference content is required.");
    expect(errors.references.k3?.description).toBe("Description is required.");
  });
});

describe("hasDraftErrors", () => {
  it("is false for the all-undefined clean errors shape", () => {
    const errors: DraftErrors = {
      name: undefined,
      description: undefined,
      body: undefined,
      references: {},
    };
    expect(hasDraftErrors(errors)).toBe(false);
  });

  it("is true when only a top-level field errors", () => {
    expect(
      hasDraftErrors({ name: "bad", description: undefined, body: undefined, references: {} }),
    ).toBe(true);
    expect(
      hasDraftErrors({ name: undefined, description: "bad", body: undefined, references: {} }),
    ).toBe(true);
    expect(
      hasDraftErrors({ name: undefined, description: undefined, body: "bad", references: {} }),
    ).toBe(true);
  });

  it("is true when only a reference errors (even with clean top-level fields)", () => {
    const errors: DraftErrors = {
      name: undefined,
      description: undefined,
      body: undefined,
      references: { k1: { name: "bad" } },
    };
    expect(hasDraftErrors(errors)).toBe(true);
  });

  it("is true for the EMPTY_DRAFT validation result", () => {
    expect(hasDraftErrors(validateDraft(EMPTY_DRAFT))).toBe(true);
  });

  it("is false for an empty reference-error object even alongside clean top-level fields", () => {
    const errors: DraftErrors = {
      name: undefined,
      description: undefined,
      body: undefined,
      references: {},
    };
    expect(hasDraftErrors(errors)).toBe(false);
  });
});
