// @vitest-environment jsdom
//
// DOM-environment component tests for SiteHeader / SiteHeaderStatus — the
// pinned translucent header every page renders. The header is a small
// presentational surface but it carries the page's right cluster contract
// (a status readout followed by optional page actions) and the runtime status
// dot (a size-1.5 primary dot that pulses while the page is actively working)
// documented in the reference's DESIGN.md. Pins: the container chrome + the
// status/actions slot wiring (actions cluster only renders when actions are
// supplied), the SiteHeaderStatus dot + children rendering, the pulse gate
// (animate-pulse only when pulse=true), and the absent-status/absent-actions
// no-op shapes.
//
// Uses the render/screen React Testing Library harness established in
// iteration 55. No providers, hooks, or stores are touched — the header is a
// pure presentational component, so these are plain render + DOM assertions.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SiteHeader, SiteHeaderStatus } from "~/components/site-header";

afterEach(() => {
  cleanup();
});

describe("SiteHeader", () => {
  it("renders the status slot when supplied", () => {
    render(<SiteHeader status={<span>status-text</span>} />);
    expect(screen.getByText("status-text")).toBeTruthy();
  });

  it("renders nothing in the actions cluster when no actions are supplied", () => {
    render(<SiteHeader status={<span>status-text</span>} />);
    expect(screen.queryByText("action-button")).toBeNull();
  });

  it("renders the actions cluster when actions are supplied", () => {
    render(
      <SiteHeader
        actions={<button type="button">action-button</button>}
        status={<span>status-text</span>}
      />,
    );
    expect(screen.getByRole("button", { name: "action-button" })).toBeTruthy();
  });

  it("renders with neither status nor actions", () => {
    render(<SiteHeader />);
    // The header element itself always renders.
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.queryByText("status-text")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("exposes the sticky header as a banner landmark", () => {
    render(<SiteHeader />);
    const header = screen.getByRole("banner");
    expect(header.tagName).toBe("HEADER");
  });
});

describe("SiteHeaderStatus", () => {
  it("renders the status dot and the children label", () => {
    render(<SiteHeaderStatus>Ready</SiteHeaderStatus>);
    expect(screen.getByText("Ready")).toBeTruthy();
    // The primary dot is the aria-hidden size-1.5 element.
    const dot = document.querySelector("span[aria-hidden='true'].rounded-full");
    expect(dot).not.toBeNull();
  });

  it("does not pulse the dot by default", () => {
    render(<SiteHeaderStatus>Ready</SiteHeaderStatus>);
    const dot = document.querySelector("span[aria-hidden='true']");
    expect(dot?.className.includes("animate-pulse")).toBe(false);
  });

  it("pulses the dot when pulse=true", () => {
    render(<SiteHeaderStatus pulse>Responding</SiteHeaderStatus>);
    const dot = document.querySelector("span[aria-hidden='true']");
    expect(dot?.className.includes("animate-pulse")).toBe(true);
  });

  it("marks the dot aria-hidden so screen readers rely on the label", () => {
    render(<SiteHeaderStatus>Ready</SiteHeaderStatus>);
    const dot = document.querySelector("span[aria-hidden='true']");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the dot sized for the status indicator (size-1.5)", () => {
    render(<SiteHeaderStatus>Ready</SiteHeaderStatus>);
    const dot = document.querySelector("span[aria-hidden='true']");
    expect(dot?.className.includes("size-1.5")).toBe(true);
  });
});
