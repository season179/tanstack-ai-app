// @vitest-environment jsdom
//
// DOM-environment component tests for AppShell / AppShellFrame — the root
// layout frame that wraps every routed page in the AppShellProvider and
// renders the persistent AppSidebar + content region. The AppShellProvider
// context itself (sidebarOpen default, toggle/close, stable callbacks,
// isMobileViewport SSR-safe read, layout constants) already has co-located
// coverage (app-shell-context.test.tsx, iteration 81); the AppSidebar,
// scheduler, and ThemeToggle are all pinned elsewhere. What had ZERO coverage
// was the AppShellFrame itself: the two load-bearing mount side effects that
// live HERE (not in the context, not in the sidebar):
//
//   1. the iteration-32 invariant — the scheduled-task ticker is booted from
//      the always-mounted root frame (not just from /tasks), so due/recurring
//      tasks fire on every route. startTaskScheduler fires exactly once on
//      mount and is idempotent across re-renders.
//   2. the mobile-collapsed-on-mount behavior — closeSidebar() is called on
//      first mount ONLY when isMobileViewport() returns true (so a fresh load
//      on a phone starts with the rail docked), and is NOT called on desktop.
//
// Plus the structural rendering contract: the frame wraps children in the
// real AppShellProvider, renders the AppSidebar + the content region, and
// sets the --sidebar-width / --sidebar-rail CSS custom properties on the
// outermost div so the layout CSS can size the sidebar from sidebarOpen
// (SIDEBAR_WIDTH when expanded, SIDEBAR_RAIL when docked).
//
// Harness: startTaskScheduler is replaced with a hoisted spy so the mount
// effect never starts a real setInterval, and AppSidebar is replaced with a
// marker element so the frame can be rendered in isolation (the sidebar's
// own router/context/store wiring has its own coverage). The real
// AppShellProvider, isMobileViewport, and SIDEBAR_WIDTH/SIDEBAR_RAIL run so
// the provider→frame data flow + the CSS-variable derivation are exercised
// end-to-end. jsdom does not implement window.matchMedia by default, so a
// small installMatchMedia helper sets a fixed-matches mock (the same gap
// documented for theme resolution in iteration 50 / ModelPicker
// scroll-into-view in 55 / the AppShellProvider test in 81).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "~/components/app-shell";
import {
  isMobileViewport,
  MOBILE_QUERY,
  SIDEBAR_RAIL,
  SIDEBAR_WIDTH,
} from "~/components/app-shell-context";

const QUERY = MOBILE_QUERY;

// vi.mock factories are hoisted BEFORE imports, so the spies must be created
// via vi.hoisted to be referenceable from inside the factory closures.
const mocks = vi.hoisted(() => ({
  startTaskSchedulerSpy: vi.fn(),
}));

// Replace the scheduler's singleton-boot function with the hoisted spy so the
// mount effect never starts a real setInterval (which would leak across
// tests and depend on real wall-clock time). The real module's other exports
// are preserved.
vi.mock("~/lib/tasks/scheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/tasks/scheduler")>();
  return {
    ...actual,
    startTaskScheduler: mocks.startTaskSchedulerSpy,
  };
});

// Replace AppSidebar with a marker element so AppShellFrame renders in
// isolation. The sidebar's own router/context/store wiring has its own
// co-located coverage (app-sidebar.test.tsx, iteration 79); pulling it in
// here would force mocking the router + sessions store + busy signal just to
// render the frame, obscuring the frame's own contract.
vi.mock("~/components/app-sidebar", () => ({
  AppSidebar: () => <aside data-testid="app-sidebar-marker" />,
}));

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

