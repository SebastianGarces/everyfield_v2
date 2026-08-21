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

function output(insights: Insight[]) {
  return judgeOutputSchema.safeParse({
    summary: "A plain-language read of overall plant health.",
    insights,
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
