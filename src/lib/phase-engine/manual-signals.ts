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
//      that signal READS as ("you confirmed your launch funding is viable").
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
  /**
   * This attestation GOES STALE, so the card asks again once the reaffirm
   * window has passed (#474 D2).
   *
   * A DECLARED PROPERTY RATHER THAN A KEY CHECK IN THE CARD. Bryan's second
   * prayer question — "has that gathering actually happened in the last 30
   * days?" — is not a third toggle; it is the age of an answer the planter
   * already gave. But the card may not learn which signals those are by
   * spelling their keys (`manual-signals.test.ts` fails if it does, and the
   * whole point of this module is that the vocabulary has one home). So the
   * signal declares its own perishability and the card reads it.
   *
   * `values_documented` and `systems_tested` do NOT perish: documenting values
   * once is documenting them, and a dry run that happened, happened. A rhythm
   * is a claim about the present tense.
   */
  reaffirms: boolean;
}

/**
 * How long a perishable answer stays fresh, in days (#474 D2).
 *
 * Here rather than beside the snapshot's other thresholds because it is a
 * property of the VOCABULARY, not of a signal computation — and because this
 * module is import-free, so the `"use client"` toggle card can read the same
 * number the judge is handed without dragging the DB client into a browser
 * chunk. `build-fact-snapshot` imports it from here.
 */
export const ATTESTATION_REAFFIRM_WINDOW_DAYS = 30;

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
    // Documenting values once is documenting them. Nothing expires.
    reaffirms: false,
  },
  {
    // SOLVENCY ONLY, since #475 (C06). The old label — "Initial funding and a
    // giving plan are established" — fused two questions Bryan pulled apart:
    // "A plant could have a healthy financial base because of outside support
    // while the core group is not giving sacrificially. The opposite could also
    // be true." One toggle could not answer both, so this one answers the
    // second and `core_group_giving` below answers the first.
    //
    // THE KEY DOES NOT MOVE. It is read by the Phase 1 financial gate
    // (`assessment/exit-criteria.ts`) and by every row already in
    // `plant_signals`; renaming it would silently reset the gate to `unknown`
    // for every plant that had answered it.
    key: "financial_base_established",
    label: "Launch funding viable",
    description:
      "Funds and support available now are enough to launch and sustain ministry.",
    clause: "your launch funding is viable",
    reaffirms: false,
  },
  {
    key: "core_group_giving",
    label: "Core group giving sacrificially",
    description:
      "People in your core group are learning to give sacrificially and regularly.",
    clause: "your core group is giving sacrificially",
    // A giving culture is a claim about the present tense, exactly like a
    // prayer rhythm — so it perishes on the same 30-day window (#474).
    reaffirms: true,
  },
  {
    // COVERAGE, NOT HEALTH, since #474 (C05). Bryan: "I would be careful not to
    // equate having a Prayer Leader with being a praying plant… I don't think
    // 'Do you have a Prayer Leader?' tells you very much about whether prayer
    // is actually central." The toggle stays — an unfilled role is still worth
    // knowing — but rubric v1 cites it under CSF-7 role coverage, and CSF-5
    // reads the two rhythm attestations below instead.
    key: "prayer_leader_assigned",
    label: "Prayer leader assigned",
    description: "Someone owns the prayer covering for the plant.",
    clause: "a prayer leader is assigned",
    // A title does not perish; whether it means anything is what CSF-5 stopped
    // asking it.
    reaffirms: false,
  },
  {
    key: "prayer_rhythm_established",
    label: "Corporate prayer rhythm established",
    description:
      "Your core group has a regular, recurring rhythm of praying together.",
    clause: "your core group has an established corporate prayer rhythm",
    reaffirms: true,
  },
  {
    key: "prayer_in_gatherings",
    label: "Prayer woven into gatherings",
    description:
      "Prayer is a regular part of core-group and leadership gatherings.",
    clause: "prayer is regularly part of your gatherings",
    reaffirms: true,
  },
  {
    key: "systems_tested",
    label: "Launch systems tested",
    description: "Check-in, giving, and gathering logistics have a dry run.",
    clause: "your launch systems have been tested",
    // A dry run that happened, happened.
    reaffirms: false,
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
 * `setManualSignalSchema` consumes it as a `z.enum`
 * (`signals/attestation-service.ts`), which is what binds the WRITE side to the
 * same closed set the three readers are typed against — so a key outside this
 * list is rejected at the boundary instead of being stored and read back to a
 * planter as its own de-camelised spelling.
 */
export const MANUAL_SIGNAL_KEYS: readonly ManualSignalKey[] =
  MANUAL_SIGNALS.map((signal) => signal.key);
