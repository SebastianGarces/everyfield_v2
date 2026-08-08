import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { wikiHref } from "@/lib/wiki/href";
import type { ArticleMeta } from "@/lib/wiki/types";

type RelatedArticlesProps = {
  articles: ArticleMeta[];
};

/**
 * Authored cross-links at the foot of an article (W-009).
 *
 * Renders NOTHING when there is nothing to link — an empty "Related articles"
 * heading is a promise the page does not keep, and most articles carry no
 * `related_article_slugs` at all. The caller passes an already-resolved list
 * (`getArticleNavigation`), so slugs that no longer resolve have been dropped
 * upstream and every link here is known to open.
 *
 * Hrefs are built with `wikiHref` — never interpolated — because a slug is
 * authored content (`memory/invariants.md` → Wiki Articles).
 */
export function RelatedArticles({ articles }: RelatedArticlesProps) {
  if (articles.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="wiki-related-articles"
      aria-labelledby="wiki-related-articles-heading"
      className="space-y-3 border-t pt-6"
    >
      <h2
        id="wiki-related-articles-heading"
        className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
      >
        Related articles
      </h2>

      <ul className="grid gap-2">
        {articles.map((article) => (
          <li key={article.slug}>
            <Link
              href={wikiHref(article.slug)}
              data-testid="wiki-related-article"
              className="group hover:bg-muted/50 flex cursor-pointer items-start justify-between gap-3 rounded-lg border p-3 transition-colors"
            >
              <span className="min-w-0 space-y-1">
                <span className="group-hover:text-primary block font-medium">
                  {article.title}
                </span>
                {article.description && (
                  <span className="text-muted-foreground line-clamp-1 block text-sm">
                    {article.description}
                  </span>
                )}
              </span>
              <ArrowUpRight
                className="text-muted-foreground group-hover:text-foreground mt-0.5 h-4 w-4 shrink-0"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