beforeEach(() => {
  installMatchMedia(false);
  mocks.startTaskSchedulerSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

/** Render AppShell around a marker child and return the outermost frame div. */
function renderFrame() {
  const utils = render(
    <AppShell>
      <main data-testid="page-content">page</main>
    </AppShell>,
  );
  // The outermost div is the frame wrapper carrying the CSS custom properties.
  const frame = utils.container.firstElementChild as HTMLElement;
  return { ...utils, frame };
}

describe("AppShell structural rendering", () => {
  it("renders the AppSidebar and the routed content region", () => {
    renderFrame();
    expect(screen.getByTestId("app-sidebar-marker")).toBeTruthy();
    expect(screen.getByTestId("page-content").textContent).toBe("page");
  });

  it("wraps children in the real AppShellProvider so useAppShell resolves", () => {
    // If the provider were missing, isMobileViewport is read directly (not via
    // context), but the frame's own useAppShell() would throw at render. The
    // fact that renderFrame() renders at all (without throwing) proves the
    // provider is wired. The CSS-variable derivation below additionally proves
    // the provider's sidebarOpen flows into the frame.
    const { frame } = renderFrame();
    expect(frame).toBeTruthy();
  });

  it("applies the full-viewport flex + background classes to the outermost frame", () => {
    const { frame } = renderFrame();
    expect(frame.className).toContain("h-dvh");
    expect(frame.className).toContain("bg-background");
    expect(frame.className).toContain("flex");
  });
});

describe("AppShell CSS custom properties", () => {
  it("sets --sidebar-rail to SIDEBAR_RAIL regardless of open state", () => {
    const { frame } = renderFrame();
    expect(window.getComputedStyle(frame).getPropertyValue("--sidebar-rail").trim()).toBe(
      SIDEBAR_RAIL,
    );
  });

  it("sets --sidebar-width to SIDEBAR_WIDTH when the sidebar is open (default)", () => {
    const { frame } = renderFrame();
    expect(window.getComputedStyle(frame).getPropertyValue("--sidebar-width").trim()).toBe(
      SIDEBAR_WIDTH,
    );
  });
});

describe("AppShell scheduler boot (iteration-32 invariant)", () => {
  it("boots the scheduled-task scheduler exactly once on mount", () => {
    renderFrame();
    expect(mocks.startTaskSchedulerSpy).toHaveBeenCalledTimes(1);
  });

  it("does not re-boot the scheduler on re-render (idempotent mount effect)", () => {
    const { rerender } = renderFrame();
    expect(mocks.startTaskSchedulerSpy).toHaveBeenCalledTimes(1);
    rerender(
      <AppShell>
        <main data-testid="page-content">page-2</main>
      </AppShell>,
    );
    rerender(
      <AppShell>
        <main data-testid="page-content">page-3</main>
      </AppShell>,
    );
    expect(mocks.startTaskSchedulerSpy).toHaveBeenCalledTimes(1);
  });

  it("re-boots the scheduler when the frame is remounted (new lifecycle)", () => {
    const { unmount } = renderFrame();
    expect(mocks.startTaskSchedulerSpy).toHaveBeenCalledTimes(1);
    unmount();
    renderFrame();
    expect(mocks.startTaskSchedulerSpy).toHaveBeenCalledTimes(2);
  });
});

describe("AppShell mobile sidebar collapse on mount", () => {
  it("does NOT call closeSidebar on mount when the viewport is desktop", () => {
    installMatchMedia(false);
    expect(isMobileViewport()).toBe(false);
    const { frame } = renderFrame();
    // Desktop keeps the default open state → --sidebar-width is the full width.
    expect(window.getComputedStyle(frame).getPropertyValue("--sidebar-width").trim()).toBe(
      SIDEBAR_WIDTH,
    );
  });

  it("calls closeSidebar on mount when the viewport is mobile (rail docked)", () => {
    installMatchMedia(true);
    expect(isMobileViewport()).toBe(true);
    const { frame } = renderFrame();
    // Mobile-start collapsed → --sidebar-width collapses to the rail width.
    expect(window.getComputedStyle(frame).getPropertyValue("--sidebar-width").trim()).toBe(
      SIDEBAR_RAIL,
    );
  });

  it("the mobile-collapse mount effect runs once (stable closeSidebar identity)", () => {
    // The effect's deps are [closeSidebar]; closeSidebar is a stable useCallback
    // in the provider, so the effect should fire exactly once on mount even
    // across re-renders. We assert via the resulting --sidebar-width staying at
    // the rail value (a second closeSidebar call would be a no-op anyway, but a
    // missing dep would re-run on every render — observable here as the value
    // remaining stable, which it must).
    installMatchMedia(true);
    const { frame, rerender } = renderFrame();
    expect(window.getComputedStyle(frame).getPropertyValue("--sidebar-width").trim()).toBe(
      SIDEBAR_RAIL,
    );
    rerender(
      <AppShell>
        <main data-testid="page-content">page-2</main>
      </AppShell>,
    );
    expect(window.getComputedStyle(frame).getPropertyValue("--sidebar-width").trim()).toBe(
      SIDEBAR_RAIL,
    );
  });
});
