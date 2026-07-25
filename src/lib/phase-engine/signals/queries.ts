// ============================================================================
// Phase Engine — Signal layer queries
//
// Every read here is church_id-scoped (NFR-PE-6) and returns ONLY raw, countable
// rows. There is no interpretation in this file: the builder (build-fact-snapshot)
// assembles the deterministic snapshot from these primitives. Keeping the SQL
// isolated makes the determinism easy to audit (AC-PE-2) and the queries easy to
// reason about for tenant isolation.
// ============================================================================

import { db } from "@/db";
import {
  churches,
  churchMeetings,
  commitments,
  meetingAttendance,
  ministryTeams,
  persons,
  plantSignals,
  teamMemberships,
  trainingCompletions,
  trainingPrograms,
} from "@/db/schema";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

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
  launchDate: string | null;
}

/** Loads the church row (phase + launch date). `null` when the church is absent. */
export async function getChurch(churchId: string): Promise<ChurchRow | null> {
  const rows = await db
    .select({
      id: churches.id,
      currentPhase: churches.currentPhase,
      launchDate: churches.launchDate,
    })
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);

  return rows[0] ?? null;
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

/** Candidate persons (committed / core-group / launch-team / leader). */
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
