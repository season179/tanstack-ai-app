/**
 * Pure draft helpers for the Skills page editor, extracted from
 * `src/routes/skills.tsx` so the editor's validation + conversion logic is
 * unit-testable without rendering the full route (which would need router
 * context, the useSkills hook, and the skills store).
 *
 * Mirrors the established extraction pattern (sidebar-grouping /
 * chat-route-helpers / tool-trace-display / create-task-helpers /
 * message-display / token-usage-display): the route file imports the pure
 * helpers and keeps only the stateful/JSX bits. Zero behavior change.
 */

import type { Skill } from "~/lib/hooks/use-skills";
import {
  validateDescription,
  validateName,
  validateReferenceBody,
  validateSkillBody,
} from "~/lib/skills/validation";

export type ReferenceDraft = {
  /** Stable key for React lists; not sent to the store. */
  key: string;
  /** Set when editing an existing reference. */
  id?: string;
  name: string;
  description: string;
  body: string;
};

export type SkillDraft = {
  name: string;
  description: string;
  body: string;
  references: ReferenceDraft[];
};

export type ReferenceErrors = {
  name?: string;
  description?: string;
  body?: string;
};

export type DraftErrors = {
  name?: string;
  description?: string;
  body?: string;
  references: Record<string, ReferenceErrors>;
};

export const EMPTY_DRAFT: SkillDraft = {
  name: "",
  description: "",
  body: "",
  references: [],
};

/**
 * Build an editable draft from a stored Skill. Reference keys reuse the
 * persisted id so React list reconciliation stays stable across edits; new
 * (unsaved) references get their key minted by the caller's draft-key counter.
 */
export function draftFromSkill(skill: Skill): SkillDraft {
  return {
    name: skill.name,
    description: skill.description,
    body: skill.body,
    references: skill.references.map((reference) => ({
      key: reference.id,
      id: reference.id,
      name: reference.name,
      description: reference.description,
      body: reference.body,
    })),
  };
}

/**
 * Validate a full editor draft, mirroring the same .trim() pre-pass the editor
 * applies before submit. Each field is validated independently; reference
 * errors are keyed by the reference's draft key and only present when the
 * reference has at least one error (so an empty `references` object signals
 * "no reference errors" rather than an entry per clean reference).
 */
export function validateDraft(draft: SkillDraft): DraftErrors {
  const references: Record<string, ReferenceErrors> = {};

  for (const reference of draft.references) {
    const errors: ReferenceErrors = {
      name: validateName(reference.name.trim()) ?? undefined,
      description: validateDescription(reference.description.trim()) ?? undefined,
      body: validateReferenceBody(reference.body.trim()) ?? undefined,
    };

    if (errors.name || errors.description || errors.body) {
      references[reference.key] = errors;
    }
  }

  return {
    name: validateName(draft.name.trim()) ?? undefined,
    description: validateDescription(draft.description.trim()) ?? undefined,
    body: validateSkillBody(draft.body.trim()) ?? undefined,
    references,
  };
}

/** True when the draft has any field-level or reference-level error. */
export function hasDraftErrors(errors: DraftErrors): boolean {
  return Boolean(
    errors.name || errors.description || errors.body || Object.keys(errors.references).length > 0,
  );
}
