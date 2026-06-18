// @vitest-environment jsdom
//
// DOM-environment component tests for the Markdown component — the
// framework-agnostic replacement for the reference's Streamdown (iteration 16).
// It maps react-markdown + remark-gfm output onto the app's OKLCH design tokens
// and is the renderer behind every assistant bubble, reasoning panel, and the
// Skills page bodies/preview. Despite driving three big surfaces it had zero
// prior coverage; this pins the element mappings, the block-vs-inline code
// detection (the non-obvious language-/newline heuristic), the GFM plugin
// features (tables / strikethrough / task lists / autolinks), and the security
// contracts (raw HTML disabled, links sandboxed to a new tab), extending the
// React Testing Library harness from iteration 55/59.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Markdown } from "~/components/ui/markdown";

afterEach(() => {
  cleanup();
});

/** Query helpers ----------------------------------------------------------- */
// react-markdown renders into a wrapper <div>, so the first child is the
// markdown root. Several tests reach for nested elements by tag.
function root(): HTMLElement {
  return screen.getByTestId("markdown-root");
}

function renderMd(children: string): ReturnType<typeof render> {
  return render(
    <div data-testid="markdown-root">
      <Markdown>{children}</Markdown>
    </div>,
  );
}

describe("Markdown wrapper", () => {
  it("renders a non-empty wrapper div for plain content", () => {
    renderMd("Hello world");
    expect(root().textContent).toBe("Hello world");
  });

  it("renders without throwing for an empty string", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    // The wrapper div is always emitted; only the inner tree is empty.
    expect(container.querySelector("div")).not.toBeNull();
  });

  it("merges a caller-supplied className onto the wrapper's base classes", () => {
    const { container } = render(
      <Markdown className="prose-lg" data-testid="ignored">
        {"hi"}
      </Markdown>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("prose-lg");
    expect(wrapper.className).toContain("text-sm");
    expect(wrapper.className).toContain("leading-6");
    expect(wrapper.className).toContain("text-inherit");
  });
});

describe("Markdown paragraphs and text", () => {
  it("wraps consecutive text in a <p>", () => {
    const { container } = render(<Markdown>{"A plain paragraph."}</Markdown>);
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p?.textContent).toBe("A plain paragraph.");
    // The p element carries the typographic chrome (leading + the first/last
    // margin trim so a single paragraph flushes to its container).
    expect(p?.className).toContain("leading-6");
    expect(p?.className).toContain("first:mt-0");
    expect(p?.className).toContain("last:mb-0");
  });

  it("renders multiple paragraphs as separate <p> siblings", () => {
    const { container } = render(<Markdown>{"First.\n\nSecond."}</Markdown>);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });
});

describe("Markdown headings", () => {
  it("renders h1–h6 with the documented size bucketing", () => {
    const src = "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6";
    const { container } = render(<Markdown>{src}</Markdown>);
    const h1 = container.querySelector("h1");
    const h2 = container.querySelector("h2");
    const h3 = container.querySelector("h3");
    const h4 = container.querySelector("h4");
    const h5 = container.querySelector("h5");
    const h6 = container.querySelector("h6");
    expect(h1?.textContent).toBe("H1");
    expect(h2?.textContent).toBe("H2");
    expect(h3?.textContent).toBe("H3");
    expect(h4?.textContent).toBe("H4");
    expect(h5?.textContent).toBe("H5");
    expect(h6?.textContent).toBe("H6");
    // h1/h2 share the larger size bucket (text-base); h3–h6 the smaller
    // (text-sm). All are font-semibold.
    expect(h1?.className).toContain("text-base");
    expect(h2?.className).toContain("text-base");
    expect(h3?.className).toContain("text-sm");
    expect(h4?.className).toContain("text-sm");
    expect(h5?.className).toContain("text-sm");
    expect(h6?.className).toContain("text-sm");
    for (const h of [h1, h2, h3, h4, h5, h6]) {
      expect(h?.className).toContain("font-semibold");
    }
  });
});

describe("Markdown emphasis", () => {
  it("renders **bold** as <strong> with the foreground color", () => {
    const { container } = render(<Markdown>{"**bold**"}</Markdown>);
    const strong = container.querySelector("strong");
    expect(strong?.textContent).toBe("bold");
    expect(strong?.className).toContain("font-semibold");
    expect(strong?.className).toContain("text-foreground");
  });

  it("renders _italic_ as <em> (default styling, passes through)", () => {
    const { container } = render(<Markdown>{"_italic_"}</Markdown>);
    const em = container.querySelector("em");
    expect(em?.textContent).toBe("italic");
  });
});

describe("Markdown code blocks vs inline code", () => {
  it("renders inline `code` as a <code> with the muted pill styling and NO <pre> wrapper", () => {
    const { container } = render(<Markdown>{"inline `code` here"}</Markdown>);
    const code = container.querySelector("code");
    expect(code?.textContent).toBe("code");
    expect(code?.className).toContain("bg-muted");
    expect(code?.className).toContain("rounded");
    expect(code?.className).toContain("font-mono");
    expect(container.querySelector("pre")).toBeNull();
  });

  it("renders a fenced ``` block inside a <pre> with block chrome", () => {
    const src = "```\nline one\nline two\n```";
    const { container } = render(<Markdown>{src}</Markdown>);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain("line one");
    expect(pre?.textContent).toContain("line two");
    expect(pre?.className).toContain("overflow-x-auto");
    expect(pre?.className).toContain("rounded-lg");
    expect(pre?.className).toContain("border");
    expect(pre?.className).toContain("bg-muted/60");
    // The inner <code> is unstyled (just font-mono) — the <pre> owns the chrome.
    const code = pre?.querySelector("code");
    expect(code).not.toBeNull();
    expect(code?.className).toContain("font-mono");
    expect(code?.className).not.toContain("bg-muted");
    expect(code?.className).not.toContain("rounded");
  });

  it("treats a fenced block with a language identifier as a block (language- class)", () => {
    const src = "```ts\nconst x = 1;\n```";
    const { container } = render(<Markdown>{src}</Markdown>);
    const pre = container.querySelector("pre");
    const code = pre?.querySelector("code");
    expect(pre).not.toBeNull();
    // The language identifier lands as a `language-<lang>` class on the inner code.
    expect(code?.className).toContain("language-ts");
  });

  it("detects a block by a newline in the payload even without a language class", () => {
    // The bare-```-fence path: no language- class, but a multi-line payload.
    // This is the non-obvious second arm of the isBlock heuristic.
    const src = "```\nhello\n```";
    const { container } = render(<Markdown>{src}</Markdown>);
    expect(container.querySelector("pre")).not.toBeNull();
  });
});

