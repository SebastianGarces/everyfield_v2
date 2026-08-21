import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ATTESTATION_LEAVES,
  type AttestationLeafName,
} from "./attestation-citation";
import {
  citedFactPath,
  formatCitedFact,
  formatCitedFacts,
  parseCitedFact,
} from "./fact-format";
import { renderPhrase, toWords } from "./fact-phrases";

/** Every leaf `manual.attestations.#.<leaf>` is allowed to be, from the table. */
const ATTESTATION_LEAF_NAMES = Object.keys(
  ATTESTATION_LEAVES
) as AttestationLeafName[];

// The shape the issue is about: a dotted path, a camelCase leaf, an `=`.
// Nothing this module renders may match it.
const LEDGER_SYNTAX = /[a-z]+\.[a-zA-Z]+=/;
const CAMEL_CASE = /[a-z][A-Z]/;

// ----------------------------------------------------------------------------
// parseCitedFact
// ----------------------------------------------------------------------------

test("parseCitedFact splits on the first = only", () => {
  assert.deepEqual(parseCitedFact("ministryRoles.filledCount=4"), {
    path: "ministryRoles.filledCount",
    value: "4",
  });
  assert.deepEqual(parseCitedFact("manual.byKey.note=a=b"), {
    path: "manual.byKey.note",
    value: "a=b",
  });
});

test("parseCitedFact tolerates a bare key with no value", () => {
  assert.deepEqual(parseCitedFact("coreGroup.isEmpty"), {
    path: "coreGroup.isEmpty",
    value: null,
  });
});

// ----------------------------------------------------------------------------
// AC 1 — no field path, camelCase identifier or `=` survives.
// ----------------------------------------------------------------------------

test("the issue's example renders as a readable phrase, not field syntax", () => {
  const rendered = formatCitedFact("ministryRoles.filledCount=4");

  assert.equal(rendered, "4 of 8 ministry roles filled");
  assert.doesNotMatch(rendered, LEDGER_SYNTAX);
  assert.doesNotMatch(rendered, CAMEL_CASE);
  assert.ok(!rendered.includes("="));
});

test("no known fact renders a path, a camelCase identifier or an =", () => {
  const facts = [
    "snapshotVersion=1",
    "currentPhase=2",
    "isColdStart=false",
    "generatedAt=2026-07-20T10:00:00.000Z",
    "churchId=6f1d2c3b-4a5e-4f60-8b71-9c2d3e4f5a6b",
    "coreGroup.committedCount=22",
    "coreGroup.launchTeamCount=1",
    "coreGroup.growthDelta=-2",
    "coreGroup.growthWindowDays=30",
    "coreGroup.isEmpty=false",
    "visionMeetings.totalCompleted=3",
    "visionMeetings.lastMeetingAt=2026-07-01T18:00:00.000Z",
    "visionMeetings.daysSinceLastMeeting=21",
    "visionMeetings.averageCadenceDays=14",
    "visionMeetings.latestAttendance=12",
    "visionMeetings.previousAttendance=1",
    "visionMeetings.attendanceTrend=down",
    "visionMeetings.isEmpty=false",
    "followUp.openCount=5",
    "followUp.stalestDays=40",
    "followUp.staleCount=1",
    "followUp.staleThresholdDays=14",
    "followUp.isEmpty=false",
    "ministryRoles.filledCount=4",
    "ministryRoles.totalRoles=8",
    "ministryRoles.roles.2.key=small_groups",
    "ministryRoles.roles.2.label=Small groups",
    "ministryRoles.roles.2.teamPresent=true",
    "ministryRoles.roles.2.filled=false",
    "ministryRoles.isEmpty=false",
    "leadership.candidates[0].personId=6f1d2c3b-4a5e-4f60-8b71-9c2d3e4f5a6b",
    "leadership.candidates.0.status=core_group",
    "leadership.candidates.0.tenureDays=90",
    "leadership.candidates.0.meetingsAttended=1",
    "leadership.candidates.0.activeMemberships=2",
    "leadership.candidates.0.hasCommitment=true",
    "leadership.candidates.0.leadsTeam=false",
    "leadership.isEmpty=false",
    "training.programCount=3",
    "training.requiredProgramCount=2",
    "training.completionCount=7",
    "training.requiredCompletionRate=0.5",
    "training.isEmpty=false",
    "launch.launchDate=2026-09-13",
    "launch.daysUntilLaunch=48",
    "launch.isPastDue=false",
    "launch.isEmpty=false",
    "manual.byKey.financial_base_established=true",
    "manual.byKey.values_documented=false",
    "manual.attestations.0.signalKey=systems_tested",
    "manual.attestations.0.value=true",
    "manual.attestations.0.attestedAt=2026-07-19T09:30:00.000Z",
    "manual.isEmpty=false",
  ];

  for (const fact of facts) {
    const rendered = formatCitedFact(fact);
    assert.ok(rendered.length > 0, `${fact} rendered nothing`);
    assert.doesNotMatch(rendered, LEDGER_SYNTAX, `${fact} → ${rendered}`);
    assert.doesNotMatch(rendered, CAMEL_CASE, `${fact} → ${rendered}`);
    assert.ok(!rendered.includes("="), `${fact} → ${rendered}`);
    assert.ok(!rendered.includes("_"), `${fact} → ${rendered}`);
  }
});

// ----------------------------------------------------------------------------
// AC 3 — the underlying number survives humanising.
// ----------------------------------------------------------------------------

