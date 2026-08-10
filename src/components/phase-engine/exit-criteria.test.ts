// ============================================================================
// ExitCriteria — DOM-level tests (PE-022 + PE-025).
//
// The projection tests (lib/phase-engine/assessment/exit-criteria.test.ts) pin
// what the read layer PRODUCES. These pin what a browser actually RECEIVES,
// because three of this unit's acceptance criteria are assertions about the
// rendered surface, not about the projection behind it:
//
//   - the gates render individually, each carrying the engine's standing,
//   - a gate the judge did not address SAYS so instead of rendering as failed,
//   - the values shown are the snapshot's, never the model's quoted text,
//   - the expansion control carries `cursor-pointer` (project hard rule) —
//     `<summary>` is not a `<button>` or an `<a>`, so it does NOT inherit the
//     cursor from globals.css and the class has to be on the element.
//
// `renderToStaticMarkup` gives the exact markup the browser is served, so
// asserting on it is a real assertion about the DOM — no jsdom needed for a
// server component with no client behaviour. Same approach as
// components/ui/progress.test.ts.
//
// The fixture is a hand-built `ExitCriteriaProgress` rather than one projected
// from a snapshot: this file is about the rendering contract, and building the
// input by hand keeps it from importing `queries.ts` (which constructs the Neon
// client at import time) for a test that touches no data layer.
// ============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PlantInsight } from "@/db/schema";
import type {
  ExitCriteriaProgress,
  ExitCriterionProgress,
} from "@/lib/phase-engine/assessment";

import { ExitCriteria } from "./exit-criteria";

// ----------------------------------------------------------------------------
// A tiny markup reader.
// ----------------------------------------------------------------------------

/**
 * The markup of each criterion row, in document order. Splitting on the row's
 * own opening tag is exact: `data-testid="exit-criterion"` with a closing quote
 * never matches the drill-down's `exit-criterion-fact` / `-cited-fact` ids.
 */
function rows(html: string): string[] {
  return html.split('<li data-testid="exit-criterion" ').slice(1);
}

/** The first value of `name="…"` in a chunk — the row's own, when scoped to it. */
function attr(chunk: string, name: string): string | null {
  const match = chunk.match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : null;
}

/** Every `<li data-testid="<testid>" …>` body inside a chunk. */
function items(chunk: string, testid: string): string[] {
  const pattern = new RegExp(
    `<li data-testid="${testid}"[^>]*>([\\s\\S]*?)</li>`,
    "g"
  );
  return [...chunk.matchAll(pattern)].map((match) => match[1]);
}

function render(progress: ExitCriteriaProgress | null): string {
  return renderToStaticMarkup(createElement(ExitCriteria, { progress }));
}

// ----------------------------------------------------------------------------
// Fixtures — one criterion the judge addressed, one it stayed silent on.
// ----------------------------------------------------------------------------

const GENERATED_AT = new Date("2026-07-20T09:00:00.000Z");

function makeInsight(overrides: Partial<PlantInsight> = {}): PlantInsight {
  return {
    id: "insight-1",
    assessmentId: "assessment-1",
    churchId: "church-1",
    audience: "planter",
    category: "critical_mass",
    severity: "high",
    title: "Core-group growth is behind the gate",
    body: "You are 8 short of the 30 the rubric asks for before phase 2.",
    citedFacts: ["coreGroup.committedCount=22"],
    relatedArticleSlugs: [],
    rank: 0,
    createdAt: GENERATED_AT,
    ...overrides,
  } as PlantInsight;
}

