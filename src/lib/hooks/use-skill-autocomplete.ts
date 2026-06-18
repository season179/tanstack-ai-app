import { useCallback, useMemo, useState } from "react";

import type { Skill } from "~/lib/skills/skills-store";
import { parsePartialSkillCommand } from "~/lib/skills/slash-command";

export type UseSkillAutocompleteOptions = {
  /** Current composer input; the leading /command is parsed from this. */
  input: string;
  /** Only enabled skills are activatable (matches the reference's catalog). */
  activatableSkills: Skill[];
  /**
   * Fired when a skill is accepted (click/Tab/Enter). The parent owns the
   * composer input + textarea focus, so it implements the setInput("/name ")
   * + refocus; this hook only owns the menu's open/dismissed/highlight state.
   */
  onAccept: (name: string) => void;
};

export type UseSkillAutocompleteResult = {
  /** Skills whose name starts with the active /query (prefix match). */
  skillMatches: Skill[];
  /** True only when there is a query, at least one match, and the user hasn't dismissed. */
  isSkillMenuOpen: boolean;
  /** Clamped into [0, matches.length - 1] so a shrinking match list can't outrun it. */
  highlightedSkillIndex: number;
  /** Accept a skill by name: dismiss the menu and delegate input/focus to onAccept. */
  accept: (name: string) => void;
  /** Escape: dismiss the menu until the next keystroke reopens it. */
  dismiss: () => void;
  /** onChange: un-dismiss AND reset the highlight to the top (fresh query). */
  resetMenu: () => void;
  /** After-send: un-dismiss only (the cleared input already closes the menu). */
  clearDismissed: () => void;
  /** ArrowUp/ArrowDown: wrap-around move within the current match list. */
  moveHighlight: (delta: 1 | -1) => void;
};

/**
 * Owns the /skill-name composer autocomplete's open/dismissed/highlight state.
 * Extracted from chat-surface so the non-obvious state machine — clamp-on-shrink,
 * wrap-around keyboard nav, dismiss-vs-reset semantics — is unit-testable and
 * the surface stays focused on streaming + persistence.
 *
 * Faithful port of the inline logic: the menu is open iff there is a partial
 * command, ≥1 prefix match, and the user hasn't dismissed it; the highlight is
 * clamped so it never exceeds the (possibly just-shrunk) match list; ArrowUp/
 * ArrowDown wrap via `+ matches.length` before the modulo so a negative index
 * lands at the end instead of going negative.
 */
export function useSkillAutocomplete({
  input,
  activatableSkills,
  onAccept,
}: UseSkillAutocompleteOptions): UseSkillAutocompleteResult {
  const skillQuery = parsePartialSkillCommand(input);
  const skillMatches = useMemo(
    () =>
      skillQuery === null
        ? []
        : activatableSkills.filter((skill) => skill.name.startsWith(skillQuery)),
    [activatableSkills, skillQuery],
  );

  const [skillMenuDismissed, setSkillMenuDismissed] = useState(false);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);

  const isSkillMenuOpen = skillQuery !== null && skillMatches.length > 0 && !skillMenuDismissed;
  // Clamp so a shrinking match list (e.g. the user keeps typing) can't leave the
  // highlight pointing past the end. Math.max(... - 1, 0) guards the empty-list
  // case from producing -1.
  const highlightedSkillIndex = Math.min(activeSkillIndex, Math.max(skillMatches.length - 1, 0));

  const accept = useCallback(
    (name: string) => {
      setSkillMenuDismissed(true);
      onAccept(name);
    },
    [onAccept],
  );

  const dismiss = useCallback(() => setSkillMenuDismissed(true), []);
  const resetMenu = useCallback(() => {
    setSkillMenuDismissed(false);
    setActiveSkillIndex(0);
  }, []);
  const clearDismissed = useCallback(() => setSkillMenuDismissed(false), []);

  const moveHighlight = useCallback(
    (delta: 1 | -1) => {
      setActiveSkillIndex(
        (highlightedSkillIndex + delta + skillMatches.length) % skillMatches.length,
      );
    },
    [highlightedSkillIndex, skillMatches.length],
  );

  return {
    skillMatches,
    isSkillMenuOpen,
    highlightedSkillIndex,
    accept,
    dismiss,
    resetMenu,
    clearDismissed,
    moveHighlight,
  };
}
