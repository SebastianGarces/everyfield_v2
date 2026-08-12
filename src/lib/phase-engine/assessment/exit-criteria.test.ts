// ============================================================================
// Exit-criteria progress + fact drill-down (PE-022 + PE-025).
//
// These tests pin the properties this surface's honesty depends on:
//   - the current phase's gates render individually, each with the judge's
//     standing on it,
//   - a gate the judge did not address reads `not_addressed` — never as a
//     failure, and never borrowing another gate's insight,
//   - the drill-down shows exactly the facts the judge cited on the persisted
//     insight, with the VALUE re-read from the fact snapshot rather than
//     quoted from the model,
//   - nothing measured is computed anywhere but out of that snapshot, by path.
//
// This file imports `./queries`, which constructs the Neon client at import
// time. That is fine and deliberate: `pnpm test` supplies a placeholder
// DATABASE_URL (see .github/workflows/pull-request-checks.yml) and every test
// below exercises the PURE projection — no query is ever issued.
// ============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlantAssessment, PlantInsight } from "@/db/schema";

import {
  buildExitCriteriaProgress,
  EXIT_CRITERION_STANDINGS,
  PHASE_EXIT_CRITERIA,
  readSnapshotFact,
  type ExitCriteriaProgress,
  type LatestAssessment,
} from "./queries";

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const ASSESSMENT_ID = "assessment-1";
const CHURCH_ID = "church-1";
const GENERATED_AT = new Date("2026-07-20T09:00:00.000Z");

/**
 * A snapshot shaped like the real one (signals/types.ts), with a phase-1 plant
 * short of the core-group gate and no worship leader. Only the branches the
 * criteria read are filled in; a stored snapshot is plain JSON, so the
 * projection must cope with whatever a caller hands it.
 */
function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    snapshotVersion: "1.0.0",
    churchId: CHURCH_ID,
    currentPhase: 1,
    generatedAt: GENERATED_AT.toISOString(),
    isColdStart: false,
    coreGroup: {
      committedCount: 22,
      launchTeamCount: 0,
      growthDelta: 3,
      growthWindowDays: 30,
      isEmpty: false,
    },
    ministryRoles: {
      filledCount: 2,
      totalRoles: 8,
      roles: [
        { key: "worship", label: "Worship", teamPresent: true, filled: false },
        {
          key: "childrens",
          label: "Children's",
          teamPresent: true,
          filled: true,
        },
      ],
      isEmpty: false,
    },
    training: {
      programCount: 1,
      requiredProgramCount: 1,
      completionCount: 0,
      requiredCompletionRate: 0,
      isEmpty: false,
    },
    launch: {
      launchDate: "2026-11-01",
      daysUntilLaunch: 104,
      isPastDue: false,
      isEmpty: false,
    },
    manual: {
      attestations: [],
      byKey: { financial_base_established: false },
      isEmpty: false,
    },
    ...overrides,
  };
}

/**
 * The manual block as `build-fact-snapshot.ts` actually writes it: every
 * attestation appears TWICE, once as a `byKey` entry and once as a row of
 * `attestations[]`. The fixtures above keep `attestations` empty on purpose (the
 * older tests only care about `byKey`), so the attribution tests build the real
 * two-sided shape here rather than hand-editing that default.
 */
function manualBlock(
  entries: readonly { signalKey: string; value: unknown }[]
): Record<string, unknown> {
  return {
    attestations: entries.map((entry) => ({
      signalKey: entry.signalKey,
      value: entry.value,
      attestedAt: GENERATED_AT.toISOString(),
    })),
    byKey: Object.fromEntries(entries.map((e) => [e.signalKey, e.value])),
    isEmpty: entries.length === 0,
  };
}

function makeAssessment(
  overrides: Partial<PlantAssessment> = {}
): PlantAssessment {
  return {
    id: ASSESSMENT_ID,
    churchId: CHURCH_ID,
    generatedAt: GENERATED_AT,
    phase: 1,
    rubricVersion: "v0",
    factSnapshot: makeSnapshot(),
    modelId: "test-model",
    status: "complete",
    createdAt: GENERATED_AT,
    ...overrides,
  } as PlantAssessment;
}

