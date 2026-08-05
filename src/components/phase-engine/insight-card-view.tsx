// ============================================================================
// InsightCardView — the rendering half of one prioritized planter insight
// (PE-007/008/009/014).
//
// Pure presentational component. It performs NO data access and NO judgement of
// its own: it is handed an insight (projected from the persisted
// `plant_insights` row), the published-wiki refs to resolve its "how to
// improve" links against, and — as a slot — whatever interactivity the host
// wants to hang off the card. Everything it renders is either the insight's own
// text or a pure transform of it.
//
// Why it is split out of `insight-card.tsx`: the interactive host is an async
// server component that reads the wiki slug index and mounts a client feedback
// island, so nothing that cannot touch the database could render this card. The
// marketing page needs exactly this markup from a typed fixture (issue #296),
// so the markup lives here with JSON in and no IO — same shape as the CSF
// scorecard (components/phase-engine/csf-scorecard.tsx). `InsightCard` is now a
// thin wrapper that does the reads and passes the feedback island in.
//
// Server-safe on purpose: no "use client", no event handlers, no value-level
// import of anything server-only. Keep it that way — the only interactivity
// this card may carry arrives as `feedbackSlot`.
// ============================================================================

import Link from "next/link";
import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";

import {
  buildArticleLinks,
  severityMeta,
} from "@/components/phase-engine/focus-presentation";
import { Badge } from "@/components/ui/badge";
import type { PlantInsight } from "@/db/schema";
// The one humanising formatter, shared with the CSF scorecard
// (components/phase-engine/csf-scorecard.tsx): a planter reads the evidence in
// English, never in the judge's fact-ledger syntax.
import { formatCitedFacts } from "@/lib/phase-engine/fact-format";

/**
 * The fields of a persisted insight this card actually renders. A `PlantInsight`
 * row satisfies it; a fixture only has to supply these six.
 */
export type InsightCardData = Pick<
  PlantInsight,
  "id" | "title" | "body" | "severity" | "citedFacts" | "relatedArticleSlugs"
>;

/**
 * A published wiki article, as the slug index yields it. Declared structurally
 * rather than imported from `lib/wiki/service` so this file never names a
 * DB-backed module.
 */
export interface InsightArticleRef {
  slug: string;
  title: string;
}

interface InsightCardViewProps {
  insight: InsightCardData;
  /**
   * Currently published articles, for resolving the insight's stored slugs
   * (PE-024). Empty (the default) means no "how to improve" section renders —
   * never a dangling link.
   */
  articleRefs?: InsightArticleRef[];
  /**
   * The card's only interactive region — the per-insight feedback control in
   * the app (PE-014), nothing at all where the card is a picture of itself.
   */
  feedbackSlot?: ReactNode;
  /** Render the article references as inert markup instead of links — for
   *  presentational embeds (the marketing page), where nothing may be
   *  clickable, focusable or prefetchable. Absent, as in the app, this card is
   *  unchanged. */
  linkStatic?: boolean;
}

/** Shared by the link and its inert twin, so the two can never drift. */
const ARTICLE_LINK_CLASS =
  "text-primary inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium hover:underline";

export function InsightCardView({
  insight,
  articleRefs = [],
  feedbackSlot,
  linkStatic,
}: InsightCardViewProps) {
  const severity = severityMeta(insight.severity);
  const citedFacts = formatCitedFacts(insight.citedFacts);

  // Resolve the stored slugs against the live published wiki: only articles
  // that still exist become links (PE-024). No stored slug, or none that still
  // resolves, means no "how to improve" section at all — never a dangling link.
  // `link.href` below is already URL-safe (buildArticleLinks → wikiHref, which
  // percent-encodes each slug segment); never re-interpolate `link.slug` here.
  const storedSlugs = insight.relatedArticleSlugs ?? [];
  const articleLinks =
    storedSlugs.length > 0 ? buildArticleLinks(storedSlugs, articleRefs) : [];

  // Ties the link list to its "How to improve" label for screen readers.
  const improveHeadingId = `insight-improve-${insight.id}`;

  return (
    <article className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm leading-snug font-semibold">{insight.title}</h3>
        <Badge variant={severity.badgeVariant} className="shrink-0">
          {severity.label}
        </Badge>
      </div>

      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        {insight.body}
      </p>

      {citedFacts.length > 0 && (
        <div className="mt-3">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Based on
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {citedFacts.map((fact, index) => (
              <li key={`${fact}-${index}`}>
                {/* Humanised citations are phrases, not `key=value` tokens, so
                    the chip has to wrap and stay inside the card rather than
                    ride Badge's default `whitespace-nowrap` off a narrow
                    screen. Left-aligned because a wrapped second line centred
                    under the first reads as a caption, not a sentence. */}
                <Badge
                  variant="outline"
                  className="text-muted-foreground max-w-full text-left font-normal whitespace-normal"
                >
                  {fact}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {articleLinks.length > 0 && (
        <div className="mt-3">
          <p
            id={improveHeadingId}
            className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
          >
            How to improve
          </p>
          <ul
            aria-labelledby={improveHeadingId}
            className="mt-1.5 flex flex-wrap gap-3"
          >
            {articleLinks.map((link) => (
              <li key={link.slug}>
                {linkStatic ? (
                  <span className={ARTICLE_LINK_CLASS}>
                    <BookOpen className="h-3.5 w-3.5" aria-hidden />
                    {link.label}
                  </span>
                ) : (
                  <Link href={link.href} className={ARTICLE_LINK_CLASS}>
                    <BookOpen className="h-3.5 w-3.5" aria-hidden />
                    {link.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {feedbackSlot}
    </article>
  );
}
