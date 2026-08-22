import assert from "node:assert/strict";
import { test } from "node:test";

import { NETWORK_VERDICT_PHRASES } from "./network-register";
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

// --- The budget and the pairing rule do not actually collide (#605) ---------
//
// They look like they do — pairing wants a planter insight per network concern,
// the budget allows three planter work items — and a first draft of this fix
// told the model so, in a sentence claiming "at most 3 non-positive network
// categories can ever be paired". That is false, and it contradicted the
// pairing message sitting in the SAME prompt. The budget counts only
// NON-POSITIVE planter insights, so a positive planter insight pairs a network
// concern for free. These two tests are the claim and its proof.

test("a positive planter insight pairs a network concern at no cost to the budget", () => {
  const CATEGORIES = [
    "critical_mass",
    "cohesion",
    "prayer",
    "generosity",
    "emerging_leadership",
  ] as const;

  const result = output([
    // Three planter work items — the budget, spent in full.
    insight(),
    insight(),
    insight(),
    // Five network concerns, each paired with a POSITIVE planter insight.
    ...CATEGORIES.flatMap((category) => [
      insight({ category, severity: "positive" }),
      insight({ audience: "network", category }),
    ]),
  ]);

  assert.equal(result.success, true);
});

test("the verdict correction shows the WHOLE ban-list, interpolated (#538/#605)", () => {
  const result = output([
    insight({
      audience: "network",
      title: "Core-group growth is failing",
      body: "The plant is behind and this needs to be addressed by the network.",
    }),
  ]);

  assert.equal(result.success, false);
  const message = result.error!.issues.map((i) => i.message).join("\n");

  // EVERY phrase, from the one array. Naming only the word that was caught let
  // a corrected draft reach for the next entry instead — EVAL-09, the fleet's
  // most troubled plant, spent all three drafts swapping banned words. The list
  // is interpolated rather than retyped, so it can never go short the way the
  // hand-kept rubric copy did (#538).
  for (const phrase of NETWORK_VERDICT_PHRASES) {
    assert.ok(
      message.includes(phrase),
      `the correction must name "${phrase}" — a phrase the model is held to but never shown is #538's exact failure`
    );
  }
  assert.match(message, /swapping the one above for another of them/);
});

test("when both rules fail, the correction names the free fix rather than a cap", () => {
  const result = output([
    insight(),
    insight(),
    insight(),
    insight(), // over budget
    insight({ audience: "network", category: "prayer" }), // unpaired
  ]);

  assert.equal(result.success, false);
  const combined = result.error!.issues.map((i) => i.message).join("\n");
  assert.match(combined, /one primary focus and at most 2 supplements/);
  assert.match(combined, /pairing rule failed too, and the two are not/);
  assert.match(combined, /costs nothing against it/);
  // The retracted claim must never come back: it is the one sentence that made
  // two messages in one prompt disagree.
  assert.doesNotMatch(combined, /can ever be paired/);
});
