"use client";

import { Fragment, useEffect, useState, type JSX } from "react";
import Link from "next/link";
import { jsx, jsxs } from "react/jsx-runtime";
import remarkGfm from "remark-gfm";
import { X, ExternalLink, Clock, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Callout } from "@/components/wiki/callout";
import { useWikiGuide } from "./wiki-guide-provider";
import { cn } from "@/lib/utils";

/**
 * MDX component overrides — identical to src/components/wiki/mdx-components.tsx.
 * These are passed to the evaluated MDX so rendering matches the wiki pages exactly.
 */
const mdxComponents = {
  // Custom MDX components
  Callout,

  // Element overrides (same classes as wiki pages)
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mt-8 mb-4 scroll-m-20 text-3xl font-bold tracking-tight first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mt-8 mb-3 scroll-m-20 border-b pb-2 text-2xl font-semibold tracking-tight first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mt-6 mb-2 scroll-m-20 text-xl font-semibold tracking-tight">
      {children}
    </h3>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="mt-4 mb-2 scroll-m-20 text-lg font-semibold tracking-tight">
      {children}
    </h4>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="leading-7 not-first:mt-4">{children}</p>
  ),
  ul: ({ children, ...props }: React.ComponentProps<"ul">) => (
    <ul
      className="my-4 ml-6 list-disc [&_ol]:my-1 [&_ol]:ml-4 [&_ul]:my-1 [&_ul]:ml-4"
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.ComponentProps<"ol">) => (
    <ol
      className="my-4 ml-6 list-decimal [&_ol]:my-1 [&_ol]:ml-4 [&_ul]:my-1 [&_ul]:ml-4"
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }: React.ComponentProps<"li">) => (
    <li className="mt-2 [&>ol]:mt-1 [&>ul]:mt-1" {...props}>
      {children}
    </li>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-muted-foreground/30 text-muted-foreground mt-4 border-l-4 pl-4 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-muted my-8" />,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-6 w-full overflow-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-muted/50 border-b">{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => (
    <tbody>{children}</tbody>
  ),
  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className="hover:bg-muted/50 border-b transition-colors">{children}</tr>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-4 py-3 text-left font-semibold">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-4 py-3">{children}</td>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      className="text-primary hover:text-primary/80 underline underline-offset-4"
    >
      {children}
    </a>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-sm">
      {children}
    </code>
  ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="bg-muted my-4 overflow-x-auto rounded-lg p-4">
      {children}
    </pre>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic">{children}</em>
  ),
};

/**
 * Compile and evaluate MDX content client-side.
 * Uses @mdx-js/mdx's evaluate() which supports full MDX syntax
 * including custom components like <Callout>.
 */
