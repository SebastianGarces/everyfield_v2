import assert from "node:assert/strict";
import { test } from "node:test";

import { findGrowthVocabularyViolations } from "./growth-vocabulary";
import type { Insight } from "./schema";

// ----------------------------------------------------------------------------
// The floor under the words "slowed" and "stalled" (#538 / C02).
//
// The fleet pass that produced this module found eight of twelve assessments
// calling growth stalled below the 28-day threshold, including a plant three
// days after a new commitment. These tests pin the two levels, the exemptions
// that keep the rule from over-firing, and the null case.
// ----------------------------------------------------------------------------

const THRESHOLDS = { slowedThresholdDays: 21, stalledThresholdDays: 28 };

function insight(overrides: Partial<Insight> = {}): Insight {
  return {
    audience: "planter",
    category: "critical_mass",
    severity: "watch",
    title: "Growth",
    body: "Some observation about the core group.",
    citedFacts: ["coreGroup.committedCount=22"],
    relatedArticleSlugs: [],
    ...overrides,
  };
}

test("'stalled' below 28 days is a violation", () => {
  const found = findGrowthVocabularyViolations(
    [insight({ title: "Core Group Growth Stalled" })],
    3,
    THRESHOLDS
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].level, "stalled");
  assert.equal(found[0].requiredDays, 28);
  assert.equal(found[0].actualDays, 3);
});

test("'stalled' at or above 28 days is allowed", () => {
  assert.deepEqual(
    findGrowthVocabularyViolations(
      [insight({ title: "Core Group Growth Stalled" })],
      31,
      THRESHOLDS
    ),
    []
  );
});

test("'momentum has slowed' needs 21 days, not 28", () => {
  // The whole point of two levels: at 23 days the softer word is available and
  // the stronger one is not.
  assert.deepEqual(
    findGrowthVocabularyViolations(
      [insight({ body: "Momentum has slowed over the past few weeks." })],
      23,
      THRESHOLDS
    ),
    []
  );
  assert.equal(
    findGrowthVocabularyViolations(
      [insight({ body: "Growth has stalled over the past few weeks." })],
      23,
      THRESHOLDS
    ).length,
    1
  );
});

test("below the slowed floor, neither word is available", () => {
  assert.equal(
    findGrowthVocabularyViolations(
      [insight({ body: "Momentum has slowed." })],
      10,
      THRESHOLDS
    ).length,
    1
  );
});

test("a null clock — nobody has ever committed — allows neither word", () => {
  // A plant with no core group has not stalled; it has not started.
  assert.equal(
    findGrowthVocabularyViolations(
      [insight({ title: "Growth Stalled" })],
      null,
      THRESHOLDS
    ).length,
    1
  );
});

test("only critical-mass insights are gated", () => {
  // "Vision-meeting cadence has stalled" is a claim about meetings, resting on
  // its own facts. This rule has nothing to say about it.
  assert.deepEqual(
    findGrowthVocabularyViolations(
      [
        insight({
          category: "vision_casting",
          title: "Vision Meeting Cadence Has Stalled",
        }),
      ],
      3,
      THRESHOLDS
    ),
    []
  );
});

test("a comparison is not a level claim", () => {
  // The rule bans asserting the LEVEL, not every use of the word "slow".
  assert.deepEqual(
    findGrowthVocabularyViolations(
      [insight({ body: "Growth is slower than the previous window." })],
      5,
      THRESHOLDS
    ),
    []
  );
});

test("the violation names the phrase, so a retry log is actionable", () => {
  const [found] = findGrowthVocabularyViolations(
    [insight({ body: "The core group has stagnant numbers." })],
    5,
    THRESHOLDS
  );
  assert.equal(found.phrase, "stagnant");
  assert.equal(found.title, "Growth");
});