test("the underlying number is still shown", () => {
  const cases: [string, string][] = [
    ["coreGroup.committedCount=22", "22"],
    ["ministryRoles.filledCount=4", "4"],
    ["visionMeetings.daysSinceLastMeeting=21", "21"],
    ["visionMeetings.totalCompleted=3", "3"],
    ["followUp.staleCount=6", "6"],
    ["launch.daysUntilLaunch=48", "48"],
    ["training.completionCount=7", "7"],
    ["currentPhase=2", "2"],
  ];

  for (const [fact, value] of cases) {
    assert.ok(
      formatCitedFact(fact).includes(value),
      `${fact} lost its value: ${formatCitedFact(fact)}`
    );
  }
});

test("singular and plural each read correctly", () => {
  assert.equal(
    formatCitedFact("coreGroup.committedCount=1"),
    "1 committed core-group member"
  );
  assert.equal(
    formatCitedFact("coreGroup.committedCount=2"),
    "2 committed core-group members"
  );
  assert.equal(formatCitedFact("followUp.openCount=0"), "0 open follow-ups");
});

test("a signed delta reads as growth or shrinkage, keeping the number", () => {
  assert.equal(
    formatCitedFact("coreGroup.growthDelta=3"),
    "3 more committed than the window before"
  );
  assert.equal(
    formatCitedFact("coreGroup.growthDelta=-2"),
    "2 fewer committed than the window before"
  );
  assert.match(formatCitedFact("coreGroup.growthDelta=0"), /0/);
});

test("a launch countdown reads correctly on both sides of the date", () => {
  assert.equal(
    formatCitedFact("launch.daysUntilLaunch=48"),
    "48 days until launch"
  );
  assert.equal(
    formatCitedFact("launch.daysUntilLaunch=-3"),
    "3 days past your launch date"
  );
});

test("a completion rate reads as a percentage", () => {
  assert.equal(
    formatCitedFact("training.requiredCompletionRate=0.5"),
    "50% of required training complete"
  );
});

test("a date renders in the app's pinned zone, not an ISO string", () => {
  assert.match(
    formatCitedFact("launch.launchDate=2026-09-13"),
    /^a launch date of \w{3}, Sep 13, 2026$/
  );
});

// ----------------------------------------------------------------------------
// Person-level facts stay anonymous.
// ----------------------------------------------------------------------------

test("a personId citation names no identifier", () => {
  const rendered = formatCitedFact(
    "leadership.candidates[0].personId=6f1d2c3b-4a5e-4f60-8b71-9c2d3e4f5a6b"
  );
  assert.equal(rendered, "one leadership candidate");
  assert.ok(!rendered.includes("6f1d2c3b"));
});

test("bracketed and dotted array indices reach the same phrase", () => {
  assert.equal(
    formatCitedFact("leadership.candidates[3].leadsTeam=true"),
    formatCitedFact("leadership.candidates.3.leadsTeam=true")
  );
});

// ----------------------------------------------------------------------------
// AC 4 — an unknown shape degrades readably instead of throwing.
// ----------------------------------------------------------------------------

test("an unknown fact key degrades to a readable label and value", () => {
  const rendered = formatCitedFact("generosity.financialBaseInPlace=false");

  assert.equal(rendered, "financial base in place (generosity): no");
  assert.doesNotMatch(rendered, LEDGER_SYNTAX);
  assert.doesNotMatch(rendered, CAMEL_CASE);
  assert.ok(!rendered.includes("="));
});

test("an unknown fact keeps its number", () => {
  assert.equal(
    formatCitedFact("prayer.weeklyGatheringCount=12"),
    "weekly gathering count (prayer): 12"
  );
});

test("an unknown single-segment key still reads", () => {
  assert.equal(formatCitedFact("baptismsRecorded=4"), "baptisms recorded: 4");
});

test("an unknown key with an opaque identifier shows the label alone", () => {
  assert.equal(
    formatCitedFact("mystery.ownerId=6f1d2c3b-4a5e-4f60-8b71-9c2d3e4f5a6b"),
    "owner id (mystery)"
  );
});

test("an unknown key with an enum value is de-camelised", () => {
  assert.equal(
    formatCitedFact("mystery.stage=awaitingReview"),
    "stage (mystery): awaiting review"
  );
});

test("a null or missing value degrades rather than printing null", () => {
  assert.equal(
    formatCitedFact("mystery.thing=null"),
    "thing (mystery): not recorded"
  );
  assert.equal(formatCitedFact("mystery.thing"), "thing (mystery)");
});

test("a known fact with an unexpected value type falls back instead of lying", () => {
  assert.equal(
    formatCitedFact("coreGroup.committedCount=many"),
    "committed count (core group): many"
  );
});

test("malformed citations never throw", () => {
  const malformed = [
    "",
    "   ",
    "=",
    "=5",
    "....",
    "...=...",
    "[0]",
    "a".repeat(500),
    "coreGroup..committedCount=4",
  ];

  for (const fact of malformed) {
    assert.doesNotThrow(() => formatCitedFact(fact), fact);
    const rendered = formatCitedFact(fact);
    assert.doesNotMatch(rendered, LEDGER_SYNTAX, fact);
    assert.ok(!rendered.includes("="), fact);
  }
});

