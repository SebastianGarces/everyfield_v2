/**
 * DISPOSABLE. Four directions for one question: when the judge addresses an
 * attested exit criterion but cites it through a path form the criterion did
 * not declare, does the row say "Not addressed"?
 *
 * Nothing here imports the app. It mimics only the attribution rule
 * (`addressesCriterion`, assessment/queries.ts:1229) and the citable ledger
 * (`flattenFacts`, judge/prompt.ts:33) so the four rules can be compared on
 * identical inputs.
 */

// ---------------------------------------------------------------------------
// The snapshot slice that matters: manual signals are written TWICE.
// (signals/build-fact-snapshot.ts:483 — byKey AND attestations[])
// ---------------------------------------------------------------------------

export const MANUAL_ROWS = [
  { signalKey: "values_documented", value: "true" },
  { signalKey: "financial_base_established", value: "true" },
  { signalKey: "systems_tested", value: "false" },
] as const;

/** Every path a judge may legally cite for the manual block, both shapes. */
export function citableManualPaths(): string[] {
  const paths: string[] = [];
  MANUAL_ROWS.forEach((row, i) => {
    paths.push(`manual.byKey.${row.signalKey}`);
    paths.push(`manual.attestations.${i}.signalKey`);
    paths.push(`manual.attestations.${i}.value`);
    paths.push(`manual.attestations.${i}.attestedAt`);
  });
  return paths;
}