let insightCounter = 0;

function makeInsight(overrides: Partial<PlantInsight> = {}): PlantInsight {
  insightCounter += 1;
  return {
    id: `insight-${insightCounter}`,
    assessmentId: ASSESSMENT_ID,
    churchId: CHURCH_ID,
    audience: "planter",
    category: "critical_mass",
    severity: "medium",
    title: "Core-group growth is behind the gate",
    body: "You are 8 short of the 30 the rubric asks for before phase 2.",
    citedFacts: ["coreGroup.committedCount=22"],
    relatedArticleSlugs: [],
    rank: 0,
    createdAt: GENERATED_AT,
    ...overrides,
  } as PlantInsight;
}

function makeLatest(
  insights: PlantInsight[],
  assessment: Partial<PlantAssessment> = {}
): LatestAssessment {
  return { assessment: makeAssessment(assessment), insights };
}

function criterion(progress: ExitCriteriaProgress, key: string) {
  const found = progress.criteria.find((c) => c.key === key);
  assert.ok(found, `expected a criterion named ${key}`);
  return found;
}

// ----------------------------------------------------------------------------
// AC: the current phase's exit criteria render individually, with the engine's
// standing on each.
// ----------------------------------------------------------------------------

test("PE-022: the card carries the current phase's gates, one row each", () => {
  const progress = buildExitCriteriaProgress(makeLatest([makeInsight()]))!;

  assert.equal(progress.phase, 1);
  assert.equal(progress.nextPhase, 2);
  assert.equal(progress.isTerminalPhase, false);
  assert.deepEqual(
    progress.criteria.map((c) => c.key),
    PHASE_EXIT_CRITERIA[1].map((d) => d.key)
  );
  // Every row is a separate gate with its own label — not one composite verdict.
  for (const row of progress.criteria) {
    assert.ok(row.label.length > 0, `${row.key} needs a label`);
    assert.ok(row.detail.length > 0, `${row.key} needs a description`);
    assert.ok(
      (EXIT_CRITERION_STANDINGS as readonly string[]).includes(row.standing),
      `${row.key} has an unknown standing`
    );
  }
});

test("PE-022: the standing on a gate is the severity the judge assigned", () => {
  const urgent = makeInsight({
    severity: "high",
    rank: 3,
    title: "Growth has stalled",
  });
  const milder = makeInsight({
    severity: "low",
    rank: 1,
    title: "Two new commitments this month",
    citedFacts: ["coreGroup.growthDelta=3"],
  });

  const progress = buildExitCriteriaProgress(makeLatest([milder, urgent]))!;
  const committed = criterion(progress, "committed_adults");

  // Relabelled severity, nothing recomputed: `high` → attention.
  assert.equal(committed.standing, "attention");
  // Most urgent first, so the leading insight is the one that set the standing.
  assert.deepEqual(
    committed.insights.map((i) => i.title),
    ["Growth has stalled", "Two new commitments this month"]
  );
});

test("PE-022: the phase read is the ASSESSMENT's, so standings match the gates they were made against", () => {
  const progress = buildExitCriteriaProgress(
    makeLatest([makeInsight()], { phase: 2 })
  )!;

  assert.equal(progress.phase, 2);
  assert.deepEqual(
    progress.criteria.map((c) => c.key),
    ["all_team_leaders", "launch_date_set"]
  );
});

test("PE-022: a launch day reads as the stored DAY, pinned to APP_TIME_ZONE", () => {
  // `launches.target_date` is a yyyy-mm-dd DAY, not an instant, and
  // memory/invariants/dates-times.md forbids round-tripping it through a bare
  // `Date`. The reading is pinned here so the single owner of that parse
  // (`parseTargetDate`) cannot be quietly replaced by a hand-rolled second one
  // without a test going red — the duplication this criterion once carried.
  const progress = buildExitCriteriaProgress(
    makeLatest([], {
      phase: 2,
      factSnapshot: makeSnapshot({
        launch: { launchDate: "2026-11-01", isEmpty: false },
      }),
    })
  )!;

  const launch = criterion(progress, "launch_date_set");
  assert.equal(launch.measurement, "met");
  assert.equal(launch.reading, "a launch date of Sunday, November 1, 2026");
});

