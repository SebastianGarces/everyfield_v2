// ============================================================================
// InsightCard — one prioritized planter insight (PE-007/008/009/014).
//
// The interactive host for `InsightCardView`. Async server component: it does
// the one read the card needs and mounts the one client island the card
// carries, then hands both to the view, which owns every pixel
// (components/phase-engine/insight-card-view.tsx). Nothing renders here — keep
// markup in the view so the marketing page can render this exact card from a
// fixture (issue #296).
//
// The per-insight feedback control (thumbs + comment) is the only interactive
// piece and is delegated to the InsightFeedback client component (PE-014); it
// reaches the view as its `feedbackSlot`.
//
// The insight itself is handed in fully-formed by the Focus panel, which read
// the latest cached snapshot with ZERO LLM calls (PE-011). The one article read
// this component makes is the published-wiki slug index (PE-024): a stored slug
// can go stale between assessment and render, and a "how to improve" link that
// 404s is worse than no link, so the link is resolved against live wiki state.
// That read is `React.cache`-deduped, so a panel of insight cards costs one
// query, not one per card — and it is a plain DB read, never an LLM call. It is
// scoped to the reader's own church like every other reader-facing wiki read
// (#411); the session it needs for that is `React.cache`d too.
// ============================================================================

import { InsightCardView } from "@/components/phase-engine/insight-card-view";
import { InsightFeedback } from "@/components/phase-engine/insight-feedback";
import type { InsightFeedbackRating } from "@/db/schema";
import type { AssessedInsight } from "@/lib/phase-engine/assessment";
import { getCurrentSession } from "@/lib/auth";
import { getPublishedArticleRefs } from "@/lib/wiki/get-articles";

/** The current user's prior feedback for an insight, if any. */
export interface InsightFeedbackState {
  rating: InsightFeedbackRating | null;
  comment: string | null;
}

interface InsightCardProps {
  /**
   * `AssessedInsight` rather than `PlantInsight`: the row arrives from the read
   * layer carrying the signal each of its citations resolved to, and the view
   * reads an attestation in the drill-down's own words off that map (#319,
   * ruled 2026-08-12). This component only passes it through.
   */
  insight: AssessedInsight;
  /** The current user's existing feedback for this insight, if any. */
  feedback?: InsightFeedbackState;
}

export async function InsightCard({ insight, feedback }: InsightCardProps) {
  // Only pay for the slug index when there is something to resolve; the view
  // drops any stored slug that no longer resolves (PE-024).
  const storedSlugs = insight.relatedArticleSlugs ?? [];

  // The slug index is a reader-facing wiki read, so it is scoped to the reader's
  // own church like every other one (#411, #317): the title on this card and the
  // article the click opens must be one document, and where a church overrides a
  // global slug the unscoped read named the wrong one. `getCurrentSession` is
  // `React.cache`d and the dashboard layout above has already called it, so
  // reading it here costs no extra query.
  const { user } = await getCurrentSession();
  const articleRefs =
    storedSlugs.length > 0
      ? await getPublishedArticleRefs(user?.churchId ?? null)
      : [];

  return (
    <InsightCardView
      insight={insight}
      articleRefs={articleRefs}
      feedbackSlot={
        <InsightFeedback
          insightId={insight.id}
          initialRating={feedback?.rating ?? null}
          initialComment={feedback?.comment ?? null}
        />
      }
    />
  );
}