// A citation is LLM-authored, so its path segments are attacker-shaped strings.
// Both phrase vocabularies used to be indexed as objects, which reaches
// `Object.prototype`: `constructor=4` and `valueOf=1` threw out of BOTH public
// functions (a crashed `/phase` — all three surfaces call them), `toString=x`
// printed "[object Object]", and `manual.byKey.toString` read back a native
// function's source. Both tables are `Map`s now; this pins the behaviour, not
// the mechanism.
test("a path that collides with an Object.prototype key still degrades", () => {
  const collisions = [
    "constructor=4",
    "valueOf=1",
    "__proto__=x",
    "toString=x",
    "hasOwnProperty=true",
    "constructor",
    "manual.byKey.constructor=true",
    "manual.byKey.toString=true",
    "manual.byKey.__proto__",
    "manual.attestations.0.value=true",
  ];

  for (const fact of collisions) {
    assert.doesNotThrow(() => formatCitedFact(fact), fact);
    assert.doesNotThrow(() => formatCitedFacts([fact]), fact);

    const rendered = formatCitedFact(fact);
    const [line] = formatCitedFacts([fact]);
    for (const phrase of [rendered, line]) {
      assert.equal(typeof phrase, "string", fact);
      assert.ok(phrase.length > 0, `${fact} rendered nothing`);
      assert.ok(!phrase.includes("[object"), `${fact} → ${phrase}`);
      assert.ok(!phrase.includes("native code"), `${fact} → ${phrase}`);
      assert.doesNotMatch(phrase, LEDGER_SYNTAX, `${fact} → ${phrase}`);
      assert.doesNotMatch(phrase, CAMEL_CASE, `${fact} → ${phrase}`);
      assert.ok(!phrase.includes("="), `${fact} → ${phrase}`);
    }
  }
});

// ----------------------------------------------------------------------------
// formatCitedFacts — the column-level entry point both surfaces call.
// ----------------------------------------------------------------------------

test("formatCitedFacts humanises a whole column in order", () => {
  assert.deepEqual(
    formatCitedFacts([
      "ministryRoles.filledCount=4",
      "coreGroup.committedCount=22",
    ]),
    ["4 of 8 ministry roles filled", "22 committed core-group members"]
  );
});

// ----------------------------------------------------------------------------
// Duplicate anonymous citations aggregate to a count (ruling on #154).
// ----------------------------------------------------------------------------

test("formatCitedFacts counts rows that humanise identically", () => {
  assert.deepEqual(
    formatCitedFacts([
      "leadership.candidates[0].personId=6f1d2c3b-4a5e-4f60-8b71-9c2d3e4f5a6b",
      "leadership.candidates[1].personId=7a2e3d4c-5b6f-4071-9c82-ad3e4f5b6c7d",
    ]),
    ["2 leadership candidates"]
  );
});

test("three rows read as a count, not a repeat and not one", () => {
  assert.deepEqual(
    formatCitedFacts([
      "leadership.candidates.0.personId=6f1d2c3b-4a5e-4f60-8b71-9c2d3e4f5a6b",
      "leadership.candidates.1.personId=7a2e3d4c-5b6f-4071-9c82-ad3e4f5b6c7d",
      "leadership.candidates.2.personId=8b3f4e5d-6c70-4182-ad93-be4f5a6c7d8e",
    ]),
    ["3 leadership candidates"]
  );
});

test("a lone anonymous citation keeps the singular copy", () => {
  assert.deepEqual(
    formatCitedFacts(["leadership.candidates.0.tenureDays=90"]),
    ["one leadership candidate 90 days in"]
  );
});

test("a counted phrase pluralises the whole clause, not just the subject", () => {
  assert.deepEqual(
    formatCitedFacts([
      "leadership.candidates.0.tenureDays=90",
      "leadership.candidates.1.tenureDays=90",
      "leadership.candidates.2.tenureDays=90",
    ]),
    ["3 leadership candidates each 90 days in"]
  );
  assert.deepEqual(
    formatCitedFacts([
      "leadership.candidates.0.leadsTeam=true",
      "leadership.candidates.1.leadsTeam=true",
    ]),
    ["2 leadership candidates already leading teams"]
  );
  assert.deepEqual(
    formatCitedFacts([
      "ministryRoles.roles.0.filled=false",
      "ministryRoles.roles.1.filled=false",
      "ministryRoles.roles.2.filled=false",
    ]),
    ["no leaders yet for 3 ministry roles"]
  );
});

test("a count keeps the underlying number visible and leaks no syntax", () => {
  const [rendered] = formatCitedFacts([
    "leadership.candidates.0.meetingsAttended=4",
    "leadership.candidates.1.meetingsAttended=4",
  ]);

  assert.equal(rendered, "2 leadership candidates each at 4 vision meetings");
  assert.doesNotMatch(rendered, LEDGER_SYNTAX);
  assert.doesNotMatch(rendered, CAMEL_CASE);
  assert.ok(!rendered.includes("="));
});

test("the same row cited twice is one row, not two", () => {
  assert.deepEqual(
    formatCitedFacts([
      "leadership.candidates[0].personId=6f1d2c3b-4a5e-4f60-8b71-9c2d3e4f5a6b",
      "leadership.candidates.0.personId=6f1d2c3b-4a5e-4f60-8b71-9c2d3e4f5a6b",
    ]),
    ["one leadership candidate"]
  );
});