/** Resolve any manual path back to the signal it is about, or null. */
export function signalOfPath(path: string): string | null {
  const byKey = /^manual\.byKey\.([^.]+)/.exec(path);
  if (byKey) return byKey[1];
  const attestation = /^manual\.attestations\.(\d+)(\.|$)/.exec(path);
  if (attestation) {
    const row = MANUAL_ROWS[Number(attestation[1])];
    return row ? row.signalKey : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The three attested criteria, exactly as the branch defines them today.
// ---------------------------------------------------------------------------

export type Criterion = {
  key: string;
  label: string;
  /** The one path the definition declares today. */
  factPaths: string[];
  /** The signal the gate is actually about. */
  signal: string;
};

export const CRITERIA: Criterion[] = [
  {
    key: "values_documented",
    label: "Core values documented (phase 0)",
    factPaths: ["manual.byKey.values_documented"],
    signal: "values_documented",
  },
  {
    key: "financial_base",
    label: "Financial base in place (phase 1)",
    factPaths: ["manual.byKey.financial_base_established"],
    signal: "financial_base_established",
  },
  {
    key: "systems_tested",
    label: "Systems tested (phase 3)",
    factPaths: ["manual.byKey.systems_tested"],
    signal: "systems_tested",
  },
];

// ---------------------------------------------------------------------------
// Insights: what the judge emitted, and which gate it was really about.
// ---------------------------------------------------------------------------

export type Insight = {
  id: string;
  text: string;
  citedPaths: string[];
  /** Ground truth for grading: the criterion keys this insight speaks to. */
  truth: string[];
};

export type Scenario = { name: string; note: string; insights: Insight[] };

export const SCENARIOS: Scenario[] = [
  {
    name: "byKey citations (what the seeded fixtures do)",
    note: "The form every current fixture uses. All four directions agree here — which is why the preview showed nothing wrong.",
    insights: [
      {
        id: "i1",
        text: "Your values are written down — keep them in front of the core group.",
        citedPaths: ["manual.byKey.values_documented"],
        truth: ["values_documented"],
      },
      {
        id: "i2",
        text: "Financial base is attested; revisit the first-year budget monthly.",
        citedPaths: ["manual.byKey.financial_base_established"],
        truth: ["financial_base"],
      },
    ],
  },
  {
    name: "attestation-array citations (the latent case)",
    note: "Equally legal citations from the same ledger. Today all three rows read 'Not addressed' although the judge wrote about them.",
    insights: [
      {
        id: "i3",
        text: "You attested your values on 12 Jun and have not revised them since.",
        citedPaths: [
          "manual.attestations.0.signalKey",
          "manual.attestations.0.attestedAt",
        ],
        truth: ["values_documented"],
      },
      {
        id: "i4",
        text: "Systems are not yet tested — this is the gate holding Pre-Launch.",
        citedPaths: [
          "manual.attestations.2.signalKey",
          "manual.attestations.2.value",
        ],
        truth: ["systems_tested"],
      },
    ],
  },
  {
    name: "mixed — one attestation citation, other gates untouched",
    note: "The precision test. Only ONE gate was addressed; a direction that lights up the other two is over-claiming to the planter.",
    insights: [
      {
        id: "i5",
        text: "Systems are not yet tested — run giving and check-in for real.",
        citedPaths: ["manual.attestations.2.value"],
        truth: ["systems_tested"],
      },
      {
        id: "i6",
        text: "Your core group has 11 committed members.",
        citedPaths: ["coreGroup.committedCount"],
        truth: [],
      },
    ],
  },
  {
    name: "a manual citation about no gate at all",
    note: "A future manual signal that no exit criterion measures. Does it leak onto the three attested rows?",
    insights: [
      {
        id: "i7",
        text: "You logged an attestation we do not gate on.",
        citedPaths: ["manual.attestations.1.attestedAt", "manual.isEmpty"],
        truth: [],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// The four directions.
// ---------------------------------------------------------------------------

export type Direction = {
  key: "A" | "B" | "C" | "D";
  name: string;
  blurb: string;
  /** What the judge is allowed to cite under this direction. */
  ledger: (paths: string[]) => string[];
  matches: (criterion: Criterion, citedPaths: string[]) => boolean;
  diff: string;
};

const prefixMatch = (cited: string, factPath: string): boolean =>
  cited === factPath || cited.startsWith(`${factPath}.`);

export const DIRECTIONS: Direction[] = [
  {
    key: "A",
    name: "Leave it — declared path only (today's behaviour)",
    blurb:
      "`factPaths: ['manual.byKey.<signal>']`, prefix match, nothing else. Understating the engine is the safe direction.",
    ledger: (paths) => paths,
    matches: (criterion, cited) =>
      criterion.factPaths.some((factPath) =>
        cited.some((c) => prefixMatch(c, factPath))
      ),
    diff: "no code change",
  },
  {
    key: "B",
    name: "Widen the three definitions to the `manual` prefix",
    blurb:
      "`factPaths: ['manual']` on all three. Any manual citation attributes to every attested gate. Maximum recall, no precision.",
    ledger: (paths) => paths,
    matches: (_criterion, cited) => cited.some((c) => prefixMatch(c, "manual")),
    diff: "3 lines in PHASE_EXIT_CRITERIA",
  },
  {
    key: "C",
    name: "Attribute by signal, not by path shape",
    blurb:
      "Resolve any manual citation back to its signalKey (byKey.<sig> or attestations[i] -> rows[i].signalKey) and match that against the criterion's signal.",
    ledger: (paths) => paths,
    matches: (criterion, cited) =>
      cited.some((c) => signalOfPath(c) === criterion.signal),
    diff: "one resolver + a branch in addressesCriterion (~15 lines, unit-testable, no UI change on byKey fixtures)",
  },
  {
    key: "D",
    name: "Narrow the ledger — stop offering the second shape",
    blurb:
      "Exclude `manual.attestations[]` from flattenFacts so `manual.byKey.<signal>` is the ONLY citable form. The ambiguity cannot be emitted.",
    ledger: (paths) =>
      paths.filter((p) => !p.startsWith("manual.attestations")),
    matches: (criterion, cited) =>
      criterion.factPaths.some((factPath) =>
        cited.some((c) => prefixMatch(c, factPath))
      ),
    diff: "a filter in flattenFacts + its test; costs the judge attestedAt (recency) as a citable fact",
  },
];

/**
 * Under D the judge never sees the attestation paths, so it cites the byKey
 * form instead. Rewrite a scenario's citations into the direction's ledger.
 */
export function citationsUnder(
  direction: Direction,
  insight: Insight
): string[] {
  const allowed = new Set(direction.ledger(citableManualPaths()));
  return insight.citedPaths.map((path) => {
    if (!path.startsWith("manual.") || allowed.has(path)) return path;
    const signal = signalOfPath(path);
    return signal ? `manual.byKey.${signal}` : path;
  });
}

/** What the lens measures. Identical under every direction — only attribution moves. */
export const STANDINGS: Record<string, string> = {
  values_documented: "met",
  financial_base: "met",
  systems_tested: "not_met",
};

export type Row = {
  criterion: Criterion;
  addressed: boolean;
  addressedBy: string[];
  /** met | not_met | unknown come from the lens, unchanged by every direction. */
  standing: string;
};

export function runDirection(direction: Direction, scenario: Scenario): Row[] {
  return CRITERIA.map((criterion) => {
    const addressedBy = scenario.insights
      .filter((insight) =>
        direction.matches(criterion, citationsUnder(direction, insight))
      )
      .map((insight) => insight.id);
    return {
      criterion,
      addressed: addressedBy.length > 0,
      addressedBy,
      standing: STANDINGS[criterion.key] ?? "unknown",
    };
  });
}

/** Grade a direction against ground truth: misses and over-claims. */
export function grade(
  direction: Direction,
  scenario: Scenario
): { missed: string[]; overclaimed: string[] } {
  const missed: string[] = [];
  const overclaimed: string[] = [];
  for (const criterion of CRITERIA) {
    const truthAddressed = scenario.insights.some((insight) =>
      insight.truth.includes(criterion.key)
    );
    const got = scenario.insights.some((insight) =>
      direction.matches(criterion, citationsUnder(direction, insight))
    );
    if (truthAddressed && !got) missed.push(criterion.key);
    if (!truthAddressed && got) overclaimed.push(criterion.key);
  }
  return { missed, overclaimed };
}
