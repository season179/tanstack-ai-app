// @vitest-environment jsdom
//
// DOM-environment tests for the framework-agnostic theme helpers (the reference
// app's next-themes dependency, replaced here with no extra deps). The helpers
// guard on `window`/`document`/`matchMedia` and consult localStorage + the OS
// prefers-color-scheme query, so coverage requires jsdom (which supplies all
// three). The module holds no cross-test mutable state, so no resetModules is
// needed; beforeEach clears localStorage + the documentElement class list.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyTheme,
  getSystemTheme,
  readStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "~/lib/hooks/use-theme";

/** A minimal MediaQueryList shape that reports a fixed `matches` value. jsdom
 *  does not implement matchMedia, so tests install it before resolving. */
type MqlLike = {
  matches: boolean;
  media: string;
  onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null;
  addEventListener: () => void;
  removeEventListener: () => void;
  addListener: () => void;
  removeListener: () => void;
  dispatchEvent: () => boolean;
};

function installMatchMedia(prefersDark: boolean): MqlLike {
  const make = (query: string): MqlLike => ({
    matches: query === "(prefers-color-scheme: dark)" ? prefersDark : !prefersDark,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  // matchMedia is absent in jsdom; assign directly (the spies below still work).
  window.matchMedia = ((query: string) => make(query)) as unknown as typeof window.matchMedia;
  return make("(prefers-color-scheme: dark)");
}

describe("readStoredTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("reads each valid value back verbatim", () => {
    for (const value of ["light", "dark", "system"] as const) {
      window.localStorage.setItem(THEME_STORAGE_KEY, value);
      expect(readStoredTheme()).toBe(value);
    }
  });

  it("defaults to system when nothing is stored", () => {
    expect(readStoredTheme()).toBe("system");
  });

  it("defaults to system on an unrecognized value", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "nord");
    expect(readStoredTheme()).toBe("system");
  });

  it("defaults to system on an empty string", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "");
    expect(readStoredTheme()).toBe("system");
  });

  it("fails soft to system when localStorage throws", () => {
    const getter = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(readStoredTheme()).toBe("system");
    getter.mockRestore();
  });
});

describe("getSystemTheme", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns dark when the OS prefers dark", () => {
    installMatchMedia(true);
    expect(getSystemTheme()).toBe("dark");
  });

  it("returns light when the OS prefers light", () => {
    installMatchMedia(false);
    expect(getSystemTheme()).toBe("light");
  });
});

describe("resolveTheme", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes explicit preferences through unchanged", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("delegates system to the OS media query", () => {
    installMatchMedia(true);
    expect(resolveTheme("system")).toBe("dark");
  });
});

describe("applyTheme", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("adds the dark class for dark", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes the dark class for light", () => {
    document.documentElement.classList.add("dark");
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("is idempotent (re-applying dark twice keeps a single class)", () => {
    applyTheme("dark");
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.className).toBe("dark");
  });

  it("toggles off cleanly from dark back to light", () => {
    applyTheme("dark");
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.className).toBe("");
  });
});