test("rows that differ still read as separate phrases", () => {
  assert.deepEqual(
    formatCitedFacts([
      "leadership.candidates.0.tenureDays=90",
      "leadership.candidates.1.tenureDays=12",
    ]),
    [
      "one leadership candidate 90 days in",
      "one leadership candidate 12 days in",
    ]
  );
});

test("a phrase that names its row groups without counting", () => {
  // `roles.#.key` and `roles.#.label` name the SAME role two ways; counting
  // them would claim two roles where there is one.
  assert.deepEqual(
    formatCitedFacts([
      "ministryRoles.roles.2.key=small_groups",
      "ministryRoles.roles.2.label=Small groups",
    ]),
    ["the small groups ministry role"]
  );
});

test("formatCitedFacts degrades a malformed jsonb column to nothing", () => {
  assert.deepEqual(formatCitedFacts(null), []);
  assert.deepEqual(formatCitedFacts(undefined), []);
  assert.deepEqual(formatCitedFacts("coreGroup.committedCount=4"), []);
  assert.deepEqual(formatCitedFacts({ a: 1 }), []);
  assert.deepEqual(formatCitedFacts([null, 4, "", "   "]), []);
});

// ----------------------------------------------------------------------------
// One attestation, two legal spellings, one sentence (#319, 2026-08-10).
//
// The snapshot writes every manual attestation to BOTH `manual.byKey.<signal>`
// and `manual.attestations[]`, so a citation of either names the same fact. The
// caller resolves row N to its signal against the snapshot and passes it here;
// with it, the two spellings must read identically.
// ----------------------------------------------------------------------------

test("a resolved attestation reads exactly as its keyed spelling", () => {
  for (const [signalKey, expected] of [
    [
      "financial_base_established",
      "you confirmed your launch funding is viable",
    ],
    ["values_documented", "you confirmed your core values are documented"],
    ["prayer_leader_assigned", "you confirmed a prayer leader is assigned"],
    ["systems_tested", "you confirmed your launch systems have been tested"],
  ] as const) {
    const keyed = formatCitedFact(`manual.byKey.${signalKey}=true`);
    const arrayForm = formatCitedFact("manual.attestations.1.value=true", {
      signalKey,
    });

    assert.equal(keyed, expected);
    assert.equal(arrayForm, keyed, `${signalKey} read two ways`);
  }
});

test("a resolved attestation carries the negative the same way", () => {
  assert.equal(
    formatCitedFact("manual.attestations.0.value=false", {
      signalKey: "systems_tested",
    }),
    formatCitedFact("manual.byKey.systems_tested=false")
  );
  assert.equal(
    formatCitedFact("manual.attestations.0.value=false", {
      signalKey: "systems_tested",
    }),
    "you have not confirmed your launch systems have been tested"
  );
});

test("the bracketed index spelling resolves the same as the dotted one", () => {
  assert.equal(
    formatCitedFact("manual.attestations[2].value=true", {
      signalKey: "values_documented",
    }),
    "you confirmed your core values are documented"
  );
});

test("citing the signal key itself names the fact without asserting it", () => {
  // The array-form twin of a BARE `manual.byKey.<signal>` citation: it says
  // which signal, and nothing about its answer.
  assert.equal(
    formatCitedFact("manual.attestations.0.signalKey=values_documented", {
      signalKey: "values_documented",
    }),
    formatCitedFact("manual.byKey.values_documented")
  );
  assert.equal(
    formatCitedFact("manual.attestations.0.signalKey=values_documented", {
      signalKey: "values_documented",
    }),
    "your core values are documented"
  );
});

test("a resolved attestation date names its signal and keeps the date", () => {
  const phrase = formatCitedFact(
    "manual.attestations.0.attestedAt=2026-07-19T09:30:00.000Z",
    { signalKey: "prayer_leader_assigned" }
  );

  assert.match(phrase, /a prayer leader is assigned/);
  // The date is evidence; humanising must not spend it to buy uniformity.
  assert.match(phrase, /2026/);
  assert.doesNotMatch(phrase, CAMEL_CASE);
  assert.ok(!phrase.includes("_"));
});

test("an unresolved attestation keeps the generic phrasing, never a guess", () => {
  // No context at all, an explicitly unresolved row, and a blank key are the
  // same case: the module knows only what the citation says on its face.
  for (const context of [
    undefined,
    { signalKey: null },
    { signalKey: "   " },
  ]) {
    assert.equal(
      formatCitedFact("manual.attestations.4.value=true", context),
      "something you confirmed"
    );
  }
});

test("a signal key is ignored on paths that are not attestation rows", () => {
  const context = { signalKey: "financial_base_established" };

  assert.equal(
    formatCitedFact("coreGroup.committedCount=22", context),
    formatCitedFact("coreGroup.committedCount=22")
  );
  assert.equal(
    formatCitedFact("manual.byKey.values_documented=true", context),
    "you confirmed your core values are documented"
  );
  assert.equal(
    formatCitedFact("manual.isEmpty=false", context),
    "self-reports on record"
  );
});

test("an unknown signal still degrades to words, never to ledger syntax", () => {
  const phrase = formatCitedFact("manual.attestations.0.value=true", {
    signalKey: "future_signal_nobody_wrote_a_clause_for",
  });

  assert.doesNotMatch(phrase, LEDGER_SYNTAX);
  assert.doesNotMatch(phrase, CAMEL_CASE);
  assert.ok(!phrase.includes("_"), phrase);
  assert.match(phrase, /you confirmed/);
});

