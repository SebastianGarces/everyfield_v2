// ============================================================================
// Phase Engine — Signal layer queries
//
// Every read here is church_id-scoped (NFR-PE-6) and returns ONLY raw, countable
// rows. There is no interpretation in the SNAPSHOT half of this file: the builder
// (build-fact-snapshot) assembles the deterministic snapshot from these
// primitives. Keeping the SQL isolated makes the determinism easy to audit
// (AC-PE-2) and the queries easy to reason about for tenant isolation.
//
// The READ LAYER that used to be this file's second half now sits beside it, one
// module per projection (#319, round 4 — the split follows the section banners
// this file already carried):
//
//   - `trends.ts`     — PE-026, trends and velocity;
//   - `milestones.ts` — PE-027, the milestone timeline.
//
// Both are pure PROJECTIONS over rows read here — the same division of labour
// `buildCsfScorecard` follows in assessment/queries.ts, and for the same reason:
// a projection that recomputes nothing is testable without a database and cannot
// disagree with the snapshot it was projected from. The rule they are written
// against is stated at their own headers — every number is read out of a
// persisted `fact_snapshot`, and every badge is a relabelled persisted severity.
//
// The dependency runs one way and must keep doing so: a projection may import a
// primitive from here, and nothing here may import a projection.
// ============================================================================

import { db } from "@/db";
import {
  churches,
  churchMeetings,
  commitments,
  launches,
  launchMilestones,
  meetingAttendance,
  ministryTeams,
  persons,
  plantSignals,
  teamMemberships,
  trainingCompletions,
  trainingPrograms,
} from "@/db/schema";
import type { LaunchStatus } from "@/db/schema/launch";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { isRecruitedContact } from "@/lib/people/person-user";

/** Statuses that count as "open" follow-up (warm, pre-commitment) contacts. */
export const FOLLOW_UP_STATUSES = [
  "attendee",
  "following_up",
  "interviewed",
] as const;

/** Statuses that make a person a leadership-readiness candidate. */
export const LEADERSHIP_CANDIDATE_STATUSES = [
  "core_group",
  "launch_team",
  "leader",
] as const;

// ----------------------------------------------------------------------------
// Church
// ----------------------------------------------------------------------------

export interface ChurchRow {
  id: string;
  currentPhase: number;
}

/**
 * Loads the church row. `null` when the church is absent.
 *
 * NO LAUNCH DATE HERE. It used to be `churches.launch_date`; migration 0032
 * dropped that column and Launch Sunday is an entity now (LS-001), so the
 * countdown signal reads `getLaunch()` below. Adding it back to this row — even
 * as a join — would re-create the two-owners state the entity exists to end.
 */
export async function getChurch(churchId: string): Promise<ChurchRow | null> {
  const rows = await db
    .select({
      id: churches.id,
      currentPhase: churches.currentPhase,
    })
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);

  return rows[0] ?? null;
}

// ----------------------------------------------------------------------------
// Launch (LS-001 / PE-004)
// ----------------------------------------------------------------------------

export interface LaunchRow {
  /** yyyy-mm-dd, or `null` while the launch is still `planning`. */
  targetDate: string | null;
  status: LaunchStatus;
  /**
   * OUTCOME FACTS (LS-006/LS-008). Non-null `outcomeRecordedAt` is the marker
   * that the day happened AND was written down; the counts are nullable because
   * "not recorded" and "nobody came" are different answers and the snapshot must
   * not flatten them into `0`.
   */
  outcomeRecordedAt: Date | null;
  attendanceCount: number | null;
  decisionsCount: number | null;
}

/**
 * The plant's launch, or `null` when it has none yet.
 *
 * `null` and `{ targetDate: null }` are DIFFERENT facts — "no launch record at
 * all" vs "a launch being planned with no day named" — and the builder collapses
 * them to the same empty countdown deliberately, because the countdown's
 * question is only ever "which day". Anything that wants to tell them apart
 * (the `/launch` page, the outcome facts) reads the row.
 */
