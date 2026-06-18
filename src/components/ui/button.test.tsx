// @vitest-environment jsdom
//
// DOM-environment component tests for the cva Button — the foundational
// design-system component consumed by every action in the app (sidebar,
// chat composer, tasks board, skills page, dialogs). Despite its ubiquity it
// had zero co-located coverage: these tests pin the cva variant/size/default
// contract, the tailwind-merge className-merge behavior (caller wins on
// conflict), and the prop-forwarding surface, extending the React Testing
// Library harness from iterations 55/59/63/65/74/77/78/79/80/81.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button, type ButtonProps, buttonVariants } from "~/components/ui/button";

afterEach(() => {
  cleanup();
});

/** Split a className into an order-insensitive Set for robust comparison.
 * tailwind-merge may reorder classes while resolving conflicts, so asserting
 * on the exact output string is brittle (iteration 51). */
function classSet(className: string | undefined | null): Set<string> {
  return new Set((className ?? "").trim().split(/\s+/).filter(Boolean));
}

/** Extract the className of the single rendered <button> without a non-null
 * assertion. Biome flags `!` (noNonNullAssertion); a runtime guard both
 * satisfies the linter and keeps the type narrowed to HTMLButtonElement in
 * the caller (iteration 44's biome/non-null guidance). */
function buttonClass(container: HTMLElement): string {
  const button = container.querySelector("button");
  expect(button).toBeInstanceOf(HTMLButtonElement);
  return (button as HTMLButtonElement).className;
}

/** The cva base classes are present on every variant/size combination. */
const BASE_CLASSES = [
  "inline-flex",
  "shrink-0",
  "items-center",
  "justify-center",
  "gap-2",
  "text-sm",
  "font-medium",
  "outline-none",
  "transition-colors",
  "focus-visible:ring-2",
  "focus-visible:ring-primary/30",
  "disabled:pointer-events-none",
  "disabled:opacity-50",
];

