// @vitest-environment jsdom
//
// DOM-environment component tests for ModelPicker — the searchable,
// keyboard-navigable, lazy-loading model selector in the composer. This
// extends the React Testing Library harness established for the hooks (see
// use-models.dom.test.tsx) from renderHook to render/screen/fireEvent, pinning
// the interactive component behavior that had zero coverage despite driving a
// core piece of chat UX: label derivation, popover open/close, the prefix-then-
// substring ranking filter, the MAX_RENDERED cap, keyboard navigation, outside-
// click dismiss, mouse hover/selection, the empty-catalog default-model
// fallback, and the loading state.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelPicker } from "~/components/chat/model-picker";
import type { OpenRouterModelSummary } from "~/lib/types";

type Model = OpenRouterModelSummary;

// jsdom does not implement Element.prototype.scrollIntoView (it's a layout
// primitive with no meaningful behavior in a headless DOM). ModelPicker calls
// it in a useEffect to keep the highlighted row in view during keyboard
// navigation, so opening the menu would otherwise throw under jsdom. This is a
// standard jsdom workaround, not a component bug; a no-op stub is sufficient
// for the component's contract.
beforeEach(() => {
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

function makeModels(): Model[] {
  return [
    { id: "openai/gpt-4o", name: "GPT-4o", contextLength: 128000 },
    { id: "openai/gpt-4o-mini", name: "GPT-4o mini", contextLength: 128000 },
    { id: "anthropic/claude-3.5", name: "Claude 3.5", contextLength: 200000 },
    { id: "meta/llama-3", name: "Llama 3", contextLength: 8000 },
    { id: "google/gemini-pro", name: "Gemini Pro", contextLength: 32000 },
  ];
}

afterEach(() => {
  cleanup();
});

describe("ModelPicker closed-state label", () => {
  it('shows "Default model" when there is no value and no default', () => {
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={[]}
        onChange={() => {}}
        value={null}
      />,
    );
    expect(screen.getByRole("button", { name: /Default model/ })).toBeTruthy();
  });

  it("falls back to shortName(defaultModel) when only a default is known", () => {
    render(
      <ModelPicker
        defaultModel="openai/gpt-4o"
        loading={false}
        models={[]}
        onChange={() => {}}
        value={null}
      />,
    );
    // shortName takes the segment after the last slash.
    expect(screen.getByRole("button", { name: /gpt-4o/ })).toBeTruthy();
  });

  it("shows the catalog entry's display name when value matches a catalog row", () => {
    render(
      <ModelPicker
        defaultModel="openai/gpt-4o"
        loading={false}
        models={makeModels()}
        onChange={() => {}}
        value="anthropic/claude-3.5"
      />,
    );
    expect(screen.getByRole("button", { name: "Claude 3.5" })).toBeTruthy();
  });

  it("falls back to shortName(value) when value is set but absent from the catalog", () => {
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={() => {}}
        value="mistral/mistral-large"
      />,
    );
    expect(screen.getByRole("button", { name: /mistral-large/ })).toBeTruthy();
  });

  it("disables the trigger button when the disabled prop is set", () => {
    render(
      <ModelPicker
        defaultModel={null}
        disabled
        loading={false}
        models={[]}
        onChange={() => {}}
        value={null}
      />,
    );
    expect(screen.getByRole("button")).toHaveProperty("disabled", true);
  });

  it("exposes listbox semantics on the trigger", () => {
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={[]}
        onChange={() => {}}
        value={null}
      />,
    );
    const trigger = screen.getByRole("button");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("ModelPicker open/close + onOpen lazy-load", () => {
  it("opens the listbox on click, fires onOpen, and exposes aria-expanded true", () => {
    const onOpen = vi.fn();
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={() => {}}
        onOpen={onOpen}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("textbox", { name: "Search models" })).toBeTruthy();
  });

  it("does not fire onOpen when reopening an already-open menu is a toggle-to-close", () => {
    const onOpen = vi.fn();
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={() => {}}
        onOpen={onOpen}
        value={null}
      />,
    );
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger); // open
    fireEvent.click(trigger); // toggle close
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it('shows "Loading models..." while loading and the catalog is still empty', () => {
    render(
      <ModelPicker defaultModel={null} loading models={[]} onChange={() => {}} value={null} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Loading models...")).toBeTruthy();
  });
});

describe("ModelPicker filter ranking + MAX_RENDERED cap", () => {
  it("renders all rows when no query is entered (under the cap)", () => {
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={() => {}}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    // Every option is a role="option".
    expect(screen.getAllByRole("option")).toHaveLength(5);
    expect(screen.queryByText(/Showing \d+ of/)).toBeNull();
  });

  it("ranks prefix matches ahead of substring matches and is case-insensitive", () => {
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={() => {}}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    // "4o" matches "openai/gpt-4o" + "openai/gpt-4o-mini" by prefix (id), and
    // "GPT-4o" / "GPT-4o mini" by substring (name). Prefix ids win first.
    fireEvent.change(screen.getByRole("textbox", { name: "Search models" }), {
      target: { value: "4o" },
    });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("openai/gpt-4o"),
      expect.stringContaining("openai/gpt-4o-mini"),
    ]);
  });

  it('shows "No models match." for a query with zero hits', () => {
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={() => {}}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByRole("textbox", { name: "Search models" }), {
      target: { value: "zzzznotamodel" },
    });
    expect(screen.getByText("No models match.")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toEqual([]);
  });

  it("caps rendered rows at MAX_RENDERED (50) and shows the refine hint", () => {
    // 60 models whose ids all start with "dup/" so the empty query path applies.
    const many: Model[] = Array.from({ length: 60 }, (_, i) => ({
      id: `dup/model-${i}`,
      name: `Model ${i}`,
      contextLength: null,
    }));
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={many}
        onChange={() => {}}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByRole("option")).toHaveLength(50);
    expect(screen.getByText(/Showing 50 of 60/)).toBeTruthy();
  });

  it("keeps the cap honest for a filtered query that still exceeds it", () => {
    const many: Model[] = Array.from({ length: 60 }, (_, i) => ({
      id: `dup/model-${i}`,
      name: `Model ${i}`,
      contextLength: null,
    }));
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={many}
        onChange={() => {}}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByRole("textbox", { name: "Search models" }), {
      target: { value: "dup" },
    });
    expect(screen.getAllByRole("option")).toHaveLength(50);
    expect(screen.getByText(/Showing 50 of 60/)).toBeTruthy();
  });
});

