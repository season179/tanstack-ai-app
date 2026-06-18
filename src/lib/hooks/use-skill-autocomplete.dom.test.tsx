// @vitest-environment jsdom
//
// DOM-environment renderHook tests for useSkillAutocomplete — the composer's
// /skill-name autocomplete state machine extracted from chat-surface. The hook
// owns the menu's open/dismissed/highlight state and delegates input mutation
// + focus to the parent via onAccept; these tests pin the non-obvious
// contract the surface depends on: prefix filtering driven by
// parsePartialSkillCommand, the dismiss/reset/clearDismissed state semantics,
// the clamp-on-shrink highlight, and the wrap-around keyboard navigation.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSkillAutocomplete } from "~/lib/hooks/use-skill-autocomplete";
import type { Skill } from "~/lib/skills/skills-store";

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "id",
    name: "name",
    description: "desc",
    body: "body",
    isEnabled: true,
    createdAt: "2024-06-01T00:00:00.000Z",
    updatedAt: "2024-06-01T00:00:00.000Z",
    references: [],
    ...overrides,
  };
}

// Three enabled skills with distinct prefixes so prefix filtering + wrap-around
// are both exercisable. The hook trusts the caller to pre-filter disabled
// skills (the surface passes `skills.filter(isEnabled)`), so all fixtures here
// are enabled.
const SKILLS: Skill[] = [
  makeSkill({ id: "1", name: "pig-latin", description: "Pig latin translator" }),
  makeSkill({ id: "2", name: "pirate", description: "Pirate speak" }),
  makeSkill({ id: "3", name: "poem", description: "Write a poem" }),
];

type Props = { input: string; skills?: Skill[]; onAccept?: (name: string) => void };

function renderAutocomplete(props: Props) {
  const onAccept = props.onAccept ?? vi.fn();
  return {
    onAccept,
    ...renderHook(
      ({ input, skills, onAccept }) =>
        useSkillAutocomplete({ input, activatableSkills: skills ?? SKILLS, onAccept }),
      { initialProps: { input: props.input, skills: props.skills ?? SKILLS, onAccept } },
    ),
  };
}

describe("useSkillAutocomplete menu visibility + filtering", () => {
  it("is closed with no matches when the input is not a partial command", () => {
    const { result } = renderAutocomplete({ input: "" });
    expect(result.current.skillMatches).toEqual([]);
    expect(result.current.isSkillMenuOpen).toBe(false);
    expect(result.current.highlightedSkillIndex).toBe(0);
  });

  it("is closed for plain text without a leading slash", () => {
    const { result } = renderAutocomplete({ input: "hello there" });
    expect(result.current.skillMatches).toEqual([]);
    expect(result.current.isSkillMenuOpen).toBe(false);
  });

  it("opens with ALL activatable skills on a bare slash (empty partial matches every name)", () => {
    const { result } = renderAutocomplete({ input: "/" });
    expect(result.current.skillMatches).toHaveLength(3);
    expect(result.current.isSkillMenuOpen).toBe(true);
    expect(result.current.highlightedSkillIndex).toBe(0);
  });

  it("prefix-filters by the partial name (case-sensitive: the grammar is lowercase only)", () => {
    const { result } = renderAutocomplete({ input: "/pi" });
    expect(result.current.skillMatches.map((skill) => skill.name)).toEqual(["pig-latin", "pirate"]);
    expect(result.current.isSkillMenuOpen).toBe(true);
  });

  it("narrows to a single prefix match", () => {
    const { result } = renderAutocomplete({ input: "/pig" });
    expect(result.current.skillMatches.map((skill) => skill.name)).toEqual(["pig-latin"]);
  });

  it("closes (null query) once a space follows the partial name — the grammar requires end-of-string", () => {
    const { result } = renderAutocomplete({ input: "/pi " });
    expect(result.current.skillMatches).toEqual([]);
    expect(result.current.isSkillMenuOpen).toBe(false);
  });

  it("closes when no skill name starts with the partial query", () => {
    const { result } = renderAutocomplete({ input: "/xyz" });
    expect(result.current.skillMatches).toEqual([]);
    expect(result.current.isSkillMenuOpen).toBe(false);
  });

  it("matches against exactly the activatableSkills it is given (no internal isEnabled re-filter)", () => {
    // The surface pre-filters; the hook trusts its input. A disabled skill in
    // the passed list is still matched — pinning that the hook does NOT
    // silently re-filter so the contract is explicit at the boundary.
    const disabled = makeSkill({ id: "9", name: "poker", isEnabled: false });
    const { result } = renderAutocomplete({ input: "/po", skills: [SKILLS[2], disabled] });
    expect(result.current.skillMatches.map((skill) => skill.name)).toEqual(["poem", "poker"]);
  });
});

