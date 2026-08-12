// ============================================================================
// Manual self-attestations, as citations (#319).
//
// A manual attestation is citable TWO legal ways and BOTH are correct:
// `signals/build-fact-snapshot.ts` writes the manual block twice
// (`manual.byKey.<signal>` and `manual.attestations[]`) and the judge's citable
// ledger is the whole flattened snapshot, so which spelling arrives is the
// model's coin-flip. Nothing a planter reads may depend on it
// (memory/invariants.md → Phase Engine — Cited Facts & Attestation Citations).
//
// This module owns that taxonomy end to end:
//
//   1. THE TWO LEGAL SPELLINGS, as the only two prefix constants in the phase
//      engine. Everything that classifies, resolves or builds one of these paths
//      imports them from here — `assessment/snapshot-fact.ts` (attribution's
//      read) and `assessment/exit-criteria.ts` (the gate a citation is rewritten
//      onto). Two modules declaring their own `"manual.attestations."` differed
//      by one letter from each other's and could drift apart silently.
//
//   2. THE LEAVES, as ONE table. `manual.attestations.#.<leaf>` has exactly the
//      leaves in `ATTESTATION_LEAVES`, and every leaf must answer all THREE
//      questions a citation raises — what group it folds into, what the group
//      COUNTS as, and what it reads as on its own. They used to be three
//      switch/lookup sites plus a special case, so a fourth leaf could be added
//      to one and forgotten in the others; the failure that caused printed
//      "signal key (manual attestations)" — the ledger's own shape — on a card.
//
// Two invariants used to be prose. They are now structural:
//
//   - `counted` returns `Phrase`, NOT `Phrase | null`. A `null` would fall
//     through to `fact-format.ts`'s `fallbackPhrase`, which prints the ledger's
//     shape for a path this engine knows perfectly well. The type forbids it.
//   - AT MORE THAN ONE ROW A LEAF DROPS ITS SPECIFICS AND COUNTS. The group a
//     counting phrase speaks for holds every attestation asserting the same KIND
//     of thing, whatever signal each names, so a phrase that baked in the signal
//     (or the date) would name ONE of the rows it speaks for — the folding path
//     is a COUNTER and must never become a LISTER. `specificAtOne` is the one
//     implementation of that guard; a leaf gets it by using the builder rather
//     than by re-deriving `rows === 1` correctly.
//
// Pure and IO-free. Which signal row N holds is a READ of the assessment's own
// snapshot, so it is resolved by the caller (`assessment/snapshot-fact.ts`) and
// handed in; this module never guesses one.
// ============================================================================

import {
  ATTESTED_THINGS,
  ISO_DATE_PATTERN,
  manualSignalClause,
  perRow,
  SELF_REPORTS,
  toBoolean,
  toReadableDate,
  toWords,
  type Phrase,
  type RowPhrase,
  type RowSubject,
} from "@/lib/phase-engine/fact-phrases";

// ----------------------------------------------------------------------------
// The two legal spellings.
// ----------------------------------------------------------------------------

/** The keyed spelling of an attestation: the signal is IN the path. */
export const MANUAL_BY_KEY_PREFIX = "manual.byKey.";

/** The array spelling, as stored and as cited: `manual.attestations.N.<leaf>`. */
export const MANUAL_ATTESTATIONS_PREFIX = "manual.attestations.";

/**
 * The array spelling with its row index NORMALISED to `#`, which is the form a
 * citation reaches a template in (`fact-format.ts` → `normalizePath`).
 *
 * Named apart from {@link MANUAL_ATTESTATIONS_PREFIX} on purpose: the two used
 * to be `MANUAL_ATTESTATION_PREFIX` and `MANUAL_ATTESTATIONS_PREFIX` in two
 * modules that import each other, one letter apart, and a reader could not tell
 * them apart at a glance.
 */
const MANUAL_ATTESTATION_TEMPLATE_PREFIX = `${MANUAL_ATTESTATIONS_PREFIX}#.`;

// ----------------------------------------------------------------------------
// The leaf taxonomy.
// ----------------------------------------------------------------------------

/** Every leaf `manual.attestations.#.<leaf>` is allowed to be. */
export type AttestationLeafName = "value" | "signalKey" | "attestedAt";

/**
 * Everything one attestation leaf has to answer. All three, or it does not
 * compile — that is the point of the table.
 */
