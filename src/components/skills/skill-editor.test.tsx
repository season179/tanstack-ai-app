// @vitest-environment jsdom
//
// DOM-environment component tests for the Skills editor components extracted
// into skill-editor.tsx (SkillEditor + Field). These were previously private
// to src/routes/skills.tsx (the largest untested route at 726 lines) with zero
// coverage; extraction makes the editor's submit / validation / references
// management contract testable in isolation on the established React Testing
// Library harness.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type CreateSkillPayload, Field, SkillEditor } from "~/components/skills/skill-editor";
import type { SkillDraft } from "~/lib/skills/skill-draft";

afterEach(() => {
  cleanup();
});

const EMPTY_DRAFT: SkillDraft = {
  name: "",
  description: "",
  body: "",
  references: [],
};

function nextKey() {
  return `k-${Math.random().toString(36).slice(2)}`;
}

function setup(
  overrides: {
    initialDraft?: SkillDraft;
    onSubmit?: (draft: CreateSkillPayload) => { id: string } | null;
    onSaved?: (saved: { id: string }) => void;
    onCancel?: () => void;
  } = {},
) {
  const onSubmit: (draft: CreateSkillPayload) => { id: string } | null =
    overrides.onSubmit ?? vi.fn().mockReturnValue({ id: "new-skill" });
  const onSaved: (saved: { id: string }) => void = overrides.onSaved ?? vi.fn();
  const onCancel: () => void = overrides.onCancel ?? vi.fn();

  const result = render(
    <SkillEditor
      initialDraft={overrides.initialDraft ?? EMPTY_DRAFT}
      nextReferenceKey={nextKey}
      onCancel={onCancel}
      onSaved={onSaved}
      onSubmit={onSubmit}
    />,
  );

  return { result, onSubmit, onSaved, onCancel };
}

/** Sets a controlled input/textarea value by dispatching the native setter +
 * input event, which reliably triggers React's onChange under jsdom. */
function setValue(element: HTMLElement, value: string) {
  const proto =
    element.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SkillEditor — heading + chrome", () => {
  it("renders the 'New skill' heading in create mode (empty initial draft)", () => {
    setup();
    expect(screen.getByText("New skill")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create skill" })).toBeTruthy();
  });

  it("renders the 'Edit <name>' heading + 'Save changes' button when editing", () => {
    setup({
      initialDraft: {
        name: "existing-skill",
        description: "desc",
        body: "body",
        references: [],
      },
    });
    expect(screen.getByText("Edit 'existing-skill'")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });

  it("fires onCancel from the header Close (X) button and the footer Cancel button", () => {
    const onCancel = vi.fn();
    setup({ onCancel });

    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

describe("SkillEditor — field rendering", () => {
  it("renders the Name, Description, and Instructions field labels with hints and counters", () => {
    setup();

    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Lowercase letters, digits, and single hyphens.")).toBeTruthy();
    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByText("Instructions")).toBeTruthy();
    expect(
      screen.getByText(
        "Markdown instructions loaded when the skill is activated (the SKILL.md body).",
      ),
    ).toBeTruthy();
    // Counters render: name starts at 0/64.
    expect(screen.getByText("0/64")).toBeTruthy();
  });

  it("renders the References management affordances", () => {
    setup();
    expect(screen.getByText("References")).toBeTruthy();
    expect(screen.getByText("Add reference")).toBeTruthy();
  });
});

describe("SkillEditor — references management", () => {
  it("adds a reference row on 'Add reference' click with an incremental label", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));

    expect(screen.getByText("Reference 1")).toBeTruthy();
    // The newly-added reference exposes Name / Description / Content fields.
    const labels = screen.getAllByText("Name");
    expect(labels.length).toBe(2); // top-level Name + reference Name
    expect(screen.getByText("Content")).toBeTruthy();
  });

  it("removes a reference row on the remove button", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));
    expect(screen.getByText("Reference 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove reference 1" }));
    expect(screen.queryByText("Reference 1")).toBeNull();
  });
});

describe("SkillEditor — Write/Preview toggle", () => {
  it("shows the textarea by default and switches to the markdown preview on Preview click", () => {
    setup({ initialDraft: { ...EMPTY_DRAFT, body: "# Hello" } });

    // Write mode: the body textarea (labelled Instructions) is present.
    expect(screen.getByLabelText("Instructions").tagName).toBe("TEXTAREA");

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    // Preview mode renders the markdown; the body <h1> appears.
    expect(screen.getByText("Hello").tagName).toBe("H1");
  });

  it("shows the 'Nothing to preview yet.' placeholder for an empty body in Preview mode", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("Nothing to preview yet.")).toBeTruthy();
  });
});

