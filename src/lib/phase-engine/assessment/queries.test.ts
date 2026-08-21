// ============================================================================
// CSF scorecard projection (PE-023).
//
// These tests pin the properties the scorecard's honesty depends on:
//   - all 8 factors are always present when an assessment exists,
//   - every standing traces to a persisted `plant_insights` row of the
//     assessment it was built from — nothing is recomputed,
//   - a plant with no complete assessment yields null (cold start), never
//     eight `not_raised` rows,
//   - the projection is audience-scoped and, composed with the oversight read
//     path's privacy gate, cannot leak a withheld insight into a standing.
//
// This file imports `./queries`, which constructs the Neon client at import
// time. That is fine and deliberate: `pnpm test` supplies a placeholder
// DATABASE_URL (see .github/workflows/pull-request-checks.yml) and every test
// below exercises the PURE projection — no query is ever issued.
// ============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  plantAssessments,
  type InsightSeverity,
  type PlantAssessment,
  type PlantInsight,
} from "@/db/schema";
import { privacyFeatureForCategory } from "@/lib/phase-engine/oversight/read";

import {
  assessmentReleasedToOversight,
  buildCsfScorecard,
  CSF_CATEGORIES,
  CSF_DEFINITIONS,
  csfStandingUrgency,
  isCsfCategory,
  PLANTER_FIRST_WINDOW_HOURS,
  standingForSeverity,
  type LatestAssessment,
} from "./queries";

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const ASSESSMENT_ID = "assessment-1";
const CHURCH_ID = "church-1";
const GENERATED_AT = new Date("2026-07-20T09:00:00.000Z");

function makeAssessment(
  overrides: Partial<PlantAssessment> = {}
): PlantAssessment {
  return {
    id: ASSESSMENT_ID,
    churchId: CHURCH_ID,
    generatedAt: GENERATED_AT,
    phase: 1,
    rubricVersion: "v0",
    factSnapshot: { snapshotVersion: "1.0.0" },
    modelId: "test-model",
    status: "complete",
    createdAt: GENERATED_AT,
    ...overrides,
  } as PlantAssessment;
}

let insightCounter = 0;

function makeInsight(overrides: Partial<PlantInsight> = {}): PlantInsight {
  insightCounter += 1;
  return {
    id: `insight-${insightCounter}`,
    assessmentId: ASSESSMENT_ID,
    churchId: CHURCH_ID,
    audience: "planter",
    category: "vision_casting",
    severity: "medium" as InsightSeverity,
    title: "Vision meeting cadence is slipping",
    body: "It has been 21 days since the last vision meeting.",
    citedFacts: ["visionMeetings.daysSinceLastMeeting=21"],
    relatedArticleSlugs: [],
    rank: 0,
    createdAt: GENERATED_AT,
    ...overrides,
  } as PlantInsight;
}

function makeLatest(insights: PlantInsight[]): LatestAssessment {
  return { assessment: makeAssessment(), insights };
}

// ----------------------------------------------------------------------------
// AC: the /phase surface renders all 8 CSFs with the engine's per-factor standing.
// ----------------------------------------------------------------------------

test("PE-023: a scorecard always carries all 8 CSFs, in rubric order", () => {
  const scorecard = buildCsfScorecard(makeLatest([makeInsight()]));

  assert.ok(scorecard);
  assert.equal(scorecard.factors.length, 8);
  assert.deepEqual(
    scorecard.factors.map((f) => f.category),
    [...CSF_CATEGORIES]
  );
  assert.deepEqual(
    scorecard.factors.map((f) => f.number),
    [1, 2, 3, 4, 5, 6, 7, 8]
  );
});

test("PE-023: every CSF definition has a name and a summary for the unraised case", () => {
  assert.equal(CSF_DEFINITIONS.length, 8);
  for (const definition of CSF_DEFINITIONS) {
    assert.ok(
      definition.name.length > 0,
      `${definition.category} needs a name`
    );
    assert.ok(
      definition.summary.length > 0,
      `${definition.category} needs a summary`
    );
    assert.ok(isCsfCategory(definition.category));
  }
});

test("PE-023: each severity maps onto a named standing, never a number", () => {
  const severities: InsightSeverity[] = [
    "critical",
    "high",
    "medium",
    "low",
    "info",
  ];
  const expected = ["attention", "attention", "watch", "noted", "strength"];

  assert.deepEqual(severities.map(standingForSeverity), expected);
});