export async function getLaunch(churchId: string): Promise<LaunchRow | null> {
  const rows = await db
    .select({
      targetDate: launches.targetDate,
      status: launches.status,
      outcomeRecordedAt: launches.outcomeRecordedAt,
      attendanceCount: launches.attendanceCount,
      decisionsCount: launches.decisionsCount,
    })
    .from(launches)
    .where(eq(launches.churchId, churchId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * One readiness milestone, reduced to what the snapshot counts (LS-003/LS-008).
 *
 * Rows, not counts, because this file returns raw countable primitives and the
 * builder does the arithmetic — the same division of labour every other signal
 * here follows, and what makes the assembler independently testable without a
 * database.
 */
export interface LaunchMilestoneRow {
  id: string;
  /** Non-null = complete. */
  completedAt: Date | null;
}

/**
 * The plant's launch readiness milestones (LS-003).
 *
 * Scoped by `church_id`, which `launch_milestones` carries denormalised for
 * exactly this reason (invariants → Multi-Tenancy): the tenancy filter is never
 * one JOIN away from being forgotten. A plant with no launch — or a launch whose
 * milestones have not been seeded — returns `[]`, which the builder reads as
 * "no readiness structure yet" rather than "0% ready".
 */
export async function getLaunchMilestoneRows(
  churchId: string
): Promise<LaunchMilestoneRow[]> {
  return db
    .select({
      id: launchMilestones.id,
      completedAt: launchMilestones.completedAt,
    })
    .from(launchMilestones)
    .where(eq(launchMilestones.churchId, churchId));
}

// ----------------------------------------------------------------------------
// Commitments (core group / launch team)
// ----------------------------------------------------------------------------

export interface CommitmentRow {
  personId: string;
  commitmentType: string;
  signedDate: string;
}

/**
 * All commitments for the plant, ordered deterministically by signed date then
 * id, so window/delta math is reproducible.
 */
export async function getCommitments(
  churchId: string
): Promise<CommitmentRow[]> {
  return db
    .select({
      personId: commitments.personId,
      commitmentType: commitments.commitmentType,
      signedDate: commitments.signedDate,
    })
    .from(commitments)
    .where(eq(commitments.churchId, churchId))
    .orderBy(commitments.signedDate, commitments.id);
}

// ----------------------------------------------------------------------------
// Vision meetings (completed) + attendance
// ----------------------------------------------------------------------------

export interface VisionMeetingRow {
  id: string;
  datetime: Date;
  actualAttendance: number | null;
}

/**
 * Completed vision meetings, most-recent first. Cadence/attendance trend is
 * derived from this ordered list by the builder.
 */
export async function getCompletedVisionMeetings(
  churchId: string
): Promise<VisionMeetingRow[]> {
  return db
    .select({
      id: churchMeetings.id,
      datetime: churchMeetings.datetime,
      actualAttendance: churchMeetings.actualAttendance,
    })
    .from(churchMeetings)
    .where(
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.type, "vision_meeting"),
        eq(churchMeetings.status, "completed")
      )
    )
    .orderBy(sql`${churchMeetings.datetime} desc`, churchMeetings.id);
}

// ----------------------------------------------------------------------------
// Follow-up contacts (open, pre-commitment)
// ----------------------------------------------------------------------------

export interface FollowUpRow {
  id: string;
  status: string;
  updatedAt: Date;
}

/** Non-deleted persons in an open follow-up status, church-scoped. */
export async function getOpenFollowUpContacts(
  churchId: string
): Promise<FollowUpRow[]> {
  return db
    .select({
      id: persons.id,
      status: persons.status,
      updatedAt: persons.updatedAt,
    })
    .from(persons)
    .where(
      and(
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt),
        inArray(persons.status, [...FOLLOW_UP_STATUSES])
      )
    )
    .orderBy(persons.id);
}

// ----------------------------------------------------------------------------
// Ministry teams (for role coverage) — team + whether a leader is assigned
// ----------------------------------------------------------------------------

export interface MinistryTeamRow {
  id: string;
  name: string;
  leaderId: string | null;
}

/** All ministry teams for the plant, church-scoped, ordered for determinism. */
export async function getMinistryTeams(
  churchId: string
): Promise<MinistryTeamRow[]> {
  return db
    .select({
      id: ministryTeams.id,
      name: ministryTeams.name,
      leaderId: ministryTeams.leaderId,
    })
    .from(ministryTeams)
    .where(eq(ministryTeams.churchId, churchId))
    .orderBy(ministryTeams.name, ministryTeams.id);
}

// ----------------------------------------------------------------------------
// Leadership readiness — per-person aggregated countable inputs
// ----------------------------------------------------------------------------

export interface LeadershipPersonRow {
  id: string;
  status: string;
  createdAt: Date;
}