test("PE-022: an unparseable launch day falls back to the stored value, never Invalid Date", () => {
  const progress = buildExitCriteriaProgress(
    makeLatest([], {
      phase: 2,
      factSnapshot: makeSnapshot({
        launch: { launchDate: "not-a-day", isEmpty: false },
      }),
    })
  )!;

  assert.equal(
    criterion(progress, "launch_date_set").reading,
    "a launch date of not-a-day"
  );
});

test("PE-022: the terminal phase reports itself, it does not invent gates", () => {
  const progress = buildExitCriteriaProgress(makeLatest([], { phase: 6 }))!;

  assert.equal(progress.isTerminalPhase, true);
  assert.equal(progress.nextPhase, null);
  assert.deepEqual(progress.criteria, []);
});

test("PE-022: no complete assessment yields null, not a list of unmet gates", () => {
  assert.equal(buildExitCriteriaProgress(null), null);
  assert.equal(buildExitCriteriaProgress(null, "network"), null);
});

// ----------------------------------------------------------------------------
// AC: a criterion the judge did not address says so, rather than rendering as
// failed.
// ----------------------------------------------------------------------------

test("PE-022: an unaddressed gate reads not_addressed — never a failure", () => {
  // One insight, about core-group size only.
  const progress = buildExitCriteriaProgress(makeLatest([makeInsight()]))!;

  assert.equal(criterion(progress, "committed_adults").standing, "watch");

  for (const key of ["financial_base", "worship_leader", "geographic_area"]) {
    const row = criterion(progress, key);
    assert.equal(
      row.standing,
      "not_addressed",
      `${key} must not borrow another gate's standing`
    );
    assert.deepEqual(row.insights, []);
    assert.deepEqual(row.evidence, []);
  }

  assert.equal(progress.addressedCount, 1);
});

test("PE-022: not addressed and not met are independent — silence never sets the measurement", () => {
  const progress = buildExitCriteriaProgress(makeLatest([]))!;

  const financial = criterion(progress, "financial_base");
  // The planter answered "no" to the attestation: a real, deterministic miss…
  assert.equal(financial.measurement, "not_met");
  // …that the assessment happened not to speak to.
  assert.equal(financial.standing, "not_addressed");

  // And a gate EveryField cannot measure is `not_tracked`, never `not_met`.
  const geographic = criterion(progress, "geographic_area");
  assert.equal(geographic.measurement, "not_tracked");
  assert.equal(geographic.reading, null);
  assert.deepEqual(geographic.facts, []);
});

test("PE-022: a gate whose paths are missing from an older snapshot is unknown, not failed", () => {
  // Snapshots written before LS-008 carry no launch readiness fields at all.
  const progress = buildExitCriteriaProgress(
    makeLatest([], {
      phase: 4,
      factSnapshot: makeSnapshot({ launch: { launchDate: null } }),
    })
  )!;

  const milestones = criterion(progress, "readiness_milestones");
  assert.equal(milestones.measurement, "unknown");
  assert.equal(progress.metCount, 0);
  assert.equal(progress.measuredCount, 0);
});

test("PE-022: a gate with no fact paths is reachable only through its category", () => {
  const progress = buildExitCriteriaProgress(
    makeLatest(
      [
        makeInsight({
          category: "phase_progress",
          severity: "medium",
          title: "Name the area you are planting in",
          citedFacts: ["currentPhase=1"],
        }),
      ],
      { phase: 1 }
    )
  )!;

  assert.equal(criterion(progress, "geographic_area").standing, "watch");
  // …and it does not spill onto the gates that ARE measured.
  assert.equal(
    criterion(progress, "committed_adults").standing,
    "not_addressed"
  );
});

// ----------------------------------------------------------------------------
// AC: an attested gate is addressed through EITHER legal spelling of its
// citation (ruled 2026-08-10 on #319).
//
// The snapshot writes every manual attestation twice — `manual.byKey.<signal>`
// and `manual.attestations[]` — and the judge's ledger is the whole flattened
// snapshot, so both are citations a model may legitimately emit for the same
// fact. Attribution normalises the array form onto the keyed one by resolving
// the row's `signalKey`, so which spelling the model chose cannot decide whether
// the row reads "Not addressed".
// ----------------------------------------------------------------------------

