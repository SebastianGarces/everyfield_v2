import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildEvidenceProfile,
  EVIDENCE_LENSES,
  insufficientEvidenceLine,
} from "./evidence";
import type { PlantFactSnapshot } from "./types";

// ----------------------------------------------------------------------------
// What each lens actually knows (#483, C17).
//
// Bryan: "I would rather EveryField say, 'We do not currently have enough
// information to assess prayer health' than leave a blank that could be
// interpreted as healthy."
//
// The scorecard renders eight tiles whatever happens, so a lens the engine
// cannot see looked exactly like a lens with nothing wrong — and prayer and
// generosity, the two blindest, were therefore the two calmest.
// ----------------------------------------------------------------------------

function snapshot(over: Record<string, unknown> = {}): PlantFactSnapshot {
  return {
    coreGroup: { isEmpty: true },
    visionMeetings: { isEmpty: true },
    followUp: { isEmpty: true },
    ministryRoles: { roles: [], isEmpty: true },
    leadership: { candidates: [], isEmpty: true },
    training: { isEmpty: true },
    manual: { attestations: [], byKey: {}, isEmpty: true },
    ...over,
  } as unknown as PlantFactSnapshot;
}

test("a cold-start plant knows nothing about any lens", () => {
  const profile = buildEvidenceProfile(snapshot());

  for (const lens of EVIDENCE_LENSES) {
    assert.equal(
      profile[lens].quality,
      "unknown",
      `${lens} should read unknown on a cold-start plant`
    );
  }
});

test("every lens is always present — a missing one IS the blank", () => {
  const profile = buildEvidenceProfile(snapshot());
  assert.deepEqual(Object.keys(profile).sort(), [...EVIDENCE_LENSES].sort());
});

test("a counted block makes its lens measured", () => {
  const profile = buildEvidenceProfile(
    snapshot({ coreGroup: { isEmpty: false } })
  );
  assert.equal(profile.critical_mass.quality, "measured");
  // …and only its own lens.
  assert.equal(profile.prayer.quality, "unknown");
});

test("prayer is unknown until the planter answers, then attested", () => {
  // The canonical case. Nothing about prayer is measurable, so the ONLY thing
  // that moves this lens is the planter's own answer.
  const unanswered = buildEvidenceProfile(snapshot());
  assert.equal(unanswered.prayer.quality, "unknown");

  const answered = buildEvidenceProfile(
    snapshot({
      manual: {
        attestations: [
          {
            signalKey: "prayer_rhythm_established",
            value: true,
            attestedAt: "2026-07-01T00:00:00.000Z",
            attestedDaysAgo: 45,
          },
        ],
        byKey: {},
        isEmpty: false,
      },
    })
  );
  assert.equal(answered.prayer.quality, "attested");
  assert.equal(answered.prayer.attestedDaysAgo, 45);
});

test("a stale attestation stays ATTESTED — staleness is phrasing, not category", () => {
  // Demoting a 45-day-old answer to `unknown` would throw away something the
  // planter actually told us. The age travels with it so the copy can say so.
  const profile = buildEvidenceProfile(
    snapshot({
      manual: {
        attestations: [
          {
            signalKey: "core_group_giving",
            value: true,
            attestedAt: "2026-05-01T00:00:00.000Z",
            attestedDaysAgo: 120,
          },
        ],
        byKey: {},
        isEmpty: false,
      },
    })
  );

  assert.equal(profile.generosity.quality, "attested");
  assert.equal(profile.generosity.attestedDaysAgo, 120);
});

test("the Prayer Leader title does not make prayer known (#474)", () => {
  // A title is Lens 7 coverage. Counting it here would let "somebody has the
  // job" stand in for "the plant prays", which is the exact substitution #474
  // removed from the lens.
  const profile = buildEvidenceProfile(
    snapshot({
      manual: {
        attestations: [
          {
            signalKey: "prayer_leader_assigned",
            value: true,
            attestedAt: "2026-07-01T00:00:00.000Z",
            attestedDaysAgo: 3,
          },
        ],
        byKey: {},
        isEmpty: false,
      },
    })
  );

  assert.equal(profile.prayer.quality, "unknown");
});

test("an older persisted snapshot does not throw, it reads unknown", () => {
  // `factSnapshot` is jsonb: the type describes what we WRITE, not what we may
  // READ. A row from an older build is missing blocks entirely, and the honest
  // answer for a block that is not there is that nothing was measured.
  const profile = buildEvidenceProfile({} as PlantFactSnapshot);
  assert.equal(profile.critical_mass.quality, "unknown");
  assert.equal(profile.prayer.attestedDaysAgo, null);
});

test("the insufficient-evidence line is Bryan's sentence", () => {
  assert.equal(
    insufficientEvidenceLine("Prayer"),
    "We don't have enough information to assess prayer yet."
  );
});