describe("Button", () => {
  describe("element + base class contract", () => {
    it("renders a <button> element", () => {
      render(<Button>Click</Button>);
      expect(screen.getByRole("button", { name: "Click" }).tagName).toBe("BUTTON");
    });

    it("renders its children verbatim", () => {
      render(<Button>{"Save changes"}</Button>);
      expect(screen.getByRole("button", { name: "Save changes" }).textContent).toBe("Save changes");
    });

    it("renders complex children (icon + text)", () => {
      render(
        <Button>
          <span aria-hidden="true">★</span>
          <span>Star</span>
        </Button>,
      );
      const button = screen.getByRole("button", { name: "Star" });
      expect(button.textContent).toBe("★Star");
      expect(button.querySelectorAll("span")).toHaveLength(2);
    });

    it("always carries every cva base class", () => {
      render(<Button>{"x"}</Button>);
      const classes = classSet(screen.getByRole("button").className);
      for (const base of BASE_CLASSES) {
        expect(classes.has(base)).toBe(true);
      }
    });
  });

  describe("variant contract", () => {
    it("defaults to the 'default' variant when none is supplied", () => {
      render(<Button>{"x"}</Button>);
      const classes = classSet(screen.getByRole("button").className);
      expect(classes.has("bg-primary")).toBe(true);
      expect(classes.has("text-primary-foreground")).toBe(true);
      expect(classes.has("hover:bg-primary/90")).toBe(true);
    });

    it("applies the 'default' variant classes when explicitly supplied", () => {
      render(<Button variant="default">{"x"}</Button>);
      const classes = classSet(screen.getByRole("button").className);
      expect(classes.has("bg-primary")).toBe(true);
      expect(classes.has("text-primary-foreground")).toBe(true);
      expect(classes.has("hover:bg-primary/90")).toBe(true);
    });

    it("applies the 'outline' variant classes", () => {
      render(<Button variant="outline">{"x"}</Button>);
      const classes = classSet(screen.getByRole("button").className);
      expect(classes.has("border")).toBe(true);
      expect(classes.has("bg-card")).toBe(true);
      expect(classes.has("text-foreground")).toBe(true);
      expect(classes.has("hover:bg-muted")).toBe(true);
      // outline must NOT carry the default variant's primary background.
      expect(classes.has("bg-primary")).toBe(false);
      expect(classes.has("text-primary-foreground")).toBe(false);
    });

    it("applies the 'ghost' variant classes (transparent until hover)", () => {
      render(<Button variant="ghost">{"x"}</Button>);
      const classes = classSet(screen.getByRole("button").className);
      expect(classes.has("hover:bg-muted")).toBe(true);
      // ghost has no own background/text color — it is transparent.
      expect(classes.has("bg-primary")).toBe(false);
      expect(classes.has("bg-card")).toBe(false);
      expect(classes.has("bg-destructive")).toBe(false);
    });

    it("applies the 'destructive' variant classes", () => {
      render(<Button variant="destructive">{"x"}</Button>);
      const classes = classSet(screen.getByRole("button").className);
      expect(classes.has("bg-destructive")).toBe(true);
      expect(classes.has("text-destructive-foreground")).toBe(true);
      expect(classes.has("hover:bg-destructive/90")).toBe(true);
      expect(classes.has("bg-primary")).toBe(false);
    });

    it("produces a distinct class string per variant", () => {
      const variants = ["default", "outline", "ghost", "destructive"] as const;
      const strings = variants.map((v) =>
        buttonClass(render(<Button variant={v}>{"x"}</Button>).container),
      );
      // pairwise distinctness
      for (let i = 0; i < strings.length; i++) {
        for (let j = i + 1; j < strings.length; j++) {
          expect(strings[i]).not.toBe(strings[j]);
        }
      }
    });

    it("treats an explicit undefined variant identically to omitting it", () => {
      const omitted = buttonClass(render(<Button>{"x"}</Button>).container);
      const explicit = buttonClass(render(<Button variant={undefined}>{"x"}</Button>).container);
      expect(explicit).toBe(omitted);
    });
  });

  describe("size contract", () => {
    it("defaults to the 'default' size when none is supplied", () => {
      render(<Button>{"x"}</Button>);
      const classes = classSet(screen.getByRole("button").className);
      // default size repeats the base h-10 px-4 — both present (idempotent).
      expect(classes.has("h-10")).toBe(true);
      expect(classes.has("px-4")).toBe(true);
    });

    it("applies the 'sm' size classes and overrides the base height/padding-x", () => {
      render(<Button size="sm">{"x"}</Button>);
      const classes = classSet(screen.getByRole("button").className);
      // tailwind-merge resolves the base's h-10/px-4 against sm's h-8/px-3,
      // keeping the sm values (caller-size wins).
      expect(classes.has("h-8")).toBe(true);
      expect(classes.has("px-3")).toBe(true);
      expect(classes.has("text-xs")).toBe(true);
      expect(classes.has("h-10")).toBe(false);
      expect(classes.has("px-4")).toBe(false);
    });

    it("applies the 'icon' size classes and overrides the base padding", () => {
      render(<Button size="icon">{"x"}</Button>);
      const classes = classSet(screen.getByRole("button").className);
      // size-10 sets width+height (overrides h-10); p-0 overrides px-4.
      expect(classes.has("size-10")).toBe(true);
      expect(classes.has("p-0")).toBe(true);
      // With p-0 winning, the base px-4 must be gone.
      expect(classes.has("px-4")).toBe(false);
    });

    it("produces a distinct class string per size", () => {
      const sizes = ["default", "sm", "icon"] as const;
      const strings = sizes.map((s) =>
        buttonClass(render(<Button size={s}>{"x"}</Button>).container),
      );
      for (let i = 0; i < strings.length; i++) {
        for (let j = i + 1; j < strings.length; j++) {
          expect(strings[i]).not.toBe(strings[j]);
        }
      }
    });

    it("treats an explicit undefined size identically to omitting it", () => {
      const omitted = buttonClass(render(<Button>{"x"}</Button>).container);
      const explicit = buttonClass(render(<Button size={undefined}>{"x"}</Button>).container);
      expect(explicit).toBe(omitted);
    });
  });

  describe("variant × size combinations", () => {
    it("applies both the variant and size classes simultaneously", () => {
      render(
        <Button variant="destructive" size="sm">
          {"Delete"}
        </Button>,
      );
      const classes = classSet(screen.getByRole("button").className);
      // variant
      expect(classes.has("bg-destructive")).toBe(true);
      expect(classes.has("text-destructive-foreground")).toBe(true);
      // size
      expect(classes.has("h-8")).toBe(true);
      expect(classes.has("px-3")).toBe(true);
      expect(classes.has("text-xs")).toBe(true);
    });

    it("produces a distinct class string for all 12 variant×size combinations", () => {
      const variants = ["default", "outline", "ghost", "destructive"] as const;
      const sizes = ["default", "sm", "icon"] as const;
      const seen = new Set<string>();
      for (const variant of variants) {
        for (const size of sizes) {
          const { container } = render(
            <Button variant={variant} size={size}>
              {"x"}
            </Button>,
          );
          const className = buttonClass(container);
          expect(seen.has(className)).toBe(false);
          seen.add(className);
        }
      }
      expect(seen.size).toBe(12);
    });
  });

  describe("className merging (tailwind-merge via cn)", () => {
    it("appends a non-conflicting caller className to the resolved variants", () => {
      render(<Button className="my-4">{"x"}</Button>);
      const classes = classSet(screen.getByRole("button").className);
      expect(classes.has("my-4")).toBe(true);
      // variant classes are still present.
      expect(classes.has("bg-primary")).toBe(true);
    });

    it("lets a conflicting caller utility override the cva-resolved one", () => {
      // bg-red-500 conflicts with the default variant's bg-primary;
      // tailwind-merge keeps the LATER value (the caller's), so the button
      // is red, not primary — the load-bearing override behavior every
      // one-off styled button in the app relies on.
      render(<Button className="bg-red-500">{"x"}</Button>);
      const classes = classSet(screen.getByRole("button").className);
      expect(classes.has("bg-red-500")).toBe(true);
      expect(classes.has("bg-primary")).toBe(false);
    });

    it("drops falsy className inputs (cn/clsx semantics)", () => {
      render(<Button className={undefined}>{"x"}</Button>);
      const className = screen.getByRole("button").className;
      // No stray whitespace tokens from an undefined class.
      expect(className.trim()).toBe(className);
    });

    it("resolves multiple conflicting caller utilities (last wins)", () => {
      render(<Button className="h-16 h-20">{"x"}</Button>);
      const classes = classSet(screen.getByRole("button").className);
      expect(classes.has("h-20")).toBe(true);
      expect(classes.has("h-16")).toBe(false);
      expect(classes.has("h-10")).toBe(false);
    });
  });

  describe("prop forwarding", () => {
    it("forwards the onClick handler and fires it on click", () => {
      const onClick = vi.fn();
      render(<Button onClick={onClick}>{"Go"}</Button>);
      fireEvent.click(screen.getByRole("button", { name: "Go" }));
      expect(onClick).toHaveBeenCalledOnce();
    });

    it("does not fire onClick when disabled", () => {
      const onClick = vi.fn();
      render(
        <Button onClick={onClick} disabled>
          {"Go"}
        </Button>,
      );
      const button = screen.getByRole("button", { name: "Go" }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      // React suppresses onClick on a disabled button.
      expect(onClick).not.toHaveBeenCalled();
    });

    it("carries the disabled opacity class on the rendered element", () => {
      render(<Button disabled>{"Go"}</Button>);
      const classes = classSet(screen.getByRole("button").className);
      expect(classes.has("disabled:opacity-50")).toBe(true);
    });

    it("forwards the type attribute", () => {
      render(<Button type="submit">{"Save"}</Button>);
      expect(screen.getByRole("button", { name: "Save" }).getAttribute("type")).toBe("submit");
    });

    it("forwards arbitrary data-* attributes", () => {
      render(
        <Button data-testid="cta" data-variant="primary">
          {"x"}
        </Button>,
      );
      const button = screen.getByTestId("cta");
      expect(button.getAttribute("data-variant")).toBe("primary");
    });

    it("forwards aria-* attributes for accessibility", () => {
      render(
        <Button aria-label="Close dialog" aria-pressed="false">
          {"x"}
        </Button>,
      );
      const button = screen.getByRole("button");
      expect(button.getAttribute("aria-label")).toBe("Close dialog");
      expect(button.getAttribute("aria-pressed")).toBe("false");
    });

    it("forwards the title attribute", () => {
      render(<Button title="More options">{"x"}</Button>);
      expect(screen.getByRole("button").getAttribute("title")).toBe("More options");
    });

    it("does not leak the variant/size props onto the DOM element", () => {
      render(
        <Button variant="outline" size="sm">
          {"x"}
        </Button>,
      );
      const button = screen.getByRole("button");
      // variant/size are consumed by cva and must NOT appear as DOM attributes.
      expect(button.getAttribute("variant")).toBeNull();
      expect(button.getAttribute("size")).toBeNull();
    });
  });

  describe("buttonVariants (the exported cva resolver)", () => {
    it("returns a non-empty class string with no arguments (defaults)", () => {
      const cls = buttonVariants();
      expect(typeof cls).toBe("string");
      expect(cls.trim().length).toBeGreaterThan(0);
      const classes = classSet(cls);
      // default variant + default size.
      expect(classes.has("bg-primary")).toBe(true);
      expect(classes.has("h-10")).toBe(true);
    });

    it("resolves a variant-only argument with the default size", () => {
      const classes = classSet(buttonVariants({ variant: "ghost" }));
      expect(classes.has("hover:bg-muted")).toBe(true);
      // default size still applies.
      expect(classes.has("h-10")).toBe(true);
    });

    it("resolves a size-only argument with the default variant", () => {
      const classes = classSet(buttonVariants({ size: "icon" }));
      expect(classes.has("size-10")).toBe(true);
      // default variant still applies.
      expect(classes.has("bg-primary")).toBe(true);
    });

    it("resolves both variant and size", () => {
      const classes = classSet(buttonVariants({ variant: "outline", size: "sm" }));
      expect(classes.has("border")).toBe(true);
      expect(classes.has("h-8")).toBe(true);
    });

    it("does NOT run tailwind-merge itself (the <Button> component's cn() wrapper does)", () => {
      // A non-obvious but load-bearing distinction: buttonVariants() is the
      // raw cva resolver and only CONCATENATES base + variant + size classes,
      // so for the icon size it still emits the base h-10/px-4 alongside the
      // icon's size-10/p-0. The <Button> component wraps that in cn() which
      // runs tailwind-merge and strips the overridden h-10/px-4. Callers that
      // reach for buttonVariants directly must not assume a conflict-free
      // string — only the component's output is merged.
      const fromResolver = buttonVariants({ variant: "destructive", size: "icon" });
      const resolverClasses = classSet(fromResolver);
      // The raw resolver carries BOTH the base and the overriding classes.
      expect(resolverClasses.has("h-10")).toBe(true);
      expect(resolverClasses.has("px-4")).toBe(true);
      expect(resolverClasses.has("size-10")).toBe(true);
      expect(resolverClasses.has("p-0")).toBe(true);

      const { container } = render(
        <Button variant="destructive" size="icon">
          {"x"}
        </Button>,
      );
      const componentClasses = classSet(buttonClass(container));
      // The component's cn() wrapper strips the overridden base utilities.
      expect(componentClasses.has("h-10")).toBe(false);
      expect(componentClasses.has("px-4")).toBe(false);
      expect(componentClasses.has("size-10")).toBe(true);
      expect(componentClasses.has("p-0")).toBe(true);
      // And therefore the two strings are NOT equal for a conflicting size.
      expect(buttonClass(container)).not.toBe(fromResolver);
    });

    it("matches the <Button> component's class SET (resolver string may dedupe in the component)", () => {
      // cva concatenates base + variant + size, so the raw resolver string
      // carries duplicate utilities whenever the size overlaps the base
      // (the default size repeats the base's h-10/px-4, the icon size
      // repeats none but is overridden). The component's cn() wrapper
      // tailwind-merges those into a minimal string. The honest contract is
      // that the two produce the same SET of classes for a non-overriding
      // variant+size (ghost/default here — no caller utilities to win).
      const fromResolver = buttonVariants({ variant: "ghost", size: "default" });
      const { container } = render(
        <Button variant="ghost" size="default">
          {"x"}
        </Button>,
      );
      const componentClasses = classSet(buttonClass(container));
      for (const cls of classSet(fromResolver)) {
        expect(componentClasses.has(cls)).toBe(true);
      }
    });

    it("is deterministic (same args → same string)", () => {
      expect(buttonVariants({ variant: "ghost", size: "sm" })).toBe(
        buttonVariants({ variant: "ghost", size: "sm" }),
      );
    });
  });

  describe("ButtonProps type surface", () => {
    it("accepts standard ButtonHTMLAttributes (compile-time; smoke check via ref)", () => {
      // ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> &
      // VariantProps<typeof buttonVariants>. The component accepts arbitrary
      // button attrs; this is a runtime smoke that such attrs reach the DOM.
      // The ButtonProps annotation is the compile-time check that the type
      // surface accepts standard button attributes; data-* is exercised via
      // direct JSX spread (JSX allows data-* natively on intrinsic elements).
      const props: ButtonProps = {
        type: "button",
        autoFocus: false,
        onClick: () => {},
        children: "smoke",
      };
      const { container } = render(<Button {...props} data-smoke="ok" />);
      const button = screen.getByRole("button", { name: "smoke" });
      expect(button.getAttribute("type")).toBe("button");
      expect(button.getAttribute("data-smoke")).toBe("ok");
      // container is exercised to assert the render tree root is non-empty.
      expect(container.firstChild).not.toBeNull();
    });
  });
});