function makeCriterion(
  overrides: Partial<ExitCriterionProgress> = {}
): ExitCriterionProgress {
  return {
    key: "committed_adults",
    label: "30 committed adults",
    detail: "The rubric's core-group gate for leaving phase 1.",
    factPaths: ["coreGroup.committedCount"],
    categories: ["critical_mass"],
    measurement: "not_met",
    reading: "22 of the 30 committed adults the rubric asks for.",
    facts: [{ path: "coreGroup.committedCount", present: true, value: "22" }],
    standing: "attention",
    insights: [makeInsight()],
    evidence: [
      {
        insightId: "insight-1",
        path: "coreGroup.committedCount",
        signalKey: null,
        citedValue: "22",
        snapshotValue: "22",
        inSnapshot: true,
        agrees: true,
      },
    ],
    ...overrides,
  } as ExitCriterionProgress;
}

/** The gate nobody spoke to: measured, but no insight and no citation. */
function silentCriterion(): ExitCriterionProgress {
  return makeCriterion({
    key: "worship_leader",
    label: "A worship leader in place",
    detail: "One of the ministry roles the rubric wants filled before launch.",
    factPaths: ["ministryRoles.roles"],
    measurement: "not_met",
    reading: "The worship role is not filled.",
    facts: [{ path: "ministryRoles.filledCount", present: true, value: "2" }],
    standing: "not_addressed",
    insights: [],
    evidence: [],
  });
}

