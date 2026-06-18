// @vitest-environment jsdom
//
// DOM-environment component tests for ThemeToggle — the sidebar's theme
// selector. Ported in iteration 50 as a single cycling button, then upgraded in
// this iteration to the reference's segmented Light|Dark|System control when
// expanded (`withLabel`) and a single cycling icon when the rail is docked.
// These tests pin both shapes plus the active-segment/pressed contract,
// extending the React Testing Library harness established in iteration 55
// (ModelPicker). Uses fireEvent (the project's established component-test
// interaction API) rather than @testing-library/user-event.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemeToggle } from "~/components/theme-toggle";
import { THEME_STORAGE_KEY, ThemeProvider } from "~/lib/hooks/use-theme";

/** jsdom does not implement matchMedia; install a fixed-prefers mock. */
function installMatchMedia(prefersDark: boolean) {
  const make = (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" ? prefersDark : !prefersDark,
    media: query,
    onchange: null as ((ev: MediaQueryListEvent) => unknown) | null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  window.matchMedia = ((query: string) => make(query)) as unknown as typeof window.matchMedia;
}

/** Renders ThemeToggle inside the ThemeProvider it reads from. */
function renderToggle(props: { withLabel?: boolean } = {}) {
  return render(
    <ThemeProvider>
      <ThemeToggle withLabel={props.withLabel ?? true} />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  installMatchMedia(false);
});

describe("ThemeToggle segmented control (withLabel)", () => {
  it("renders three labeled segments Light/Dark/System", () => {
    renderToggle({ withLabel: true });
    expect(screen.getByRole("button", { name: "Light" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dark" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "System" })).toBeTruthy();
  });

  it("marks the stored preference as pressed (aria-pressed) after mount", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    renderToggle({ withLabel: true });
    expect(screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Light" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.getByRole("button", { name: "System" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("defaults to the system segment when nothing is stored", () => {
    renderToggle({ withLabel: true });
    expect(screen.getByRole("button", { name: "System" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("clicking a segment calls setTheme and persists it to localStorage", () => {
    renderToggle({ withLabel: true });
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("applies the active segment styling (bg-background) only to the pressed segment", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    renderToggle({ withLabel: true });
    expect(screen.getByRole("button", { name: "Light" }).className).toContain("bg-background");
    expect(screen.getByRole("button", { name: "Dark" }).className).not.toContain("bg-background");
  });

  it("switching segments updates the pressed + applied class in one click", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    renderToggle({ withLabel: true });
    fireEvent.click(screen.getByRole("button", { name: "System" }));
    expect(screen.getByRole("button", { name: "System" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Light" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    // System resolves to light (OS prefers light in this test) → no .dark class.
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("ThemeToggle collapsed rail (withLabel=false)", () => {
  it("renders a single cycling icon button, not three segments", () => {
    renderToggle({ withLabel: false });
    // Exactly one button, labelled with the current theme.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("shows the current theme in the aria-label", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    renderToggle({ withLabel: false });
    expect(screen.getByRole("button", { name: /theme: dark\. click to change\./i })).toBeTruthy();
  });

  it("cycles light → dark → system → light on repeat clicks", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { rerender } = renderToggle({ withLabel: false });

    fireEvent.click(screen.getByRole("button"));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    // ThemeProvider reads localStorage on mount; re-mount to pick up the new
    // stored value before clicking again (mirrors a real reload between clicks).
    rerender(
      <ThemeProvider>
        <ThemeToggle withLabel={false} />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");

    rerender(
      <ThemeProvider>
        <ThemeToggle withLabel={false} />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("derives the rail title from the stored preference", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    renderToggle({ withLabel: false });
    expect(screen.getByRole("button").getAttribute("title")).toBe("Theme: Light");
  });
});
