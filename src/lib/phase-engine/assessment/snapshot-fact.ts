// ============================================================================
// Reading a persisted fact snapshot (PE-025 support).
//
// `plant_assessments.fact_snapshot` is stored JSON, and three things read it:
// the CSF scorecard's projection, the exit-criteria projection, and the citation
// wording the /phase surfaces render. They must not each walk it their own way,
// so this module owns BOTH halves of that reading:
//
//   1. BY PATH — `readSnapshotFact` / `findSnapshotRowIndex`. Pure, total, and
//      safe on any stored shape: a path that does not resolve is `present:
//      false`, which is materially different from the snapshot storing `null`
//      there.
//   2. BY CITATION — `attestationSignalKey` and its whole-column form
//      `resolveCitedFactSignals`. Which manual signal `manual.attestations.N.…`
//      names is a READ of the snapshot (entry N's `signalKey`), not a syntax
//      rule, which is exactly why the pure formatter cannot do it and why the
//      read layer carries the answer down (ruled 2026-08-12 on #319).
//
// It imports nothing else from this folder. Both `queries.ts` (the DB reads and
// the CSF scorecard) and `exit-criteria.ts` sit on top of it, so a rule about
// what a stored snapshot says is written once and read the same way by every
// projection above it.
// ============================================================================

import type { PlantInsight } from "@/db/schema";
// The owner of attestation-citation SYNTAX: the two legal spellings and the one
// leaf table. The manual block is written into the snapshot TWICE —
// `manual.byKey.<signal>` and `manual.attestations[]`
// (signals/build-fact-snapshot.ts) — and the judge's citable ledger is the whole
// flattened snapshot, so BOTH spellings are legal citations of the same
// attestation. This module resolves the array one; it must not also decide what
// that spelling is called.
import { MANUAL_ATTESTATIONS_PREFIX } from "@/lib/phase-engine/attestation-citation";
// The citation parser, shared with the humanising formatter the UI renders
// through. One reader of `plant_insights.cited_facts` syntax, so the read layer
// and the surfaces above it can never disagree about where a path ends and a
// quoted value begins.
import {
  citedFactPath,
  dotIndices,
  type CitedFactSignals,
} from "@/lib/phase-engine/fact-format";

// ----------------------------------------------------------------------------
// Reading the persisted snapshot by path.
// ----------------------------------------------------------------------------
/** One deterministic reading taken out of the persisted fact snapshot. */
export interface SnapshotFact {
  /** The dotted path read, e.g. `coreGroup.committedCount`. */
  path: string;
  /**
   * The path RESOLVED inside the stored snapshot. False means this snapshot
   * predates the field (or the path is not a fact at all) — materially
   * different from the snapshot storing `null` there.
   */
  present: boolean;
  /**
   * The scalar at that path as a string; `null` when the snapshot stores null,
   * when the path did not resolve, or when the value is an object/array (a
   * container is not a fact). `present: true` with `value: null` is a real
   * reading — "no launch date set" is an answer.
   */
  value: string | null;
}

/** A scalar rendered for display/comparison; containers are not facts. */
function scalarToString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return String(value);
  return null;
}

/** Walk a dotted path through the stored snapshot JSON. Never throws. */
function resolveSnapshotPath(
  snapshot: unknown,
  path: string
): { found: boolean; value: unknown } {
  const segments = dotIndices(path)
    .split(".")
    .filter((segment) => segment.length > 0);

  let cursor: unknown = snapshot;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== "object") {
      return { found: false, value: undefined };
    }
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) {
        return { found: false, value: undefined };
      }
      cursor = cursor[index];
      continue;
    }
    const record = cursor as Record<string, unknown>;
    // `Object.hasOwn`, never `in` — A CITED PATH IS UNTRUSTED INPUT
    // (memory/invariants.md → Phase Engine): the judge writes it, so a segment
    // may be `constructor`, `valueOf`, `toString` or `__proto__`. `in` walks the
    // prototype chain, so `coreGroup.constructor` resolved as `present: true`
    // and the exit-criteria drill-down rendered a native function's slot as a
    // verified reading of the snapshot. The same rule the two phrase
    // vocabularies got as `Map`s, applied to the walk that feeds them.
    if (!Object.hasOwn(record, segment)) {
      return { found: false, value: undefined };
    }
    cursor = record[segment];
  }

  return { found: cursor !== undefined, value: cursor };
}

/** Read one fact out of a persisted snapshot. Pure; safe on any stored shape. */
export function readSnapshotFact(
  snapshot: unknown,
  path: string
): SnapshotFact {
  const normalized = dotIndices(path);
  const { found, value } = resolveSnapshotPath(snapshot, normalized);
  return {
    path: normalized,
    present: found,
    value: found ? scalarToString(value) : null,
  };
}

/**
 * Index of the row in the array at `arrayPath` whose `field` equals `value`
 * (e.g. the `worship` entry of `ministryRoles.roles`), or null.
 *
 * A locator, not a reading: the caller still has to `readSnapshotFact` the row
 * it points at, which is what keeps every rendered value a logged read (see
 * `exit-criteria.ts` → `FactLens`).
 */
export function findSnapshotRowIndex(
  snapshot: unknown,
  arrayPath: string,
  field: string,
  value: string
): number | null {
  const { found, value: rows } = resolveSnapshotPath(snapshot, arrayPath);
  if (!found || !Array.isArray(rows)) return null;

  const index = rows.findIndex(
    (row) =>
      row !== null &&
      typeof row === "object" &&
      scalarToString((row as Record<string, unknown>)[field]) === value
  );
  return index === -1 ? null : index;
}