// ----------------------------------------------------------------------------
// The PLURAL formatter reads that same one voice (#319, ruled 2026-08-12).
//
// Round 2 unified the drill-down (`formatCitedFact` + `signalKey`) and stopped
// there, so the insight card and the CSF scorecard — which render a whole
// column through `formatCitedFacts` — still said "something you confirmed"
// about the fact the drill-down named, on the same page. Option A extends the
// unification to them via a read-layer-resolved `CitedFactSignals` map, with one
// hard limit: MIXED signals collapse to a count. The counting path stays a
// counter, never a lister.
// ----------------------------------------------------------------------------

/** The map key both sides agree on, so no test invents its own spelling. */
const FINANCIAL_BASE = {
  [citedFactPath("manual.attestations.1.value=true")]:
    "financial_base_established",
} as const;

test("citedFactPath strips the value and unifies both index spellings", () => {
  assert.equal(
    citedFactPath("manual.attestations[1].value=true"),
    "manual.attestations.1.value"
  );
  assert.equal(
    citedFactPath("manual.attestations.1.value=true"),
    "manual.attestations.1.value"
  );
  assert.equal(
    citedFactPath(" manual.byKey.systems_tested "),
    "manual.byKey.systems_tested"
  );
});

test("the formerly-divergent pair now agrees for a single resolved signal", () => {
  // Reproduced verbatim from the spec-question on PR 394. Before this change:
  //   formatCitedFacts([arrayForm])            -> ["something you confirmed"]
  //   formatCitedFact(arrayForm, { signalKey}) -> "you confirmed your financial
  //                                                base is in place"
  const arrayForm = "manual.attestations.1.value=true";
  const drillDown = formatCitedFact(arrayForm, {
    signalKey: "financial_base_established",
  });

  assert.deepEqual(formatCitedFacts([arrayForm], FINANCIAL_BASE), [drillDown]);
  assert.deepEqual(formatCitedFacts([arrayForm], FINANCIAL_BASE), [
    "you confirmed your launch funding is viable",
  ]);
});

test("all three surfaces read one citation as one sentence", () => {
  // The scorecard tile / insight card (plural), the drill-down (singular) and
  // the keyed spelling of the very same fact.
  const [plural] = formatCitedFacts(
    ["manual.attestations.1.value=true"],
    FINANCIAL_BASE
  );

  assert.equal(
    plural,
    formatCitedFact("manual.attestations.1.value=true", {
      signalKey: "financial_base_established",
    })
  );
  assert.equal(
    plural,
    formatCitedFact("manual.byKey.financial_base_established=true")
  );
});

test("both spellings of ONE attestation render one line, not the same line twice", () => {
  assert.deepEqual(
    formatCitedFacts(
      [
        "manual.byKey.financial_base_established=true",
        "manual.attestations.1.value=true",
      ],
      FINANCIAL_BASE
    ),
    ["you confirmed your launch funding is viable"]
  );
});

test("MIXED signals collapse to a count — the counting path never lists", () => {
  const signals = {
    "manual.attestations.0.value": "values_documented",
    "manual.attestations.1.value": "financial_base_established",
    "manual.attestations.2.value": "systems_tested",
  };
  const [line] = formatCitedFacts(
    [
      "manual.attestations.0.value=true",
      "manual.attestations.1.value=true",
      "manual.attestations.2.value=true",
    ],
    signals
  );

  assert.equal(line, "3 things you confirmed");
  // Not one signal is named: the moment two disagree, this is a count.
  assert.doesNotMatch(line, /core values|financial base|launch systems/);
});

test("the SPELLING never decides whether a pair counts or lists", () => {
  // The class the ruling is about, at N>1. Keying the fold on the rendered
  // phrase used to count the array pair ("2 things you confirmed") and LIST the
  // keyed pair (two named sentences) — the same spelling-decides-the-wording
  // harm the single-signal case was fixed for, surviving one citation later.
  const signals = {
    "manual.attestations.0.value": "values_documented",
    "manual.attestations.1.value": "financial_base_established",
  };
  const asRows = formatCitedFacts(
    ["manual.attestations.0.value=true", "manual.attestations.1.value=true"],
    signals
  );
  const asKeys = formatCitedFacts([
    "manual.byKey.values_documented=true",
    "manual.byKey.financial_base_established=true",
  ]);

  assert.deepEqual(asRows, ["2 things you confirmed"]);
  assert.deepEqual(asKeys, asRows);
});

test("an attestation cited BOTH ways beside another counts as two things", () => {
  // Not ["2 things you confirmed", "you confirmed your core values are
  // documented"]: printing the named one beside a count that already includes
  // it is the doubled evidence this ruling exists to stop.
  assert.deepEqual(
    formatCitedFacts(
      [
        "manual.byKey.values_documented=true",
        "manual.attestations.0.value=true",
        "manual.attestations.1.value=true",
      ],
      {
        "manual.attestations.0.value": "values_documented",
        "manual.attestations.1.value": "financial_base_established",
      }
    ),
    ["2 things you confirmed"]
  );
});

test("one attestation cited both ways is one thing, not a pair", () => {
  // The counterpart of the case above: the SAME signal, two spellings, one
  // citation — so the group is a single member and reads as its own sentence.
  assert.deepEqual(
    formatCitedFacts(
      [
        "manual.byKey.values_documented=true",
        "manual.attestations.0.value=true",
      ],
      { "manual.attestations.0.value": "values_documented" }
    ),
    ["you confirmed your core values are documented"]
  );
});

