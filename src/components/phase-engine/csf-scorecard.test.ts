import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FactorTile } from "./csf-scorecard";
import {
  buildCsfScorecard,
  type CsfFactorStanding,
} from "@/lib/phase-engine/assessment/queries";

// ----------------------------------------------------------------------------
// The tile that says it cannot see (#483, C17) — DOM level.
//
// Bryan: "I would rather EveryField say, 'We do not currently have enough
// information to assess prayer health' than leave a blank that could be
// interpreted as healthy."
//
// The eight tiles always render. Before this, a lens the engine is blind to and
// a lens with nothing wrong produced the SAME tile — so prayer and generosity,
// the two blindest, were the two that looked calmest. These assert on the
// markup a browser is actually served, the same approach `exit-criteria.test.ts`
// takes for the same reason.
// ----------------------------------------------------------------------------

function tile(over: Partial<CsfFactorStanding> = {}): string {
  const factor: CsfFactorStanding = {
    category: "prayer",
    number: 5,
    name: "Prayer",
    summary: "Prayer leadership identified and prayer rhythms established.",
    standing: "not_raised",
    insights: [],
    evidence: { quality: "unknown", attestedDaysAgo: null },
    ...over,
  };
  return renderToStaticMarkup(FactorTile({ factor }) as never);
}

/** Markup with tags stripped, for asserting on what a reader sees. */
function text(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

test("a lens with no evidence and no insight says so", () => {
  const markup = tile();

  assert.match(text(markup), /Insufficient evidence/);
  assert.match(
    text(markup),
    /We don't have enough information to assess prayer yet/
  );
});

test("it is visually distinct from BOTH neighbours", () => {
  // Not the dashed placeholder of `not_raised` ("nothing to report"), and not
  // a tint (which would read as a verdict).
  const insufficient = tile();
  assert.match(insufficient, /data-standing="insufficient_evidence"/);
  assert.doesNotMatch(insufficient, /border-dashed/);

  const notRaised = tile({
    evidence: { quality: "measured", attestedDaysAgo: null },
  });
  assert.match(notRaised, /data-standing="not_raised"/);
  assert.match(notRaised, /border-dashed/);
});

test("a raised insight is never overwritten by 'insufficient evidence'", () => {
  // If the judge raised something it HAD something to say. Printing "we cannot
  // see this" over a real observation would be a worse blank than the one this
  // replaces.
  const markup = tile({
    standing: "attention",
    insights: [
      {
        id: "i1",
        title: "No prayer rhythm recorded",
        citedFacts: [],
      } as never,
    ],
  });

  assert.doesNotMatch(text(markup), /Insufficient evidence/);
  assert.match(text(markup), /No prayer rhythm recorded/);
});

test("an attested lens says whose word it is on, and how old", () => {
  assert.match(
    text(tile({ evidence: { quality: "attested", attestedDaysAgo: 45 } })),
    /Your own answer, confirmed 45 days ago/
  );
  assert.match(
    text(tile({ evidence: { quality: "attested", attestedDaysAgo: 0 } })),
    /Your own answer, confirmed today/
  );
});

test("a measured lens claims nobody's word — it just reports", () => {
  const markup = tile({
    category: "critical_mass",
    number: 3,
    name: "Critical mass",
    summary: "Committed adults growing on a trajectory that reaches launch.",
    evidence: { quality: "measured", attestedDaysAgo: null },
  });

  assert.doesNotMatch(text(markup), /Your own answer/);
  assert.doesNotMatch(text(markup), /Insufficient evidence/);
  assert.match(markup, /data-evidence="measured"/);
});

// ----------------------------------------------------------------------------
// The cold-start plant's CSF-1 tile (#635) — the reported bug, end to end.
//
// On a plant with no recorded activity, this tile rendered:
//
//   CSF 1 · Vision casting · GOING WELL · Explore the Launch Playbook ·
//   Based on no activity recorded yet
//
// Seven sibling lenses rendered "Insufficient evidence" off the same absence.
// The whole path is exercised — the persisted row, the projection, the tile —
// because the report was about a rendered line, not about a standing.
// ----------------------------------------------------------------------------

test("#635: a cold-start plant is not told its vision casting is going well", () => {
  const generatedAt = new Date("2026-08-21T07:00:00.000Z");
  const scorecard = buildCsfScorecard({
    // A snapshot that measures nothing: `isColdStart`, every lens unknown.
    assessment: {
      id: "assessment-635",
      churchId: "church-635",
      generatedAt,
      phase: 0,
      rubricVersion: "v1",
      factSnapshot: { snapshotVersion: "1.0.0", isColdStart: true },
      modelId: "test-model",
      status: "complete",
      createdAt: generatedAt,
    } as never,
    insights: [
      {
        id: "i-635",
        assessmentId: "assessment-635",
        churchId: "church-635",
        audience: "planter",
        category: "vision_casting",
        // What persistence writes for the judge's "positive" (persist.ts).
        severity: "info",
        title: "Explore the Launch Playbook",
        body: "Your vision casting is off to a good start.",
        citedFacts: ["isColdStart=true"],
        relatedArticleSlugs: [],
        rank: 0,
        createdAt: generatedAt,
      } as never,
    ],
  })!;

  const factor = scorecard.factors.find(
    (f) => f.category === "vision_casting"
  )!;
  const rendered = text(renderToStaticMarkup(FactorTile({ factor }) as never));

  assert.doesNotMatch(rendered, /Going well/);
  assert.doesNotMatch(rendered, /no activity recorded yet/);
  assert.doesNotMatch(rendered, /Explore the Launch Playbook/);
  assert.match(rendered, /Insufficient evidence/);
  assert.match(
    rendered,
    /We don't have enough information to assess vision casting yet/
  );
});
