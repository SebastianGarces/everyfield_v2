import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { wikiHref } from "@/lib/wiki/href";
import type { ArticleMeta } from "@/lib/wiki/types";

type ArticlePagerProps = {
  previous: ArticleMeta | null;
  next: ArticleMeta | null;
};

/**
 * Previous/next through the reader's current section (W-009).
 *
 * The pair is resolved upstream (`getArticleNavigation`) from the article's
 * siblings in sort order, so the first article in a section has no Previous
 * and the last has no Next — those slots are simply absent, never a disabled
 * control that looks clickable and is not.
 *
 * A `<nav>` because it is exactly that, and labelled so a screen-reader user
 * hitting a second landmark knows which one this is. Each link's accessible
 * name carries the destination title — "Next" alone tells you nothing about
 * where you are going once you are out of visual context.
 */
export function ArticlePager({ previous, next }: ArticlePagerProps) {
  if (!previous && !next) {
    return null;
  }

  return (
    <nav
      data-testid="wiki-article-pager"
      aria-label="Article"
      className="grid gap-3 border-t pt-6 sm:grid-cols-2"
    >
      {previous ? (
        <PagerLink article={previous} direction="previous" />
      ) : (
        // Holds the left column so a section's first article still shows its
        // Next on the right, where every other article in the section has it.
        <span aria-hidden="true" className="hidden sm:block" />
      )}

      {next && <PagerLink article={next} direction="next" />}
    </nav>
  );
}

function PagerLink({
  article,
  direction,
}: {
  article: ArticleMeta;
  direction: "previous" | "next";
}) {
  const isNext = direction === "next";
  const label = isNext ? "Next" : "Previous";
  const Icon = isNext ? ChevronRight : ChevronLeft;

  return (
    <Link
      href={wikiHref(article.slug)}
      data-testid={`wiki-pager-${direction}`}
      aria-label={`${label} article: ${article.title}`}
      className={cn(
        "group hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors",
        isNext && "sm:justify-end sm:text-right"
      )}
    >
      {!isNext && (
        <Icon
          className="text-muted-foreground group-hover:text-foreground h-4 w-4 shrink-0"
          aria-hidden="true"
        />
      )}

      <span className="min-w-0 space-y-1">
        <span className="text-muted-foreground block text-xs tracking-wide uppercase">
          {label}
        </span>
        <span className="group-hover:text-primary block truncate font-medium">
          {article.title}
        </span>
      </span>

      {isNext && (
        <Icon
          className="text-muted-foreground group-hover:text-foreground h-4 w-4 shrink-0"
          aria-hidden="true"
        />
      )}
    </Link>
  );
}
