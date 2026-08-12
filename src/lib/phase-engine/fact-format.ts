// ============================================================================
// Cited-fact humanising (PE, issue #154).
//
// The judge is required to cite the exact fact keys that drove an insight
// (judge/prompt.ts, rule 3), so `plant_insights.cited_facts` holds strings in
// the fact ledger's own syntax: `ministryRoles.filledCount=4`. That syntax is
// the right contract for the model and for the reviewer who checks a citation
// against the snapshot. It is the wrong thing to put in front of a planter:
//
//   - "Based on ministryRoles.filledCount=4" is field syntax, not evidence.
//     The Plant Intelligence surface is the one a planter is meant to ACT on,
//     and a dotted path is the opposite of actionable.
//   - It leaks the shape of the fact store to end users.
//
// This module is the ONE place that turns a stored citation into a phrase a
// planter reads. All THREE surfaces that render citations — the CSF scorecard
// tiles, the Focus insight cards and the exit-criteria drill-down — go through
// it, so the fix lands once rather than per-surface. All three sit on `/phase`
// at once, which is why one citation must read as one sentence across them
// (ruled 2026-08-12 on #319; see `CitedFactSignals`).
//
// It holds the MECHANISM only — parse a citation, classify it, dispatch it,
// render it. Its two neighbours hold the vocabularies it dispatches over, and
// they are separate because they change for different reasons:
//
//   - `fact-phrases.ts` — one phrase per snapshot path. Grows when the fact
//     SNAPSHOT grows.
//   - `attestation-citation.ts` — the two legal spellings of a manual
//     attestation and the one table of its leaves. Changes when a ruling about
//     attestation citations lands.
//
// ---------------------------------------------------------------------------
// The rules this file is written against
// ---------------------------------------------------------------------------
//
// 1. HUMANISING MUST NOT DROP THE EVIDENCE. "Your ministry roles need work" is
//    not a citation. Every phrase for a counted fact carries its number, so the
//    planter can still check the claim against what they know. The only values
//    deliberately withheld are opaque identifiers (a personId is a UUID: it is
//    unreadable to a planter and it names an individual — see
//    assessment/persist.ts, which drops network insights that cite one).
//    HOW MANY rows agreed is evidence too: an insight backed by three
//    candidates says "3 leadership candidates", never "one".
//
// 2. AN UNKNOWN SHAPE DEGRADES, IT NEVER THROWS AND NEVER LEAKS SYNTAX. The
//    snapshot grows, and a model can cite a key that no longer exists or was
//    never in the ledger. Anything this module does not recognise still comes
//    out as words: the path is de-camelised into a label, the value is
//    humanised, and the `=` is gone. A citation is evidence — silently dropping
//    an unrecognised one would weaken the insight it belongs to.
//
// 3. THE OUTPUT IS A SENTENCE FRAGMENT, NOT A SENTENCE. Both callers introduce
//    the list themselves ("Based on …"), so every phrase reads as a
//    continuation: it starts with a digit or a lowercase word, and it carries
//    no trailing period. That is one capitalisation policy across both
//    surfaces (better-writing §8) rather than two.
//
// 4. ONE DISPATCHER DECIDES WHAT A CITATION ASSERTS. `citationRendering` is
//    that decision, and the two public functions are thin wrappers over it:
//    `formatCitedFact` (the drill-down) prints its specific sentence,
//    `formatCitedFacts` (the card and the scorecard) folds a column of them.
//    A second dispatcher for the plural path is exactly how the surfaces
//    diverged before — with two, the rule above holds only for as long as two
//    test files happen to agree.
//
// Pure and IO-free — no DB, no DOM, no LLM — so it is unit-testable under the
// repo's node:test harness, which only runs `src/**/*.test.ts`.
// ============================================================================

import {
  attestationCitation,
  type AttestationCitation,
} from "@/lib/phase-engine/attestation-citation";
import {
  FACT_PHRASES,
  ISO_DATE_PATTERN,
  renderPhrase,
  toNumber,
  toReadableDate,
  toWords,
  type Phrase,
} from "@/lib/phase-engine/fact-phrases";

// ----------------------------------------------------------------------------
// Parsing.
// ----------------------------------------------------------------------------

/** A citation split into the fact it names and the value it asserts. */
export interface ParsedCitedFact {
  /** The dotted fact path, e.g. `ministryRoles.filledCount`. */
  path: string;
  /** The asserted value as written, or `null` when the citation had no `=`. */
  value: string | null;
}

/**
 * Split `key=value` on the FIRST `=` only: the key never contains one, the
 * value theoretically can. A citation with no `=` (the model cited a bare key)
 * parses to a null value rather than failing.
 */
