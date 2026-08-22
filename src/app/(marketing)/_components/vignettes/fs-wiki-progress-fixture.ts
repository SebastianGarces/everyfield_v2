// ============================================================================
// FS_WIKI_PROGRESS_FIXTURE — one reader's real wiki progress, frozen so the
// landing page can render the real progress surface.
//
// Source: Daniel Reyes' reading progress at Redemption Hill Church as of
// 2026-08-04, read read-only from the dev database. The app's own read layer
// for this page is session-scoped — `getProgressStats()` and
// `getLastInProgress()` (src/lib/wiki/reads.ts) both start from
// `getCurrentSession()`, which does not exist outside a request — so the
// snapshot script ran their queries against that user's id directly and then
// applied the page's projection verbatim: the CATEGORY_NAMES table, the
// per-category grouping, the rounding and the sort in
// app/(dashboard)/wiki/progress/page.tsx. Nothing here is computed by hand.
// To regenerate, sign in as that user, open /wiki/progress and copy the props
// the page hands `WikiProgressCard`.
//
// It reconciles with the retired r5-wikiprog capture line for line: 4 of 96,
// 4% overall, Getting Started 1/2 (50%), Discovery 2/6 (33%), Core Group
// Development 0/20 (0%).
//
// The "Continue Reading" article is the same chapter the panel's primary crop
// has open — Launch Day Guide. That is not a coincidence to be maintained; it
// is what the database says, and it is why this overlay belongs on this shot.
//
// Only fields the view renders are kept: the projection also carries
// `sortOrder` and `inProgress` per row (inputs to the sort and the totals) and
// `lastViewedAt` on the continue item, none of which `WikiProgressCard` reads.
// Nothing was scrubbed — this surface has no identifiers in it.
//
// Type-only import: `wiki-progress-card.tsx` types its article kind through
// `@/lib/wiki/types`, which re-exports from `@/db/schema`, and a value import
// of that chain would pull Drizzle into the marketing bundle.
// ============================================================================

import type { WikiProgressCardProps } from "@/components/wiki/wiki-progress-card";

export const FS_WIKI_PROGRESS_FIXTURE = {
  totalArticles: 96,
  totalCompleted: 4,
  totalInProgress: 2,
  overallPercentage: 4,
  sections: [
    {
      category: "getting-started",
      name: "Getting Started",
      total: 2,
      completed: 1,
      percentage: 50,
    },
    {
      category: "discovery",
      name: "Discovery",
      phase: 0,
      total: 6,
      completed: 2,
      percentage: 33,
    },
    {
      category: "core-group",
      name: "Core Group Development",
      phase: 1,
      total: 20,
      completed: 0,
      percentage: 0,
    },
    {
      category: "launch-team",
      name: "Launch Team Formation",
      phase: 2,
      total: 18,
      completed: 0,
      percentage: 0,
    },
    {
      category: "training",
      name: "Training & Preparation",
      phase: 3,
      total: 7,
      completed: 0,
      percentage: 0,
    },
    {
      category: "pre-launch",
      name: "Pre-Launch",
      phase: 4,
      total: 8,
      completed: 0,
      percentage: 0,
    },
    {
      category: "launch-sunday",
      name: "Launch Sunday",
      phase: 5,
      total: 6,
      completed: 0,
      percentage: 0,
    },
    {
      category: "post-launch",
      name: "Post-Launch",
      phase: 6,
      total: 7,
      completed: 0,
      percentage: 0,
    },
    {
      category: "frameworks",
      name: "Frameworks & Concepts",
      total: 6,
      completed: 1,
      percentage: 17,
    },
    {
      category: "administrative",
      name: "Reference",
      total: 16,
      completed: 0,
      percentage: 0,
    },
  ],
  lastInProgress: {
    slug: "launch-sunday/launch-day-guide",
    title: "Launch Day Guide",
    description:
      "A comprehensive guide to executing Launch Sunday with excellence, covering the key priorities and mindset for the historic day.",
    type: "overview",
    readTime: 8,
    scrollPosition: 0,
  },
} satisfies Omit<WikiProgressCardProps, "breadcrumbSlot">;

/** Ten sections make up the wiki; the compositions crop before most of them,
 *  so the marketing footnote has to say how many are underneath. */
export const FS_WIKI_SECTION_COUNT = FS_WIKI_PROGRESS_FIXTURE.sections.length;
