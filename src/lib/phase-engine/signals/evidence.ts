// ============================================================================
// WHAT EACH LENS ACTUALLY KNOWS (#483, C17).
//
// Bryan: "Could the system have an explicit 'insufficient evidence' state? I
// would rather EveryField say, 'We do not currently have enough information to
// assess prayer health' than leave a blank that could be interpreted as
// healthy. Maybe every lens internally knows whether its conclusion is
// measured, attested, inferred, or simply unknown."
//
// A BLANK IS THE PROBLEM. The scorecard's eight tiles always render, and a lens
// the engine cannot see renders exactly like a lens with nothing wrong. Prayer
// and Generosity are the two that are nearly blind, so the two tiles a planter
// most needs to read carefully were the two that looked calmest.
//
// DERIVED, NEVER PERSISTED (D1). The profile is computed from the snapshot the
// assessment already stores, so there is no `evidence_quality` column to drift
// away from the facts it describes, and re-reading an old assessment recomputes
// the same answer from the same rows.
//
// `inferred` IS DELIBERATELY NOT A VALUE HERE. A FACT is never inferred — only
// a CONCLUSION can be, and conclusions belong to the judge. The rubric governs
// inference (Lens 2 is the worked example: it may only claim who carries
// follow-up from the measured owner facts). Putting `inferred` in this enum
// would invite a lens to describe its own evidence as inferred and carry on.
// ============================================================================

import { MINISTRY_ROLE_KEYS, type PlantFactSnapshot } from "./types";

/** The eight CSF lenses, by the category slug the judge and scorecard use. */
export const EVIDENCE_LENSES = [
  "vision_casting",
  "shared_ownership",
  "critical_mass",
  "cohesion",
  "prayer",
  "generosity",
  "emerging_leadership",
  "comprehensive_training",
] as const;
export type EvidenceLens = (typeof EVIDENCE_LENSES)[number];

/**
 * How strong the best evidence for a lens is.
 *
 * `measured`  — the database counted something for this lens.
 * `attested`  — nothing is measured, but the planter has answered for it.
 * `unknown`   — nothing measured and nothing answered. NOT "healthy".
 */
export type EvidenceQuality = "measured" | "attested" | "unknown";

/** One lens's evidence, and how fresh the attested part of it is. */
export interface LensEvidence {
  quality: EvidenceQuality;
  /**
   * Whole days since the newest attestation this lens rests on, or `null` when
   * it rests on none.
   *
   * STALENESS DEGRADES PHRASING, NOT CATEGORY (#474/#475). A rhythm attested 45
   * days ago is still attested — what has expired is the confirmation, so the
   * copy says "attested, 45 days ago" and the lens does not silently fall back
   * to unknown. Demoting it would throw away a real answer the planter gave.
   */
  attestedDaysAgo: number | null;
}

export type EvidenceProfile = Record<EvidenceLens, LensEvidence>;

/**
 * Which manual attestations speak for each lens.
 *
 * THE ONE MAP. Prayer and Generosity are the lenses this issue exists for, and
 * both are attestation-only today — so "does this lens know anything" is, for
 * them, exactly "has the planter answered".
 */
const LENS_ATTESTATIONS: Record<EvidenceLens, readonly string[]> = {
  vision_casting: [],
  shared_ownership: [],
  critical_mass: [],
  cohesion: [],
  // The Prayer Leader title is NOT here (#474): it is Lens 7 coverage, and
  // counting it would let a title alone make prayer look known.
  prayer: ["prayer_rhythm_established", "prayer_in_gatherings"],
  generosity: ["core_group_giving", "financial_base_established"],
  emerging_leadership: [],
  comprehensive_training: [],
};

/**
 * Does the snapshot MEASURE anything for this lens?
 *
 * Written as one predicate per lens rather than a path table, because "measured"
 * is not "the key exists" — every signal block exists on every snapshot, most of
 * them carrying zeroes and an `isEmpty` marker. A plant with no vision meetings
 * has a `visionMeetings` block; what it does not have is a measurement.
 */
function isMeasured(snapshot: PlantFactSnapshot, lens: EvidenceLens): boolean {
  // EVERY BLOCK IS READ DEFENSIVELY. A `PlantFactSnapshot` is a PERSISTED jsonb
  // value, and a row written by an older build carries whatever the shape was
  // that day — the type describes what we write now, not what we may read. A
  // missing block is "nothing measured", which is the honest answer and the
  // safe one: it can only ever move a lens toward `unknown`, never toward a
  // claim the data does not support.
  const has = (block: { isEmpty?: boolean } | undefined): boolean =>
    block !== undefined && block.isEmpty === false;

  switch (lens) {
    case "vision_casting":
      return has(snapshot.visionMeetings);
    case "shared_ownership":
      // Ownership is measured once there is a follow-up cohort to own — the
      // count of unowned follow-ups is a real finding even at zero owners.
      return has(snapshot.followUp);
    case "critical_mass":
      return has(snapshot.coreGroup);
    case "cohesion":
      // Cohesion reads attendance-shaped signals, which live on the meetings
      // block (#473: the lens was renamed, its inputs were not).
      return has(snapshot.visionMeetings);
    case "prayer":
    case "generosity":
      // Nothing is measured for either today. That is the finding.
      return false;
    case "emerging_leadership":
      return (
        has(snapshot.leadership) ||
        snapshot.ministryRoles?.roles?.length === MINISTRY_ROLE_KEYS.length
      );
    case "comprehensive_training":
      return has(snapshot.training);
  }
}

/** The newest attestation among a lens's keys, in days, or `null` for none. */
function attestationAge(
  snapshot: PlantFactSnapshot,
  lens: EvidenceLens
): number | null {
  const keys = new Set(LENS_ATTESTATIONS[lens]);
  const ages = (snapshot.manual?.attestations ?? [])
    .filter((attestation) => keys.has(attestation.signalKey))
    // `attestedDaysAgo` arrived with #474; a snapshot written before it has an
    // attestation with no age. The answer still counts — it is the age that is
    // unknown, not the attestation.
    .map((attestation) => attestation.attestedDaysAgo)
    .filter((days): days is number => typeof days === "number");

  const answered = (snapshot.manual?.attestations ?? []).some((attestation) =>
    keys.has(attestation.signalKey)
  );
  if (!answered) return null;

  return ages.length === 0 ? null : Math.min(...ages);
}

/**
 * The per-lens evidence profile for one snapshot. Pure and total: all eight
 * lenses are always present, because a lens missing from the profile would be
 * exactly the silent blank this exists to remove.
 */
export function buildEvidenceProfile(
  snapshot: PlantFactSnapshot
): EvidenceProfile {
  return Object.fromEntries(
    EVIDENCE_LENSES.map((lens) => {
      const attestedDaysAgo = attestationAge(snapshot, lens);

      const hasAttestation = (snapshot.manual?.attestations ?? []).some(
        (attestation) =>
          new Set(LENS_ATTESTATIONS[lens]).has(attestation.signalKey)
      );

      const quality: EvidenceQuality = isMeasured(snapshot, lens)
        ? "measured"
        : hasAttestation
          ? "attested"
          : "unknown";

      return [lens, { quality, attestedDaysAgo }];
    })
  ) as EvidenceProfile;
}

/** What the planter is told when a lens knows nothing. Bryan's phrasing (C17). */
export function insufficientEvidenceLine(lensName: string): string {
  return `We don't have enough information to assess ${lensName.toLowerCase()} yet.`;
}
