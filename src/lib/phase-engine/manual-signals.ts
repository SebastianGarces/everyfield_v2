// ============================================================================
// The manual self-attestation vocabulary (PE-005) — ONE declaration.
//
// A manual signal key is a string that has to mean the same thing in three
// places at once, and until this module existed each of them spelled it for
// itself:
//
//   1. `components/phase-engine/signal-toggles.tsx` — the switches a planter
//      answers, which is what WRITES `plant_signals.signal_key`.
//   2. `fact-phrases.ts` → `MANUAL_SIGNAL_CLAUSES` — the clause a citation of
//      that signal READS as ("you confirmed your financial base is in place").
//   3. `assessment/exit-criteria.ts` → `attested(<key>, …)` — the phase gate
//      that MEASURES it, at `manual.byKey.<key>`.
//
// Nothing tied the three together, and every way of getting them out of step is
// silent. Rename a toggle's key and its gate reads `unknown` forever while the
// planter keeps answering it; add a fifth toggle and its citations print the
// de-camelised key back at the planter, with no gate behind them. There is no
// runtime error and no test failure in either case — the string simply stops
// matching a string somewhere else.
//
// So the KEYS are declared here, once, as a closed union, and the other three
// sites are typed against it: a new signal is one entry in `MANUAL_SIGNALS`, and
// omitting its clause is a compile error rather than a wording bug on `/phase`.
//
// IMPORT-FREE ON PURPOSE. A `"use client"` island renders these labels, so this
// module must never grow a value import that drags the DB client into a browser
// chunk (the same rule `src/lib/invitations/register-path.ts` is held to).
// ============================================================================

/**
 * One curated self-attestation: a fact EveryField cannot observe, which only the
 * planter can answer.
 */
export interface ManualSignalDefinition {
  /** The stored `plant_signals.signal_key`, and the `manual.byKey.<key>` path. */
  key: string;
  /** The switch's label, sentence case. */
  label: string;
  /** One line under the label on what answering it asserts. */
  description: string;
}

/**
 * The curated signals, in the order the toggle card renders them.
 *
 * Wording tracks the clause each one reads back as (`fact-phrases.ts` →
 * `MANUAL_SIGNAL_CLAUSES`) so the evidence a planter is shown uses the same
 * words as the control that produced it.
 */
export const MANUAL_SIGNALS = [
  {
    key: "values_documented",
    label: "Core values documented",
    description: "Your plant's vision and values are written down and shared.",
  },
  {
    key: "financial_base_established",
    label: "Financial base in place",
    description: "Initial funding and a giving plan are established.",
  },
  {
    key: "prayer_leader_assigned",
    label: "Prayer leader assigned",
    description: "Someone owns the prayer covering for the plant.",
  },
  {
    key: "systems_tested",
    label: "Launch systems tested",
    description: "Check-in, giving, and gathering logistics have a dry run.",
  },
] as const satisfies readonly ManualSignalDefinition[];

/**
 * The closed set of keys. A phase gate and a clause table are both typed against
 * this, so `attested("systems_testd", …)` and a missing clause are both compile
 * errors instead of a gate that reads `unknown` forever.
 */
export type ManualSignalKey = (typeof MANUAL_SIGNALS)[number]["key"];

/** The keys alone, for a caller that needs the vocabulary and not the copy. */
export const MANUAL_SIGNAL_KEYS: readonly ManualSignalKey[] =
  MANUAL_SIGNALS.map((signal) => signal.key);