export function parseCitedFact(fact: string): ParsedCitedFact {
  const trimmed = fact.trim();
  const separator = trimmed.indexOf("=");
  if (separator === -1) return { path: trimmed, value: null };
  return {
    path: trimmed.slice(0, separator).trim(),
    value: trimmed.slice(separator + 1).trim(),
  };
}

/**
 * Unify the two index spellings without discarding which row was cited:
 * `roles[0].filled` and `roles.0.filled` are the same path.
 *
 * Exported because the read layer walks stored snapshots by the same dotted
 * path this module keys citations under (`assessment/snapshot-fact.ts`), and two
 * copies of one three-character regex are two things that can drift.
 */
export function dotIndices(path: string): string {
  return path.replace(/\[(\d+)\]/g, ".$1");
}

/**
 * Collapse array indices so `leadership.candidates[0].personId` and
 * `leadership.candidates.3.personId` reach the same template. Both spellings
 * occur in stored data (the ledger emits dotted indices; the model sometimes
 * echoes bracketed ones).
 */
function normalizePath(path: string): string {
  return dotIndices(path)
    .split(".")
    .map((segment) => (/^\d+$/.test(segment) ? "#" : segment))
    .filter((segment) => segment.length > 0)
    .join(".");
}

/**
 * How one citation is identified when de-duplicating a column. The row index
 * is KEPT — unlike `normalizePath`, which collapses it to reach a template —
 * because the two questions are different: `candidates.0` and `candidates.1`
 * share a template but are two candidates, while the same citation written
 * twice is one candidate. Counting (see `formatCitedFacts`) depends on telling
 * those apart.
 */
function citationIdentity(fact: string): string {
  const { path, value } = parseCitedFact(fact);
  return `${dotIndices(path)}=${value ?? ""}`;
}

/**
 * The dotted path of a citation: its asserted value stripped, both index
 * spellings unified, the row index KEPT.
 *
 * Exported because it is the KEY a {@link CitedFactSignals} map is built under
 * in the read layer and read under here. One function for both sides, so the
 * projection that resolves `manual.attestations.1.value` and the formatter that
 * looks it up cannot disagree about what that citation is called.
 */
export function citedFactPath(fact: string): string {
  return dotIndices(parseCitedFact(fact).path);
}

// ----------------------------------------------------------------------------
// The fallback: an unrecognised shape still comes out as words.
// ----------------------------------------------------------------------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Humanise a value with no template behind it. Opaque identifiers resolve to
 * `null` (render the label alone) rather than putting a UUID in front of a
 * planter.
 */
function fallbackValue(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "undefined") {
    return "not recorded";
  }
  if (trimmed === "true") return "yes";
  if (trimmed === "false") return "no";
  if (UUID_PATTERN.test(trimmed)) return null;
  if (ISO_DATE_PATTERN.test(trimmed)) return toReadableDate(trimmed);
  if (toNumber(trimmed) !== null) return trimmed;
  // Anything else is prose or an enum: de-camelise it and strip any stray `=`
  // so no fragment of ledger syntax survives.
  return toWords(trimmed.replace(/=+/g, " ")) || "not recorded";
}

/**
 * Turn an unrecognised path into a label: the leaf names the thing, the branch
 * it hangs off gives it context. `generosity.financialBaseInPlace` becomes
 * "financial base in place (generosity)".
 */
function fallbackLabel(normalized: string): string {
  const segments = normalized
    .split(".")
    .filter((segment) => segment.length > 0 && segment !== "#")
    .map(toWords)
    .filter(Boolean);

  if (segments.length === 0) return "an unnamed detail";

  const leaf = segments[segments.length - 1];
  const context = segments.slice(0, -1).join(" ");
  return context ? `${leaf} (${context})` : leaf;
}

/** The whole fallback: a label for the path, plus the value if it says anything. */
function fallbackPhrase(normalized: string, value: string | null): string {
  const label = fallbackLabel(normalized);
  const readable = fallbackValue(value);
  return readable ? `${label}: ${readable}` : label;
}

// ----------------------------------------------------------------------------
// Public API.
// ----------------------------------------------------------------------------

/**
 * What the caller knows about a citation that this module cannot work out for
 * itself, because knowing it means reading the snapshot the citation was made
 * against.
 */
export interface CitedFactContext {
  /**
   * The manual signal an `manual.attestations.N.…` citation names, resolved out
   * of that snapshot (assessment/snapshot-fact.ts). Supplying it makes the array
   * spelling read as the SAME sentence as `manual.byKey.<signal>`; omitting it
   * (or passing null, for a row that does not resolve) keeps the generic
   * self-report phrasing. Ignored for every other path.
   */
  signalKey?: string | null;
}