export interface AttestationLeaf {
  /**
   * The IDENTITY of the group this citation folds into: the template plus the
   * CLASS of the asserted value, signal-free and date-free BY CONSTRUCTION.
   *
   * Never the rendered phrase. Two of the three leaves put the signal or the
   * date INTO their phrase, so a phrase key gave every attestation a group of
   * its own, every group held one member, and the counting path printed each
   * one's specific sentence — a lister. Being signal-independent is also what
   * makes the fold spelling-independent: the two legal spellings land on one key
   * by construction rather than by happening to render alike.
   */
  groupKey(asserted: string | null): string;
  /**
   * The COUNTING phrase: what the group reads as at N rows, with the specifics
   * dropped above one. Total by signature — see the header, invariant 1.
   */
  counted(asserted: string | null): Phrase;
  /**
   * The SPECIFIC sentence, once the signal this citation names is known. `null`
   * when the leaf has nothing specific to say about this value (an `attestedAt`
   * that carries no parseable date), which keeps the counting phrase.
   */
  specific(signal: string, asserted: string | null): string | null;
}

/**
 * Drop the specifics above one row, written ONCE.
 *
 * `whenOne` is the only branch allowed to be specific; returning `null` from it
 * means "nothing specific to add", which reads as the bare subject. A leaf that
 * hand-rolled `rows === 1 && value ? … : subject` was re-deciding the counter's
 * central rule per leaf, three times.
 */
function specificAtOne(
  subject: RowSubject,
  whenOne: (named: string) => string | null
): RowPhrase {
  return perRow(subject, (named, rows) =>
    rows === 1 ? (whenOne(named) ?? named) : named
  );
}

/** What a citation of one manual signal reads as, keyed or not. */
function signalPhrase(signalKey: string, value: string | null): string {
  const clause = manualSignalClause(signalKey);
  const flag = toBoolean(value);
  if (flag === true) return `you confirmed ${clause}`;
  if (flag === false) return `you have not confirmed ${clause}`;
  return value ? `${clause}, reported as ${toWords(value)}` : clause;
}

/**
 * The ONE table. A fourth leaf is one new row here and nothing else: the record
 * key widens {@link AttestationLeafName}, and nothing compiles until all three
 * answers are supplied.
 *
 * The specific sentences are the WORDING half of the 2026-08-10 ruling on #319.
 * Attribution already resolves the array spelling onto its signal so both
 * spellings land on the same exit criterion; having landed on the same gate they
 * must also READ the same. "something you confirmed" beside "you confirmed your
 * financial base is in place" is the same evidence told twice, once vaguely, and
 * the vague one is what makes a planter doubt the specific one.
 */
export const ATTESTATION_LEAVES: Record<AttestationLeafName, AttestationLeaf> =
  {
    // `…value` asserts the attestation — exactly what the keyed spelling
    // asserts, so it is exactly the sentence the keyed spelling reads as.
    value: {
      groupKey: (asserted) => {
        // The value CLASS splits the group, because "you confirmed" and "you
        // have not confirmed" are two different assertions and counting them
        // together would claim a planter confirmed something they refused.
        const flag = toBoolean(asserted);
        return `attestation:value:${flag === null ? "other" : String(flag)}`;
      },
      counted: (asserted) => {
        const flag = toBoolean(asserted);
        if (flag === null) {
          return specificAtOne(SELF_REPORTS, (report) =>
            asserted ? `${report} of ${toWords(asserted)}` : null
          );
        }
        // A boolean names no signal and no date, so it is already specific-free
        // at every count and needs no `specificAtOne` guard.
        return perRow(ATTESTED_THINGS, (thing) =>
          flag ? `${thing} you confirmed` : `${thing} you have not confirmed`
        );
      },
      specific: (signal, asserted) => signalPhrase(signal, asserted),
    },

    // `…signalKey` names the fact and asserts nothing about it, which is what a
    // bare `manual.byKey.<signal>` citation does.
    signalKey: {
      groupKey: () => "attestation:signalKey",
      counted: (asserted) =>
        specificAtOne(SELF_REPORTS, (report) =>
          asserted ? `${report} about ${toWords(asserted)}` : null
        ),
      specific: (signal) => signalPhrase(signal, null),
    },

    // `…attestedAt` carries WHEN, which the keyed spelling has no path for. Name
    // the signal in the same words and keep the date — dropping it would lose
    // evidence (`fact-format.ts` rule 1) to buy a uniformity nothing asked for.
    attestedAt: {
      groupKey: () => "attestation:attestedAt",
      counted: (asserted) => {
        const readable = readableAttestedAt(asserted);
        return specificAtOne(SELF_REPORTS, (report) =>
          readable ? `${report} from ${readable}` : null
        );
      },
      specific: (signal, asserted) => {
        const readable = readableAttestedAt(asserted);
        return readable
          ? `${manualSignalClause(signal)}, self-reported on ${readable}`
          : null;
      },
    },
  };

