import type * as React from "react";
import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "~/lib/utils";

/**
 * Renders a markdown string with the app's design tokens. The reference app
 * uses Vercel's Streamdown here; to stay free of the AI-SDK ecosystem we use
 * the framework-agnostic react-markdown + remark-gfm pair and provide our own
 * element styling (no @tailwindcss/typography plugin — every tag is mapped
 * explicitly so the rendering matches the chat bubble / skill preview shells).
 *
 * Output is treated as trusted local content (model replies / user-authored
 * skill bodies), so raw HTML is intentionally disabled (react-markdown's
 * default) and links open in a new tab.
 */

// react-markdown injects a non-DOM `node` prop into every component; strip it
// before spreading the rest onto a real DOM element so React doesn't warn.
type MdProps<T extends HTMLElement> = Omit<React.HTMLAttributes<T>, "node"> & { node?: unknown };

const COMPONENTS = {
  a: ({
    children,
    href,
    node: _node,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) => (
    <a
      className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
      href={href}
      rel="noreferrer"
      target="_blank"
      {...props}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }: MdProps<HTMLElement>) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: ({ className, children, node: _node, ...props }: MdProps<HTMLElement>) => {
    // Fenced blocks arrive as <pre><code class="language-x">…</code></pre>;
    // inline code is a bare <code> with no language class. Detect a block by
    // either a language- class or a newline in the payload (plain ``` fences
    // have no language), so the inner <code> stays unstyled and the surrounding
    // <pre> carries the block chrome.
    const text = Array.isArray(children) ? children.join("") : String(children ?? "");
    const isBlock = /language-/.test(className ?? "") || text.includes("\n");
    if (isBlock) {
      return (
        <code className={cn("font-mono", className)} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]" {...props}>
        {children}
      </code>
    );
  },
  h1: ({ children }: MdProps<HTMLHeadingElement>) => (
    <h1 className="mb-2 mt-3 text-base font-semibold">{children}</h1>
  ),
  h2: ({ children }: MdProps<HTMLHeadingElement>) => (
    <h2 className="mb-2 mt-3 text-base font-semibold">{children}</h2>
  ),
  h3: ({ children }: MdProps<HTMLHeadingElement>) => (
    <h3 className="mb-1.5 mt-2 text-sm font-semibold">{children}</h3>
  ),
  h4: ({ children }: MdProps<HTMLHeadingElement>) => (
    <h4 className="mb-1.5 mt-2 text-sm font-semibold">{children}</h4>
  ),
  h5: ({ children }: MdProps<HTMLHeadingElement>) => (
    <h5 className="mb-1 mt-2 text-sm font-semibold">{children}</h5>
  ),
  h6: ({ children }: MdProps<HTMLHeadingElement>) => (
    <h6 className="mb-1 mt-2 text-sm font-semibold">{children}</h6>
  ),
  hr: () => <hr className="my-3 border-border" />,
  img: ({ alt, src }: React.ImgHTMLAttributes<HTMLImageElement> & { node?: unknown }) => (
    <img alt={alt} className="my-2 max-h-72 rounded-lg border border-border" src={src} />
  ),
  ol: ({ children }: MdProps<HTMLOListElement>) => (
    <ol className="my-1.5 list-decimal space-y-1 pl-5 marker:text-muted-foreground">{children}</ol>
  ),
  p: ({ children }: MdProps<HTMLParagraphElement>) => (
    <p className="my-1.5 leading-6 first:mt-0 last:mb-0">{children}</p>
  ),
  pre: ({ children }: MdProps<HTMLPreElement>) => (
    <pre className="my-2 overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-[0.85em] leading-6">
      {children}
    </pre>
  ),
  strong: ({ children }: MdProps<HTMLElement>) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  table: ({ children }: MdProps<HTMLTableElement>) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }: MdProps<HTMLTableCellElement>) => (
    <th className="border border-border bg-muted px-2.5 py-1.5 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }: MdProps<HTMLTableCellElement>) => (
    <td className="border border-border px-2.5 py-1.5 align-top">{children}</td>
  ),
  ul: ({ children }: MdProps<HTMLUListElement>) => (
    <ul className="my-1.5 list-disc space-y-1 pl-5 marker:text-muted-foreground">{children}</ul>
  ),
} as const;

export type MarkdownProps = {
  children: string;
  className?: string;
};

export const Markdown = memo(function Markdown({ children, className }: MarkdownProps) {
  // remarkGfm is a module singleton (stable reference), so memoizing the plugin
  // list keeps ReactMarkdown's internal AST cache hot across renders.
  const remarkPlugins = useMemo(() => [remarkGfm], []);
  return (
    <div className={cn("text-sm leading-6 text-inherit", className)}>
      <ReactMarkdown components={COMPONENTS} remarkPlugins={remarkPlugins}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