/** Phase 1's attested gate, plus a neighbouring signal no phase-1 gate measures. */
const MANUAL_TWO_SIGNALS = manualBlock([
  { signalKey: "values_documented", value: true },
  { signalKey: "financial_base_established", value: false },
]);

test("PE-022: a byKey citation attributes to the attested gate it names", () => {
  const progress = buildExitCriteriaProgress(
    makeLatest(
      [
        makeInsight({
          category: "generosity",
          title: "Your financial base is not confirmed",
          citedFacts: ["manual.byKey.financial_base_established=false"],
        }),
      ],
      { factSnapshot: makeSnapshot({ manual: MANUAL_TWO_SIGNALS }) }
    )
  )!;

  assert.equal(criterion(progress, "financial_base").standing, "watch");
  assert.deepEqual(
    criterion(progress, "financial_base").evidence.map((e) => e.path),
    ["manual.byKey.financial_base_established"]
  );
  // The keyed spelling already names its signal in the path, so there is
  // nothing to resolve and nothing for a surface to override.
  assert.equal(
    criterion(progress, "financial_base").evidence[0].signalKey,
    null
  );
  // …and it stays on that gate.
  assert.equal(
    criterion(progress, "committed_adults").standing,
    "not_addressed"
  );
});

test("PE-022: an attestations-array citation reaches the gate that measures entry N's signal", () => {
  const progress = buildExitCriteriaProgress(
    makeLatest(
      [
        makeInsight({
          category: "generosity",
          title: "Your financial base is not confirmed",
          citedFacts: ["manual.attestations.1.value=false"],
        }),
      ],
      { factSnapshot: makeSnapshot({ manual: MANUAL_TWO_SIGNALS }) }
    )
  )!;

  // Entry 1 is `financial_base_established`, so this is the financial-base gate.
  assert.equal(criterion(progress, "financial_base").standing, "watch");

  // The drill-down is NOT rewritten: the planter sees the citation as the judge
  // wrote it, re-resolved against the snapshot. Normalisation is attribution
  // only.
  const [evidence] = criterion(progress, "financial_base").evidence;
  assert.equal(evidence.path, "manual.attestations.1.value");
  assert.equal(evidence.snapshotValue, "false");
  assert.equal(evidence.inSnapshot, true);
  assert.equal(evidence.agrees, true);

  // …but the signal the row resolved to rides ALONGSIDE the untouched path, so
  // the drill-down can read this citation in the same words as the keyed
  // spelling of it without either being rewritten.
  assert.equal(evidence.signalKey, "financial_base_established");
});

test("PE-025: every attestation-row citation carries the signal it resolved to", () => {
  // All three leaves of a row are legal citations, and each of them needs the
  // resolution: none of the three says which signal it is about on its face.
  const progress = buildExitCriteriaProgress(
    makeLatest(
      [
        makeInsight({
          category: "generosity",
          title: "Your financial base is not confirmed",
          citedFacts: [
            "manual.attestations.1.value=false",
            "manual.attestations.1.signalKey=financial_base_established",
            "manual.attestations[1].attestedAt=2026-07-20",
            "coreGroup.committedCount=22",
          ],
        }),
      ],
      { factSnapshot: makeSnapshot({ manual: MANUAL_TWO_SIGNALS }) }
    )
  )!;

  const { evidence } = criterion(progress, "financial_base");
  assert.deepEqual(
    evidence.map((e) => [e.path, e.signalKey]),
    [
      ["manual.attestations.1.value", "financial_base_established"],
      ["manual.attestations.1.signalKey", "financial_base_established"],
      ["manual.attestations.1.attestedAt", "financial_base_established"],
      // A fact that is not an attestation row resolves to no signal at all.
      ["coreGroup.committedCount", null],
    ]
  );
});