/**
 * The same knowledge for a WHOLE cited-facts column: the signal each citation
 * resolved to, keyed by that citation's {@link citedFactPath}.
 *
 * The insight card and the CSF scorecard render a column at a time and hold no
 * snapshot of their own, so the read layer that builds their projection resolves
 * the signals and hands the map down (ruled 2026-08-12 on #319 —
 * `AssessedInsight.citedFactSignals`). A path with no entry, or an entry of
 * `null`, is a citation that did not resolve; nothing is guessed for it.
 */
export type CitedFactSignals = Readonly<Record<string, string | null>>;

/** Everything one citation renders as — the ONE decision both surfaces read. */
interface CitationRendering {
  /**
   * The GROUPING phrase: what this citation reads as with the specifics dropped,
   * and therefore what the group renders as. Rendered at the group's row count,
   * so at more than one row an attestation phrase drops its specifics and counts.
   */
  group: Phrase;
  /**
   * The group's IDENTITY while a column is folded — signal-independent and
   * date-independent for an attestation, so both spellings of one attestation
   * and two different attestations of the same kind share a group.
   */
  groupKey: string;
  /** What it reads as on its own; `null` when there is no specific sentence. */
  specific: string | null;
  /**
   * The distinct thing cited. The SIGNAL when it is known, so one attestation
   * cited twice — once each way — is one thing, never two.
   */
  member: string;
}

/**
 * What an ATTESTATION citation renders as. All three answers come from the ONE
 * row of `ATTESTATION_LEAVES` this leaf owns (`attestation-citation.ts`), so a
 * leaf cannot be grouped one way and phrased another.
 *
 * A leaf with no row keeps the generic treatment: the ledger-shaped path is
 * still humanised by the fallback, and the group is its own phrase — two unknown
 * leaves are never silently merged into one line that speaks for both.
 */
function attestationRendering(
  fact: string,
  attestation: AttestationCitation,
  normalized: string,
  value: string | null
): CitationRendering {
  const { template, asserted, signal } = attestation;
  const group = template
    ? template.counted(asserted)
    : fallbackPhrase(normalized, value);

  return {
    group,
    groupKey: template ? template.groupKey(asserted) : renderPhrase(group, 1),
    specific:
      template && signal !== null ? template.specific(signal, asserted) : null,
    member:
      signal === null
        ? `citation:${citationIdentity(fact)}`
        : `signal:${signal}`,
  };
}

/**
 * Decide what a citation asserts, ONCE. Both public functions below are thin
 * wrappers over this: the singular one prints `specific ?? group`, the plural
 * one folds `group`/`member`/`specific` across a column.
 *
 * One dispatcher rather than two is the point (structural finding on #319). The
 * property this whole ruling is about — the drill-down and the folding formatter
 * saying the same thing about the same citation — is then true BY CONSTRUCTION:
 * there is one taxonomy, one place that maps the keyed spelling onto the array
 * form, and one place that decides what `manual.byKey.<signal>` means. Two
 * dispatchers made it true only by two test files agreeing.
 *
 * Returns `null` for a non-string or empty citation, which both callers drop.
 */
function citationRendering(
  fact: unknown,
  signalKey: string | null | undefined
): CitationRendering | null {
  if (typeof fact !== "string" || fact.trim() === "") return null;

  const { path, value } = parseCitedFact(fact);
  const normalized = normalizePath(path);

  // An attestation is phrased through the array spelling's leaf whichever way it
  // was written; everything else through its own path.
  const attestation = attestationCitation(normalized, value, signalKey);
  if (attestation !== null) {
    return attestationRendering(fact, attestation, normalized, value);
  }

  // `.get`, never an index: the path is the model's own string, so an object
  // lookup would reach `Object.prototype` and hand a native function to
  // `renderPhrase` (see `FACT_PHRASES` — rule 2 is why both vocabularies are
  // Maps).
  const group =
    FACT_PHRASES.get(normalized)?.(value) ?? fallbackPhrase(normalized, value);
  return {
    group,
    // Everything that is NOT an attestation keeps the old identity — its own
    // phrase, rendered singular. Those templates name their subject, not their
    // row, so alike phrases really are one group.
    groupKey: renderPhrase(group, 1),
    specific: null,
    member: `citation:${citationIdentity(fact)}`,
  };
}

/**
 * Turn one stored citation into a phrase a planter reads.
 *
 * Never throws and never returns ledger syntax: an unrecognised path degrades
 * to a de-camelised label plus a humanised value. Returns `""` only for an
 * empty input, which `formatCitedFacts` drops. A row fact renders as its
 * singular here — one citation is one row; counting is `formatCitedFacts`'
 * job, because only the whole column knows how many rows agreed.
 *
 * `context` carries what only the caller can know (see `CitedFactContext`); a
 * caller with no snapshot to hand omits it and every path still renders.
 */