function useMdxContent(content: string | undefined) {
  const [rendered, setRendered] = useState<JSX.Element | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);

  useEffect(() => {
    if (!content) {
      setRendered(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // Dynamic import to keep the MDX compiler out of the initial bundle
        const { evaluate } = await import("@mdx-js/mdx");

        const { default: MdxContent } = await evaluate(content, {
          Fragment,
          jsx,
          jsxs,
          remarkPlugins: [remarkGfm],
        });

        if (!cancelled) {
          setRendered(<MdxContent components={mdxComponents} />);
          setCompileError(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[WikiGuide] MDX compile error:", err);
          setCompileError("Failed to render article content");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [content]);

  return { rendered, compileError };
}

/**
 * Non-modal floating panel that renders wiki article content.
 *
 * Key behaviors:
 *   - No overlay: page underneath remains fully interactive
 *   - No focus trap: keyboard navigation flows naturally
 *   - Slides in from the right with a CSS transition
 *   - Has its own scroll area independent of the page
 *   - Full MDX support (including <Callout> and other custom components)
 */
export function WikiGuidePanel() {
  const {
    isAvailable,
    isOpen,
    close,
    entry,
    activeSlug,
    setActiveSlug,
    article,
    isLoading,
    error,
  } = useWikiGuide();

  const { rendered: mdxContent, compileError } = useMdxContent(
    article?.content
  );

  if (!isAvailable) return null;

  const hasMultipleArticles = entry && entry.slugs.length > 1;

  return (
    <div
      className={cn(
        // Panel positioning — floating with margin on all sides
        "fixed top-4 right-4 bottom-4 z-40 w-[520px]",
        "bg-card rounded-xl border shadow-2xl",
        "flex flex-col",
        // Slide transition
        "transition-all duration-300 ease-in-out",
        isOpen
          ? "translate-x-0 opacity-100"
          : "translate-x-[calc(100%+1rem)] opacity-0",
        // Mobile: full width with smaller margins
        "max-md:right-4 max-md:left-4 max-md:w-auto"
      )}
      role="complementary"
      aria-label="Wiki guide panel"
    >
      {/* ── Panel Header ─────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between gap-2 rounded-t-xl border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="text-muted-foreground size-4 shrink-0" />
          <h2 className="truncate text-sm font-semibold">
            {entry?.label ?? "Wiki Guide"}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {activeSlug && (
            <Button
              variant="ghost"
              size="icon-xs"
              asChild
              className="cursor-pointer"
            >
              <Link href={`/wiki/${activeSlug}`} title="Open in Wiki">
                <ExternalLink className="size-3.5" />
              </Link>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={close}
            className="cursor-pointer"
            aria-label="Close guide panel"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Article Content (scrollable) ─────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-4">
          {isLoading && <ArticleSkeleton />}

          {(error || compileError) && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <AlertCircle className="text-muted-foreground size-8" />
              <div className="space-y-1">
                <p className="text-muted-foreground text-sm font-medium">
                  {error || compileError}
                </p>
                <p className="text-muted-foreground/70 text-xs">
                  This article may not exist yet. Check the wiki guide
                  configuration.
                </p>
              </div>
            </div>
          )}

          {!isLoading && !error && !compileError && article && (
            <>
              {/* Article metadata */}
              <div className="mb-4 space-y-2">
                <h3 className="text-lg font-bold tracking-tight">
                  {article.title}
                </h3>
                {article.description && (
                  <p className="text-muted-foreground text-sm">
                    {article.description}
                  </p>
                )}
                <div className="text-muted-foreground flex items-center gap-3 text-xs">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3" />
                    {article.readTime} min read
                  </span>
                  <span className="bg-muted rounded-full px-2 py-0.5 capitalize">
                    {article.type}
                  </span>
                </div>
              </div>

              {/* Rendered MDX content — identical to wiki pages */}
              <div className="prose prose-neutral dark:prose-invert max-w-none">
                {mdxContent}
              </div>

              {/* Footer link */}
              <div className="mt-8 border-t pt-4 pb-2">
                <Link
                  href={`/wiki/${article.slug}`}
                  className="text-primary inline-flex cursor-pointer items-center gap-1.5 text-xs hover:underline"
                >
                  <ExternalLink className="size-3" />
                  Read full article in Wiki
                </Link>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Related Articles Card (always visible at bottom) ─────── */}
      {hasMultipleArticles && (
        <div className="bg-muted/30 shrink-0 rounded-b-xl border-t px-4 py-3">
          <p className="text-muted-foreground mb-2 text-xs font-medium">
            Related Articles
          </p>
          <div className="space-y-1">
            {entry.slugs.map((slug) => (
              <button
                key={slug}
                onClick={() => setActiveSlug(slug)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                  slug === activeSlug
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <FileText className="size-3.5 shrink-0" />
                <span className="truncate">{formatSlugLabel(slug)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Loading skeleton for article content */
function ArticleSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <div className="flex gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
      <div className="space-y-3 pt-4">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/6" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}

/** Extract a human-readable label from an article slug */
function formatSlugLabel(slug: string): string {
  const lastSegment = slug.split("/").pop() ?? slug;
  return lastSegment
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