test("a lone keyed attestation still names its fact", () => {
  // Folding the keyed spelling into the array spelling's group must not cost
  // the singular its sentence.
  assert.deepEqual(formatCitedFacts(["manual.byKey.systems_tested=true"]), [
    "you confirmed your launch systems have been tested",
  ]);
  assert.deepEqual(formatCitedFacts(["manual.byKey.systems_tested=false"]), [
    "you have not confirmed your launch systems have been tested",
  ]);
  assert.deepEqual(formatCitedFacts(["manual.byKey.systems_tested"]), [
    "your launch systems have been tested",
  ]);
});

test("a confirmed attestation and an unconfirmed one are not one count", () => {
  // Two different assertions are two groups: collapsing them would say "2
  // things you confirmed" about something the planter did NOT confirm.
  assert.deepEqual(
    formatCitedFacts([
      "manual.byKey.values_documented=true",
      "manual.byKey.systems_tested=false",
    ]),
    [
      "you confirmed your core values are documented",
      "you have not confirmed your launch systems have been tested",
    ]
  );
});

test("one resolved beside one unresolved is MIXED, so it counts too", () => {
  assert.deepEqual(
    formatCitedFacts(
      ["manual.attestations.1.value=true", "manual.attestations.9.value=true"],
      FINANCIAL_BASE
    ),
    ["2 things you confirmed"]
  );
});

test("a column with no signals is byte-for-byte what it was before", () => {
  // The map is additive: every caller that has no snapshot to resolve against
  // — the marketing fixtures, and anything predating the ruling — is untouched.
  const column = [
    "manual.attestations.0.value=true",
    "manual.attestations.1.value=true",
    "coreGroup.committedCount=22",
  ];

  assert.deepEqual(formatCitedFacts(column), [
    "2 things you confirmed",
    "22 committed core-group members",
  ]);
  assert.deepEqual(formatCitedFacts(column), formatCitedFacts(column, {}));
});

test("a signal is ignored on a path that is not an attestation row", () => {
  assert.deepEqual(
    formatCitedFacts(["coreGroup.committedCount=22"], {
      "coreGroup.committedCount": "financial_base_established",
    }),
    ["22 committed core-group members"]
  );
});

test("the resolved signal reaches the other two attestation paths as well", () => {
  assert.deepEqual(
    formatCitedFacts(
      ["manual.attestations.1.signalKey=financial_base_established"],
      {
        "manual.attestations.1.signalKey": "financial_base_established",
      }
    ),
    ["your launch funding is viable"]
  );

  const [dated] = formatCitedFacts(
    ["manual.attestations.1.attestedAt=2026-07-19T09:30:00.000Z"],
    { "manual.attestations.1.attestedAt": "financial_base_established" }
  );
  assert.match(dated, /your launch funding is viable/);
  assert.match(dated, /2026/);
});

test("a valueless attestation row reads as its signal on BOTH paths", () => {
  // ONE dispatcher decides what a citation asserts, so the fold cannot land on
  // a label the drill-down never shows. While the two paths were written
  // separately this column read "value (manual attestations)" — the generic
  // fallback — beside a drill-down that already said the sentence below.
  const fact = "manual.attestations.1.value";
  const signals = {
    "manual.attestations.1.value": "financial_base_established",
  };

  assert.deepEqual(formatCitedFacts([fact], signals), [
    formatCitedFact(fact, { signalKey: "financial_base_established" }),
  ]);
  assert.deepEqual(formatCitedFacts([fact], signals), [
    "your launch funding is viable",
  ]);
});

// ----------------------------------------------------------------------------
// The fold is keyed on the SIGNAL, at EVERY leaf and in EVERY spelling
// (round-4 regression, #319).
//
// The round-3 code keyed the fold on the RENDERED PHRASE, and two of the four
// attestation templates bake the signal (`signalKey`) or the date
// (`attestedAt`) into that phrase. So two distinct attestations never shared a
// group, every group held exactly one member, and the counting path printed each
// one's specific sentence — the counter had become a LISTER on three of the four
// leaves, and the bare array `signalKey` spelling fell out of the templates
// entirely and printed the ledger's own shape.
//
// The property under test is the one the ruling is about: THE SPELLING MUST NOT
// DECIDE THE WORDING, at N=2 as well as at N=1. Every case below is TWO DISTINCT
// resolved signals, and every case must answer with ONE count line that names
// neither of them.
// ----------------------------------------------------------------------------

/**
 * Two different attestations, resolved on EVERY leaf the table declares.
 *
 * Derived from `ATTESTATION_LEAVES` rather than hand-listed: a fourth leaf joins
 * this fixture — and every case driven off it below — by existing.
 */
const TWO_SIGNALS: Record<string, string> = Object.fromEntries(
  ATTESTATION_LEAF_NAMES.flatMap((leaf) => [
    [`manual.attestations.0.${leaf}`, "values_documented"],
    [`manual.attestations.1.${leaf}`, "financial_base_established"],
  ])
);

/** Neither signal may be named once two of them are in one group. */
const NAMES_A_SIGNAL = /core values|financial base/;

/** The ledger-shaped label a valueless array `signalKey` used to render as. */
const LEAKED_LABEL = "signal key (manual attestations)";

/** The ledger-shaped label ANY leaf would render as if it fell to the fallback. */
function leakedLabelFor(leaf: string): string {
  return `${toWords(leaf)} (manual attestations)`;
}

