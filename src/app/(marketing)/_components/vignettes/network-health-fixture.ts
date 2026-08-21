// ============================================================================
// NETWORK_PORTFOLIO — one real oversight portfolio, frozen so the landing page
// can render the real Plant Health surface.
//
// Source: the NTX Planting network in the dev database, read
// 2026-08-05T03:45:47Z through the app's own read layer —
// `getOversightPlantHealth(user)` (src/lib/phase-engine/oversight/read.ts) with
// ray@ntxplanting.org's `users` row, the same call and the same user the
// /oversight/health page makes. Read-only; to regenerate, re-run that function
// for that user and paste the result back over the constant below.
//
// Every rendered string is verbatim: church names, phases, classifications,
// insight titles and bodies, the launch countdown, the observation counts.
// Church, assessment and insight ids are scrubbed — the church id is a React
// key and the rest never reach the DOM at all.
//
// THREE THINGS THIS SNAPSHOT CHANGED SINCE THE CAPTURE IT REPLACES:
//
//   1. The read now returns THREE plants. The third is "Invitation Flow
//      Church" — a phase-0, never-assessed church created by the planter-
//      invitation QA in #23, not a plant anyone sent. It is left out here: it
//      is a test artifact, and a landing page that lists it is advertising our
//      test fixtures. Everything else is included exactly as returned.
//   2. `net-health.webp` showed "Assessed yesterday". The assessment is the
//      same one; it is simply older now. The label is computed from
//      `generatedAt`, which is re-anchored at render (see ./snapshot-clock),
//      so it reads five days rather than one — five days behind a launch that
//      is 27 days out, which is a coherent picture. Freezing the date instead
//      would have the card claiming a months-old read of a plant launching in
//      four weeks.
//   3. The 60-vs-61 discrepancy the capture had is still true and still
//      honest: this insight quotes `coreGroup.committedCount=60` from the fact
//      snapshot the judge scored on 2026-07-31, and the dashboard beside it
//      counts 61 today. One is a reading, the other is a count.
//
// `daysUntilLaunch` does NOT drift — it is a fact the assessment recorded, not
// a live subtraction — so "Launches in 27 days" stays 27, and stays inside the
// 30-day readiness window (READINESS_LAUNCH_WINDOW_DAYS) that makes it red and
// puts this plant under "Readiness focus".
// ============================================================================

import type { PlantInsight } from "@/db/schema";
import type { PlantHealthSummary } from "@/lib/phase-engine/oversight/read";

import { snapshotClock } from "./snapshot-clock";

const since = snapshotClock("2026-08-05T03:45:47.805Z");

/** Inert: the church id is a React key; the other two never reach the DOM. */
const REDEMPTION_HILL_ID = "fixture-church-redemption-hill";
const TRINITY_GROVE_ID = "fixture-church-trinity-grove";
const ASSESSMENT_ID = "fixture-assessment";

/** Every insight in this assessment was written in the same run. */
const CREATED_AT = since("2026-07-31T06:29:32.033Z");

const REDEMPTION_HILL_INSIGHTS = [
  {
    id: "fixture-insight-prayer",
    assessmentId: ASSESSMENT_ID,
    churchId: REDEMPTION_HILL_ID,
    audience: "network",
    category: "prayer",
    severity: "medium",
    title: "Emphasize Prayer Leading to Launch",
    body: "Ensure prayer coverage is established before launch. Prayer rhythms are one of the eight Critical Success Factors, and this plant has none recorded.",
    citedFacts: ["launch.daysUntilLaunch=27"],
    relatedArticleSlugs: ["pre-launch/launch-team-spiritual-preparation"],
    rank: 3,
    createdAt: CREATED_AT,
  },
  {
    id: "fixture-insight-cohesion",
    assessmentId: ASSESSMENT_ID,
    churchId: REDEMPTION_HILL_ID,
    audience: "network",
    category: "cohesion",
    severity: "low",
    title: "Consistent Core Group Commitment",
    body: "The core group remains active with 60 committed members and steady growth. Regular engagement is crucial for cohesive readiness by launch.",
    citedFacts: ["coreGroup.committedCount=60", "coreGroup.growthDelta=3"],
    relatedArticleSlugs: [],
    rank: 5,
    createdAt: CREATED_AT,
  },
  {
    id: "fixture-insight-readiness",
    assessmentId: ASSESSMENT_ID,
    churchId: REDEMPTION_HILL_ID,
    audience: "network",
    category: "launch_readiness",
    severity: "info",
    title: "Strong Foundation for Launch",
    body: "The financial base is confirmed, a critical step towards readiness. Leadership roles are largely filled, showing strong foundational support.",
    citedFacts: [
      "manual.byKey.financial_base_established=true",
      "ministryRoles.filledCount=7",
    ],
    relatedArticleSlugs: [],
    rank: 7,
    createdAt: CREATED_AT,
  },
] satisfies PlantInsight[];

export const NETWORK_SCOPE_LABEL = "network";

export const NETWORK_PORTFOLIO = [
  {
    churchId: REDEMPTION_HILL_ID,
    churchName: "Redemption Hill Church",
    currentPhase: 4,
    classification: "readiness",
    insights: REDEMPTION_HILL_INSIGHTS,
    daysUntilLaunch: 27,
    generatedAt: since("2026-07-31T06:29:22.536Z"),
    hasSharedContent: true,
  },
  {
    // Shares only its phase with the network — which is the point of showing
    // it: the portfolio lists every plant, and says so when a planter has
    // opted nothing in. Nothing here was withheld by us.
    churchId: TRINITY_GROVE_ID,
    churchName: "Trinity Grove Church",
    currentPhase: 6,
    classification: "on-track",
    insights: [],
    daysUntilLaunch: null,
    generatedAt: null,
    hasSharedContent: false,
  },
] satisfies PlantHealthSummary[];
