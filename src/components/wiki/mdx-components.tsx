import { isValidElement, type ReactNode } from "react";
import type { MDXComponents } from "mdx/types";
import { slugifyHeading } from "@/lib/wiki/toc";
import { Callout } from "./callout";

/**
 * Flatten a heading's children to plain text so its anchor id can be derived
 * the same way `extractHeadings()` derives it from the MDX source — a heading
 * like `## **Pray** first` renders as two nodes but must still slugify to
 * `pray-first`.
 */
function headingText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(headingText).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return headingText(node.props.children);
  }
  return "";
}

/** Anchor id for a rendered heading — the target of a TOC entry (W-014). */
function headingId(children: ReactNode): string {
  return slugifyHeading(headingText(children));
}

export const mdxComponents: MDXComponents = {
  // Custom components
  Callout,

  // Override default elements for styling
  h1: ({ children }) => (
    <h1 className="mt-8 mb-4 scroll-m-20 text-3xl font-bold tracking-tight first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2
      id={headingId(children)}
      className="mt-8 mb-3 scroll-m-20 border-b pb-2 text-2xl font-semibold tracking-tight first:mt-0"
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      id={headingId(children)}
      className="mt-6 mb-2 scroll-m-20 text-xl font-semibold tracking-tight"
    >
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4
      id={headingId(children)}
      className="mt-4 mb-2 scroll-m-20 text-lg font-semibold tracking-tight"
    >
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="leading-7 [&:not(:first-child)]:mt-4">{children}</p>
  ),
  ul: ({ children, ...props }) => (
    <ul
      className="my-4 ml-6 list-disc [&_ol]:my-1 [&_ol]:ml-4 [&_ul]:my-1 [&_ul]:ml-4"
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol
      className="my-4 ml-6 list-decimal [&_ol]:my-1 [&_ol]:ml-4 [&_ul]:my-1 [&_ul]:ml-4"
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="mt-2 [&>ol]:mt-1 [&>ul]:mt-1" {...props}>
      {children}
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-muted-foreground/30 text-muted-foreground mt-4 border-l-4 pl-4 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-muted my-8" />,
  table: ({ children }) => (
    <div className="my-6 w-full overflow-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/50 border-b">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="hover:bg-muted/50 border-b transition-colors">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-4 py-3 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="px-4 py-3">{children}</td>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-primary hover:text-primary/80 underline underline-offset-4"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-sm">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="bg-muted my-4 overflow-x-auto rounded-lg p-4">
      {children}
    </pre>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
};
