import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PLANTER_FOCUS_BUDGET,
  judgeOutputSchema,
  type Insight,
} from "./schema";

// ----------------------------------------------------------------------------
// The observation budget, enforced where a model cannot argue with it (#478).
//
// Bryan asked for "1 main 2 supplement". A cap in the PROMPT is a request the
// model can talk itself out of on a busy plant — which is precisely the plant
// where the cap matters most. A cap in the SCHEMA is a refusal: an over-budget
// response fails validation and is retried, never stored.
//
// Since #605 that retry is a RE-PROMPT carrying the message asserted below, so
// the message is not decoration: it is what the model is told to fix. The other
// three rules on this schema are exercised elsewhere — coverage and pairing in
// `schema-retry.test.ts`, the verdict register in `network-register.test.ts`.
// ----------------------------------------------------------------------------

function insight(over: Partial<Insight> = {}): Insight {
  return {
    audience: "planter",
    category: "critical_mass",
    severity: "watch",
    title: "Core-group growth has slowed",
    body: "No new committed adults in three weeks. When did you last hold a vision meeting?",
    citedFacts: ["coreGroup.committedCount=22"],
    relatedArticleSlugs: [],
    ...over,
  };
}

/**
 * A network insight that satisfies audience coverage and NOTHING ELSE.
 *
 * Coverage (PE-012) became a refinement on this schema in #605 — it used to be
 * a post-parse throw in the pipeline, which is a rule the retry ladder could
 * not see. Every output below therefore needs a network item, and this one is
 * `positive` on purpose: a positive network insight is exempt from the pairing
 * rule and is not budgeted, so it cannot influence what these tests are about.
 */
const NETWORK_COVERAGE = insight({
  audience: "network",
  severity: "positive",
  title: "Core-group commitments continue to come in",
});

function output(insights: Insight[]) {
  return judgeOutputSchema.safeParse({
    summary: "A plain-language read of overall plant health.",
    insights: [...insights, NETWORK_COVERAGE],
  });
}

test("one primary plus two supplements is accepted", () => {
  assert.equal(output([insight(), insight(), insight()]).success, true);
});

test("a fourth actionable planter insight is refused", () => {
  const result = output([insight(), insight(), insight(), insight()]);

  assert.equal(result.success, false);
  assert.match(
    result.error!.issues[0].message,
    /one primary focus and at most 2 supplements/
  );
  assert.deepEqual(result.error!.issues[0].path, ["insights"]);
});

test("positives are exempt — three work items plus encouragement is fine", () => {
  const result = output([
    insight(),
    insight(),
    insight(),
    insight({ severity: "positive" }),
    insight({ severity: "positive" }),
  ]);

  assert.equal(result.success, true);
});

test("the cap counts the PLANTER's list, not the network's", () => {
  // The network audience has its own rules (#482) and is not budgeted here.
  const result = output([
    insight(),
    insight({ audience: "network" }),
    insight({ audience: "network" }),
    insight({ audience: "network" }),
    insight({ audience: "network" }),
  ]);

  assert.equal(result.success, true);
});

test("the budget is one primary plus two", () => {
  assert.equal(PLANTER_FOCUS_BUDGET, 3);
});
