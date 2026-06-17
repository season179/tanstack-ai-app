import { useCallback, useSyncExternalStore } from "react";

import {
  type CreateSkillInput,
  createSkill as createSkillInStore,
  deleteSkill as deleteSkillInStore,
  getSkillsSnapshot,
  type Skill,
  subscribeSkills,
  type UpdateSkillInput,
  updateSkill as updateSkillInStore,
} from "~/lib/skills/skills-store";

export type {
  CreateSkillInput,
  Skill,
  SkillReference,
  UpdateSkillInput,
} from "~/lib/skills/skills-store";

export type UseSkills = {
  /** Newest-created-first; referentially stable between mutations. */
  skills: Skill[];
  createSkill: (input: CreateSkillInput) => Skill;
  updateSkill: (id: string, input: UpdateSkillInput) => Skill | null;
  removeSkill: (id: string) => void;
};

/**
 * Live view of the localStorage skills store. Backed by useSyncExternalStore
 * so every consumer shares one source of truth and updates the instant any
 * writer mutates the store (same-tab via the listener set, cross-tab via the
 * native storage event).
 */
export function useSkills(): UseSkills {
  const skills = useSyncExternalStore(subscribeSkills, getSkillsSnapshot, getSkillsSnapshot);

  const createSkill = useCallback((input: CreateSkillInput) => createSkillInStore(input), []);
  const updateSkill = useCallback(
    (id: string, input: UpdateSkillInput) => updateSkillInStore(id, input),
    [],
  );
  const removeSkill = useCallback((id: string) => deleteSkillInStore(id), []);

  return { skills, createSkill, updateSkill, removeSkill };
}
