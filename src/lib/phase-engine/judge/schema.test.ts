import assert from "node:assert/strict";
import { test } from "node:test";

import { makeEvidence } from "@/lib/phase-engine/signals/testing";

import { NETWORK_VERDICT_PHRASES } from "./network-register";
import {
  judgeOutputSchemaFor,
  PLANTER_FOCUS_BUDGET,
  type Insight,
} from "./schema";
import { FIXTURE_JUDGE_SCHEMA } from "./testing";

/** The fixture plant's schema — this suite is not about the evidence rule. */
const judgeOutputSchema = FIXTURE_JUDGE_SCHEMA;

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
  // FIVE LENSES THE FIXTURE PLANT ACTUALLY MEASURES. This list used to name
  // prayer and generosity, which NOTHING measures for any plant
  // (signals/evidence.ts) — so the free-pairing device was proven only where
  // #635 now refuses it, against a hand-written profile no plant could produce.
  // The device is real; it just belongs to the lenses that know something.
  const CATEGORIES = [
    "critical_mass",
    "cohesion",
    "vision_casting",
    "shared_ownership",
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

// --- Unknown is not healthy (#483 C17, enforced by #635) --------------------
//
// The rubric has said this since v1: an unknown lens produces at most an
// insufficient-evidence statement, "never a quiet pass, a blank, or an
// encouraging remark". It said it in prose only, and on the fleet's cold-start
// plant — where every one of the eight lenses is unknown at once — seven lenses
// obeyed and CSF-1 did not. The tile read "Vision casting · GOING WELL · Based
// on no activity recorded yet".

/** The cold-start plant: nothing measured and nothing attested, anywhere. */
const NOTHING_KNOWN = makeEvidence({
  vision_casting: "unknown",
  shared_ownership: "unknown",
  critical_mass: "unknown",
  cohesion: "unknown",
  prayer: "unknown",
  generosity: "unknown",
  emerging_leadership: "unknown",
  comprehensive_training: "unknown",
});

/**
 * Audience coverage for a cold-start output, and nothing else. `onboarding` is
 * not one of the eight lenses, and a "positive" network insight is exempt from
 * the pairing rule — so this item cannot influence what these tests are about.
 */
const COLD_START_NETWORK_COVERAGE = insight({
  audience: "network",
  category: "onboarding",
  severity: "positive",
  title: "This plant has just finished setting up",
  citedFacts: ["isColdStart=true"],
});

function coldStartOutput(insights: Insight[]) {
  return judgeOutputSchemaFor(NOTHING_KNOWN).safeParse({
    summary: "This plant has not recorded any activity yet.",
    insights,
  });
}

test("a positive insight in a lens that knows nothing is refused", () => {
  const result = coldStartOutput([
    insight({
      category: "vision_casting",
      severity: "positive",
      title: "Vision casting is going well",
      body: "Your vision casting looks healthy so far — keep the rhythm going.",
      citedFacts: ["isColdStart=true"],
    }),
    COLD_START_NETWORK_COVERAGE,
  ]);

  assert.equal(result.success, false);
  const message = result.error!.issues.map((i) => i.message).join("\n");
  assert.match(message, /Absence of evidence is not evidence of health/);
  // Both sides of the comparison and the way out (#605): the blind lenses, the
  // insight that claimed otherwise, and the severity to reach for instead.
  assert.match(message, /vision_casting/);
  assert.match(message, /"Vision casting is going well"/);
  assert.match(message, /at most an insufficient-evidence statement/);
});

test("an insufficient-evidence statement on the same lens is accepted", () => {
  // The sentence #483 exists to produce is severity "info", not "positive".
  // Refusing it too would trade a false pass for the blank it replaced.
  const result = coldStartOutput([
    insight({
      category: "prayer",
      severity: "info",
      title: "We can't see your prayer rhythm yet",
      body: "We don't have enough information to assess prayer health yet. Attesting your rhythm gives the next assessment something to read.",
      citedFacts: ["manual.isEmpty=true"],
    }),
    COLD_START_NETWORK_COVERAGE,
  ]);

  assert.equal(result.success, true);
});

test("a positive insight in a lens that measures something is untouched", () => {
  // The rule is about what the LENS knows, not about the word "positive".
  const result = output([
    insight({
      category: "critical_mass",
      severity: "positive",
      title: "Core-group growth is steady",
    }),
  ]);

  assert.equal(result.success, true);
});

test("cross-cutting categories are not lenses and keep their positives", () => {
  // `onboarding`, `phase_progress`, `follow_up` and `launch_readiness` have no
  // evidence profile of their own — they are not one of the eight — so a
  // cold-start plant may still be encouraged about getting started (PE-018).
  const result = coldStartOutput([
    insight({
      category: "onboarding",
      severity: "positive",
      title: "You've finished setting up your plant",
      citedFacts: ["isColdStart=true"],
    }),
    COLD_START_NETWORK_COVERAGE,
  ]);

  assert.equal(result.success, true);
});
