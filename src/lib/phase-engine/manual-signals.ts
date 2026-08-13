// ============================================================================
// The manual self-attestation vocabulary (PE-005) — ONE declaration.
//
// A manual signal key is a string that has to mean the same thing in four
// places at once, and until this module existed each of them spelled it for
// itself:
//
//   1. `components/phase-engine/signal-toggles.tsx` — the switches a planter
//      answers, which is what the WRITE behind them stores in
//      `plant_signals.signal_key`.
//   2. `fact-phrases.ts` → `MANUAL_SIGNAL_CLAUSES` — the clause a citation of
//      that signal READS as ("you confirmed your financial base is in place").
//   3. `assessment/exit-criteria.ts` → `attested(<key>, …)` — the phase gate
//      that MEASURES it, at `manual.byKey.<key>`.
//   4. `signals/attestation-service.ts` → `setManualSignalSchema` — the zod
//      schema every write is parsed by, including the anonymous POST that
//      reaches `setManualSignalAction` with no UI in front of it.
//
// Nothing tied the four together, and every way of getting them out of step is
// silent. Rename a toggle's key and its gate reads `unknown` forever while the
// planter keeps answering it; add a fifth toggle and its citations print the
// de-camelised key back at the planter, with no gate behind them. There is no
// runtime error and no test failure in either case — the string simply stops
// matching a string somewhere else.
//
// So the vocabulary is declared here, once — key, copy AND clause in one object
// literal per signal — and the other sites are bound to it: the three READERS
// by the `ManualSignalKey` union, and the WRITER by `MANUAL_SIGNAL_KEYS`, which
// `setManualSignalSchema` is a `z.enum` over. A new signal is one entry in
// `MANUAL_SIGNALS` and nothing else; a key outside the list is rejected at the
// boundary rather than stored and read back as its own de-camelised spelling.
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
  /**
   * What a citation of this signal reads back as, completing "you confirmed …".
   *
   * It lives HERE, beside the label it has to agree with, rather than in
   * `fact-phrases.ts`: a `satisfies Record<ManualSignalKey, string>` one module
   * away catches a MISSING clause and cannot catch a DRIFTED one, which is the
   * only property the pair exists for — the evidence a planter is shown must
   * use the same words as the control that produced it.
   */
  clause: string;
}

/**
 * The curated signals, in the order the toggle card renders them.
 *
 * One object literal per signal, holding every string that signal owns. Adding
 * a fifth is one edit in one file.
 */
export const MANUAL_SIGNALS = [
  {
    key: "values_documented",
    label: "Core values documented",
    description: "Your plant's vision and values are written down and shared.",
    clause: "your core values are documented",
  },
  {
    key: "financial_base_established",
    label: "Financial base in place",
    description: "Initial funding and a giving plan are established.",
    clause: "your financial base is in place",
  },
  {
    key: "prayer_leader_assigned",
    label: "Prayer leader assigned",
    description: "Someone owns the prayer covering for the plant.",
    clause: "a prayer leader is assigned",
  },
  {
    key: "systems_tested",
    label: "Launch systems tested",
    description: "Check-in, giving, and gathering logistics have a dry run.",
    clause: "your launch systems have been tested",
  },
] as const satisfies readonly ManualSignalDefinition[];

/**
 * One entry of {@link MANUAL_SIGNALS}, with its `key` narrowed to the closed
 * union. The toggle card renders THIS, not `ManualSignalDefinition`: the switch
 * hands `signal.key` to `setManualSignalAction`, whose schema is a `z.enum` over
 * the vocabulary, so a widened `key: string` would not type-check there.
 */
export type ManualSignal = (typeof MANUAL_SIGNALS)[number];

/**
 * The closed set of keys. Every phase gate is typed against this, so
 * `attested("systems_testd", …)` is a compile error instead of a gate that
 * reads `unknown` forever.
 */
export type ManualSignalKey = (typeof MANUAL_SIGNALS)[number]["key"];

/**
 * The keys alone, for a caller that needs the vocabulary and not the copy.
 *
 * A NON-EMPTY TUPLE on purpose: `setManualSignalSchema` is a `z.enum` over it
 * (`signals/attestation-service.ts`), which is what binds the WRITE side to the
 * same closed set the readers are typed against. `readonly ManualSignalKey[]`
 * does not satisfy `z.enum`, and the compile error it produced is what let the
 * schema stay a free-form string.
 */
export const MANUAL_SIGNAL_KEYS = MANUAL_SIGNALS.map(
  (signal) => signal.key
) as [ManualSignalKey, ...ManualSignalKey[]];
