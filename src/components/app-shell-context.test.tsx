// @vitest-environment jsdom
//
// DOM-environment tests for AppShellProvider / useAppShell / isMobileViewport —
// the app-wide shell-state context (sidebar open/close) that AppShellFrame
// reads to drive the --sidebar-width/--sidebar-rail CSS custom properties and
// the AppSidebar consumes for its collapse/expand toggle. Pins the context
// contract (default sidebarOpen=true, toggleSidebar flips, closeSidebar sets
// false, stable callback identities, the provider + thrown-on-missing-consumer
// contract) AND isMobileViewport's SSR-safe matchMedia read (false on a server
// render where window is undefined, true/false driven by the (max-width: 639px)
// media query in the browser) plus the exported layout constants the root
// frame + sidebar read for their CSS variable sizing.
//
// Uses the React Testing Library renderHook harness established in iteration
// 53. jsdom does not implement window.matchMedia by default, so a small
// installMatchMedia helper sets a fixed-matches mock (the same gap documented
// for theme resolution in iteration 50 / ModelPicker scroll-into-view in 55).
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppShellProvider,
  isMobileViewport,
  MOBILE_QUERY,
  SIDEBAR_RAIL,
  SIDEBAR_WIDTH,
  useAppShell,
} from "~/components/app-shell-context";

const QUERY = "(max-width: 639px)";

/** jsdom does not implement matchMedia; install a fixed-matches mock. */
function installMatchMedia(matchesMobile: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query === QUERY ? matchesMobile : !matchesMobile,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderShellHook() {
  return renderHook(() => useAppShell(), { wrapper: AppShellProvider });
}

beforeEach(() => {
  installMatchMedia(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("layout constants", () => {
  it("exports the expanded sidebar width, rail width, and mobile breakpoint", () => {
    expect(SIDEBAR_WIDTH).toBe("16rem");
    expect(SIDEBAR_RAIL).toBe("3.5rem");
    expect(MOBILE_QUERY).toBe("(max-width: 639px)");
  });

  it("the rail width is narrower than the expanded width", () => {
    // Both are rem strings; parse the leading number to compare.
    const parse = (s: string) => Number.parseFloat(s);
    expect(parse(SIDEBAR_RAIL)).toBeLessThan(parse(SIDEBAR_WIDTH));
  });
});

describe("isMobileViewport", () => {
  it("returns false when window is undefined (SSR guard)", () => {
    const original = globalThis.window;
    // @ts-expect-error intentionally deleting the global for the SSR case
    delete globalThis.window;
    try {
      expect(isMobileViewport()).toBe(false);
    } finally {
      globalThis.window = original;
    }
  });

  it("returns true when the mobile media query matches", () => {
    installMatchMedia(true);
    expect(isMobileViewport()).toBe(true);
  });

  it("returns false when the mobile media query does not match", () => {
    installMatchMedia(false);
    expect(isMobileViewport()).toBe(false);
  });
});

describe("AppShellProvider context contract", () => {
  it("exposes sidebarOpen=true by default", () => {
    const { result } = renderShellHook();
    expect(result.current.sidebarOpen).toBe(true);
  });

  it("toggleSidebar flips the open state", () => {
    const { result } = renderShellHook();
    expect(result.current.sidebarOpen).toBe(true);
    act(() => result.current.toggleSidebar());
    expect(result.current.sidebarOpen).toBe(false);
    act(() => result.current.toggleSidebar());
    expect(result.current.sidebarOpen).toBe(true);
  });

  it("closeSidebar sets the open state to false", () => {
    const { result } = renderShellHook();
    expect(result.current.sidebarOpen).toBe(true);
    act(() => result.current.closeSidebar());
    expect(result.current.sidebarOpen).toBe(false);
    // Idempotent: closing an already-closed sidebar stays closed.
    act(() => result.current.closeSidebar());
    expect(result.current.sidebarOpen).toBe(false);
  });

  it("keeps toggleSidebar identity stable across renders + state changes", () => {
    const { result, rerender } = renderShellHook();
    const first = result.current.toggleSidebar;
    act(() => result.current.toggleSidebar());
    rerender();
    expect(result.current.toggleSidebar).toBe(first);
  });

  it("keeps closeSidebar identity stable across renders + state changes", () => {
    const { result, rerender } = renderShellHook();
    const first = result.current.closeSidebar;
    act(() => result.current.closeSidebar());
    rerender();
    expect(result.current.closeSidebar).toBe(first);
  });

  it("toggleSidebar and closeSidebar are distinct functions", () => {
    const { result } = renderShellHook();
    expect(result.current.toggleSidebar).not.toBe(result.current.closeSidebar);
  });
});

describe("useAppShell consumer contract", () => {
  it("throws when used outside the AppShellProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAppShell())).toThrow(/useAppShell must be used inside/);
    spy.mockRestore();
  });
});
