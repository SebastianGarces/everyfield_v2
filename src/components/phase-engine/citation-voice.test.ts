// ============================================================================
// ONE VOICE PER CITATION, ON THE RENDERED PAGE (#319, ruled 2026-08-12).
//
// `/phase` renders one citation through THREE components at once — the CSF
// scorecard tile, the Focus insight card and the exit-criteria drill-down. Two
// of them fold a whole `cited_facts` column (`formatCitedFacts`); the third
// resolves one citation at a time (`formatCitedFact`). Until this ruling the
// third spoke the specific sentence for an `manual.attestations[N]` citation
// while the first two said "something you confirmed" about the same fact, so a
// planter could read one attestation told two ways in a single screenful.
//
// The projection tests (lib/phase-engine/assessment/exit-criteria.test.ts) pin
// what the read layer PRODUCES. This file pins what a browser RECEIVES, and it
// pins it across the three components together — the only place the property
// is actually about, since each component in isolation is self-consistent.
//
// One `LatestAssessment` drives all three, through the real projections and the
// real components, and `renderToStaticMarkup` gives the exact markup served
// (same approach as exit-criteria.test.ts next door).
// ============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PlantAssessment, PlantInsight } from "@/db/schema";
import {
  buildCsfScorecard,
  buildExitCriteriaProgress,
  type LatestAssessment,
} from "@/lib/phase-engine/assessment";

import { CsfScorecard } from "./csf-scorecard";
import { ExitCriteria } from "./exit-criteria";
import { InsightCardView } from "./insight-card-view";

// ----------------------------------------------------------------------------
// Fixtures — the snapshot's REAL two-sided manual block.
// ----------------------------------------------------------------------------

const GENERATED_AT = new Date("2026-07-20T09:00:00.000Z");

/**
 * `build-fact-snapshot.ts` writes every attestation TWICE — a `byKey` entry and
 * a row of `attestations[]` — which is what makes both spellings legal
 * citations of one fact. `financial_base_established` sits at index 1 so a
 * position can never be mistaken for a key.
 */
const MANUAL = {
  attestations: [
    {
      signalKey: "values_documented",
      value: true,
      attestedAt: GENERATED_AT.toISOString(),
    },
    {
      signalKey: "financial_base_established",
      value: false,
      attestedAt: GENERATED_AT.toISOString(),
    },
  ],
  byKey: { values_documented: true, financial_base_established: false },
  isEmpty: false,
};

function makeLatest(citedFacts: string[]): LatestAssessment {
  const assessment = {
    id: "assessment-1",
    churchId: "church-1",
    generatedAt: GENERATED_AT,
    phase: 1,
    rubricVersion: "v0",
    factSnapshot: {
      snapshotVersion: "1.0.0",
      churchId: "church-1",
      currentPhase: 1,
      generatedAt: GENERATED_AT.toISOString(),
      isColdStart: false,
      manual: MANUAL,
    },
    modelId: "test-model",
    status: "complete",
    createdAt: GENERATED_AT,
  } as PlantAssessment;

  const insight = {
    id: "insight-1",
    assessmentId: assessment.id,
    churchId: "church-1",
    audience: "planter",
    category: "generosity",
    severity: "medium",
    title: "Your financial base is not confirmed",
    body: "You have not yet attested that your launch funding is viable.",
    citedFacts,
    relatedArticleSlugs: [],
    rank: 0,
    createdAt: GENERATED_AT,
  } as PlantInsight;

  return { assessment, insights: [insight] };
}

/** The three surfaces' markup, all built from one assessment. */
function renderAllThree(citedFacts: string[]) {
  const latest = makeLatest(citedFacts);
  const scorecard = buildCsfScorecard(latest, "planter");
  const progress = buildExitCriteriaProgress(latest, "planter");
  const insight = scorecard!.factors.find((f) => f.category === "generosity")!
    .insights[0];

  return {
    tile: renderToStaticMarkup(createElement(CsfScorecard, { scorecard })),
    card: renderToStaticMarkup(createElement(InsightCardView, { insight })),
    drillDown: renderToStaticMarkup(createElement(ExitCriteria, { progress })),
  };
}

const SPECIFIC = "you have not confirmed your launch funding is viable";
const GENERIC = "something you have not confirmed";

// ----------------------------------------------------------------------------
// The ruling.
// ----------------------------------------------------------------------------

test("#319: all three /phase surfaces read one attestation as one sentence", () => {
  const keyed = renderAllThree([
    "manual.byKey.financial_base_established=false",
  ]);
  const array = renderAllThree(["manual.attestations.1.value=false"]);

  for (const [spelling, surfaces] of [
    ["byKey", keyed],
    ["attestations[]", array],
  ] as const) {
    for (const [surface, html] of Object.entries(surfaces)) {
      assert.ok(
        html.includes(SPECIFIC),
        `${surface} did not name the fact for the ${spelling} spelling`
      );
      assert.ok(
        !html.includes(GENERIC),
        `${surface} still speaks vaguely for the ${spelling} spelling`
      );
    }
  }
});

test("#319: the raw citation path is still the judge's own, unrewritten", () => {
  // The wording unifies; the citation does not. Round-2 ruling, unchanged.
  // Scoped to the CITED-fact rows: the criterion's own measurement row carries
  // the keyed path legitimately, because that is the path the gate declares.
  const { drillDown } = renderAllThree(["manual.attestations.1.value=false"]);
  const citedPaths = [
    ...drillDown.matchAll(
      /data-testid="exit-criterion-cited-fact"[^>]*data-path="([^"]*)"/g
    ),
  ].map((match) => match[1]);

  assert.deepEqual(citedPaths, ["manual.attestations.1.value"]);
});

test("#319: an unresolvable citation stays vague rather than borrowing a signal", () => {
  const { tile, card } = renderAllThree(["manual.attestations.9.value=false"]);

  for (const [surface, html] of [
    ["tile", tile],
    ["card", card],
  ] as const) {
    assert.ok(html.includes(GENERIC), `${surface} lost the honest fallback`);
    assert.ok(!html.includes(SPECIFIC), `${surface} guessed a signal`);
  }
});

test("#319: two attestations of different signals COUNT on the folding surfaces", () => {
  // The scorecard tile and the insight card fold a column; that path is a
  // counter and must not become a second copy of the drill-down.
  const { tile, card } = renderAllThree([
    "manual.attestations.0.value=true",
    "manual.attestations.1.value=true",
  ]);

  for (const [surface, html] of [
    ["tile", tile],
    ["card", card],
  ] as const) {
    assert.ok(
      html.includes("2 things you confirmed"),
      `${surface} did not collapse mixed signals to a count`
    );
    assert.ok(
      !html.includes("your core values are documented"),
      `${surface} listed the signals instead of counting them`
    );
  }
});