test("PE-025: an attestation row the snapshot cannot resolve carries no signal", () => {
  // The insight reaches the gate through its OTHER citation; the unresolvable
  // one still rides in the drill-down, and must not borrow a signal from it.
  const progress = buildExitCriteriaProgress(
    makeLatest(
      [
        makeInsight({
          category: "generosity",
          title: "Your financial base is not confirmed",
          citedFacts: [
            "manual.byKey.financial_base_established=false",
            "manual.attestations.9.value=false",
          ],
        }),
      ],
      { factSnapshot: makeSnapshot({ manual: MANUAL_TWO_SIGNALS }) }
    )
  )!;

  const { evidence } = criterion(progress, "financial_base");
  assert.deepEqual(
    evidence.map((e) => [e.path, e.signalKey]),
    [
      ["manual.byKey.financial_base_established", null],
      ["manual.attestations.9.value", null],
    ]
  );
});

test("PE-022: the array form resolves per signal, so it cannot spill onto a gate it does not name", () => {
  // Entry 0 is `values_documented` — a phase-0 gate, measured by no phase-1 one.
  const progress = buildExitCriteriaProgress(
    makeLatest(
      [
        makeInsight({
          category: "vision_casting",
          citedFacts: ["manual.attestations.0.attestedAt=2026-07-20"],
          title: "Your values are written down",
        }),
      ],
      { factSnapshot: makeSnapshot({ manual: MANUAL_TWO_SIGNALS }) }
    )
  )!;

  // Widening the three attested gates to the bare `manual` prefix would light
  // this one up; resolving the row does not.
  assert.equal(criterion(progress, "financial_base").standing, "not_addressed");
  assert.deepEqual(criterion(progress, "financial_base").evidence, []);

  // The same citation DOES reach the gate that measures entry 0, in phase 0.
  const phaseZero = buildExitCriteriaProgress(
    makeLatest(
      [
        makeInsight({
          category: "vision_casting",
          citedFacts: ["manual.attestations.0.attestedAt=2026-07-20"],
          title: "Your values are written down",
        }),
      ],
      { phase: 0, factSnapshot: makeSnapshot({ manual: MANUAL_TWO_SIGNALS }) }
    )
  )!;
  assert.equal(criterion(phaseZero, "values_documented").standing, "watch");
});

test("PE-022: a bracketed attestation index reaches the same gate as a dotted one", () => {
  const progress = buildExitCriteriaProgress(
    makeLatest(
      [
        makeInsight({
          category: "generosity",
          citedFacts: [
            "manual.attestations[1].signalKey=financial_base_established",
          ],
          title: "Financial base outstanding",
        }),
      ],
      { factSnapshot: makeSnapshot({ manual: MANUAL_TWO_SIGNALS }) }
    )
  )!;

  assert.equal(criterion(progress, "financial_base").standing, "watch");
});

test("PE-022: an out-of-range attestation index attributes to nothing, and never throws", () => {
  const progress = buildExitCriteriaProgress(
    makeLatest(
      [
        makeInsight({
          category: "generosity",
          citedFacts: ["manual.attestations.9.value=false"],
          title: "A row that is not in this snapshot",
        }),
      ],
      { factSnapshot: makeSnapshot({ manual: MANUAL_TWO_SIGNALS }) }
    )
  )!;

  // An unresolvable citation is not a licence to guess a gate.
  assert.equal(criterion(progress, "financial_base").standing, "not_addressed");
  assert.equal(progress.addressedCount, 0);
  // The measurement is untouched — it is not the judge's.
  assert.equal(criterion(progress, "financial_base").measurement, "not_met");
});

test("PE-022: a malformed attestation citation attributes to nothing, and never throws", () => {
  const malformed = [
    "manual.attestations.notanindex.value=false",
    "manual.attestations=whatever",
    "manual.attestations.-1.value=false",
    "manual.attestations..value=false",
    "manual.attestations.1e0.value=false",
  ];

  for (const citation of malformed) {
    const progress = buildExitCriteriaProgress(
      makeLatest(
        [makeInsight({ category: "generosity", citedFacts: [citation] })],
        {
          factSnapshot: makeSnapshot({ manual: MANUAL_TWO_SIGNALS }),
        }
      )
    )!;

    assert.equal(
      criterion(progress, "financial_base").standing,
      "not_addressed",
      `${citation} must reach no gate`
    );
  }
});