test("PE-023: standings sort attention-first and rank tiebreaks within a factor", () => {
  const urgent = makeInsight({
    severity: "high",
    rank: 5,
    title: "Urgent one",
  });
  const mild = makeInsight({ severity: "low", rank: 0, title: "Mild one" });
  const alsoUrgent = makeInsight({
    severity: "high",
    rank: 1,
    title: "Also urgent",
  });

  // Deliberately out of order on the way in.
  const scorecard = buildCsfScorecard(makeLatest([mild, urgent, alsoUrgent]));
  const vision = scorecard!.factors[0];

  assert.equal(vision.standing, "attention");
  assert.deepEqual(
    vision.insights.map((i) => i.title),
    ["Also urgent", "Urgent one", "Mild one"]
  );
  assert.ok(
    csfStandingUrgency("attention") < csfStandingUrgency("watch"),
    "attention must sort before watch"
  );
  assert.ok(
    csfStandingUrgency("strength") < csfStandingUrgency("not_raised"),
    "not_raised is the last step, not a health verdict"
  );
});

// ----------------------------------------------------------------------------
// AC: each factor traces to the assessment that produced it, not a separately
// computed number.
// ----------------------------------------------------------------------------

test("PE-023: the scorecard carries the identity of the plant_assessments row it came from", () => {
  const latest = makeLatest([makeInsight()]);
  const scorecard = buildCsfScorecard(latest)!;

  assert.equal(scorecard.assessmentId, latest.assessment.id);
  assert.equal(scorecard.generatedAt, latest.assessment.generatedAt);
  assert.equal(scorecard.rubricVersion, latest.assessment.rubricVersion);
  assert.equal(scorecard.phase, latest.assessment.phase);
});

test("PE-023: a factor's standing and evidence are the persisted insight rows themselves", () => {
  const persisted = makeInsight({
    category: "critical_mass",
    severity: "high",
    citedFacts: ["coreGroup.committedCount=22"],
  });
  const scorecard = buildCsfScorecard(makeLatest([persisted]))!;
  const criticalMass = scorecard.factors.find(
    (f) => f.category === "critical_mass"
  )!;

  // Reference identity: the tile renders the row, it does not summarise it
  // into a derived value.
  assert.equal(criticalMass.insights.length, 1);
  assert.equal(criticalMass.insights[0], persisted);
  assert.equal(criticalMass.insights[0].assessmentId, ASSESSMENT_ID);
  // And the standing is a relabelling of the persisted severity, nothing else.
  assert.equal(criticalMass.standing, standingForSeverity(persisted.severity));
});

test("PE-023: no standing is invented for a factor the assessment did not raise", () => {
  const scorecard = buildCsfScorecard(
    makeLatest([makeInsight({ category: "prayer", severity: "info" })])
  )!;

  assert.equal(scorecard.raisedCount, 1);
  for (const factor of scorecard.factors) {
    if (factor.category === "prayer") {
      assert.equal(factor.standing, "strength");
      assert.equal(factor.insights.length, 1);
    } else {
      assert.equal(factor.standing, "not_raised");
      assert.deepEqual(factor.insights, []);
    }
  }
});

test("PE-023: cross-cutting categories never land on a CSF tile", () => {
  const scorecard = buildCsfScorecard(
    makeLatest([
      makeInsight({ category: "follow_up", severity: "critical" }),
      makeInsight({ category: "launch_readiness", severity: "critical" }),
      makeInsight({ category: "phase_progress", severity: "critical" }),
      makeInsight({ category: "onboarding", severity: "critical" }),
    ])
  )!;

  assert.equal(scorecard.raisedCount, 0);
  assert.ok(scorecard.factors.every((f) => f.standing === "not_raised"));
});

// ----------------------------------------------------------------------------
// AC: a church with no completed assessment sees the cold-start state, not
// eight empty rows.
// ----------------------------------------------------------------------------

test("PE-023: no complete assessment yields null, not eight not_raised rows", () => {
  assert.equal(buildCsfScorecard(null), null);
  assert.equal(buildCsfScorecard(null, "network"), null);
});

test("PE-023: an assessment with zero insights is NOT the cold-start state", () => {
  // Materially different from "never assessed": the engine looked and said
  // nothing. The scorecard must still exist so the as-of date is shown.
  const scorecard = buildCsfScorecard(makeLatest([]));

  assert.ok(scorecard, "an assessed plant always has a scorecard");
  assert.equal(scorecard.factors.length, 8);
  assert.equal(scorecard.raisedCount, 0);
});

// ----------------------------------------------------------------------------
// AC: nothing is shown to a network audience that the privacy gating forbids.
// ----------------------------------------------------------------------------

