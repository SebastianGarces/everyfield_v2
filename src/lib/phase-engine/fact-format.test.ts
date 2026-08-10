import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatCitedFact,
  formatCitedFacts,
  parseCitedFact,
} from "./fact-format";

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
      "you confirmed your financial base is in place",
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