describe("SkillEditor — validation", () => {
  it("surfaces per-field errors on an empty submit without calling onSubmit/onSaved", () => {
    const onSubmit = vi.fn();
    const onSaved = vi.fn();
    setup({ onSubmit, onSaved });

    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    expect(screen.getByText("Name is required.")).toBeTruthy();
    expect(screen.getByText("Description is required.")).toBeTruthy();
    expect(screen.getByText("Instructions are required.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("clears a field error once the field is edited", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));
    expect(screen.getByText("Name is required.")).toBeTruthy();

    setValue(screen.getByPlaceholderText("my-skill"), "valid-name");
    expect(screen.queryByText("Name is required.")).toBeNull();
  });
});

describe("SkillEditor — submit happy path", () => {
  it("trims all fields, builds the payload, and fires onSubmit then onSaved on a valid create submit", async () => {
    const onSubmit = vi.fn().mockReturnValue({ id: "created-1" });
    const onSaved = vi.fn();
    setup({ onSubmit, onSaved });

    setValue(screen.getByPlaceholderText("my-skill"), "  my-skill  ");
    setValue(screen.getByPlaceholderText("Use this skill when..."), "  A description.  ");
    setValue(screen.getByLabelText("Instructions"), "  # Body  ");

    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toEqual({
      name: "my-skill",
      description: "A description.",
      body: "# Body",
      references: [],
    });
    // onSaved fires with the saved shape returned by onSubmit.
    expect(onSaved).toHaveBeenCalledWith({ id: "created-1" });
  });

  it("includes a reference (carrying its id when present) in the submit payload", async () => {
    const onSubmit = vi.fn().mockReturnValue({ id: "created-2" });
    setup({
      onSubmit,
      initialDraft: {
        name: "",
        description: "",
        body: "",
        references: [{ key: "k1", id: "ref-existing", name: "", description: "", body: "" }],
      },
    });

    setValue(screen.getByPlaceholderText("my-skill"), "skill");
    setValue(screen.getByPlaceholderText("Use this skill when..."), "desc");
    setValue(screen.getByLabelText("Instructions"), "body");
    // The reference's own name/description/content placeholders.
    setValue(screen.getByPlaceholderText("api-reference"), "ref-name");
    setValue(screen.getByPlaceholderText("What this document covers"), "ref-desc");
    setValue(screen.getByPlaceholderText("Markdown content..."), "ref-body");

    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    const payload = onSubmit.mock.calls[0][0];
    expect(payload.references).toEqual([
      { id: "ref-existing", name: "ref-name", description: "ref-desc", body: "ref-body" },
    ]);
  });

  it("omits the id on references that did not carry one (new references)", async () => {
    const onSubmit = vi.fn().mockReturnValue({ id: "created-3" });
    setup({ onSubmit });

    setValue(screen.getByPlaceholderText("my-skill"), "skill");
    setValue(screen.getByPlaceholderText("Use this skill when..."), "desc");
    setValue(screen.getByLabelText("Instructions"), "body");
    fireEvent.click(screen.getByRole("button", { name: "Add reference" }));
    setValue(screen.getByPlaceholderText("api-reference"), "ref-name");
    setValue(screen.getByPlaceholderText("What this document covers"), "ref-desc");
    setValue(screen.getByPlaceholderText("Markdown content..."), "ref-body");

    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    const payload = onSubmit.mock.calls[0][0];
    expect(payload.references).toEqual([
      { name: "ref-name", description: "ref-desc", body: "ref-body" },
    ]);
    expect("id" in payload.references[0]).toBe(false);
  });
});

describe("SkillEditor — submit failure", () => {
  it("shows a save error and does not call onSaved when onSubmit returns null", () => {
    const onSubmit = vi.fn().mockReturnValue(null);
    const onSaved = vi.fn();
    setup({ onSubmit, onSaved });

    setValue(screen.getByPlaceholderText("my-skill"), "skill");
    setValue(screen.getByPlaceholderText("Use this skill when..."), "desc");
    setValue(screen.getByLabelText("Instructions"), "body");
    fireEvent.click(screen.getByRole("button", { name: "Create skill" }));

    expect(
      screen.getByText("This skill could not be found. It may have been deleted."),
    ).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("Field", () => {
  it("renders the label, hint, and counter, and links the label to the rendered input via htmlFor/id", () => {
    let capturedId = "";
    render(
      <Field counter="3/64" hint="A hint." label="My Field">
        {(id) => {
          capturedId = id;
          return <input id={id} />;
        }}
      </Field>,
    );

    const label = screen.getByText("My Field");
    expect(label.tagName).toBe("LABEL");
    expect(label.getAttribute("for")).toBe(capturedId);
    expect(screen.getByText("A hint.")).toBeTruthy();
    expect(screen.getByText("3/64")).toBeTruthy();
    expect(document.getElementById(capturedId)).toBeTruthy();
  });

  it("omits the counter and hint lines when not provided", () => {
    render(<Field label="Bare">{() => <input />}</Field>);

    expect(screen.getByText("Bare")).toBeTruthy();
    expect(screen.queryByText("0/64")).toBeNull();
  });

  it("renders the error line with role=alert when an error is provided", () => {
    render(
      <Field error="Bad value" label="With Error">
        {() => <input />}
      </Field>,
    );

    const errorNode = screen.getByText("Bad value");
    expect(errorNode.getAttribute("role")).toBe("alert");
  });
});