test("PE-023: the projection is audience-scoped — planter insights never reach a network scorecard", () => {
  const planterOnly = makeInsight({
    audience: "planter",
    category: "emerging_leadership",
    severity: "critical",
    title: "Sara is ready to lead worship",
  });
  const networkOne = makeInsight({
    audience: "network",
    category: "cohesion",
    severity: "medium",
    title: "Core-group cadence is uneven",
  });

  const network = buildCsfScorecard(
    makeLatest([planterOnly, networkOne]),
    "network"
  )!;

  assert.equal(network.audience, "network");
  assert.equal(
    network.factors.find((f) => f.category === "emerging_leadership")!.standing,
    "not_raised",
    "a planter-only finding must not set a network standing"
  );
  assert.equal(
    network.factors.find((f) => f.category === "cohesion")!.standing,
    "watch"
  );

  const allTitles = network.factors.flatMap((f) =>
    f.insights.map((i) => i.title)
  );
  assert.ok(!allTitles.includes(planterOnly.title));

  // The planter's own scorecard is unaffected by the network projection.
  const planter = buildCsfScorecard(
    makeLatest([planterOnly, networkOne]),
    "planter"
  )!;
  assert.equal(
    planter.factors.find((f) => f.category === "emerging_leadership")!.standing,
    "attention"
  );
});

test("PE-023: every CSF category is privacy-gated by the oversight read path", () => {
  // The scorecard adds no new exposure surface only because each of the eight
  // lenses is already tied to a `share_*` toggle. A category that mapped to
  // null would be visible to oversight on the page-level check alone.
  for (const category of CSF_CATEGORIES) {
    assert.ok(
      privacyFeatureForCategory(category) !== null,
      `${category} must be gated by a privacy feature`
    );
  }
});

test("PE-023: a withheld insight reads as not_raised, it cannot leak through a standing", () => {
  const shared = makeInsight({
    audience: "network",
    category: "comprehensive_training",
    severity: "medium",
    title: "Training is behind the launch date",
  });
  const withheld = makeInsight({
    audience: "network",
    category: "generosity",
    severity: "critical",
    title: "Giving has stalled",
    citedFacts: ["generosity.financialBaseInPlace=false"],
  });

  // Model the oversight gate: the church shares ministry_teams but not people.
  const allowed: Record<string, boolean> = {
    ministry_teams: true,
    meetings: true,
    people: false,
  };
  const gated = [shared, withheld].filter((insight) => {
    const feature = privacyFeatureForCategory(insight.category);
    return feature === null || allowed[feature] === true;
  });

  const scorecard = buildCsfScorecard(makeLatest(gated), "network")!;
  const generosity = scorecard.factors.find(
    (f) => f.category === "generosity"
  )!;
  const training = scorecard.factors.find(
    (f) => f.category === "comprehensive_training"
  )!;

  assert.equal(
    generosity.standing,
    "not_raised",
    "a gated-away insight must leave no trace in the standing"
  );
  assert.deepEqual(generosity.insights, []);
  assert.equal(training.standing, "watch");

  // Nothing anywhere on the card repeats the withheld finding.
  const rendered = scorecard.factors.flatMap((f) =>
    f.insights.flatMap((i) => [
      i.title,
      i.body,
      ...((i.citedFacts ?? []) as string[]),
    ])
  );
  assert.ok(!rendered.includes(withheld.title));
  assert.ok(!rendered.some((s) => s.includes("financialBaseInPlace")));
});

// ----------------------------------------------------------------------------
// The planter-first release gate (#482, C16/C25)
//
// Bryan: "The planter should never discover the diagnosis through his
// overseer." The predicate below is what oversight reads through, and it has
// two arms for two different reasons — one so the planter is first, one so an
// org that pays per plant is never blocked by a planter on holiday.
// ----------------------------------------------------------------------------

test("release has two arms: the planter has seen it, OR it is old enough", () => {
  const { sql: text } = db
    .select()
    .from(plantAssessments)
    .where(assessmentReleasedToOversight())
    .toSQL();

  assert.match(text, /"planter_seen_at" is not null/);
  assert.match(text, /"generated_at" < now\(\) - interval '72 hours'/);
  assert.match(text, / or /);
});

test("the window is stated once, and the SQL reads it", () => {
  // A second copy of "72" in the predicate is how the column's meaning and the
  // documented rule come apart.
  assert.equal(PLANTER_FIRST_WINDOW_HOURS, 72);
  assert.match(
    db
      .select()
      .from(plantAssessments)
      .where(assessmentReleasedToOversight())
      .toSQL().sql,
    new RegExp(`interval '${PLANTER_FIRST_WINDOW_HOURS} hours'`)
  );
});

test("the planter's own read is NOT gated", () => {
  // The planter opening their assessment is the event that releases it. Gating
  // their view on it would mean nobody could ever see anything.
  const planterQuery = db
    .select()
    .from(plantAssessments)
    .where(
      and(
        eq(plantAssessments.churchId, CHURCH_ID),
        eq(plantAssessments.status, "complete")
      )
    )
    .toSQL().sql;

  // The WHERE clause only — `select()` names every column, this one included.
  const where = planterQuery.slice(planterQuery.indexOf(" where "));
  assert.doesNotMatch(where, /planter_seen_at/);
  assert.doesNotMatch(where, /interval/);
});