function makeProgress(
  criteria: ExitCriterionProgress[] = [makeCriterion(), silentCriterion()],
  overrides: Partial<ExitCriteriaProgress> = {}
): ExitCriteriaProgress {
  return {
    assessmentId: "assessment-1",
    generatedAt: GENERATED_AT,
    rubricVersion: "v0",
    phase: 1,
    nextPhase: 2,
    audience: "planter",
    isTerminalPhase: false,
    criteria,
    metCount: 0,
    measuredCount: criteria.length,
    addressedCount: criteria.filter((c) => c.standing !== "not_addressed")
      .length,
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// AC: the gates render individually, with the engine's standing on each.
// ----------------------------------------------------------------------------

test("PE-022: every criterion renders as its own row, carrying its standing", () => {
  const html = render(makeProgress());
  const rendered = rows(html);

  assert.equal(rendered.length, 2);
  assert.deepEqual(
    rendered.map((row) => attr(row, "data-criterion")),
    ["committed_adults", "worship_leader"]
  );
  assert.deepEqual(
    rendered.map((row) => attr(row, "data-standing")),
    ["attention", "not_addressed"]
  );
  // The two columns of truth stay separate in the markup, not blended.
  assert.deepEqual(
    rendered.map((row) => attr(row, "data-measurement")),
    ["not_met", "not_met"]
  );
  // The standing is readable as WORDS, never as colour alone.
  assert.match(rendered[0], /Needs attention/);
  assert.match(rendered[0], /30 committed adults/);
});

// ----------------------------------------------------------------------------
// AC (project hard rule): expansion controls carry cursor-pointer.
// ----------------------------------------------------------------------------

test("PE-022: every expansion control carries cursor-pointer", () => {
  const html = render(makeProgress());
  const toggles = [
    ...html.matchAll(/<summary[^>]*data-testid="exit-criterion-toggle"[^>]*>/g),
  ].map((match) => match[0]);

  assert.equal(toggles.length, 2);
  for (const toggle of toggles) {
    assert.match(toggle, /cursor-pointer/);
  }
});

// ----------------------------------------------------------------------------
// AC: a criterion the judge did not address says so, rather than failing.
// ----------------------------------------------------------------------------

test("PE-022: an unaddressed gate says so and never borrows the failure palette", () => {
  const silent = rows(render(makeProgress()))[1];

  assert.equal(attr(silent, "data-standing"), "not_addressed");
  assert.match(silent, /Not addressed/);
  assert.match(silent, /did not speak to this criterion/);
  assert.match(silent, /not the same as failing it/);
  // The attention ink is what "the judge escalated this" looks like. Silence
  // must never be painted with it.
  assert.doesNotMatch(silent, /attention-high-ink/);
  assert.doesNotMatch(silent, /Needs attention/);
});

// ----------------------------------------------------------------------------
// AC: the facts shown are the snapshot's values, never the model's words.
// ----------------------------------------------------------------------------

test("PE-025: a citation renders the snapshot's value, with the quoted one only as a correction", () => {
  const disagreeing = makeCriterion({
    evidence: [
      {
        insightId: "insight-1",
        path: "coreGroup.committedCount",
        signalKey: null,
        citedValue: "40",
        snapshotValue: "22",
        inSnapshot: true,
        agrees: false,
      },
    ],
  });

  const cited = items(
    rows(render(makeProgress([disagreeing])))[0],
    "exit-criterion-cited-fact"
  );

  assert.equal(cited.length, 1);
  assert.match(cited[0], /22/);
  // The model's number may appear ONLY inside the correction clause that names
  // it as the assessment's own quote.
  assert.match(cited[0], /the assessment quoted 40; your snapshot is what is/);
});

test("PE-025: a cited path that is not in the snapshot is not shown as a fact", () => {
  const unverifiable = makeCriterion({
    evidence: [
      {
        insightId: "insight-1",
        path: "coreGroup.committedCount",
        signalKey: null,
        citedValue: "40",
        snapshotValue: null,
        inSnapshot: false,
        agrees: false,
      },
    ],
  });

  const cited = items(
    rows(render(makeProgress([unverifiable])))[0],
    "exit-criterion-cited-fact"
  );

  assert.equal(cited.length, 1);
  assert.match(cited[0], /not in this snapshot, so it is not shown as a fact/);
  assert.doesNotMatch(cited[0], /40/);
});

test("PE-025: a citation whose snapshot value is null says 'not recorded', not a bare label", () => {
  // `inSnapshot: true, snapshotValue: null` is the citation-side twin of a
  // present-but-null fact: the path resolved, the plant has nothing there. It
  // must read as the empty reading it is, not as a label with its value lost.
  const empty = makeCriterion({
    evidence: [
      {
        insightId: "insight-1",
        path: "launch.launchDate",
        signalKey: null,
        citedValue: null,
        snapshotValue: null,
        inSnapshot: true,
        agrees: true,
      },
    ],
  });

  const cited = items(
    rows(render(makeProgress([empty])))[0],
    "exit-criterion-cited-fact"
  );

  assert.equal(cited.length, 1);
  assert.match(cited[0], /not recorded/);
  assert.doesNotMatch(cited[0], /not in this snapshot/);
});

// ----------------------------------------------------------------------------
// AC (#319, ruled 2026-08-10): one attestation, two legal spellings, one
// sentence. The snapshot writes every manual attestation to both
// `manual.byKey.<signal>` and `manual.attestations[]`, so the judge may cite
// either — and having made both land on this gate, the drill-down must not then
// read one of them as "something you confirmed".
// ----------------------------------------------------------------------------

test("PE-025: both spellings of one attestation read the same specific sentence", () => {
  const attested = makeCriterion({
    key: "financial_base",
    label: "A financial base in place",
    factPaths: ["manual.byKey.financial_base_established"],
    measurement: "met",
    reading: "You have confirmed your financial base is in place.",
    facts: [
      {
        path: "manual.byKey.financial_base_established",
        present: true,
        value: "true",
      },
    ],
    evidence: [
      {
        insightId: "insight-1",
        path: "manual.byKey.financial_base_established",
        signalKey: null,
        citedValue: "true",
        snapshotValue: "true",
        inSnapshot: true,
        agrees: true,
      },
      {
        insightId: "insight-1",
        path: "manual.attestations.1.value",
        // What the read layer resolved row 1 to, out of the same snapshot.
        signalKey: "financial_base_established",
        citedValue: "true",
        snapshotValue: "true",
        inSnapshot: true,
        agrees: true,
      },
    ],
  });

  const row = rows(render(makeProgress([attested])))[0];
  const cited = items(row, "exit-criterion-cited-fact");

  assert.equal(cited.length, 2);
  assert.equal(cited[0], "you confirmed your financial base is in place");
  // The whole point: identical wording, not merely both non-empty.
  assert.equal(cited[1], cited[0]);
  // …and none of the old anonymous phrasing survives on either row.
  assert.doesNotMatch(row, /something you confirmed/);

  // The citation itself is untouched — `data-path` is what the judge wrote, so
  // a reader checking the assessment against the snapshot still can.
  assert.ok(
    row.includes('data-path="manual.byKey.financial_base_established"')
  );
  assert.ok(row.includes('data-path="manual.attestations.1.value"'));
});

test("PE-025: an attestation row that did not resolve keeps the generic phrasing", () => {
  // `signalKey: null` is the read layer saying it could not resolve the row —
  // an out-of-range index, or a snapshot whose row carries no signal. The
  // drill-down must degrade to what the citation says on its face, never guess
  // a signal, and never leak ledger syntax while doing it.
  const unresolved = makeCriterion({
    evidence: [
      {
        insightId: "insight-1",
        path: "manual.attestations.7.value",
        signalKey: null,
        citedValue: "true",
        snapshotValue: "true",
        inSnapshot: true,
        agrees: true,
      },
    ],
  });

  const cited = items(
    rows(render(makeProgress([unresolved])))[0],
    "exit-criterion-cited-fact"
  );

  assert.equal(cited.length, 1);
  assert.equal(cited[0], "something you confirmed");
  assert.doesNotMatch(cited[0], /manual\.|=/);
});

test("PE-022: a lens read the snapshot did not answer is labelled, not asserted", () => {
  // `present: false` means the path did not resolve — the phrase has no value
  // behind it, so the row must say that rather than print a bare label that
  // reads like a fact with its number lost.
  const missing = makeCriterion({
    facts: [
      { path: "coreGroup.committedCount", present: true, value: "22" },
      { path: "coreGroup.launchTeamCount", present: false, value: null },
    ],
  });

  const facts = items(
    rows(render(makeProgress([missing])))[0],
    "exit-criterion-fact"
  );

  assert.equal(facts.length, 2);
  assert.match(facts[0], /22/);
  assert.match(facts[1], /not in this snapshot yet/);
});

test("PE-022: a fact that IS in the snapshot but holds no value says 'not recorded'", () => {
  // `present: true, value: null` is a real reading — the path resolved and the
  // plant has nothing there (every pre-launch plant's `launch.launchDate`). It
  // must keep the ordinary phrasing and say the value is absent; the bare label
  // "launch date (launch)" reads as a fact with its value lost.
  const stored = makeCriterion({
    key: "launch_date_set",
    label: "Launch date set",
    factPaths: ["launch.launchDate"],
    measurement: "not_met",
    reading: "No launch date set yet.",
    facts: [{ path: "launch.launchDate", present: true, value: null }],
    standing: "not_addressed",
    insights: [],
    evidence: [],
  });

  const facts = items(
    rows(render(makeProgress([stored])))[0],
    "exit-criterion-fact"
  );

  assert.equal(facts.length, 1);
  assert.match(facts[0], /not recorded/);
  // …and NOT the `present: false` sentence, which would be a different claim.
  assert.doesNotMatch(facts[0], /not in this snapshot yet/);
});

// ----------------------------------------------------------------------------
// The two states with no rows at all.
// ----------------------------------------------------------------------------

test("PE-022: a never-assessed plant renders the cold start, not a list of unmet gates", () => {
  const html = render(null);

  assert.equal(rows(html).length, 0);
  assert.match(html, /hasn(&#x27;|')t been assessed yet/);
});

test("PE-022: the terminal phase says there is no gate rather than rendering none", () => {
  const html = render(
    makeProgress([], {
      isTerminalPhase: true,
      nextPhase: null,
      phase: 6,
      measuredCount: 0,
    })
  );

  assert.equal(rows(html).length, 0);
  assert.match(html, /no gate past it/);
});