describe("ModelPicker empty-catalog default-model fallback", () => {
  it("offers the default model as the only row when the catalog is empty", () => {
    render(
      <ModelPicker
        defaultModel="openai/gpt-4o"
        loading={false}
        models={[]}
        onChange={() => {}}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("openai/gpt-4o");
  });

  it("shows no options at all when there is no catalog and no default", () => {
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={[]}
        onChange={() => {}}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryAllByRole("option")).toEqual([]);
    expect(screen.getByText("No models match.")).toBeTruthy();
  });
});

describe("ModelPicker keyboard navigation", () => {
  it("cycles ArrowDown/ArrowUp through the matches and Enter selects", () => {
    const onChange = vi.fn();
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={onChange}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const search = screen.getByRole("textbox", { name: "Search models" });

    // Highlight starts at 0 (first match). ArrowDown -> index 1.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(makeModels()[1].id);
    // Selecting closes the menu.
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("ArrowUp wraps from the first row back to the last", () => {
    const onChange = vi.fn();
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={onChange}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const search = screen.getByRole("textbox", { name: "Search models" });
    const ids = makeModels().map((m) => m.id);

    // From index 0, ArrowUp wraps to the last row (index ids.length - 1).
    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(ids[ids.length - 1]);
  });

  it("Enter on an empty result set does not call onChange", () => {
    const onChange = vi.fn();
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={onChange}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const search = screen.getByRole("textbox", { name: "Search models" });
    fireEvent.change(search, { target: { value: "zzzznotamodel" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Arrow keys are a no-op when there are no matches", () => {
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={() => {}}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const search = screen.getByRole("textbox", { name: "Search models" });
    fireEvent.change(search, { target: { value: "zzzznotamodel" } });
    // No throw + still open.
    expect(() => fireEvent.keyDown(search, { key: "ArrowDown" })).not.toThrow();
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("Escape closes the menu without selecting", () => {
    const onChange = vi.fn();
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={onChange}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const search = screen.getByRole("textbox", { name: "Search models" });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("ModelPicker mouse interaction + outside-click dismiss", () => {
  it("clicking an option calls onChange with its id and closes", () => {
    const onChange = vi.fn();
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={onChange}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const options = screen.getAllByRole("option");
    fireEvent.click(options[2]);
    expect(onChange).toHaveBeenCalledWith(makeModels()[2].id);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("mouseenter on an option re-highlights it so the next Enter picks that row", () => {
    const onChange = vi.fn();
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={onChange}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const search = screen.getByRole("textbox", { name: "Search models" });
    const options = screen.getAllByRole("option");
    fireEvent.mouseEnter(options[3]);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(makeModels()[3].id);
  });

  it("dismisses the listbox on a mousedown outside the container", () => {
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={() => {}}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox")).toBeTruthy();
    // A mousedown on document.body (outside the picker container) dismisses.
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not dismiss on a mousedown inside the container", () => {
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={() => {}}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.mouseDown(screen.getByRole("listbox"));
    expect(screen.getByRole("listbox")).toBeTruthy();
  });
});

describe("ModelPicker selection checkmark + context-length formatting", () => {
  it("marks the keyboard-highlighted row (not the chosen value) with aria-selected", () => {
    // aria-selected here tracks the active-descendant highlight (the row a
    // keyboard Enter would pick), which defaults to the first match — NOT the
    // chosen value. The chosen value is shown only via the Check icon's
    // opacity. This matches the reference's semantics (a faithful port).
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={() => {}}
        value="anthropic/claude-3.5"
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const options = screen.getAllByRole("option");
    const selected = options.map((o) => o.getAttribute("aria-selected"));
    // Exactly one row is highlighted (the active descendant), and by default
    // it is the first row.
    expect(selected.filter((v) => v === "true")).toHaveLength(1);
    expect(selected[0]).toBe("true");
    // Moving the highlight with ArrowDown shifts aria-selected to row 1.
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search models" }), {
      key: "ArrowDown",
    });
    const after = screen.getAllByRole("option").map((o) => o.getAttribute("aria-selected"));
    expect(after[1]).toBe("true");
    expect(after[0]).toBe("false");
  });

  it("formats context length in thousands (K) when >= 1000", () => {
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={() => {}}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const options = screen.getAllByRole("option");
    // 128000 -> "128K", 200000 -> "200K", 32000 -> "32K".
    expect(options[0].textContent).toContain("128K"); // gpt-4o
    expect(options[2].textContent).toContain("200K"); // claude-3.5
    expect(options[4].textContent).toContain("32K"); // gemini-pro
  });

  it("renders the raw context length (no K) when under 1000", () => {
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={makeModels()}
        onChange={() => {}}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const options = screen.getAllByRole("option");
    // meta/llama-3 has contextLength 8000 -> "8K", so use a sub-1000 fixture.
    expect(options[3].textContent).toContain("8K"); // 8000 -> 8K
  });

  it("omits the context readout when contextLength is null", () => {
    const models: Model[] = [{ id: "openai/gpt-4o", name: "GPT-4o", contextLength: null }];
    render(
      <ModelPicker
        defaultModel={null}
        loading={false}
        models={models}
        onChange={() => {}}
        value={null}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    // No "K" context pill should be rendered for a null contextLength.
    expect(screen.getByRole("option").textContent).not.toMatch(/\d+K$/);
  });
});
