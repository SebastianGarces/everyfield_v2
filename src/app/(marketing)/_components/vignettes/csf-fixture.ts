// ============================================================================
// CSF_FIXTURE — one real assessment, frozen so the landing page can render the
// real scorecard.
//
// Source: Redemption Hill Church's live planter assessment of 2026-07-31
// (rubric v0, phase 4) — the same report whose dashboard render the retired
// r5-csf capture screenshotted. Snapshotted read-only from the dev database;
// to regenerate, re-run `getCsfScorecard(churchId)` for that church and paste
// the result back over the constant below.
//
// Every rendered string is verbatim: titles, bodies, cited-fact syntax,
// summaries, ranks, severities, the timestamp. Only the inert identifiers were
// scrubbed — ids never reach the DOM, they exist here to satisfy the type.
//
// This is the fixture behind the marketing page's live embed of
// components/phase-engine/csf-scorecard.tsx. Because the component is the
// app's own, the landing page cannot drift into showing a card the product
// does not render — but it does mean a change to that component changes this
// page.
// ============================================================================

import type { CsfScorecard } from "@/lib/phase-engine/assessment";

const ASSESSMENT_ID = "fixture-assessment";
const CHURCH_ID = "fixture-church";
const CREATED_AT = new Date("2026-07-31T06:29:32.033Z");

export const CSF_FIXTURE = {
  assessmentId: ASSESSMENT_ID,
  generatedAt: new Date("2026-07-31T06:29:22.536Z"),
  rubricVersion: "v0",
  phase: 4,
  audience: "planter",
  raisedCount: 4,
  factors: [
    {
      category: "vision_casting",
      number: 1,
      name: "Vision casting",
      summary:
        "Vision meetings on cadence, drawing a steady flow of new people.",
      standing: "strength",
      insights: [
        {
          id: "fixture-insight-1",
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
      ],
    },
    {
      category: "shared_ownership",
      number: 2,
      name: "Shared ownership",
      summary:
        "Inviting and follow-up spread across the core group, not carried alone.",
      standing: "attention",
      insights: [
        {
          id: "fixture-insight-2",
          assessmentId: ASSESSMENT_ID,
          churchId: CHURCH_ID,
          audience: "planter",
          category: "shared_ownership",
          severity: "high",
          title: "Address Stale Follow-Ups",
          body: "There are 12 stale follow-ups older than the 14-day threshold. Address these quickly to re-engage potential attendees and strengthen community ties.",
          citedFacts: [
            "followUp.staleCount=12",
            "followUp.staleThresholdDays=14",
          ],
          relatedArticleSlugs: ["pre-launch/final-checklist-review"],
          rank: 0,
          createdAt: CREATED_AT,
        },
      ],
    },
    {
      category: "critical_mass",
      number: 3,
      name: "Critical mass",
      summary: "Committed adults growing on a trajectory that reaches launch.",
      standing: "not_raised",
      insights: [],
    },
    {
      category: "cohesion",
      number: 4,
      name: "Cohesion",
      summary: "Regular core-group gatherings with consistent attendance.",
      standing: "not_raised",
      insights: [],
    },
    {
      category: "prayer",
      number: 5,
      name: "Prayer",
      summary: "Prayer leadership identified and prayer rhythms established.",
      standing: "not_raised",
      insights: [],
    },
    {
      category: "generosity",
      number: 6,
      name: "Generosity",
      summary: "A financial base in place and a viable first-year budget.",
      standing: "not_raised",
      insights: [],
    },
    {
      category: "emerging_leadership",
      number: 7,
      name: "Emerging leadership",
      summary: "Leaders rising from within to fill the eight ministry roles.",
      standing: "watch",
      insights: [
        {
          id: "fixture-insight-3",
          assessmentId: ASSESSMENT_ID,
          churchId: CHURCH_ID,
          audience: "planter",
          category: "emerging_leadership",
          severity: "medium",
          title: "Fill Remaining Leadership Role",
          body: "You currently have 7 out of 8 leadership roles filled. Focus on filling the Small Groups role to ensure full leadership coverage for launch.",
          citedFacts: [
            "ministryRoles.filledCount=7",
            "ministryRoles.totalRoles=8",
          ],
          relatedArticleSlugs: ["pre-launch/launch-team-spiritual-preparation"],
          rank: 1,
          createdAt: CREATED_AT,
        },
      ],
    },
    {
      category: "comprehensive_training",
      number: 8,
      name: "Comprehensive training",
      summary:
        "Ministry-model and role training underway, finishing before launch.",
      standing: "watch",
      insights: [
        {
          id: "fixture-insight-4",
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
      ],
    },
  ],
} satisfies CsfScorecard;

/** The three the compact composition shows: a strength, the one that needs
 *  attention, and one worth a look — the same three the retired capture led
 *  with, and the smallest set that still says the engine grades all eight. */
export const CSF_FIXTURE_COMPACT = [
  CSF_FIXTURE.factors[0],
  CSF_FIXTURE.factors[1],
  CSF_FIXTURE.factors[6],
];