/** The `attestedAt` value as a readable day, or `null` when it is not a date. */
function readableAttestedAt(asserted: string | null): string | null {
  return asserted && ISO_DATE_PATTERN.test(asserted)
    ? toReadableDate(asserted)
    : null;
}

/**
 * The table row for a leaf. `null` for a leaf this module has no template for —
 * that citation keeps the generic phrase-identity fold and the generic fallback
 * wording, so two unknown leaves cannot be silently merged into one line that
 * speaks for both.
 */
function attestationLeaf(leaf: string): AttestationLeaf | null {
  return Object.hasOwn(ATTESTATION_LEAVES, leaf)
    ? ATTESTATION_LEAVES[leaf as AttestationLeafName]
    : null;
}

// ----------------------------------------------------------------------------
// Classifying a citation.
// ----------------------------------------------------------------------------

/**
 * One attestation citation with its SPELLING thrown away: whichever of the two
 * legal forms it arrived in, it is described here as the array form.
 *
 * That mapping is the whole point. It is what puts `manual.byKey.<signal>` and
 * `manual.attestations[N].value` on ONE template and in ONE group, so how many
 * attestations were cited — not which spelling the model picked — decides
 * whether a column names them or counts them.
 */
export interface AttestationCitation {
  /** The leaf of `manual.attestations.#.<leaf>` this citation speaks through. */
  leaf: string;
  /** Its row in {@link ATTESTATION_LEAVES}; `null` for a leaf with no template. */
  template: AttestationLeaf | null;
  /** What that leaf asserts, once the spelling has been mapped across. */
  asserted: string | null;
  /** The signal it names, or `null` when nothing resolved it. */
  signal: string | null;
}

/** The signal a `manual.byKey.<signal>` citation names, or null for any other path. */
function manualByKeySignal(normalized: string): string | null {
  if (!normalized.startsWith(MANUAL_BY_KEY_PREFIX)) return null;
  const signalKey = normalized.slice(MANUAL_BY_KEY_PREFIX.length);
  return signalKey.length > 0 ? signalKey : null;
}

/**
 * Classify a normalised citation path as an attestation, in either spelling.
 * `null` for every citation that is not one.
 *
 * @param normalized the cited path with its row index collapsed to `#`
 * @param value      the citation's asserted value, as written
 * @param signalKey  the signal the READ LAYER resolved this row to, if any
 */
export function attestationCitation(
  normalized: string,
  value: string | null,
  signalKey: string | null | undefined
): AttestationCitation | null {
  if (normalized.startsWith(MANUAL_ATTESTATION_TEMPLATE_PREFIX)) {
    // Only the read layer can say which signal row N holds, so an unresolved
    // (or blank) key is an unresolved row — never a guess.
    const resolved = signalKey?.trim();
    const signal = resolved ? resolved : null;
    const leaf = normalized.slice(MANUAL_ATTESTATION_TEMPLATE_PREFIX.length);
    return {
      leaf,
      template: attestationLeaf(leaf),
      // NORMALISED ACROSS THE SPELLINGS. The `signalKey` leaf names the signal
      // and asserts nothing else, which is exactly what a bare
      // `manual.byKey.<signal>` does — and that spelling hands the signal down
      // as its `asserted` (below). A bare `manual.attestations.N.signalKey`
      // carries no `=`, so without this it handed down `null`, took a different
      // branch of the same template and fell out to the ledger-shaped fallback.
      // Two spellings of one citation must reach the template identically.
      asserted: leaf === "signalKey" ? (value ?? signal) : value,
      signal,
    };
  }

  const keyedSignal = manualByKeySignal(normalized);
  if (keyedSignal === null) return null;

  // A keyed citation WITH a value asserts the attestation, exactly as
  // `…attestations.N.value` does; a bare one only names it, as `…signalKey`
  // does. The signal is in the path, so it never needs resolving.
  const leaf: AttestationLeafName = value === null ? "signalKey" : "value";
  return {
    leaf,
    template: ATTESTATION_LEAVES[leaf],
    asserted: value === null ? keyedSignal : value,
    signal: keyedSignal,
  };
}