test("PE-022: an attestation row with no signalKey resolves to nothing", () => {
  const progress = buildExitCriteriaProgress(
    makeLatest(
      [
        makeInsight({
          category: "generosity",
          citedFacts: ["manual.attestations.0.value=false"],
        }),
      ],
      {
        factSnapshot: makeSnapshot({
          manual: {
            attestations: [{ value: false, attestedAt: "2026-07-20" }],
            byKey: { financial_base_established: false },
            isEmpty: false,
          },
        }),
      }
    )
  )!;

  assert.equal(criterion(progress, "financial_base").standing, "not_addressed");
});

test("PE-022: both spellings reach the attested gates of every phase that has one", () => {
  const cases = [
    { phase: 0, key: "values_documented", signal: "values_documented" },
    { phase: 1, key: "financial_base", signal: "financial_base_established" },
    { phase: 3, key: "systems_tested", signal: "systems_tested" },
  ];

  for (const { phase, key, signal } of cases) {
    const manual = manualBlock([{ signalKey: signal, value: true }]);

    for (const citation of [
      `manual.byKey.${signal}=true`,
      "manual.attestations.0.value=true",
    ]) {
      const progress = buildExitCriteriaProgress(
        makeLatest(
          [
            makeInsight({
              severity: "high",
              citedFacts: [citation],
              title: `About ${signal}`,
            }),
          ],
          { phase, factSnapshot: makeSnapshot({ manual }) }
        )
      )!;

      assert.equal(
        criterion(progress, key).standing,
        "attention",
        `${citation} must address ${key} in phase ${phase}`
      );
    }
  }
});

// ----------------------------------------------------------------------------
// AC: expanding a criterion shows the specific facts the judge cited for it.
// ----------------------------------------------------------------------------

test("PE-025: the drill-down is exactly the citedFacts of the insights that addressed the gate", () => {
  const insight = makeInsight({
    citedFacts: ["coreGroup.committedCount=22", "coreGroup.growthDelta=3"],
  });
  const elsewhere = makeInsight({
    category: "comprehensive_training",
    citedFacts: ["training.requiredCompletionRate=0"],
    title: "Training has not started",
  });

  const progress = buildExitCriteriaProgress(makeLatest([insight, elsewhere]))!;
  const committed = criterion(progress, "committed_adults");

  assert.deepEqual(
    committed.evidence.map((e) => e.path),
    ["coreGroup.committedCount", "coreGroup.growthDelta"]
  );
  // Each item traces back to the persisted insight that cited it…
  assert.ok(committed.evidence.every((e) => e.insightId === insight.id));
  // …and a citation from an insight about another gate never appears here.
  assert.ok(!committed.evidence.some((e) => e.path.startsWith("training")));
});

test("PE-025: the same citation twice is one row of evidence", () => {
  const first = makeInsight({ citedFacts: ["coreGroup.committedCount=22"] });
  const second = makeInsight({
    severity: "low",
    rank: 4,
    title: "Keep inviting",
    citedFacts: ["coreGroup.committedCount=22", "coreGroup.growthDelta=3"],
  });

  const progress = buildExitCriteriaProgress(makeLatest([first, second]))!;

  assert.deepEqual(
    criterion(progress, "committed_adults").evidence.map((e) => e.path),
    ["coreGroup.committedCount", "coreGroup.growthDelta"]
  );
});

test("PE-025: the surviving row of a shared citation names the most urgent citer", () => {
  // The dedup above collapses two insights quoting the same fact into one row,
  // so `insightId` cannot be an exhaustive trace. It is not arbitrary either:
  // the insights are already ordered most urgent first, so the row carries the
  // insight a reader would be sent to. `CitedFactEvidence.insightId` documents
  // exactly this; the test is what keeps the documentation true.
  const milder = makeInsight({
    severity: "low",
    rank: 4,
    title: "Keep inviting",
    citedFacts: ["coreGroup.committedCount=22"],
  });
  const urgent = makeInsight({
    severity: "high",
    rank: 0,
    citedFacts: ["coreGroup.committedCount=22"],
  });

  // Handed in mildest-first, so a pass cannot come from input order.
  const progress = buildExitCriteriaProgress(makeLatest([milder, urgent]))!;
  const { evidence } = criterion(progress, "committed_adults");

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].insightId, urgent.id);
});

