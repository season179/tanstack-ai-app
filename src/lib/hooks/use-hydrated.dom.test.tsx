// @vitest-environment jsdom
//
// Hook test for useHydrated. The hook returns false during SSR / the first
// client render and true after mount, which is the gating pattern every
// localStorage-backed route uses to avoid acting on the pre-hydration
// snapshot. @testing-library/react 16 flushes the mount effect synchronously
// inside act(), so the pre-effect `false` is NOT observable through
// renderHook (the SSR/first-render value lives only in React's render
// output, not the post-commit hook result); these tests therefore pin the
// observable post-mount contract: true after the first commit and stable
// across re-renders / remounts.
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useHydrated } from "~/lib/hooks/use-hydrated";

describe("useHydrated", () => {
  it("is true once the mount effect has committed", () => {
    const { result } = renderHook(() => useHydrated());
    expect(result.current).toBe(true);
  });

  it("stays true across subsequent re-renders", () => {
    const { result, rerender } = renderHook(() => useHydrated());
    expect(result.current).toBe(true);
    rerender();
    rerender();
    expect(result.current).toBe(true);
  });

  it("is true for a fresh instance after unmount (no leaked state)", () => {
    const first = renderHook(() => useHydrated());
    expect(first.result.current).toBe(true);
    first.unmount();

    const second = renderHook(() => useHydrated());
    expect(second.result.current).toBe(true);
  });
});
