// ============================================================================
// FOCUS_* — the same real assessment csf-fixture.ts freezes, read from the
// other end: not the eight-factor standing, but the ranked list of what to do
// about it.
//
// Source: Redemption Hill Church's live planter assessment of 2026-07-31
// (rubric v0, phase 4, model gpt-4o) — the SAME assessment row behind
// csf-fixture.ts, so the two engine panes tell one story about one plant on one
// day. Snapshotted read-only from the dev database; to regenerate, re-run
// `getLatestAssessment(churchId)` for that church, keep the `audience:
// "planter"` insights (they arrive ordered by rank), read the delta with
// `readDelta(assessment.factSnapshot)`, resolve the insights' slugs against
// `getPublishedArticleRefs()`, and paste the results back over the constants
// below.
//
// Every rendered string is verbatim: titles, bodies, cited-fact syntax, article
// titles, ranks, severities, the generated-at date. (One exception, by ruling:
// the what-changed delta is hand-authored — see FOCUS_DELTA.) Only the inert identifiers
// were scrubbed — but note these ones are NOT purely inert: the insight card
// builds a DOM id from `insight.id` (`insight-improve-<id>`, tying its "How to
// improve" list to its label), so the scrubbed ids must stay unique and
// HTML-safe. They deliberately differ from csf-fixture.ts's scrubbed ids for
// the same rows; the scorecard never emits an insight id, this card does, and
// both cards render on the same page.
//
// `factSnapshot` is the one field the panel never renders, and it is the
// judge's whole fact ledger for a real plant — so it carries only the `_delta`
// fragment the panel's what-changed row is read from (PE-016). A landing page
// has no business holding the rest.
//
// This is the fixture behind the marketing page's live embed of
// components/phase-engine/focus-panel.tsx. Because the component is the app's
// own, the landing page cannot drift into showing a card the product does not
// render — but it does mean a change to that component changes this page.
// ============================================================================

import type { InsightArticleRef } from "@/components/phase-engine/insight-card-view";
import type { SnapshotDelta } from "@/lib/phase-engine/assessment";
import type { PlantAssessment, PlantInsight } from "@/db/schema";

const ASSESSMENT_ID = "fixture-focus-assessment";
const CHURCH_ID = "fixture-focus-church";
const GENERATED_AT = new Date("2026-07-31T06:29:22.536Z");
const CREATED_AT = new Date("2026-07-31T06:29:32.033Z");

/** The stored what-changed delta (PE-016). The source assessment was the
 *  plant's first, so the panel rendered its "nothing to compare against yet"
 *  line — the one sentence in this embed that was app boilerplate rather than
 *  this plant's story. Ruled 2026-08-05 (PR #299 decision 7): the fixture
 *  carries a hand-authored prior month instead, so the panel renders its real
 *  what-changed chips. Every `current` value below is a fact the insights
 *  already cite (28 latest attendance, 7 of 8 roles, 65 training
 *  completions), so the chips and the cards under them tell one story; the
 *  fields and their order are exactly what `computeSnapshotDelta` tracks. */
export const FOCUS_DELTA = {
  isFirstAssessment: false,
  changed: [
    {
      path: "visionMeetings.totalCompleted",
      previous: 3,
      current: 4,
      delta: 1,
    },
    {
      path: "visionMeetings.latestAttendance",
      previous: 24,
      current: 28,
      delta: 4,
    },
    {
      path: "ministryRoles.filledCount",
      previous: 6,
      current: 7,
      delta: 1,
    },
    {
      path: "training.completionCount",
      previous: 52,
      current: 65,
      delta: 13,
    },
  ],
} satisfies SnapshotDelta;

export const FOCUS_ASSESSMENT = {
  id: ASSESSMENT_ID,
  churchId: CHURCH_ID,
  generatedAt: GENERATED_AT,
  phase: 4,
  rubricVersion: "v0",
  factSnapshot: { _delta: FOCUS_DELTA },
  modelId: "gpt-4o",
  status: "complete",
  planterSeenAt: null,
  createdAt: GENERATED_AT,
} satisfies PlantAssessment;

/**
 * All five planter-audience insights this assessment produced, in the order the
 * read layer returns them (by rank, lowest first). Kept whole even though the
 * page renders two, because the whole list is what makes "the two the engine
 * ranked first" a checkable claim rather than a marketing adjective.
 */
