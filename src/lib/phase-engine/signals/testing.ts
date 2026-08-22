// ============================================================================
// Test support for the signal layer — the ONE `PlantFactSnapshot` fixture.
//
// A snapshot is a wide, wholly-required record: every sub-signal carries its
// own thresholds and its own `isEmpty`, so building one by hand is ~120 lines
// and adding a field to `types.ts` breaks every hand-built copy. Three suites
// already wanted one, and the first two each wrote their own — which is how the
// judge's copy grew a second ministry role the batch runner's copy never had,
// for no reason either file could state.
//
// So there is one shape here and callers override the fields their assertion is
// about. It sits beside `types.ts` rather than in `src/lib/testing/` for the
// same reason `judge/testing.ts` sits beside `token-pacer.ts`: it returns a
// type this directory owns. Imported by tests only, and deliberately NOT
// re-exported from `index.ts`.
// ============================================================================

import {
  buildEvidenceProfile,
  EVIDENCE_LENSES,
  type EvidenceLens,
  type EvidenceProfile,
  type EvidenceQuality,
} from "./evidence";
import type { PlantFactSnapshot } from "./types";

/**
 * The evidence profile of the fixture snapshot, plus whatever a suite overrides.
 *
 * DERIVED FROM `makeSnapshot`, NOT HAND-WRITTEN, because a hand-written default
 * describes a plant that cannot exist: `prayer` and `generosity` are never
 * `measured` (nothing counts them — signals/evidence.ts), so an all-measured
 * default quietly switches off the rule that refuses a healthy read on a blind
 * lens (#635), in exactly the two lenses that rule was written for. A suite
 * that wants a different plant says which lens and how blind:
 * `makeEvidence({ vision_casting: "unknown" })`.
 */
export function makeEvidence(
  overrides: Partial<Record<EvidenceLens, EvidenceQuality>> = {}
): EvidenceProfile {
  const base = buildEvidenceProfile(makeSnapshot());
  return Object.fromEntries(
    EVIDENCE_LENSES.map((lens) => [
      lens,
      overrides[lens]
        ? { quality: overrides[lens], attestedDaysAgo: null }
        : base[lens],
    ])
  ) as EvidenceProfile;
}

/** A minimal but complete snapshot: every signal present, nothing extreme. */
export function makeSnapshot(
  overrides: Partial<PlantFactSnapshot> = {}
): PlantFactSnapshot {
  return {
    snapshotVersion: "1.0.0",
    churchId: "church-123",
    currentPhase: 1,
    generatedAt: "2026-06-22T00:00:00.000Z",
    isColdStart: false,
    coreGroup: {
      committedCount: 22,
      launchTeamCount: 0,
      growthDelta: 2,
      growthWindowDays: 7,
      daysSinceLastNewCommitment: 30,
      slowedThresholdDays: 21,
      stalledThresholdDays: 28,
      sourceComposition: {},
      unknownSourceCount: 0,
      isEmpty: false,
    },
    visionMeetings: {
      totalCompleted: 4,
      lastMeetingAt: "2026-06-01",
      daysSinceLastMeeting: 21,
      averageCadenceDays: 14,
      latestAttendance: 30,
      previousAttendance: 30,
      attendanceTrend: "flat",
      cadenceWatchDays: 21,
      cadenceDirectDays: 28,
      isEmpty: false,
    },
    followUp: {
      openCount: 10,
      stalestDays: 20,
      staleCount: 7,
      staleThresholdDays: 14,
      unownedCount: 0,
      staleUnownedCount: 0,
      distinctOwnerCount: 0,
      planterOwnedCount: 0,
      warmCount: 0,
      staleWarmCount: 0,
      seriouslyStaleWarmCount: 0,
      staleColdCount: 0,
      warmWindowDays: 14,
      warmStaleThresholdDays: 7,
      isEmpty: false,
    },
    ministryRoles: {
      filledCount: 2,
      totalRoles: 8,
      roles: [
        { key: "worship", label: "Worship", teamPresent: false, filled: false },
        {
          key: "childrens",
          label: "Children's",
          teamPresent: true,
          filled: true,
        },
      ],
      isEmpty: false,
    },
    leadership: {
      candidates: [
        {
          personId: "p-1",
          status: "core_group",
          tenureDays: 70,
          meetingsAttended: 6,
          activeMemberships: 1,
          hasCommitment: true,
          leadsTeam: false,
          interviewCount: 0,
          lastInterviewResult: null,
          lastInterviewDate: null,
          assessmentCount: 0,
          lastAssessmentTotal: null,
          lastAssessmentDate: null,
        },
      ],
      candidateThresholdDays: 60,
      isEmpty: false,
    },
    training: {
      programCount: 0,
      requiredProgramCount: 0,
      completionCount: 0,
      requiredCompletionRate: null,
      isEmpty: true,
    },
    launch: {
      launchDate: "2026-10-12",
      daysUntilLaunch: 112,
      isPastDue: false,
      isEmpty: false,
    },
    cohesion: {
      activeCommittedCount: 0,
      disengagedCount: 0,
      disengagedShare: null,
      disengagedIncludesLeader: false,
      disengagedShareThreshold: 0.2,
      disengagedMinimumCount: 3,
      windowDays: 28,
      isEmpty: true,
    },
    manual: {
      attestations: [],
      byKey: {},
      reaffirmWindowDays: 30,
      isEmpty: true,
    },
    ...overrides,
  };
}