export function formatCitedFact(
  fact: string,
  context?: CitedFactContext
): string {
  const rendering = citationRendering(fact, context?.signalKey);
  if (rendering === null) return "";
  return rendering.specific ?? renderPhrase(rendering.group, 1);
}

/** One phrase's group while a column is being folded. */
interface CitedFactGroup {
  /** The GROUPING phrase — the group's identity and its rendering at N rows. */
  phrase: Phrase;
  /** The DISTINCT things cited: one attestation is one, however it is spelled. */
  members: Set<string>;
  /** The sentences resolved members read as; empty when none resolved. */
  specifics: Set<string>;
}

/**
 * Humanise a whole `cited_facts` column.
 *
 * Takes `unknown` because the column is `jsonb`: both render surfaces would
 * otherwise repeat the same cast, and a malformed row must degrade to "no
 * citations" rather than crash the page.
 *
 * Several per-row citations legitimately humanise to the same phrase, and
 * "one leadership candidate, one leadership candidate" reads as a bug. They
 * are therefore grouped — but a group of anonymous rows becomes a COUNT, not a
 * single row: three candidates cited render "3 leadership candidates". The
 * earlier collapse said "one", which understated the very evidence the
 * citation exists to carry (ruling on #154).
 *
 * Two de-duplications are at work and they are not the same:
 *
 *   - the SAME citation written twice is one row (`citationIdentity` keeps the
 *     index, so `candidates.0` twice counts once);
 *   - DIFFERENT rows that read alike are one phrase carrying a count
 *     (`candidates.0.tenureDays=90` and `candidates.1.tenureDays=90` are two).
 *
 * Phrases with a fixed subject — including ones that name their row, like a
 * ministry role's own label — carry no count and simply group.
 *
 * ---------------------------------------------------------------------------
 * `signals` — one voice for one citation (ruled 2026-08-12 on #319)
 * ---------------------------------------------------------------------------
 *
 * An attestation is citable two legal ways (`manual.byKey.<signal>` and
 * `manual.attestations[N]`), and until this ruling the singular formatter spoke
 * the specific sentence for both while THIS one still said "something you
 * confirmed" for the array spelling. Both live on `/phase` — the drill-down
 * beside the insight card and the scorecard — so one planter could read the
 * same fact told two ways in one screenful, decided by a spelling the model
 * happened to pick.
 *
 * Supplying `signals` closes that, and the shape of the fix is the ruling:
 *
 *   - ONE distinct attestation in a group reads the drill-down's own sentence;
 *   - MORE THAN ONE — two DIFFERENT signals, or one that resolved beside one
 *     that did not — collapses to the count ("3 things you confirmed"). THIS
 *     PATH IS A COUNTER AND NEVER BECOMES A LISTER: naming them all here would
 *     turn a chip that says how much evidence there is into a second copy of
 *     the drill-down.
 *
 * The rule is keyed on the SIGNAL, not on the rendered phrase, and that is what
 * makes it spelling-independent — the property the ruling is actually about.
 * Both spellings of one attestation are ONE member of ONE group, so:
 *
 *   - two attestations count the same whether they were cited by key or by row
 *     (keying on the phrase counted the array pair and listed the keyed pair);
 *   - an attestation cited BOTH ways beside another one counts as two things,
 *     not as one named sentence beside a count that silently included it again.
 */
export function formatCitedFacts(
  citedFacts: unknown,
  signals?: CitedFactSignals
): string[] {
  if (!Array.isArray(citedFacts)) return [];

  const groups = new Map<string, CitedFactGroup>();

  for (const fact of citedFacts) {
    if (typeof fact !== "string") continue;

    // The same decision the drill-down reads, taken once (`citationRendering`).
    // All this path adds is WHERE the resolved signal comes from: a column has
    // one map for all of its citations, a drill-down one context per citation.
    const rendering = citationRendering(fact, signals?.[citedFactPath(fact)]);
    if (rendering === null) continue;

    // Group on the identity the dispatcher decided — for an attestation an
    // explicit, signal-independent key; for everything else the phrase itself,
    // rendered singular. NEVER the rendered phrase for an attestation: two of
    // its leaves carry the signal or the date, so a phrase key put every
    // attestation in a group of its own and the count below became a list.
    const key = rendering.groupKey;
    let group = groups.get(key);
    if (!group) {
      group = {
        phrase: rendering.group,
        members: new Set(),
        specifics: new Set(),
      };
      groups.set(key, group);
    }
    group.members.add(rendering.member);
    if (rendering.specific) group.specifics.add(rendering.specific);
  }

  return Array.from(groups.values(), ({ phrase, members, specifics }) => {
    const [only] = specifics;
    return members.size === 1 && specifics.size === 1
      ? only
      : renderPhrase(phrase, members.size);
  });
}
