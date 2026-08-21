import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PHASE_EXIT_CRITERIA } from "@/lib/phase-engine/assessment/exit-criteria";
import { manualSignalClause } from "@/lib/phase-engine/fact-phrases";
import { MANUAL_BY_KEY_PREFIX } from "@/lib/phase-engine/attestation-citation";
import { sourceReader } from "@/lib/testing/source-span";

import { MANUAL_SIGNALS, MANUAL_SIGNAL_KEYS } from "./manual-signals";

// ----------------------------------------------------------------------------
// ONE manual-signal vocabulary (PE-005).
//
// A signal key has to mean the same thing in three places — the toggle that
// WRITES it, the clause a citation READS as, and the phase gate that MEASURES
// it at `manual.byKey.<key>`. Each used to spell it for itself, and every way of
// getting them out of step is silent: rename a key and its gate reads `unknown`
// forever while the planter keeps answering the switch.
//
// The clause is the fourth string a signal owns and now sits in the same object
// literal as the other three, so "this signal has no wording" is not a state the
// vocabulary can be in. These tests pin what is still reachable: the keys, the
// gates that measure them, the card that renders them, and the one boundary that
// WRITES them.
// ----------------------------------------------------------------------------

test("the keys are distinct and every signal carries its four strings", () => {
  assert.ok(MANUAL_SIGNALS.length > 0);
  assert.equal(new Set(MANUAL_SIGNAL_KEYS).size, MANUAL_SIGNAL_KEYS.length);
  for (const signal of MANUAL_SIGNALS) {
    assert.ok(signal.key.trim().length > 0, "a signal key is never blank");
    assert.ok(signal.label.trim().length > 0);
    assert.ok(signal.description.trim().length > 0);
    assert.equal(signal.clause, signal.clause.trim());
    assert.ok(signal.clause.length > 0);

    // NOT the deleted "reads back as a written clause" test, which could no
    // longer fail once the clause moved into this table. This one fails if
    // `fact-phrases.ts` ever grows a second clause table beside the vocabulary
    // again — the drift a `satisfies Record<ManualSignalKey, string>` one module
    // away could never catch.
    assert.equal(
      manualSignalClause(signal.key),
      signal.clause,
      `${signal.key} reads back as wording this table does not hold`
    );
  }
});

// The WRITE boundary — `setManualSignalSchema` is a `z.enum` over
// `MANUAL_SIGNAL_KEYS` — is pinned once, where the schema lives:
// `signals/attestation-service.test.ts`, "rejects a signal key outside the
// closed vocabulary". It drives off this table, so a fifth signal is covered by
// existing.

test("every attested exit criterion names a signal the planter can answer", () => {
  const attested: string[] = [];

  for (const definitions of Object.values(PHASE_EXIT_CRITERIA)) {
    for (const definition of definitions) {
      for (const path of definition.factPaths) {
        if (!path.startsWith(MANUAL_BY_KEY_PREFIX)) continue;
        const key = path.slice(MANUAL_BY_KEY_PREFIX.length);
        attested.push(key);
        assert.ok(
          (MANUAL_SIGNAL_KEYS as readonly string[]).includes(key),
          `exit criterion "${definition.key}" gates on ${path}, which no toggle writes — the gate would read "unknown" forever`
        );
      }
    }
  }

  // The scan must actually have seen the attested gates; a walk that matched
  // nothing would pass silently, which is how a guardrail becomes decoration.
  assert.ok(
    attested.length >= 3,
    `expected the three attested gates, saw ${attested.length}`
  );
});

test("the toggle card declares no vocabulary of its own", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/phase-engine/signal-toggles.tsx"),
    "utf8"
  );
  const reader = sourceReader(source, "signal-toggles.tsx");

  assert.match(
    reader.after("export function SignalToggles("),
    /MANUAL_SIGNALS\.map\(/,
    "the card renders the one declaration"
  );
  for (const key of MANUAL_SIGNAL_KEYS) {
    assert.equal(
      source.includes(`"${key}"`),
      false,
      `${key} is spelled in the component again — the vocabulary lives in src/lib/phase-engine/manual-signals.ts`
    );
  }
});