export const FOCUS_INSIGHTS = [
  {
    id: "fixture-focus-insight-1",
    assessmentId: ASSESSMENT_ID,
    churchId: CHURCH_ID,
    audience: "planter",
    category: "shared_ownership",
    severity: "high",
    title: "Address Stale Follow-Ups",
    body: "There are 12 stale follow-ups older than the 14-day threshold. Address these quickly to re-engage potential attendees and strengthen community ties.",
    citedFacts: ["followUp.staleCount=12", "followUp.staleThresholdDays=14"],
    relatedArticleSlugs: ["pre-launch/final-checklist-review"],
    rank: 0,
    createdAt: CREATED_AT,
  },
  {
    id: "fixture-focus-insight-2",
    assessmentId: ASSESSMENT_ID,
    churchId: CHURCH_ID,
    audience: "planter",
    category: "emerging_leadership",
    severity: "medium",
    title: "Fill Remaining Leadership Role",
    body: "You currently have 7 out of 8 leadership roles filled. Focus on filling the Small Groups role to ensure full leadership coverage for launch.",
    citedFacts: ["ministryRoles.filledCount=7", "ministryRoles.totalRoles=8"],
    relatedArticleSlugs: ["pre-launch/launch-team-spiritual-preparation"],
    rank: 1,
    createdAt: CREATED_AT,
  },
  {
    id: "fixture-focus-insight-3",
    assessmentId: ASSESSMENT_ID,
    churchId: CHURCH_ID,
    audience: "planter",
    category: "comprehensive_training",
    severity: "medium",
    title: "Complete Training Programs",
    body: "Ensure all training programs are completed. You have achieved a 65% completion rate, but full readiness requires completion of all key training initiatives.",
    citedFacts: [
      "training.completionCount=65",
      "training.requiredCompletionRate=0.8",
    ],
    relatedArticleSlugs: ["pre-launch/the-final-3-4-weeks"],
    rank: 2,
    createdAt: CREATED_AT,
  },
  {
    id: "fixture-focus-insight-4",
    assessmentId: ASSESSMENT_ID,
    churchId: CHURCH_ID,
    audience: "planter",
    category: "phase_progress",
    severity: "low",
    title: "Preparations for Launch Sunday",
    body: "With 27 days until Launch Sunday, focus on integrating all parts into the whole and testing all systems thoroughly, as currently, systems have not been fully tested.",
    citedFacts: [
      "launch.daysUntilLaunch=27",
      "manual.byKey.systems_tested=false",
    ],
    relatedArticleSlugs: ["pre-launch/the-final-3-4-weeks"],
    rank: 4,
    createdAt: CREATED_AT,
  },
  {
    id: "fixture-focus-insight-5",
    assessmentId: ASSESSMENT_ID,
    churchId: CHURCH_ID,
    audience: "planter",
    category: "vision_casting",
    severity: "info",
    title: "Vision Meetings Show Positive Momentum",
    body: "Your recent vision meetings have shown an upward trend in attendance, increasing from 24 to 28 participants. This is a positive indicator of growing engagement as you approach launch.",
    citedFacts: [
      "visionMeetings.latestAttendance=28",
      "visionMeetings.previousAttendance=24",
      "visionMeetings.attendanceTrend=up",
    ],
    relatedArticleSlugs: ["pre-launch/the-final-3-4-weeks"],
    rank: 6,
    createdAt: CREATED_AT,
  },
] satisfies PlantInsight[];

/**
 * The two the engine ranked first — the only subset that fits this pane above
 * the type floor.
 *
 * The pane is ~550px of content; the panel is 704px wide, so it renders
 * scaled, and every insight card added costs ~26% of the remaining scale. Two
 * cards land at ~9px of effective type at 1440 (ahead of the capture this
 * replaces); three land at ~7px, which is a wall of grey. So the desktop
 * composition is the real panel holding rank 0 and rank 1 — the two the planter
 * would act on first — and the pane says a short list because the product's
 * claim is a short list.
 */
export const FOCUS_INSIGHTS_LEAD = [
  FOCUS_INSIGHTS[0],
  FOCUS_INSIGHTS[1],
] satisfies PlantInsight[];

/**
 * The published-wiki refs these insights' slugs resolve against (PE-024). In
 * the app the card reads this index itself; here it is frozen, because a
 * marketing page may not touch the database. All three slugs still resolve —
 * verified in the same snapshot pass — so every "How to improve" link this page
 * shows is a link the product would show today.
 */
export const FOCUS_ARTICLE_REFS = [
  { slug: "pre-launch/the-final-3-4-weeks", title: "The Final 3-4 Weeks" },
  {
    slug: "pre-launch/launch-team-spiritual-preparation",
    title: "Launch Team Spiritual Preparation",
  },
  {
    slug: "pre-launch/final-checklist-review",
    title: "Final Checklist Review",
  },
] satisfies InsightArticleRef[];