describe("useSkillAutocomplete dismiss / reset / clearDismissed state machine", () => {
  it("dismiss() closes the menu even while a query + matches are present", () => {
    const { result } = renderAutocomplete({ input: "/pi" });
    expect(result.current.isSkillMenuOpen).toBe(true);

    act(() => result.current.dismiss());
    expect(result.current.isSkillMenuOpen).toBe(false);
    // Matches are still computed; only the dismissed flag flipped.
    expect(result.current.skillMatches.map((skill) => skill.name)).toEqual(["pig-latin", "pirate"]);
  });

  it("resetMenu() reopens a dismissed menu (any keystroke after Escape)", () => {
    const { result } = renderAutocomplete({ input: "/pi" });
    act(() => result.current.dismiss());
    expect(result.current.isSkillMenuOpen).toBe(false);

    act(() => result.current.resetMenu());
    expect(result.current.isSkillMenuOpen).toBe(true);
  });

  it("clearDismissed() reopens a dismissed menu without resetting the highlight (after-send path)", () => {
    const { result } = renderAutocomplete({ input: "/pi" });
    // Move the highlight off the top so we can tell reset vs clear apart.
    act(() => result.current.moveHighlight(1));
    expect(result.current.highlightedSkillIndex).toBe(1);
    act(() => result.current.dismiss());
    expect(result.current.isSkillMenuOpen).toBe(false);

    act(() => result.current.clearDismissed());
    expect(result.current.isSkillMenuOpen).toBe(true);
    // clearDismissed preserves the highlight, unlike resetMenu.
    expect(result.current.highlightedSkillIndex).toBe(1);
  });

  it("resetMenu() zeroes the highlight (onChange path: fresh query restarts at the top)", () => {
    const { result } = renderAutocomplete({ input: "/pi" });
    act(() => result.current.moveHighlight(1));
    expect(result.current.highlightedSkillIndex).toBe(1);

    act(() => result.current.resetMenu());
    expect(result.current.highlightedSkillIndex).toBe(0);
  });
});

describe("useSkillAutocomplete highlight clamping on a shrinking match list", () => {
  it("clamps the highlight so it never points past the last match", () => {
    // Start with 3 matches, highlight the last.
    const { result, rerender, onAccept } = renderAutocomplete({ input: "/" });
    act(() => result.current.moveHighlight(1));
    act(() => result.current.moveHighlight(1));
    expect(result.current.highlightedSkillIndex).toBe(2);

    // Narrow the query so only 1 match remains; the highlight must clamp to 0
    // rather than pointing at index 2 of a length-1 list.
    rerender({ input: "/po", skills: SKILLS, onAccept });
    expect(result.current.skillMatches).toHaveLength(1);
    expect(result.current.highlightedSkillIndex).toBe(0);
  });
});

describe("useSkillAutocomplete wrap-around keyboard navigation", () => {
  it("moveHighlight(1) advances and wraps from the last match back to the first", () => {
    const { result } = renderAutocomplete({ input: "/" });
    expect(result.current.highlightedSkillIndex).toBe(0);

    act(() => result.current.moveHighlight(1));
    expect(result.current.highlightedSkillIndex).toBe(1);
    act(() => result.current.moveHighlight(1));
    expect(result.current.highlightedSkillIndex).toBe(2);
    // Wrap: last -> first.
    act(() => result.current.moveHighlight(1));
    expect(result.current.highlightedSkillIndex).toBe(0);
  });

  it("moveHighlight(-1) retreats and wraps from the first match back to the last", () => {
    const { result } = renderAutocomplete({ input: "/" });
    expect(result.current.highlightedSkillIndex).toBe(0);

    // Wrap: first -> last.
    act(() => result.current.moveHighlight(-1));
    expect(result.current.highlightedSkillIndex).toBe(2);
    act(() => result.current.moveHighlight(-1));
    expect(result.current.highlightedSkillIndex).toBe(1);
  });

  it("wraps correctly on a two-match list (the +matches.length-before-modulo guard)", () => {
    const { result } = renderAutocomplete({ input: "/pi" });
    expect(result.current.skillMatches).toHaveLength(2);
    expect(result.current.highlightedSkillIndex).toBe(0);

    act(() => result.current.moveHighlight(-1));
    // 0 - 1 + 2 = 1, % 2 = 1 -> last match (no negative index leak).
    expect(result.current.highlightedSkillIndex).toBe(1);
  });
});

describe("useSkillAutocomplete accept", () => {
  it("fires onAccept with the chosen name AND dismisses the menu", () => {
    const onAccept = vi.fn();
    const { result } = renderAutocomplete({ input: "/pi", onAccept });

    act(() => result.current.accept("pig-latin"));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith("pig-latin");
    // Menu dismissed even though the query + matches are still present.
    expect(result.current.isSkillMenuOpen).toBe(false);
  });

  it("does not fire onAccept on dismiss/reset/clearDismissed/moveHighlight", () => {
    const onAccept = vi.fn();
    const { result } = renderAutocomplete({ input: "/pi", onAccept });

    act(() => result.current.dismiss());
    act(() => result.current.resetMenu());
    act(() => result.current.clearDismissed());
    act(() => result.current.moveHighlight(1));
    expect(onAccept).not.toHaveBeenCalled();
  });
});

describe("useSkillAutocomplete referential stability", () => {
  it("keeps skillMatches referentially stable when neither skills nor the query change", () => {
    const { result, rerender, onAccept } = renderAutocomplete({ input: "/pi" });
    const first = result.current.skillMatches;
    // Re-render with identical props (a streaming token landing, say).
    rerender({ input: "/pi", skills: SKILLS, onAccept });
    expect(result.current.skillMatches).toBe(first);
  });

  it("keeps dismiss/resetMenu/clearDismissed stable across renders (empty deps)", () => {
    const { result, rerender, onAccept } = renderAutocomplete({ input: "/pi" });
    const dismiss = result.current.dismiss;
    const resetMenu = result.current.resetMenu;
    const clearDismissed = result.current.clearDismissed;
    rerender({ input: "/pig", skills: SKILLS, onAccept });
    expect(result.current.dismiss).toBe(dismiss);
    expect(result.current.resetMenu).toBe(resetMenu);
    expect(result.current.clearDismissed).toBe(clearDismissed);
  });

  it("keeps accept stable as long as onAccept is stable", () => {
    const onAccept = vi.fn();
    const { result, rerender } = renderAutocomplete({ input: "/pi", onAccept });
    const accept = result.current.accept;
    rerender({ input: "/pig", skills: SKILLS, onAccept });
    expect(result.current.accept).toBe(accept);
  });
});