// ----------------------------------------------------------------------------
// Prayer is rhythms, not a title (#474, C05/C21)
// ----------------------------------------------------------------------------

test("the two prayer-rhythm attestations carry the approved copy", () => {
  const byKey = new Map(MANUAL_SIGNALS.map((s) => [s.key, s]));

  const rhythm = byKey.get("prayer_rhythm_established");
  assert.equal(rhythm?.label, "Corporate prayer rhythm established");
  assert.equal(
    rhythm?.description,
    "Your core group has a regular, recurring rhythm of praying together."
  );
  assert.equal(
    rhythm?.clause,
    "your core group has an established corporate prayer rhythm"
  );

  const gatherings = byKey.get("prayer_in_gatherings");
  assert.equal(gatherings?.label, "Prayer woven into gatherings");
  assert.equal(
    gatherings?.description,
    "Prayer is a regular part of core-group and leadership gatherings."
  );
  assert.equal(
    gatherings?.clause,
    "prayer is regularly part of your gatherings"
  );
});

test("only the rhythm attestations perish", () => {
  // A claim about the present tense goes stale; a thing that happened does not.
  // The card reads this flag rather than the keys, which is what keeps the
  // vocabulary in one place (see the source scan above).
  assert.deepEqual(
    MANUAL_SIGNALS.filter((s) => s.reaffirms).map((s) => s.key),
    // A giving culture is a present-tense claim just like a prayer rhythm
    // (#475), so it joins the same window.
    ["core_group_giving", "prayer_rhythm_established", "prayer_in_gatherings"]
  );
});

test("generosity and solvency are two separate attestations (#475)", () => {
  const byKey = new Map(MANUAL_SIGNALS.map((s) => [s.key, s]));

  const giving = byKey.get("core_group_giving");
  assert.equal(giving?.label, "Core group giving sacrificially");
  assert.equal(
    giving?.description,
    "People in your core group are learning to give sacrificially and regularly."
  );
  assert.equal(giving?.clause, "your core group is giving sacrificially");

  // THE KEY DID NOT MOVE. It is what the Phase 1 financial gate reads, and what
  // every already-answered row in `plant_signals` carries; renaming it would
  // reset that gate to `unknown` for every plant that had answered it.
  const funding = byKey.get("financial_base_established");
  assert.equal(funding?.label, "Launch funding viable");
  assert.equal(funding?.clause, "your launch funding is viable");
  assert.equal(funding?.reaffirms, false);
});

test("the Prayer Leader toggle survives, as coverage", () => {
  // #474 demoted it out of CSF-5; it did not delete it. An unfilled role is
  // still worth knowing — it is just not evidence that a plant prays.
  const leader = MANUAL_SIGNALS.find((s) => s.key === "prayer_leader_assigned");
  assert.ok(leader, "the prayer-leader attestation was removed, not demoted");
  assert.equal(leader.reaffirms, false);
});

test("the reaffirm chip is driven by the flag, not by a key", () => {
  const source = readFileSync(
    join(process.cwd(), "src/components/phase-engine/signal-toggles.tsx"),
    "utf8"
  );
  assert.match(
    source,
    /signal\.reaffirms/,
    "the card must ask the vocabulary which signals perish"
  );
});

test("AC-2: the Phase 1 financial gate still reads the same key", () => {
  // #475 narrowed the WORDS of `financial_base_established` and left the KEY
  // alone, which is the whole safety of the change: every plant that answered
  // it keeps its answer, and the gate keeps reading it. If this ever fails, it
  // means somebody renamed the key and every answered gate silently reset to
  // `unknown`.
  const financial = Object.values(PHASE_EXIT_CRITERIA)
    .flat()
    .find((criterion) => criterion.key === "financial_base");

  assert.ok(financial, "the Phase 1 financial gate disappeared");
  assert.deepEqual(financial.factPaths, [
    "manual.byKey.financial_base_established",
  ]);
});