test("PE-025: a bracketed index in a citation reaches the same gate as a dotted one", () => {
  const progress = buildExitCriteriaProgress(
    makeLatest([
      makeInsight({
        category: "emerging_leadership",
        citedFacts: ["ministryRoles.roles[0].filled=false"],
        title: "No worship leader yet",
      }),
    ])
  )!;

  const worship = criterion(progress, "worship_leader");
  assert.equal(worship.standing, "watch");
  assert.deepEqual(
    worship.evidence.map((e) => e.path),
    ["ministryRoles.roles.0.filled"]
  );
});

test("PE-025: a malformed citedFacts column degrades to no evidence, it never throws", () => {
  const progress = buildExitCriteriaProgress(
    makeLatest([
      makeInsight({ citedFacts: null as unknown as string[] }),
      makeInsight({
        citedFacts: [
          42,
          "",
          "coreGroup.committedCount=22",
        ] as unknown as string[],
        rank: 2,
      }),
    ])
  )!;

  assert.deepEqual(
    criterion(progress, "committed_adults").evidence.map((e) => e.path),
    ["coreGroup.committedCount"]
  );
});

// ----------------------------------------------------------------------------
// AC: facts shown are the deterministic snapshot values, never LLM-generated
// text presented as fact.
// ----------------------------------------------------------------------------

test("PE-025: a citation's value is re-read from the snapshot, not quoted from the judge", () => {
  // The model quotes a number the snapshot does not hold.
  const progress = buildExitCriteriaProgress(
    makeLatest([makeInsight({ citedFacts: ["coreGroup.committedCount=48"] })])
  )!;

  const [evidence] = criterion(progress, "committed_adults").evidence;

  assert.equal(evidence.citedValue, "48");
  assert.equal(evidence.snapshotValue, "22", "the snapshot is what is shown");
  assert.equal(evidence.inSnapshot, true);
  assert.equal(evidence.agrees, false, "the disagreement must be visible");
});

test("PE-025: a cited path that is not in the snapshot is marked unverifiable, not rendered as evidence", () => {
  const progress = buildExitCriteriaProgress(
    makeLatest([
      makeInsight({
        citedFacts: ["coreGroup.prayerWarriors=12"],
      }),
    ])
  )!;

  const [evidence] = criterion(progress, "committed_adults").evidence;

  assert.equal(evidence.inSnapshot, false);
  assert.equal(evidence.snapshotValue, null);
  assert.equal(evidence.agrees, false);
});

test("PE-025: an agreeing citation compares numerically, not as text", () => {
  const progress = buildExitCriteriaProgress(
    makeLatest([makeInsight({ citedFacts: ["coreGroup.committedCount=22.0"] })])
  )!;

  const [evidence] = criterion(progress, "committed_adults").evidence;
  assert.equal(evidence.agrees, true);
  assert.equal(evidence.snapshotValue, "22");
});

test("PE-022: every measured value is a read out of the fact snapshot, by path", () => {
  const latest = makeLatest([]);
  const snapshot = latest.assessment.factSnapshot;
  const progress = buildExitCriteriaProgress(latest)!;

  for (const row of progress.criteria) {
    if (row.measurement === "not_tracked") {
      assert.deepEqual(row.facts, [], `${row.key} must read nothing`);
      assert.equal(row.reading, null);
      continue;
    }

    assert.ok(row.facts.length > 0, `${row.key} must record what it read`);
    for (const fact of row.facts) {
      // The recorded reading IS what the snapshot holds at that path — this is
      // the property that makes "SQL-derived, never LLM-generated" checkable.
      assert.deepEqual(fact, readSnapshotFact(snapshot, fact.path));
    }
  }
});

test("PE-022: the readings are the snapshot's own numbers", () => {
  const progress = buildExitCriteriaProgress(makeLatest([]))!;

  const committed = criterion(progress, "committed_adults");
  assert.equal(committed.measurement, "not_met");
  assert.match(committed.reading!, /^22 of 30 /);
  assert.deepEqual(
    committed.facts.map((f) => `${f.path}=${f.value}`),
    ["coreGroup.committedCount=22"]
  );

  const worship = criterion(progress, "worship_leader");
  assert.equal(worship.measurement, "not_met");
  assert.deepEqual(
    worship.facts.map((f) => f.path),
    ["ministryRoles.roles.0.filled"]
  );
});