/**
 * One same-class PAIR of legal values per leaf — two DIFFERENT specifics of the
 * kind that leaf carries, so "does it drop them above one row" is answerable.
 *
 * Typed on {@link AttestationLeafName}, so a fourth leaf does not COMPILE until
 * it is given samples. That is the point of the whole block: the taxonomy lives
 * in one table, and the guards below iterate it rather than repeating it.
 */
const LEAF_SAMPLES: Record<AttestationLeafName, readonly [string, string]> = {
  // Non-boolean on purpose: the boolean branch of `value` is the one leaf case
  // that is already specific-free, and it has its own test below.
  value: ["values_documented", "financial_base_established"],
  signalKey: ["values_documented", "financial_base_established"],
  attestedAt: ["2026-05-01T00:00:00.000Z", "2026-05-02T00:00:00.000Z"],
  attestedDaysAgo: ["45", "12"],
};

for (const leaf of ATTESTATION_LEAF_NAMES) {
  const [first, second] = LEAF_SAMPLES[leaf];

  for (const [form, column] of [
    // Valueless — the shape that fell out of the templates and printed the
    // ledger's own label.
    [
      "valueless",
      [`manual.attestations.0.${leaf}`, `manual.attestations.1.${leaf}`],
    ],
    // Valued, with two DIFFERENT specifics: the signal, or the date, that the
    // phrase used to bake in.
    [
      "valued",
      [
        `manual.attestations.0.${leaf}=${first}`,
        `manual.attestations.1.${leaf}=${second}`,
      ],
    ],
  ] as const) {
    test(`the ${leaf} leaf COUNTS two attestations (${form}), it does not list`, () => {
      const lines = formatCitedFacts(column, TWO_SIGNALS);

      // ONE line for the pair — a group per attestation is the lister bug.
      assert.equal(lines.length, 1, `${leaf} ${form}: ${lines.join(" | ")}`);
      const [line] = lines;
      // …carrying the COUNT, because how much evidence there is IS the evidence.
      assert.match(line, /\b2\b/, `${leaf} ${form}: ${line}`);
      // …and naming neither of the two things it speaks for.
      assert.doesNotMatch(line, NAMES_A_SIGNAL, `${leaf} ${form}: ${line}`);
      assert.ok(!line.includes("2026"), `${leaf} ${form}: ${line}`);
      // Never the fallback: `counted` is total, so no leaf reaches it.
      assert.ok(
        !line.includes(leakedLabelFor(leaf)),
        `${leaf} ${form}: ${line}`
      );
      assert.doesNotMatch(line, LEDGER_SYNTAX, `${leaf} ${form}: ${line}`);
      assert.doesNotMatch(line, CAMEL_CASE, `${leaf} ${form}: ${line}`);
    });
  }

  test(`the ${leaf} leaf's counting phrase drops its specifics above one row`, () => {
    // Straight at the table, not through the formatter: two DIFFERENT values of
    // the same class must render identically at two rows, because the group they
    // speak for holds both. `specificAtOne` is what makes this structural.
    const [a, b] = [first, second].map((value) =>
      renderPhrase(ATTESTATION_LEAVES[leaf].counted(value), 2)
    );
    assert.equal(a, b, leaf);
    assert.match(a, /\b2\b/, leaf);

    // …and it is a phrase at every input, `null` included — the invariant the
    // `Phrase` (not `Phrase | null`) return type now enforces at compile time.
    for (const value of [null, "", first, "not-a-date", "true", "false"]) {
      const rendered = renderPhrase(ATTESTATION_LEAVES[leaf].counted(value), 1);
      assert.ok(rendered.length > 0, `${leaf} ← ${String(value)}`);
      assert.ok(
        !rendered.includes(leakedLabelFor(leaf)),
        `${leaf} ← ${String(value)}: ${rendered}`
      );
    }
  });

  test(`the ${leaf} leaf's group identity is signal-free and date-free`, () => {
    // Two different specifics of the same class are ONE group, always. Keying
    // the fold on the rendered phrase is what broke this.
    assert.equal(
      ATTESTATION_LEAVES[leaf].groupKey(first),
      ATTESTATION_LEAVES[leaf].groupKey(second),
      leaf
    );
  });
}

for (const [spelling, column] of [
  // The bare keyed pair — the signal is in the PATH, so nothing resolves it and
  // nothing has to: this pair listed two sentences before the fix.
  [
    "bare keyed",
    [
      "manual.byKey.values_documented",
      "manual.byKey.financial_base_established",
    ],
  ],
  // Cross-spelling: one attestation named by key, the other by row.
  [
    "keyed + array signalKey",
    ["manual.byKey.values_documented", "manual.attestations.1.signalKey"],
  ],
  [
    "keyed + array signalKey (valued)",
    [
      "manual.byKey.values_documented",
      "manual.attestations.1.signalKey=financial_base_established",
    ],
  ],
] as const) {
  test(`two attestations cited as ${spelling} COUNT, they do not list`, () => {
    const lines = formatCitedFacts(column, TWO_SIGNALS);

    assert.deepEqual(lines, ["2 self-reports"], spelling);
    for (const line of lines) {
      assert.doesNotMatch(line, NAMES_A_SIGNAL, spelling);
      assert.ok(!line.includes(LEAKED_LABEL), spelling);
      assert.doesNotMatch(line, LEDGER_SYNTAX, spelling);
      assert.doesNotMatch(line, CAMEL_CASE, spelling);
    }
  });
}

