// @vitest-environment jsdom
//
// DOM-environment component tests for the Skills detail presentation components
// extracted into skill-detail.tsx (SkillDetail + CopyableId). These were
// previously private to src/routes/skills.tsx (the largest untested route at
// 726 lines) with zero coverage; extraction makes the detail-presentation
// contract testable in isolation on the established React Testing Library
// harness.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyableId, SkillDetail } from "~/components/skills/skill-detail";
import type { Skill } from "~/lib/hooks/use-skills";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const SKILL: Skill = {
  id: "skill-1",
  name: "my-skill",
  description: "A skill description.",
  body: "# Heading\n\nSome **bold** text.",
  isEnabled: true,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-02T00:00:00.000Z",
  references: [],
};

const SKILL_WITH_REFS: Skill = {
  ...SKILL,
  id: "skill-2",
  references: [
    {
      id: "ref-1",
      name: "api-reference",
      description: "Covers the API surface.",
      body: "## Endpoint\n\n`GET /things`",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    },
  ],
};

describe("SkillDetail", () => {
  it("renders the skill name as a heading, the enabled badge, and the description", () => {
    render(
      <SkillDetail onDelete={vi.fn()} onEdit={vi.fn()} onToggleEnabled={vi.fn()} skill={SKILL} />,
    );

    expect(screen.getByText("my-skill").tagName).toBe("H2");
    expect(screen.getByText("Enabled")).toBeTruthy();
    expect(screen.getByText("A skill description.")).toBeTruthy();
  });

  it("renders the Disabled badge and an Enable action when the skill is disabled", () => {
    render(
      <SkillDetail
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onToggleEnabled={vi.fn()}
        skill={{ ...SKILL, isEnabled: false }}
      />,
    );

    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enable" })).toBeTruthy();
  });

  it("renders the Enable-toggle button label as 'Disable' when enabled", () => {
    render(
      <SkillDetail onDelete={vi.fn()} onEdit={vi.fn()} onToggleEnabled={vi.fn()} skill={SKILL} />,
    );

    expect(screen.getByRole("button", { name: "Disable" })).toBeTruthy();
  });

  it("renders the instructions body as markdown", () => {
    const { container } = render(
      <SkillDetail onDelete={vi.fn()} onEdit={vi.fn()} onToggleEnabled={vi.fn()} skill={SKILL} />,
    );

    // Markdown maps # Heading to an <h1>, and **bold** to <strong>.
    expect(container.querySelector("h1")?.textContent).toBe("Heading");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(screen.getByText("Instructions")).toBeTruthy();
  });

  it("fires onToggleEnabled, onEdit, and onDelete via their respective buttons", () => {
    const onToggleEnabled = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();

    render(
      <SkillDetail
        onDelete={onDelete}
        onEdit={onEdit}
        onToggleEnabled={onToggleEnabled}
        skill={SKILL}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(onToggleEnabled).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Delete my-skill" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("omits the References section when the skill has no references", () => {
    render(
      <SkillDetail onDelete={vi.fn()} onEdit={vi.fn()} onToggleEnabled={vi.fn()} skill={SKILL} />,
    );

    expect(screen.queryByText(/^References/)).toBeNull();
  });

  it("renders the References section with a count, each reference's name/description/body, and a copyable id", () => {
    render(
      <SkillDetail
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onToggleEnabled={vi.fn()}
        skill={SKILL_WITH_REFS}
      />,
    );

    // Section heading carries the count.
    expect(screen.getByText("References (1)")).toBeTruthy();
    expect(screen.getByText("api-reference")).toBeTruthy();
    expect(screen.getByText("Covers the API surface.")).toBeTruthy();
    // Reference body rendered as markdown (## Endpoint -> h2, inline code).
    expect(screen.getByText("Endpoint").tagName).toBe("H2");
    expect(screen.getByText("GET /things").tagName).toBe("CODE");
    // Both the skill and the reference expose a copyable id.
    expect(screen.getByText("skill-2")).toBeTruthy();
    expect(screen.getByText("ref-1")).toBeTruthy();
  });
});

describe("CopyableId", () => {
  /** navigator.clipboard is a read-only getter on the Navigator prototype in
   * jsdom, so Object.assign(navigator, { clipboard }) silently fails; a
   * defineProperty override is the robust way to stub it per-test. */
  function stubClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
  }

  it("renders the label and the id verbatim", () => {
    render(<CopyableId id="abc-123" label="Skill ID" />);

    expect(screen.getByText("Skill ID")).toBeTruthy();
    expect(screen.getByText("abc-123")).toBeTruthy();
    // Title tooltip reflects the label.
    expect(screen.getByRole("button").getAttribute("title")).toBe("Copy Skill ID");
  });

  it("writes the id to the clipboard on click and flashes Copied!", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    vi.useFakeTimers();
    render(<CopyableId id="xyz" label="Reference ID" />);
    fireEvent.click(screen.getByRole("button"));

    // The clipboard promise resolves on the microtask queue; flush it before
    // asserting on the Copied! flash.
    await vi.waitFor(() => {
      expect(screen.getByText("Copied!")).toBeTruthy();
    });

    expect(writeText).toHaveBeenCalledWith("xyz");
  });

  it("reverts from Copied! back to the id after the ~1.5s confirmation window", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    vi.useFakeTimers();
    render(<CopyableId id="xyz" label="Reference ID" />);
    fireEvent.click(screen.getByRole("button"));
    await vi.waitFor(() => {
      expect(screen.getByText("Copied!")).toBeTruthy();
    });

    // Advancing the fake timer fires the component's setTimeout(() =>
    // setCopied(false)) callback; wrapping in act flushes the resulting React
    // re-render before the assertion.
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    expect(screen.getByText("xyz")).toBeTruthy();
    expect(screen.queryByText("Copied!")).toBeNull();
  });
});