test("PE-022: a cleared gate reads met, from the snapshot alone", () => {
  const progress = buildExitCriteriaProgress(
    makeLatest([], {
      factSnapshot: makeSnapshot({
        coreGroup: { committedCount: 31, isEmpty: false },
        manual: { byKey: { financial_base_established: true }, isEmpty: false },
      }),
    })
  )!;

  assert.equal(criterion(progress, "committed_adults").measurement, "met");
  assert.equal(criterion(progress, "financial_base").measurement, "met");
  assert.equal(progress.metCount, 2);
  assert.equal(progress.measuredCount, 3);
});

test("PE-022: an unanswered attestation is unknown, not a no", () => {
  const progress = buildExitCriteriaProgress(
    makeLatest([], {
      factSnapshot: makeSnapshot({
        manual: { attestations: [], byKey: {}, isEmpty: true },
      }),
    })
  )!;

  const financial = criterion(progress, "financial_base");
  assert.equal(financial.measurement, "unknown");
  assert.equal(financial.facts[0].present, false);
});

test("PE-022: a null in the snapshot is a reading; a missing key is not", () => {
  const snapshot = makeSnapshot();

  assert.deepEqual(readSnapshotFact(snapshot, "launch.launchDate"), {
    path: "launch.launchDate",
    present: true,
    value: "2026-11-01",
  });
  assert.deepEqual(readSnapshotFact(snapshot, "launch.status"), {
    path: "launch.status",
    present: false,
    value: null,
  });
  // A container is not a fact.
  assert.equal(readSnapshotFact(snapshot, "coreGroup").value, null);
  // Nothing about a nonsense path throws.
  assert.equal(
    readSnapshotFact(snapshot, "coreGroup.committedCount.nope").present,
    false
  );
  assert.equal(readSnapshotFact(null, "coreGroup").present, false);
});

// ----------------------------------------------------------------------------
// AC: nothing reaches a network audience that the privacy gating forbids.
// ----------------------------------------------------------------------------

test("PE-022: the projection is audience-scoped — a planter insight never sets a network standing", () => {
  const planterOnly = makeInsight({
    audience: "planter",
    severity: "critical",
    title: "Sara is ready to lead worship",
  });
  const networkOne = makeInsight({
    audience: "network",
    category: "generosity",
    severity: "medium",
    title: "Financial base not yet confirmed",
    citedFacts: ["manual.byKey.financial_base_established=false"],
  });

  const network = buildExitCriteriaProgress(
    makeLatest([planterOnly, networkOne]),
    "network"
  )!;

  assert.equal(network.audience, "network");
  assert.equal(
    criterion(network, "committed_adults").standing,
    "not_addressed"
  );
  assert.equal(criterion(network, "financial_base").standing, "watch");

  const titles = network.criteria.flatMap((c) =>
    c.insights.map((i) => i.title)
  );
  assert.ok(!titles.includes(planterOnly.title));

  // The measurement is unaffected by the audience — it is not the judge's.
  assert.equal(criterion(network, "committed_adults").measurement, "not_met");
});

// ----------------------------------------------------------------------------
// The definitions themselves.
// ----------------------------------------------------------------------------

test("PE-022: every phase up to the terminal one names its gates, and they are unique", () => {
  for (const phase of [0, 1, 2, 3, 4, 5]) {
    const definitions = PHASE_EXIT_CRITERIA[phase];
    assert.ok(definitions?.length, `phase ${phase} needs exit criteria`);
    const keys = definitions.map((d) => d.key);
    assert.equal(new Set(keys).size, keys.length, `phase ${phase} has a dupe`);
    for (const definition of definitions) {
      // A gate is reachable by the judge one way or the other, or it can never
      // be addressed at all.
      assert.ok(
        definition.factPaths.length > 0 || definition.categories.length > 0,
        `${definition.key} is unreachable by the judge`
      );
    }
  }
  assert.equal(PHASE_EXIT_CRITERIA[6], undefined, "phase 6 is terminal");
});