test("the `value` leaf still counts in BOTH spellings and in a mix", () => {
  // The round-3 assertions this must not relax: the `.value` leaf was the one
  // leaf that already counted, in both spellings, and it still must.
  for (const column of [
    ["manual.attestations.0.value=true", "manual.attestations.1.value=true"],
    [
      "manual.byKey.values_documented=true",
      "manual.byKey.financial_base_established=true",
    ],
    ["manual.byKey.values_documented=true", "manual.attestations.1.value=true"],
  ]) {
    assert.deepEqual(
      formatCitedFacts(column, TWO_SIGNALS),
      ["2 things you confirmed"],
      column.join(" | ")
    );
  }
});

test("ONE attestation cited both legal ways paints ONE chip, not two", () => {
  // The verifier's own case: the same attestation, once by key and once by row,
  // rendered its sentence TWICE through the real insight card because the two
  // spellings landed in two phrase-keyed groups.
  const lines = formatCitedFacts(
    [
      "manual.byKey.financial_base_established",
      "manual.attestations.1.signalKey",
    ],
    TWO_SIGNALS
  );

  assert.deepEqual(lines, ["your launch funding is viable"]);
});

test("no attestation column ever renders the ledger's own label", () => {
  // Rule 2: an unknown shape degrades to words, and a KNOWN one never degrades
  // at all. EVERY leaf the table declares, across the values that used to fall
  // through it, resolved and unresolved and out of range.
  const columns = ATTESTATION_LEAF_NAMES.flatMap((leaf) => [
    [`manual.attestations.0.${leaf}`],
    [`manual.attestations.0.${leaf}=maybe`],
    [`manual.attestations.0.${leaf}=not-a-date`],
    [`manual.attestations.0.${leaf}`, `manual.attestations.1.${leaf}`],
    // Out of range on both rows: nothing resolves, and nothing may be guessed.
    [`manual.attestations.7.${leaf}`, `manual.attestations.8.${leaf}`],
  ]);

  for (const column of columns) {
    for (const signals of [undefined, TWO_SIGNALS]) {
      for (const line of formatCitedFacts(column, signals)) {
        for (const leaf of ATTESTATION_LEAF_NAMES) {
          assert.ok(
            !line.includes(leakedLabelFor(leaf)),
            `${column.join(" | ")}: ${line}`
          );
        }
        assert.doesNotMatch(line, LEDGER_SYNTAX, line);
        assert.doesNotMatch(line, CAMEL_CASE, line);
      }
    }
  }
});

test("an unresolved attestation pair counts rather than labelling", () => {
  // Neither row resolves, so there is no sentence to say — but there are still
  // two of them, and "2 self-reports" is the honest answer.
  assert.deepEqual(
    formatCitedFacts([
      "manual.attestations.7.signalKey",
      "manual.attestations.8.signalKey",
    ]),
    ["2 self-reports"]
  );
});

test("N=1 keeps its sentence on every leaf and in every spelling", () => {
  // The round-3 N=1 assertions, restated as the floor this fix may not lower:
  // one distinct attestation in a group still reads the drill-down's sentence.
  assert.deepEqual(
    formatCitedFacts(["manual.attestations.1.signalKey"], TWO_SIGNALS),
    ["your launch funding is viable"]
  );
  assert.deepEqual(
    formatCitedFacts(["manual.byKey.financial_base_established"]),
    ["your launch funding is viable"]
  );
  assert.deepEqual(
    formatCitedFacts(["manual.attestations.1.value=true"], TWO_SIGNALS),
    ["you confirmed your launch funding is viable"]
  );

  const [dated] = formatCitedFacts(
    ["manual.attestations.1.attestedAt=2026-05-02T00:00:00.000Z"],
    TWO_SIGNALS
  );
  assert.match(dated, /your launch funding is viable/);
  assert.match(dated, /2026/);
});

test("the singular formatter agrees with the fold at N=1 on every leaf", () => {
  // ONE dispatcher, so this cannot drift — asserted anyway, because it is the
  // property the whole ruling is about. Driven off the leaf table, so a fourth
  // leaf is held to it the moment it exists.
  const signalKey = "financial_base_established";
  const facts = ATTESTATION_LEAF_NAMES.flatMap((leaf) => [
    `manual.attestations.1.${leaf}`,
    `manual.attestations.1.${leaf}=${LEAF_SAMPLES[leaf][1]}`,
    `manual.attestations.1.${leaf}=true`,
    `manual.attestations.1.${leaf}=false`,
  ]);

  for (const fact of facts) {
    assert.deepEqual(
      formatCitedFacts([fact], { [citedFactPath(fact)]: signalKey }),
      [formatCitedFact(fact, { signalKey })],
      fact
    );
  }
});

test("a resolved plural line still leaks no ledger syntax", () => {
  for (const line of formatCitedFacts(
    [
      "manual.attestations.1.value=true",
      "manual.attestations.2.value=false",
      "coreGroup.committedCount=22",
    ],
    {
      "manual.attestations.1.value": "financial_base_established",
      "manual.attestations.2.value": "systems_tested",
    }
  )) {
    assert.doesNotMatch(line, LEDGER_SYNTAX);
    assert.doesNotMatch(line, CAMEL_CASE);
    assert.ok(!line.includes("="), line);
  }
});
