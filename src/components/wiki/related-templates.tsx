import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ContextualTemplate } from "@/lib/documents/contextual";

import { getArticleTemplates } from "./article-templates";

type RelatedTemplatesProps = {
  /** The article being read; its slug is the key into the template map. */
  articleSlug: string;
};

/**
 * The F6 templates an article hands out (W-010), at its foot.
 *
 * Takes the SLUG rather than a resolved list, unlike its sibling
 * `RelatedArticles`: that one needs the visible corpus (a database read the
 * page already made), while this one resolves from a code-defined catalog with
 * no I/O at all — so passing the list down would only have moved a pure lookup
 * into the page.
 *
 * Renders NOTHING when the article offers no template: most articles offer
 * none, and an empty "Templates" heading is a promise the page does not keep.
 * Unknown ids are dropped upstream (`resolveArticleTemplates`), so every link
 * here is known to open a real template.
 *
 * Each link opens the template's generate dialog on the documents library
 * (`contextualTemplateHref`) — never a blind download. Choosing a format and
 * filling merge fields is the point.
 *
 * It opens in a NEW TAB, unlike its `RelatedArticles` sibling. A template is
 * something you fetch *while* reading; navigating away would cost the reader
 * their place in the article and their scroll position. That is also why the
 * affordance is `ExternalLink` rather than the sibling's `ArrowUpRight` — the
 * repo's established icon for a link that leaves the current tab — and why each
 * link carries a screen-reader-only "(opens in new tab)", since the icon is
 * decorative and announces nothing.
 */
export function RelatedTemplates({ articleSlug }: RelatedTemplatesProps) {
  const templates: ContextualTemplate[] = getArticleTemplates(articleSlug);

  if (templates.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="wiki-related-templates"
      aria-labelledby="wiki-related-templates-heading"
      className="space-y-3 border-t pt-6"
    >
      <h2
        id="wiki-related-templates-heading"
        className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
      >
        Templates
      </h2>

      <ul className="grid gap-2">
        {templates.map((template) => (
          <li key={template.id}>
            <Link
              href={template.href}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="wiki-related-template"
              data-template-id={template.id}
              className="group hover:bg-muted/50 focus-visible:ring-ring flex cursor-pointer items-start justify-between gap-3 rounded-lg border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <span className="min-w-0 space-y-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="group-hover:text-primary font-medium">
                    {template.name}
                  </span>
                  <span className="sr-only">{"(opens in new tab)"}</span>
                  {template.formats.map((format) => (
                    <Badge
                      key={format}
                      variant="secondary"
                      className="text-xs uppercase"
                    >
                      {format}
                    </Badge>
                  ))}
                </span>
                <span className="text-muted-foreground line-clamp-2 block text-sm">
                  {template.description}
                </span>
              </span>
              <ExternalLink
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