describe("Markdown lists", () => {
  it("renders a bulleted list as <ul> with list-disc", () => {
    const src = "- one\n- two\n- three";
    const { container } = render(<Markdown>{src}</Markdown>);
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul?.className).toContain("list-disc");
    expect(ul?.className).toContain("pl-5");
    expect(ul?.querySelectorAll("li")).toHaveLength(3);
  });

  it("renders a numbered list as <ol> with list-decimal", () => {
    const src = "1. first\n2. second\n3. third";
    const { container } = render(<Markdown>{src}</Markdown>);
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol?.className).toContain("list-decimal");
    expect(ol?.className).toContain("pl-5");
    expect(ol?.querySelectorAll("li")).toHaveLength(3);
  });
});

describe("Markdown blockquote and hr", () => {
  it("renders a blockquote with the left border + italic muted styling", () => {
    const { container } = render(<Markdown>{"> quoted text"}</Markdown>);
    const bq = container.querySelector("blockquote");
    expect(bq?.textContent).toContain("quoted text");
    expect(bq?.className).toContain("border-l-2");
    expect(bq?.className).toContain("italic");
    expect(bq?.className).toContain("text-muted-foreground");
  });

  it("renders a horizontal rule as a bordered <hr>", () => {
    const { container } = render(<Markdown>{"a\n\n---\n\nb"}</Markdown>);
    const hr = container.querySelector("hr");
    expect(hr).not.toBeNull();
    expect(hr?.className).toContain("border-border");
  });
});

describe("Markdown links", () => {
  it("renders links with target=_blank and rel=noreferrer", () => {
    const { container } = render(<Markdown>{"[Pi](https://example.com)"}</Markdown>);
    const a = container.querySelector("a");
    expect(a?.textContent).toBe("Pi");
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noreferrer");
    expect(a?.className).toContain("text-primary");
    expect(a?.className).toContain("underline");
  });

  it("autolinks bare URLs via remark-gfm", () => {
    const { container } = render(<Markdown>{"https://example.com"}</Markdown>);
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("href")).toBe("https://example.com");
  });
});

describe("Markdown images", () => {
  it("renders images with alt + the constrained sizing classes", () => {
    const { container } = render(<Markdown>{"![alt text](https://img/x.png)"}</Markdown>);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://img/x.png");
    expect(img?.getAttribute("alt")).toBe("alt text");
    expect(img?.className).toContain("max-h-72");
    expect(img?.className).toContain("rounded-lg");
    expect(img?.className).toContain("border");
  });
});

describe("Markdown GFM tables and strikethrough", () => {
  it("renders a GFM table with th/td styling", () => {
    const src = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<Markdown>{src}</Markdown>);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.className).toContain("border-collapse");
    const ths = container.querySelectorAll("th");
    const tds = container.querySelectorAll("td");
    expect(ths).toHaveLength(2); // one per header column (A, B)
    expect(tds).toHaveLength(2); // one per body column (1, 2)
    expect(ths[0]?.textContent).toBe("A");
    expect(ths[1]?.textContent).toBe("B");
    expect(tds[0]?.textContent).toBe("1");
    expect(tds[1]?.textContent).toBe("2");
    expect(ths[0]?.className).toContain("bg-muted");
    expect(tds[0]?.className).toContain("align-top");
  });

  it("renders ~~strikethrough~~ as <del>", () => {
    const { container } = render(<Markdown>{"~~gone~~"}</Markdown>);
    const del = container.querySelector("del");
    expect(del?.textContent).toBe("gone");
  });

  it("renders GFM task lists as checkbox list items", () => {
    const src = "- [x] done\n- [ ] todo";
    const { container } = render(<Markdown>{src}</Markdown>);
    const inputs = container.querySelectorAll('input[type="checkbox"]');
    expect(inputs).toHaveLength(2);
    expect((inputs[0] as HTMLInputElement).checked).toBe(true);
    expect((inputs[1] as HTMLInputElement).checked).toBe(false);
  });
});

describe("Markdown security", () => {
  it("does NOT render raw HTML — disallowed tags are dropped/escaped", () => {
    // react-markdown's default `rehtml: false` strips raw HTML; this is the
    // load-bearing security contract for rendering model output. A <script>
    // must NOT land in the DOM as a real element.
    const src = "<script>alert(1)</script>";
    const { container } = render(<Markdown>{src}</Markdown>);
    expect(container.querySelector("script")).toBeNull();
  });

  it("does NOT render raw block-level HTML even when it looks like markup", () => {
    const src = '<div class="evil">hi</div>';
    const { container } = render(<Markdown>{src}</Markdown>);
    // No real div from the markup lands; only the wrapper div we render.
    expect(container.querySelectorAll("div")).toHaveLength(1);
    expect(container.querySelector(".evil")).toBeNull();
  });
});