/**
 * Candidate persons (committed / core-group / launch-team / leader).
 *
 * RECRUITED ONES ONLY. This feeds a SIGNAL about leadership development — how
 * far the plant has got at raising up leaders — and the planter's own person
 * row sits at `leader` from the moment the plant exists (#378). Counting it
 * would hand every plant a leadership candidate on day one that nobody
 * developed, which is a fabricated signal rather than a generous one.
 */
export async function getLeadershipCandidates(
  churchId: string
): Promise<LeadershipPersonRow[]> {
  return db
    .select({
      id: persons.id,
      status: persons.status,
      createdAt: persons.createdAt,
    })
    .from(persons)
    .where(
      and(
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt),
        isRecruitedContact(),
        inArray(persons.status, [...LEADERSHIP_CANDIDATE_STATUSES])
      )
    )
    .orderBy(persons.id);
}

export interface PersonCountRow {
  personId: string;
  count: number;
}

/** Completed-vision-meeting attendance counts per person, church-scoped. */
export async function getMeetingsAttendedByPerson(
  churchId: string
): Promise<PersonCountRow[]> {
  return db
    .select({
      personId: meetingAttendance.personId,
      count: sql<number>`count(*)::int`,
    })
    .from(meetingAttendance)
    .innerJoin(
      churchMeetings,
      eq(meetingAttendance.meetingId, churchMeetings.id)
    )
    .where(
      and(
        eq(meetingAttendance.churchId, churchId),
        eq(meetingAttendance.status, "attended"),
        eq(churchMeetings.type, "vision_meeting"),
        eq(churchMeetings.status, "completed")
      )
    )
    .groupBy(meetingAttendance.personId);
}

/** Active ministry-team membership counts per person, church-scoped. */
export async function getActiveMembershipsByPerson(
  churchId: string
): Promise<PersonCountRow[]> {
  return db
    .select({
      personId: teamMemberships.personId,
      count: sql<number>`count(*)::int`,
    })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.status, "active")
      )
    )
    .groupBy(teamMemberships.personId);
}

/** Distinct person ids that lead at least one ministry team, church-scoped. */
export async function getTeamLeaderPersonIds(
  churchId: string
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ leaderId: ministryTeams.leaderId })
    .from(ministryTeams)
    .where(
      and(
        eq(ministryTeams.churchId, churchId),
        isNotNull(ministryTeams.leaderId)
      )
    );

  return rows.map((r) => r.leaderId).filter((id): id is string => id !== null);
}

// ----------------------------------------------------------------------------
// Training
// ----------------------------------------------------------------------------

export interface TrainingProgramRow {
  id: string;
  isRequired: boolean;
}

/** Training programs defined for the plant, church-scoped. */
export async function getTrainingPrograms(
  churchId: string
): Promise<TrainingProgramRow[]> {
  return db
    .select({
      id: trainingPrograms.id,
      isRequired: trainingPrograms.isRequired,
    })
    .from(trainingPrograms)
    .where(eq(trainingPrograms.churchId, churchId))
    .orderBy(trainingPrograms.id);
}

export interface TrainingCompletionRow {
  personId: string;
  trainingProgramId: string;
}

/** Training completion records for the plant, church-scoped. */
export async function getTrainingCompletions(
  churchId: string
): Promise<TrainingCompletionRow[]> {
  return db
    .select({
      personId: trainingCompletions.personId,
      trainingProgramId: trainingCompletions.trainingProgramId,
    })
    .from(trainingCompletions)
    .where(eq(trainingCompletions.churchId, churchId))
    .orderBy(trainingCompletions.id);
}

// ----------------------------------------------------------------------------
// Manual attestations (the ONLY facts read from plant_signals) — PE-005
// ----------------------------------------------------------------------------

export interface PlantSignalRow {
  signalKey: string;
  value: unknown;
  attestedAt: Date;
}

/** Manual self-attestations for the plant, church-scoped, ordered by key. */
export async function getPlantSignals(
  churchId: string
): Promise<PlantSignalRow[]> {
  return db
    .select({
      signalKey: plantSignals.signalKey,
      value: plantSignals.value,
      attestedAt: plantSignals.attestedAt,
    })
    .from(plantSignals)
    .where(eq(plantSignals.churchId, churchId))
    .orderBy(plantSignals.signalKey);
}
