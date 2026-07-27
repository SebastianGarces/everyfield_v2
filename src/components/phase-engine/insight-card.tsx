// ============================================================================
// InsightCard — one prioritized planter insight (PE-007/008/009/014).
//
// Presentational server component. Renders a single persisted plant insight:
// its severity badge, plain-language body, the cited fact(s) that produced it
// (PE-007 / AC-PE-5), and any wiki methodology links surfaced via RAG (PE-008).
// The per-insight feedback control (thumbs + comment) is the only interactive
// piece and is delegated to the InsightFeedback client component (PE-014).
//
// The insight itself is handed in fully-formed by the Focus panel, which read
// the latest cached snapshot with ZERO LLM calls (PE-011). The one read this
// component does make is the published-wiki slug index (PE-024): a stored slug
// can go stale between assessment and render, and a "how to improve" link that
// 404s is worse than no link, so the link is resolved against live wiki state.
// That read is `React.cache`-deduped, so a panel of insight cards costs one
// query, not one per card — and it is a plain DB read, never an LLM call.
// ============================================================================

import Link from "next/link";
import { BookOpen } from "lucide-react";

import { InsightFeedback } from "@/components/phase-engine/insight-feedback";
import {
  buildArticleLinks,
  severityMeta,
} from "@/components/phase-engine/focus-presentation";
import { Badge } from "@/components/ui/badge";
import type { InsightFeedbackRating, PlantInsight } from "@/db/schema";
// The one humanising formatter, shared with the CSF scorecard
// (components/phase-engine/csf-scorecard.tsx): a planter reads the evidence in
// English, never in the judge's fact-ledger syntax.
import { formatCitedFacts } from "@/lib/phase-engine/fact-format";
import { getPublishedArticleRefs } from "@/lib/wiki/service";

/** The current user's prior feedback for an insight, if any. */
export interface InsightFeedbackState {
  rating: InsightFeedbackRating | null;
  comment: string | null;
}

interface InsightCardProps {
  insight: PlantInsight;
  /** The current user's existing feedback for this insight, if any. */
  feedback?: InsightFeedbackState;
}

export async function InsightCard({ insight, feedback }: InsightCardProps) {
  const severity = severityMeta(insight.severity);
  const citedFacts = formatCitedFacts(insight.citedFacts);

  // Resolve the stored slugs against the live published wiki: only articles
  // that still exist become links (PE-024). No stored slug, or none that still
  // resolves, means no "how to improve" section at all — never a dangling link.
  // `link.href` below is already URL-safe (buildArticleLinks → wikiHref, which
  // percent-encodes each slug segment); never re-interpolate `link.slug` here.
  const storedSlugs = insight.relatedArticleSlugs ?? [];
  const articleLinks =
    storedSlugs.length > 0
      ? buildArticleLinks(storedSlugs, await getPublishedArticleRefs())
      : [];

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
                <Link
                  href={link.href}
                  className="text-primary inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium hover:underline"
                >
                  <BookOpen className="h-3.5 w-3.5" aria-hidden />
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <InsightFeedback
        insightId={insight.id}
        initialRating={feedback?.rating ?? null}
        initialComment={feedback?.comment ?? null}
      />
    </article>
  );
}
