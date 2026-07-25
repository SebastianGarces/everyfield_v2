// ============================================================================
// InsightCard — one prioritized planter insight (PE-007/008/009/014).
//
// Presentational server component. Renders a single persisted plant insight:
// its severity badge, plain-language body, the cited fact(s) that produced it
// (PE-007 / AC-PE-5), and any wiki methodology links surfaced via RAG (PE-008).
// The per-insight feedback control (thumbs + comment) is the only interactive
// piece and is delegated to the InsightFeedback client component (PE-014).
//
// This component performs NO data access — it is handed a fully-formed insight
// by the Focus panel, which read the latest cached snapshot with zero LLM calls.
// ============================================================================

import Link from "next/link";
import { BookOpen } from "lucide-react";

import { InsightFeedback } from "@/components/phase-engine/insight-feedback";
import {
  severityMeta,
  slugToLabel,
} from "@/components/phase-engine/focus-presentation";
import { Badge } from "@/components/ui/badge";
import type { InsightFeedbackRating, PlantInsight } from "@/db/schema";

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

export function InsightCard({ insight, feedback }: InsightCardProps) {
  const severity = severityMeta(insight.severity);
  const citedFacts = (insight.citedFacts as string[] | null) ?? [];
  const articleSlugs = insight.relatedArticleSlugs ?? [];

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
                <Badge
                  variant="outline"
                  className="text-muted-foreground font-normal"
                >
                  {fact}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {articleSlugs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3">
          {articleSlugs.map((slug) => (
            <Link
              key={slug}
              href={`/wiki/${slug}`}
              className="text-primary inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium hover:underline"
            >
              <BookOpen className="h-3.5 w-3.5" />
              {slugToLabel(slug)}
            </Link>
          ))}
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