// ----------------------------------------------------------------------------
// Resolving a citation against that snapshot.
// ----------------------------------------------------------------------------

/**
 * Which manual signal an `manual.attestations.N.…` citation names, read out of
 * the snapshot the insight was made against.
 *
 * `null` for every citation that is not one of those, and for one that names no
 * resolvable entry — an out-of-range index, a non-numeric one, or a row that
 * carries no `signalKey`. Every caller treats that null the same way: it falls
 * back to what the citation says on its face rather than guessing a signal —
 * the wording here, and the ATTRIBUTION in `exit-criteria.ts`, which attributes
 * such a citation to no gate at all.
 */
export function attestationSignalKey(
  citedPath: string,
  snapshot: unknown
): string | null {
  if (!citedPath.startsWith(MANUAL_ATTESTATIONS_PREFIX)) return null;

  const [index] = citedPath.slice(MANUAL_ATTESTATIONS_PREFIX.length).split(".");
  if (!/^\d+$/.test(index)) return null;

  const signalKey = readSnapshotFact(
    snapshot,
    `${MANUAL_ATTESTATIONS_PREFIX}${index}.signalKey`
  );
  if (!signalKey.present || signalKey.value === null) return null;

  const key = signalKey.value.trim();
  return key.length > 0 ? key : null;
}

/**
 * A persisted insight, plus the manual signal each of its citations resolves to
 * in the snapshot that insight was made against.
 *
 * WHY THE READ LAYER CARRIES IT (ruled 2026-08-12 on #319). An attestation is
 * citable two legal ways, and which one the model emitted must not decide what a
 * planter reads. Resolving `manual.attestations.N.…` to its signal is a READ of
 * the assessment's own snapshot, so a presentational component — which holds an
 * insight row and nothing else — cannot do it. The projection that hands the
 * component its insights does it instead, once, and the map rides along.
 *
 * Optional because a `PlantInsight` straight out of the table is still a valid
 * input everywhere one is accepted (the marketing fixtures hand in exactly
 * that); absent, every surface falls back to the generic self-report phrasing
 * rather than guessing a signal.
 *
 * @see resolveCitedFactSignals for how the map is built, and
 *      `fact-format.ts` → `CitedFactSignals` for how it is read.
 */
export interface AssessedInsight extends PlantInsight {
  citedFactSignals?: CitedFactSignals;
}

/**
 * Every manual signal ONE insight's citations resolve to, keyed by the dotted
 * path of the citation that names it (`citedFactPath`, the same key the
 * formatter looks the map up under).
 *
 * This is the whole-column form of {@link attestationSignalKey} and the read-layer
 * half of the 2026-08-12 ruling on #319: the insight card and the CSF scorecard
 * render a `cited_facts` column with no snapshot in hand, so the projection that
 * feeds them resolves the signals once and carries them
 * ({@link AssessedInsight.citedFactSignals}).
 *
 * Only citations that RESOLVE get an entry. An unresolvable row — an
 * out-of-range index, a non-numeric one, a row with no `signalKey` — is left
 * out, and the surface then keeps the generic self-report phrasing rather than
 * borrowing a signal. Nothing here rewrites a path: the citation a surface shows
 * is still the judge's own (`buildEvidence`, and the round-2 ruling it records).
 */
export function resolveCitedFactSignals(
  insight: PlantInsight,
  snapshot: unknown
): CitedFactSignals {
  const facts = insight.citedFacts;
  if (!Array.isArray(facts)) return {};

  const signals: Record<string, string> = {};
  for (const raw of facts) {
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const path = citedFactPath(raw);
    // `Object.hasOwn`, not `in`: `path` is the judge's own string, so `in`
    // answers true for `toString`/`constructor` and would drop a citation that
    // was never recorded. Same rule as `resolveSnapshotPath` above.
    if (path.length === 0 || Object.hasOwn(signals, path)) continue;
    const key = attestationSignalKey(path, snapshot);
    if (key !== null) signals[path] = key;
  }
  return signals;
}

/**
 * The same insight, carrying the signals its citations resolved to.
 *
 * Idempotent: an insight that already carries a map keeps it, so a projection
 * built over `getLatestAssessment`'s output does not redo the resolution, and
 * one built over a hand-assembled payload (the privacy-gated oversight read)
 * still gets it.
 *
 * An insight with nothing to resolve is returned UNCHANGED — the same object,
 * not a copy of it. Almost no insight cites an attestation, and the rows a
 * surface renders are meant to BE the persisted `plant_insights` rows rather
 * than projections of them (`CsfFactorStanding.insights`, pinned by reference in
 * `queries.test.ts`). Adding an empty map to every row to make the shape uniform
 * would weaken that for nothing: `{}` and absent are the same answer to every
 * reader, because a lookup that misses falls back to the generic phrasing either
 * way.
 */
export function withCitedFactSignals(
  insight: AssessedInsight,
  snapshot: unknown
): AssessedInsight {
  if (insight.citedFactSignals) return insight;

  const citedFactSignals = resolveCitedFactSignals(insight, snapshot);
  if (Object.keys(citedFactSignals).length === 0) return insight;
  return { ...insight, citedFactSignals };
}
