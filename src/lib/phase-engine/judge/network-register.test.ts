import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findNetworkRegisterViolations,
  findUnpairedNetworkCategories,
  findVerdictLanguage,
} from "./network-register";
import { judgeOutputSchema, type Insight } from "./schema";

// ----------------------------------------------------------------------------
// The network register (#482, C15/C16/C24/C25).
//
// Bryan on v0's network samples: "It sounds like an underperforming business
// unit." And on the order: "The planter should never discover the diagnosis
// through his overseer."
//
// The rubric says both rules in prose, which is what teaches the model. These
// are what stop a bad response being STORED — a violation fails the parse and
// the generation is retried.
// ----------------------------------------------------------------------------

function insight(over: Partial<Insight> = {}): Insight {
  return {
    audience: "network",
    category: "critical_mass",
    severity: "watch",
    title: "Core-group momentum has slowed",
    body: "The core group has been at 7 committed adults for 28 days. This may be worth a coaching conversation.",
    citedFacts: ["coreGroup.committedCount=7"],
    relatedArticleSlugs: [],
    ...over,
  };
}

// -- the ban-list -------------------------------------------------------------

test("the v0 sentence Bryan objected to is refused", () => {
  const found = findVerdictLanguage({
    title: "Core Group Growth Stagnation",
    body: "Intervention to boost growth is needed to reach the target of at least 50 adults.",
  });

  assert.deepEqual(
    found.map((v) => v.phrase),
    ["intervention"]
  );
});

test("the replacement Bryan wrote passes", () => {
  assert.deepEqual(
    findVerdictLanguage({
      title: "Core-group momentum has slowed",
      body: "This may be worth a coaching conversation around vision cadence, invitations, and follow-up.",
    }),
    []
  );
});

test("'critical mass' is the name of a lens and stays sayable", () => {
  // The ban on "critical" must not ban CSF-3. This is the one exception, and
  // it is why the scan is not a substring match.
  assert.deepEqual(
    findVerdictLanguage({
      title: "Critical mass is building",
      body: "The plant is progressing toward the critical mass benchmark.",
    }),
    []
  );

  // …but the verdict use of the same word is still caught.
  assert.equal(
    findVerdictLanguage({
      title: "Critical situation",
      body: "This plant is in a critical position.",
    }).length,
    1
  );
});

test("the ban applies to the network audience only", () => {
  // The planter is allowed to be told something is critical. It is their plant.
  const output = judgeOutputSchema.safeParse({
    summary: "A plain-language read of overall plant health.",
    insights: [
      insight({
        audience: "planter",
        title: "This is critical",
        body: "Intervention on your follow-up backlog is needed this week.",
      }),
      insight(),
    ],
  });

  assert.equal(output.success, true);
});

test("a verdict in network text fails the whole response", () => {
  const output = judgeOutputSchema.safeParse({
    summary: "A plain-language read of overall plant health.",
    insights: [
      insight({ audience: "planter" }),
      insight({
        title: "Growth stagnation",
        body: "Intervention to boost growth is needed.",
      }),
    ],
  });

  assert.equal(output.success, false);
  assert.match(
    output.error!.issues[0].message,
    /coach, never deliver a verdict/
  );
  assert.match(output.error!.issues[0].message, /"intervention"/);
});

// -- the pairing rule ---------------------------------------------------------

test("a network concern the planter was never shown is refused", () => {
  const output = judgeOutputSchema.safeParse({
    summary: "A plain-language read of overall plant health.",
    insights: [
      insight({ audience: "planter", category: "vision_casting" }),
      insight({ category: "critical_mass" }),
    ],
  });

  assert.equal(output.success, false);
  assert.match(
    output.error!.issues[0].message,
    /never discover a concern through their overseer/
  );
  assert.match(output.error!.issues[0].message, /critical_mass/);
});

test("the same concern in different words is exactly what is wanted", () => {
  const output = judgeOutputSchema.safeParse({
    summary: "A plain-language read of overall plant health.",
    insights: [
      insight({
        audience: "planter",
        category: "critical_mass",
        title: "Your core group has been flat for four weeks",
        body: "Two contributing signals are vision cadence and stale follow-up.",
      }),
      insight({ category: "critical_mass" }),
    ],
  });

  assert.equal(output.success, true);
});

test("a POSITIVE network insight needs no planter pair", () => {
  // The rule exists so a planter is not ambushed by a negative conclusion.
  // Being told the plant is doing well is not an ambush, and requiring a pair
  // would spend one of the three focus slots (#478) on something that is not
  // work.
  assert.deepEqual(
    findUnpairedNetworkCategories([
      insight({ audience: "planter", category: "vision_casting" }),
      insight({ category: "prayer", severity: "positive" }),
    ]),
    []
  );
});

test("every unpaired category is reported, sorted, not just the first", () => {
  assert.deepEqual(
    findUnpairedNetworkCategories([
      insight({ audience: "planter", category: "vision_casting" }),
      insight({ category: "prayer" }),
      insight({ category: "critical_mass" }),
      insight({ category: "critical_mass" }),
    ]),
    ["critical_mass", "prayer"]
  );
});

test("findNetworkRegisterViolations ignores planter text entirely", () => {
  assert.deepEqual(
    findNetworkRegisterViolations([
      insight({ audience: "planter", body: "Intervention needed." }),
    ]),
    []
  );
});
