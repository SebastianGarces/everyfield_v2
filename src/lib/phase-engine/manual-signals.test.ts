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
// The clause half is now a compile error (`satisfies Record<ManualSignalKey,
// string>` in fact-phrases.ts). These tests pin the other two.
// ----------------------------------------------------------------------------

test("the keys are distinct and non-empty", () => {
  assert.ok(MANUAL_SIGNALS.length > 0);
  assert.equal(new Set(MANUAL_SIGNAL_KEYS).size, MANUAL_SIGNAL_KEYS.length);
  for (const signal of MANUAL_SIGNALS) {
    assert.ok(signal.key.trim().length > 0, "a signal key is never blank");
    assert.ok(signal.label.trim().length > 0);
    assert.ok(signal.description.trim().length > 0);
  }
});

test("every signal reads back as a written clause, never as its raw key", () => {
  for (const key of MANUAL_SIGNAL_KEYS) {
    const clause = manualSignalClause(key);
    assert.notEqual(
      clause,
      key,
      `${key} has no clause — a citation of it would print the ledger key`
    );
    assert.equal(clause, clause.trim());
    assert.ok(clause.length > 0);
  }
});

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
