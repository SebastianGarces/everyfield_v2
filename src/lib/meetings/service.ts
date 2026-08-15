import { db } from "@/db";
import {
  churchMeetings,
  locations,
  meetingAttendance,
  meetingChecklistItems,
  meetingEvaluations,
  ministryTeams,
  persons,
  tasks,
  type AttendanceType,
  type ChurchMeeting,
  type MeetingChecklistItem,
  type MeetingEvaluation,
  type MeetingStatus,
  type MeetingType,
  type NewChurchMeeting,
  type NewLocation,
} from "@/db/schema";
import type {
  AttendanceCreateInput,
  ChecklistItemUpdateInput,
  EvaluationCreateInput,
  MeetingCreateInput,
  MeetingUpdateInput,
} from "@/lib/validations/meetings";
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  defaultAgendaTemplatesForType,
  parseAgenda,
  sectionsFromTemplates,
  type AgendaSection,
} from "./agenda";
import type { EvaluationTrendPoint } from "./evaluation-comparison";
import { EVALUATION_QUALITY_FACTORS } from "./evaluation-factors";
// Imported, never RE-EXPORTED: a pass-through would rebuild the coupling the
// db-free split exists to remove. See memory/invariants.md → Meetings.
import { meetingDisplayTitle } from "./labels";
import {
  emitAttendanceRecorded,
  emitAttendanceFinalized,
  emitEvaluationCompleted,
  emitMeetingCompleted,
} from "./events";
import { kitTemplate } from "./kit-template";
import type {
  AttendanceSummary,
  AttendanceWithPerson,
  ListMeetingsOptions,
  MeetingWithCounts,
} from "./types";
import { emitTrainingScheduled } from "@/lib/ministry-teams/events";
import {
  addTeamMembersToGuestList,
  listActiveTeamMemberIds,
  shouldPopulateGuestListFromTeam,
} from "./guest-list";
// VM-018 — the F11 queue, consumed. `notifications.ts` owns every rule about
// who hears about a meeting and when; this module only says WHEN the question
// is asked. Each call swallows its own failures, so a notification can never
// fail the write it follows.
import {
  cancelMeetingNotifications,
  syncMeetingNotifications,
} from "./notifications";
import { topLevelTasksOnly } from "@/lib/tasks/service";
import { deriveAttendanceType } from "./attendance-type";

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Get the next vision meeting number for a church.
 * Returns `MAX(meeting_number) + 1`, starting at 1 for the first meeting.
 */
async function getNextMeetingNumber(churchId: string): Promise<number> {
  const result = await db
    .select({
      maxNum: sql<number>`COALESCE(MAX(${churchMeetings.meetingNumber}), 0)`,
    })
    .from(churchMeetings)
    .where(
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.type, "vision_meeting")
      )
    );

  return (result[0]?.maxNum ?? 0) + 1;
}

/**
 * Fetch attendance counts for a set of meeting IDs, grouped by meeting.
 * Returns a map of meetingId → { total, firstTime, returning }.
 */
async function getAttendanceCountsForMeetings(
  meetingIds: string[]
): Promise<
  Map<string, { total: number; firstTime: number; returning: number }>
> {
  if (meetingIds.length === 0) return new Map();

  const rows = await db
    .select({
      meetingId: meetingAttendance.meetingId,
      total: sql<number>`count(*)::int`,
      firstTime: sql<number>`count(*) filter (where ${meetingAttendance.attendanceType} = 'first_time')::int`,
      returning: sql<number>`count(*) filter (where ${meetingAttendance.attendanceType} = 'returning')::int`,
    })
    .from(meetingAttendance)
    .where(
      sql`${meetingAttendance.meetingId} IN (${sql.join(
        meetingIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})`
    )
    .groupBy(meetingAttendance.meetingId);

  const map = new Map<
    string,
    { total: number; firstTime: number; returning: number }
  >();
  for (const row of rows) {
    map.set(row.meetingId, {
      total: row.total,
      firstTime: row.firstTime,
      returning: row.returning,
    });
  }
  return map;
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Get a single meeting by ID with attendance counts and location data.
 * Returns null if not found or if it belongs to a different church.
 */
export async function getMeeting(
  churchId: string,
  meetingId: string
): Promise<MeetingWithCounts | null> {
  const rows = await db
    .select({
      meeting: churchMeetings,
      location: locations,
      teamName: ministryTeams.name,
    })
    .from(churchMeetings)
    .leftJoin(locations, eq(churchMeetings.locationId, locations.id))
    .leftJoin(ministryTeams, eq(churchMeetings.teamId, ministryTeams.id))
    .where(
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.id, meetingId)
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const countsMap = await getAttendanceCountsForMeetings([meetingId]);
  const counts = countsMap.get(meetingId) ?? {
    total: 0,
    firstTime: 0,
    returning: 0,
  };

  return {
    ...row.meeting,
    totalAttendees: counts.total,
    newAttendees: counts.firstTime,
    returningAttendees: counts.returning,
    location: row.location,
    teamName: row.teamName,
  };
}

/**
 * List meetings with filtering, pagination, and attendance counts.
 *
 * @param churchId - The church to scope the query to
 * @param options  - Filter by temporal status, type, teamId, limit, and offset
 */
export async function listMeetings(
  churchId: string,
  options: ListMeetingsOptions = {}
): Promise<{ meetings: MeetingWithCounts[]; total: number }> {
  const { status = "all", limit = 25, offset = 0 } = options;

  const safeLimit = Math.min(Math.max(1, limit), 100);
  const now = new Date();

  // Build conditions
  const conditions = [eq(churchMeetings.churchId, churchId)];

  if (status === "upcoming") {
    conditions.push(gte(churchMeetings.datetime, now));
  } else if (status === "past") {
    conditions.push(lt(churchMeetings.datetime, now));
  }

  // Filter by meeting type
  if (options.type) {
    conditions.push(eq(churchMeetings.type, options.type));
  }

  // Filter by team
  if (options.teamId) {
    conditions.push(eq(churchMeetings.teamId, options.teamId));
  }

  // Filter by meeting workflow status if provided
  if (options.meetingStatus) {
    conditions.push(
      eq(churchMeetings.status, options.meetingStatus as MeetingStatus)
    );
  }

  // Total count
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(churchMeetings)
    .where(and(...conditions));

  const total = countResult?.count ?? 0;

  // Determine sort order: upcoming → ascending (soonest first), past → descending
  const orderBy =
    status === "upcoming"
      ? [asc(churchMeetings.datetime)]
      : [desc(churchMeetings.datetime)];

  // Fetch meetings with location + team join
  const rows = await db
    .select({
      meeting: churchMeetings,
      location: locations,
      teamName: ministryTeams.name,
    })
    .from(churchMeetings)
    .leftJoin(locations, eq(churchMeetings.locationId, locations.id))
    .leftJoin(ministryTeams, eq(churchMeetings.teamId, ministryTeams.id))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(safeLimit)
    .offset(offset);

  // Batch-fetch attendance counts
  const meetingIds = rows.map((r) => r.meeting.id);
  const countsMap = await getAttendanceCountsForMeetings(meetingIds);

  const meetings: MeetingWithCounts[] = rows.map((row) => {
    const counts = countsMap.get(row.meeting.id) ?? {
      total: 0,
      firstTime: 0,
      returning: 0,
    };
    return {
      ...row.meeting,
      totalAttendees: counts.total,
      newAttendees: counts.firstTime,
      returningAttendees: counts.returning,
      location: row.location,
      teamName: row.teamName,
    };
  });

  return { meetings, total };
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new meeting.
 * For vision meetings: auto-assigns the next sequential meeting number and snapshots location data.
 * When ad-hoc location details are provided (name/address without a locationId),
 * a Location record is automatically created so it can be reused for future meetings.
 */
export async function createMeeting(
  churchId: string,
  userId: string,
  data: MeetingCreateInput
): Promise<ChurchMeeting> {
  let locationId = data.locationId ?? null;
  let locationName = data.locationName ?? null;
  let locationAddress = data.locationAddress ?? null;

  if (locationId) {
    // Existing saved location — snapshot its name/address onto the meeting
    const [loc] = await db
      .select({ name: locations.name, address: locations.address })
      .from(locations)
      .where(
        and(eq(locations.id, locationId), eq(locations.churchId, churchId))
      )
      .limit(1);

    if (loc) {
      locationName = loc.name;
      locationAddress = loc.address;
    }
  } else if (locationName) {
    // Ad-hoc location — auto-save it so it appears in the dropdown for future meetings
    const newLocValues: NewLocation = {
      churchId,
      name: locationName,
      address: locationAddress ?? "",
    };

    const [savedLocation] = await db
      .insert(locations)
      .values(newLocValues)
      .returning();

    locationId = savedLocation.id;
  }

  // Auto-assign meeting number for vision meetings
  let meetingNumber: number | null = null;
  if (data.type === "vision_meeting") {
    meetingNumber = await getNextMeetingNumber(churchId);
  }

  // VM-013: a new vision meeting arrives with the six-section running order
  // already on it, so the planter edits an agenda instead of facing a blank
  // one. An agenda supplied by the caller always wins; every other meeting type
  // starts empty and gets the builder's empty state.
  const suppliedAgenda = parseAgenda(data.agenda);
  const agenda =
    suppliedAgenda.length > 0
      ? suppliedAgenda
      : sectionsFromTemplates(defaultAgendaTemplatesForType(data.type));

  const values: NewChurchMeeting = {
    churchId,
    createdBy: userId,
    type: data.type,
    // The STORED title for a numbered vision meeting is the same string the
    // enumerated display surfaces derive, from the same function — not a second
    // `Vision Meeting #${n}` literal, which would spell the old label for every
    // row written after the label is re-ruled and the new one for every render.
    // The two nulls are FACTS about the row being written, not a partial
    // projection: this arm runs only when the caller supplied no title, and
    // branch 1 (a numbered vision meeting) outranks a team name anyway. Every
    // `MeetingTitleFacts` field is required so that a caller reading an
    // EXISTING row cannot omit a column and take a different branch by
    // accident.
    title:
      data.title ??
      (meetingNumber
        ? meetingDisplayTitle({
            type: "vision_meeting",
            meetingNumber,
            title: null,
            teamName: null,
          })
        : null),
    datetime: data.datetime,
    locationId,
    locationName,
    locationAddress,
    meetingNumber,
    teamId: data.teamId ?? null,
    meetingSubtype: data.meetingSubtype ?? null,
    estimatedAttendance: data.estimatedAttendance ?? null,
    durationMinutes: data.durationMinutes ?? null,
    notes: data.notes ?? null,
    agenda,
  };

  const [meeting] = await db.insert(churchMeetings).values(values).returning();

  // Auto-populate the materials checklist for vision meetings
  if (data.type === "vision_meeting") {
    await populateChecklist(churchId, meeting.id);
  }

  // VM-006 (#312): a team meeting starts with its team's roster on the guest
  // list — a meeting of a team already knows who is invited, so the planter
  // edits a list instead of retyping one. Every other meeting type is
  // untouched and keeps its empty-then-invited guest list.
  //
  // ONE read serves both this and the training announcement below, so the
  // people invited and the people announced to can never be different sets.
  const teamMemberIds = shouldPopulateGuestListFromTeam(
    values.type,
    values.teamId
  )
    ? await listActiveTeamMemberIds(churchId, values.teamId)
    : [];

  await addTeamMembersToGuestList(churchId, meeting.id, teamMemberIds, userId);

  // If it's a training team meeting, emit training scheduled event
  if (
    data.type === "team_meeting" &&
    data.meetingSubtype === "training" &&
    data.teamId
  ) {
    await emitTrainingScheduled(
      data.teamId,
      teamMemberIds,
      "training",
      data.datetime,
      churchId,
      userId
    );
  }

  // VM-018. AFTER the guest list is populated, never before: the reminder
  // audience is read from that list, so announcing first would remind the
  // organiser alone about a meeting a whole team is invited to. `previous:
  // null` because a row a moment old can have nothing pending, so the cancel
  // half is skipped.
  await syncMeetingNotifications(churchId, meeting.id, { previous: null });

  return meeting;
}

/**
 * Update an existing meeting.
 * Only provided fields are updated. Re-snapshots location data when locationId changes.
 */
export async function updateMeeting(
  churchId: string,
  meetingId: string,
  data: MeetingUpdateInput
): Promise<ChurchMeeting> {
  // Verify existence
  const existing = await getMeeting(churchId, meetingId);
  if (!existing) {
    throw new Error("Meeting not found");
  }

  const updateData: Partial<NewChurchMeeting> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  // Only include fields that are provided
  if (data.datetime !== undefined) updateData.datetime = data.datetime;
  if (data.title !== undefined) updateData.title = data.title;
  if (data.estimatedAttendance !== undefined)
    updateData.estimatedAttendance = data.estimatedAttendance;
  if (data.durationMinutes !== undefined)
    updateData.durationMinutes = data.durationMinutes;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.locationName !== undefined)
    updateData.locationName = data.locationName;
  if (data.locationAddress !== undefined)
    updateData.locationAddress = data.locationAddress;
  if (data.meetingSubtype !== undefined)
    updateData.meetingSubtype = data.meetingSubtype;

  // Handle location change: re-snapshot name/address
  if (data.locationId !== undefined) {
    updateData.locationId = data.locationId ?? null;

    if (data.locationId) {
      const [loc] = await db
        .select({ name: locations.name, address: locations.address })
        .from(locations)
        .where(
          and(
            eq(locations.id, data.locationId),
            eq(locations.churchId, churchId)
          )
        )
        .limit(1);

      if (loc) {
        updateData.locationName = loc.name;
        updateData.locationAddress = loc.address;
      }
    } else {
      // Clearing the location
      updateData.locationName = null;
      updateData.locationAddress = null;
    }
  }

  const [updated] = await db
    .update(churchMeetings)
    .set(updateData)
    .where(
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.id, meetingId)
      )
    )
    .returning();

  if (!updated) {
    throw new Error("Failed to update meeting");
  }

  // An edit may have moved the meeting. A reschedule is cancel + re-enqueue
  // (N-011), so every pending reminder is dropped and the offsets still in the
  // future are enqueued against the NEW start — there is no in-place edit of a
  // pending row, and so no way to leave one at a stale offset. `existing` was
  // already read above, so an edit that moved nothing a reminder says leaves
  // the live rows alone.
  await syncMeetingNotifications(churchId, meetingId, { previous: existing });

  return updated;
}

/**
 * Delete a meeting (hard delete).
 * Cascading foreign keys handle attendance, invitations, evaluations, and checklists.
 */
export async function deleteMeeting(
  churchId: string,
  meetingId: string
): Promise<void> {
  const existing = await getMeeting(churchId, meetingId);
  if (!existing) {
    throw new Error("Meeting not found");
  }

  await db
    .delete(churchMeetings)
    .where(
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.id, meetingId)
      )
    );

  // The subject is gone. `notifications.entity_id` carries no FK, so nothing
  // cascades — the cancel is what stops a reminder for a meeting that no longer
  // exists, and it runs AFTER the delete so a failed delete leaves the
  // reminders in place.
  await cancelMeetingNotifications(churchId, meetingId);
}

/**
 * Update a meeting's workflow status (e.g. planning → ready → in_progress → completed).
 */
export async function updateMeetingStatus(
  churchId: string,
  meetingId: string,
  newStatus: MeetingStatus
): Promise<ChurchMeeting> {
  const existing = await getMeeting(churchId, meetingId);
  if (!existing) {
    throw new Error("Meeting not found");
  }

  const [updated] = await db
    .update(churchMeetings)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.id, meetingId)
      )
    )
    .returning();

  if (!updated) {
    throw new Error("Failed to update meeting status");
  }

  // A cancelled or completed meeting is not worth an interruption, and every
  // other status may have re-opened one that was. `syncMeetingNotifications`
  // decides which of the two this is — the planner refuses both statuses — so
  // there is no status branch here to keep in step with it.
  await syncMeetingNotifications(churchId, meetingId, { previous: existing });

  // Emit meeting.completed event when status changes to completed
  if (newStatus === "completed") {
    await emitMeetingCompleted(
      meetingId,
      updated.type,
      churchId,
      updated.actualAttendance ?? 0,
      0 // newAttendeeCount not available here; consumers can query if needed
    );
  }

  return updated;
}

// ============================================================================
// Attendance
// ============================================================================

/**
 * Add an attendee to a meeting.
 * Verifies meeting belongs to the church before inserting.
 */
export async function addAttendee(
  churchId: string,
  meetingId: string,
  data: AttendanceCreateInput
) {
  // Verify meeting belongs to church and grab its datetime for type derivation
  const [meeting] = await db
    .select({ id: churchMeetings.id, datetime: churchMeetings.datetime })
    .from(churchMeetings)
    .where(
      and(
        eq(churchMeetings.id, meetingId),
        eq(churchMeetings.churchId, churchId)
      )
    )
    .limit(1);

  if (!meeting) {
    throw new Error("Meeting not found");
  }

  const status = data.status ?? "attended";

  // When the row is created as attended, ensure attendance_type is populated
  // (analytics read it). Honor an explicit type if one was provided.
  let attendanceType = data.attendanceType ?? null;
  if (status === "attended" && !attendanceType) {
    attendanceType = await deriveAttendanceType(
      data.personId,
      meetingId,
      meeting.datetime,
      db
    );
  }

  const [record] = await db
    .insert(meetingAttendance)
    .values({
      churchId,
      meetingId,
      personId: data.personId,
      attendanceType,
      status,
      invitedById: data.invitedById ?? null,
      responseStatus: data.responseStatus ?? null,
      notes: data.notes ?? null,
    })
    .returning();

  return record;
}

/**
 * Remove an attendee from a meeting.
 */
export async function removeAttendee(
  churchId: string,
  meetingId: string,
  personId: string
): Promise<void> {
  const deleted = await db
    .delete(meetingAttendance)
    .where(
      and(
        eq(meetingAttendance.churchId, churchId),
        eq(meetingAttendance.meetingId, meetingId),
        eq(meetingAttendance.personId, personId)
      )
    )
    .returning();

  if (deleted.length === 0) {
    throw new Error("Attendance record not found");
  }
}

/**
 * List all attendees for a meeting with person details.
 */
export async function listAttendees(
  churchId: string,
  meetingId: string
): Promise<AttendanceWithPerson[]> {
  const records = await db
    .select()
    .from(meetingAttendance)
    .where(
      and(
        eq(meetingAttendance.churchId, churchId),
        eq(meetingAttendance.meetingId, meetingId)
      )
    )
    .orderBy(desc(meetingAttendance.createdAt));

  if (records.length === 0) return [];

  // Collect all relevant person IDs
  const personIds = new Set<string>();
  for (const r of records) {
    personIds.add(r.personId);
    if (r.invitedById) personIds.add(r.invitedById);
  }

  const personRecords = await db
    .select({
      id: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
      email: persons.email,
      phone: persons.phone,
    })
    .from(persons)
    .where(inArray(persons.id, [...personIds]));

  const personMap = new Map(personRecords.map((p) => [p.id, p]));

  return records.map((r) => ({
    ...r,
    person: personMap.get(r.personId) ?? {
      id: r.personId,
      firstName: "Unknown",
      lastName: "",
      email: null,
      phone: null,
    },
    invitedBy: r.invitedById ? (personMap.get(r.invitedById) ?? null) : null,
  })) as AttendanceWithPerson[];
}

/**
 * Get a summary of attendance counts by type for a meeting.
 */
export async function getAttendanceSummary(
  churchId: string,
  meetingId: string
): Promise<AttendanceSummary> {
  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      firstTime: sql<number>`count(*) filter (where ${meetingAttendance.attendanceType} = 'first_time')::int`,
      returning: sql<number>`count(*) filter (where ${meetingAttendance.attendanceType} = 'returning')::int`,
      coreGroup: sql<number>`count(*) filter (where ${meetingAttendance.attendanceType} = 'core_group')::int`,
    })
    .from(meetingAttendance)
    .where(
      and(
        eq(meetingAttendance.churchId, churchId),
        eq(meetingAttendance.meetingId, meetingId)
      )
    );

  const row = rows[0];
  return {
    total: row?.total ?? 0,
    firstTime: row?.firstTime ?? 0,
    returning: row?.returning ?? 0,
    coreGroup: row?.coreGroup ?? 0,
  };
}

// ============================================================================
// Attendance finalization (MEET-011)
// ============================================================================
//
// Finalizing a meeting is not one write. It is: count who attended, advance
// person statuses, generate follow-up + evaluation tasks, mark the plant dirty,
// and record the count on the meeting. Those writes live in three different
// features behind the event bus, so no single SQL transaction can cover them —
// and the neon-http driver has no interactive transactions to offer anyway
// (see the note in `src/db/index.ts`).
//
// The guarantee is built out of ordering + idempotency instead:
//
//   1. `church_meetings.actual_attendance` is written ONLY here. A non-null
//      value therefore means "this meeting has already been finalized", which
//      makes it both the durable marker and the idempotency key.
//   2. Everything downstream runs FIRST, and the marker is written LAST. If any
//      downstream step throws, the meeting is left exactly as it was —
//      un-finalized — and the operation is safely retryable. A meeting can
//      never be marked finalized without its tasks.
//   3. Every downstream step is idempotent (person auto-advance only moves
//      prospects; follow-up task generation skips a meeting that already has
//      its evaluation task), so a retry converges rather than duplicating.
//   4. The marker write is a compare-and-set on `actual_attendance IS NULL`, so
//      two concurrent finalizes cannot both claim to have rolled forward.
//   5. Ordering + idempotency make a REPLAY safe; they do not make concurrency
//      safe on their own, because two finalizes can interleave between a
//      downstream SELECT and its INSERT. Duplicate follow-up sets are excluded
//      by the database instead: `tasks_meeting_evaluation_unique_idx` aborts
//      the loser's whole INSERT (see `src/lib/tasks/events.ts`).
//
// Known and accepted: `meeting.attendance.recorded` is emitted non-strictly, so
// a failed prospect -> attendee auto-advance is logged by the bus and swallowed
// while the meeting still finalizes. That is deliberate — a status nudge must
// not be able to block a planter from finalizing — and the next status change
// heals it. Only follow-up generation is load-bearing enough to be strict.
//
// The orchestration is expressed against an injectable `FinalizeAttendanceDeps`
// seam so the failure ordering can be unit-tested without a database.
// ============================================================================

/** Thrown when downstream generation failed and the meeting was left alone. */
export class FinalizeAttendanceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FinalizeAttendanceError";
  }
}

export type FinalizeAttendanceOutcome =
  /** Downstream ran and this call wrote the finalized marker. */
  | "finalized"
  /** Already finalized; nothing re-emitted, nothing changed. */
  | "already_finalized"
  /** Already finalized, but attendance was edited since — count refreshed only. */
  | "reconciled";

export interface FinalizeAttendanceResult {
  outcome: FinalizeAttendanceOutcome;
  total: number;
  attendeeIds: string[];
}

/** One attendance row, reduced to what finalization actually needs. */
interface AttendedRecord {
  personId: string;
  attendanceType: AttendanceType | null;
}

/** The DB + event seams `runFinalizeAttendance` orchestrates. */
export interface FinalizeAttendanceDeps {
  loadMeeting(): Promise<{
    type: MeetingType;
    actualAttendance: number | null;
  } | null>;
  loadAttendedRecords(): Promise<AttendedRecord[]>;
  emitRecorded(
    meetingType: MeetingType,
    personId: string,
    attendanceType?: AttendanceType
  ): Promise<void>;
  emitFinalized(
    meetingType: MeetingType,
    attendeeIds: string[],
    total: number
  ): Promise<void>;
  /** Compare-and-set the marker. Resolves true only if THIS call set it. */
  commitFinalized(total: number): Promise<boolean>;
  /** Refresh the count on an already-finalized meeting. Emits nothing. */
  reconcileCount(total: number): Promise<void>;
}

/**
 * Pure orchestration of the finalize flow (see the block comment above).
 * Exported for unit testing; production callers use `finalizeAttendance`.
 */
export async function runFinalizeAttendance(
  deps: FinalizeAttendanceDeps
): Promise<FinalizeAttendanceResult> {
  const meeting = await deps.loadMeeting();
  if (!meeting) {
    throw new Error("Meeting not found");
  }

  const attended = await deps.loadAttendedRecords();
  const total = attended.length;
  const attendeeIds = attended.map((r) => r.personId);

  // --- Idempotency guard --------------------------------------------------
  // Re-running finalize must not re-emit: that would duplicate follow-up tasks
  // and re-run every other subscriber. If attendance was edited after the fact
  // we still reconcile the visible count, which is a plain UPDATE with no
  // downstream effects.
  if (meeting.actualAttendance !== null) {
    if (meeting.actualAttendance !== total) {
      await deps.reconcileCount(total);
      return { outcome: "reconciled", total, attendeeIds };
    }
    return { outcome: "already_finalized", total, attendeeIds };
  }

  // --- Downstream generation (must succeed before we commit the marker) ----
  try {
    // Per-attendee events. F2 auto-advances prospect -> attendee for vision
    // meetings; the handler ignores anyone who is not still a prospect, so
    // replaying these is a no-op.
    for (const record of attended) {
      await deps.emitRecorded(
        meeting.type,
        record.personId,
        record.attendanceType ?? undefined
      );
    }

    // F5 creates the follow-up + evaluation tasks. Emitted strictly, so a
    // failure lands here instead of being swallowed by the bus.
    await deps.emitFinalized(meeting.type, attendeeIds, total);
  } catch (error) {
    throw new FinalizeAttendanceError(
      "Follow-up generation failed; the meeting was left un-finalized and can be retried",
      { cause: error }
    );
  }

  // --- Commit the marker last ---------------------------------------------
  const committed = await deps.commitFinalized(total);
  return {
    outcome: committed ? "finalized" : "already_finalized",
    total,
    attendeeIds,
  };
}

/** Wire the production DB + event-bus seams for one meeting. */
function createFinalizeAttendanceDeps(
  churchId: string,
  meetingId: string
): FinalizeAttendanceDeps {
  const scopeMeeting = and(
    eq(churchMeetings.churchId, churchId),
    eq(churchMeetings.id, meetingId)
  );

  return {
    async loadMeeting() {
      const [meeting] = await db
        .select({
          type: churchMeetings.type,
          actualAttendance: churchMeetings.actualAttendance,
        })
        .from(churchMeetings)
        .where(scopeMeeting)
        .limit(1);

      return meeting ?? null;
    },

    async loadAttendedRecords() {
      // Only people marked "attended" (toggled via checkbox) count. Filtered in
      // SQL rather than in JS so we never pull absent/excused rows over the wire.
      return db
        .select({
          personId: meetingAttendance.personId,
          attendanceType: meetingAttendance.attendanceType,
        })
        .from(meetingAttendance)
        .where(
          and(
            eq(meetingAttendance.churchId, churchId),
            eq(meetingAttendance.meetingId, meetingId),
            eq(meetingAttendance.status, "attended")
          )
        );
    },

    emitRecorded(meetingType, personId, attendanceType) {
      return emitAttendanceRecorded(
        meetingId,
        meetingType,
        personId,
        churchId,
        attendanceType
      );
    },

    emitFinalized(meetingType, attendeeIds, total) {
      return emitAttendanceFinalized(
        meetingId,
        meetingType,
        churchId,
        attendeeIds,
        total
      );
    },

    async commitFinalized(total) {
      // Compare-and-set: only the call that flips actual_attendance away from
      // NULL "wins" the finalization.
      const committed = await db
        .update(churchMeetings)
        .set({ actualAttendance: total, updatedAt: new Date() })
        .where(and(scopeMeeting, isNull(churchMeetings.actualAttendance)))
        .returning({ id: churchMeetings.id });

      return committed.length > 0;
    },

    async reconcileCount(total) {
      await db
        .update(churchMeetings)
        .set({ actualAttendance: total, updatedAt: new Date() })
        .where(scopeMeeting);
    },
  };
}

/**
 * Finalize attendance for a meeting: generate the downstream follow-ups, then
 * record the attendance count on the meeting.
 *
 * Idempotent — calling it again on a finalized meeting reconciles the count at
 * most, and never re-emits. Throws `FinalizeAttendanceError` if follow-up
 * generation fails, in which case the meeting is left un-finalized.
 */
export async function finalizeAttendance(
  churchId: string,
  meetingId: string
): Promise<FinalizeAttendanceResult> {
  return runFinalizeAttendance(
    createFinalizeAttendanceDeps(churchId, meetingId)
  );
}

/**
 * Record attendance for a meeting in batch (team meeting pattern).
 * Uses upsert logic: updates existing records, creates new ones.
 * Verifies meeting belongs to the church before modifying.
 */
export async function recordAttendanceBatch(
  churchId: string,
  meetingId: string,
  attendanceRecords: {
    personId: string;
    status: "attended" | "absent" | "excused";
  }[],
  userId: string
): Promise<void> {
  // Verify meeting belongs to church and grab its datetime for type derivation
  const [meeting] = await db
    .select({ id: churchMeetings.id, datetime: churchMeetings.datetime })
    .from(churchMeetings)
    .where(
      and(
        eq(churchMeetings.id, meetingId),
        eq(churchMeetings.churchId, churchId)
      )
    )
    .limit(1);

  if (!meeting) {
    throw new Error("Meeting not found");
  }

  for (const record of attendanceRecords) {
    // Derive attendance_type only when marking attended; clear otherwise.
    const attendanceType =
      record.status === "attended"
        ? await deriveAttendanceType(
            record.personId,
            meetingId,
            meeting.datetime,
            db
          )
        : null;

    const existing = await db
      .select()
      .from(meetingAttendance)
      .where(
        and(
          eq(meetingAttendance.churchId, churchId),
          eq(meetingAttendance.meetingId, meetingId),
          eq(meetingAttendance.personId, record.personId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(meetingAttendance)
        .set({ status: record.status, attendanceType, updatedAt: new Date() })
        .where(eq(meetingAttendance.id, existing[0].id));
    } else {
      await db.insert(meetingAttendance).values({
        churchId,
        meetingId,
        personId: record.personId,
        status: record.status,
        attendanceType,
        createdBy: userId,
      });
    }
  }
}

// ============================================================================
// Evaluations
// ============================================================================

/**
 * Create an evaluation for a meeting.
 * Calculates totalScore as the average of all 8 quality factor scores.
 */
export async function createEvaluation(
  churchId: string,
  meetingId: string,
  userId: string,
  data: EvaluationCreateInput
): Promise<MeetingEvaluation> {
  // Summed and divided over the ONE factor list, never over a hand-written
  // eight: the divisor was the literal `8` here and in the form's preview, so a
  // ninth factor would have stored an average the planter could see was wrong
  // under a heading that says /5.0 — and stored it permanently.
  const scores = EVALUATION_QUALITY_FACTORS.map((factor) => data[factor.key]);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  const totalScore = avg.toFixed(1);

  const [evaluation] = await db
    .insert(meetingEvaluations)
    .values({
      churchId,
      meetingId,
      evaluatedBy: userId,
      attendanceScore: data.attendanceScore,
      locationScore: data.locationScore,
      logisticsScore: data.logisticsScore,
      agendaScore: data.agendaScore,
      vibeScore: data.vibeScore,
      messageScore: data.messageScore,
      closeScore: data.closeScore,
      nextStepsScore: data.nextStepsScore,
      totalScore,
      notes: data.notes ?? null,
    })
    .returning();

  // Emit evaluation completed event for task auto-completion
  await emitEvaluationCompleted(meetingId, churchId, userId);

  return evaluation;
}

/**
 * Get the evaluation for a specific meeting.
 * Returns null if no evaluation exists yet.
 */
export async function getEvaluation(
  churchId: string,
  meetingId: string
): Promise<MeetingEvaluation | null> {
  const rows = await db
    .select()
    .from(meetingEvaluations)
    .where(
      and(
        eq(meetingEvaluations.churchId, churchId),
        eq(meetingEvaluations.meetingId, meetingId)
      )
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Get evaluation score trend across meetings (most recent first, returned chronologically).
 *
 * The QUERY half of VM-016c, and the only half that belongs in this module.
 * The point shape, the window callers pass as `limit`, and the comparison
 * itself touch no database and live in `./evaluation-comparison.ts`, which
 * imports nothing. Nothing here re-exports them — import from there.
 *
 * `meetingId` is on every point because `meetingNumber` cannot identify one:
 * it is null for every non-vision meeting and is only unique among vision
 * meetings, so a comparison keyed on it would silently pair up the wrong rows.
 */
export async function getEvaluationTrend(
  churchId: string,
  limit = 10
): Promise<EvaluationTrendPoint[]> {
  const rows = await db
    .select({
      meetingId: churchMeetings.id,
      meetingNumber: churchMeetings.meetingNumber,
      totalScore: meetingEvaluations.totalScore,
      datetime: churchMeetings.datetime,
    })
    .from(meetingEvaluations)
    .innerJoin(
      churchMeetings,
      eq(meetingEvaluations.meetingId, churchMeetings.id)
    )
    .where(eq(meetingEvaluations.churchId, churchId))
    .orderBy(desc(churchMeetings.datetime))
    .limit(limit);

  // Return in chronological order (oldest first)
  return rows.reverse().map((r) => ({
    meetingId: r.meetingId,
    meetingNumber: r.meetingNumber,
    totalScore: parseFloat(r.totalScore),
    datetime: r.datetime,
  }));
}

// ============================================================================
// Checklist
// ============================================================================

/**
 * Populate a meeting's checklist from the kit template.
 * Called automatically when a vision meeting is created.
 */
export async function populateChecklist(
  churchId: string,
  meetingId: string
): Promise<MeetingChecklistItem[]> {
  const items = kitTemplate.map((item) => ({
    churchId,
    meetingId,
    itemName: item.itemName,
    category: item.category,
    isChecked: false,
  }));

  const created = await db
    .insert(meetingChecklistItems)
    .values(items)
    .returning();

  return created;
}

/**
 * Get all checklist items for a meeting, ordered by category then item name.
 */
export async function getChecklist(
  churchId: string,
  meetingId: string
): Promise<MeetingChecklistItem[]> {
  return db
    .select()
    .from(meetingChecklistItems)
    .where(
      and(
        eq(meetingChecklistItems.churchId, churchId),
        eq(meetingChecklistItems.meetingId, meetingId)
      )
    )
    .orderBy(
      asc(meetingChecklistItems.category),
      asc(meetingChecklistItems.itemName)
    );
}

/**
 * Update a single checklist item (toggle, notes, assignment).
 */
export async function updateChecklistItem(
  churchId: string,
  itemId: string,
  data: ChecklistItemUpdateInput
): Promise<MeetingChecklistItem> {
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (data.isChecked !== undefined) updateData.isChecked = data.isChecked;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.assignedTo !== undefined) updateData.assignedTo = data.assignedTo;

  const [updated] = await db
    .update(meetingChecklistItems)
    .set(updateData)
    .where(
      and(
        eq(meetingChecklistItems.churchId, churchId),
        eq(meetingChecklistItems.id, itemId)
      )
    )
    .returning();

  if (!updated) {
    throw new Error("Checklist item not found");
  }

  return updated;
}

/**
 * Get a summary of checklist completion for a meeting.
 */
export async function getChecklistSummary(
  churchId: string,
  meetingId: string
): Promise<{ total: number; checked: number }> {
  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      checked: sql<number>`count(*) filter (where ${meetingChecklistItems.isChecked} = true)::int`,
    })
    .from(meetingChecklistItems)
    .where(
      and(
        eq(meetingChecklistItems.churchId, churchId),
        eq(meetingChecklistItems.meetingId, meetingId)
      )
    );

  const row = rows[0];
  return {
    total: row?.total ?? 0,
    checked: row?.checked ?? 0,
  };
}

// ============================================================================
// Agenda (VM-013)
//
// The shape, the bounds, the clamp, the reader, the offered defaults and the
// template→section mint ALL live in `./agenda.ts`, which imports nothing but an
// erased type — `AgendaBuilder` is a client component and needs the same
// policy this module does. Nothing here re-exports them, and nothing here
// decides any of them: `defaultAgendaForType` used to live in this module and
// was a second copy of the detail page's `meeting.type === "vision_meeting"`
// ternary. The one function left below is the WRITE.
// ============================================================================

/**
 * Replace a meeting's agenda with `sections`.
 *
 * Whole-array replace, not per-section CRUD: add, remove, retime and reorder
 * are all "the running order is now this", and one write means a reorder can
 * never land half-applied. The stored value is the normalized array this
 * returns, so what the next reader parses is exactly what was validated here.
 *
 * The church id is part of the `WHERE`, so a meeting id from another church
 * matches no row and is refused rather than silently writing nothing.
 */
export async function setMeetingAgenda(
  churchId: string,
  meetingId: string,
  sections: readonly unknown[]
): Promise<AgendaSection[]> {
  const normalized = parseAgenda(sections);

  const [updated] = await db
    .update(churchMeetings)
    .set({ agenda: normalized, updatedAt: new Date() })
    .where(
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.id, meetingId)
      )
    )
    .returning({ id: churchMeetings.id });

  if (!updated) {
    throw new Error("Meeting not found");
  }

  return normalized;
}

// ============================================================================
// Follow-up completion (VM-020)
// ============================================================================

/**
 * How much of a meeting's linked task work is done.
 *
 * The card that renders this is titled `MEETING_EVALUATION_TASK_CARD_TITLE` and
 * its progress line is `meetingLinkedTaskProgressCopy` — both in `copy.ts`,
 * which is where the rulings behind them are written down.
 */
export interface MeetingFollowUpCompletion {
  /** Tasks linked to this meeting. */
  total: number;
  /** How many of them are `complete`. */
  completed: number;
  /**
   * 0–100, whole numbers. `null` when `total` is 0 — a percentage with a zero
   * denominator is UNKNOWN, never 0%, the same rule the delivery figures follow
   * (memory/invariants.md → Communication). "0% of follow-ups done" is a claim
   * about work that does not exist.
   */
  percent: number | null;
}

/**
 * "A task linked to THIS meeting", as a list of conditions.
 *
 * The link is `related_type = 'meeting' AND related_id = <this meeting>`, and
 * deliberately nothing looser. Finalization also mints one follow-up per
 * attendee, but F5 links those to the PERSON (`related_type = 'person'`,
 * `related_id = <person id>` — `src/lib/tasks/events.ts`), so they carry no
 * meeting id at all. Counting them would mean joining back through attendance
 * on the person, and a person who attends two meetings would then have their
 * single follow-up counted against both. A figure that double-counts is worse
 * than a narrow one; widening this means giving those tasks a meeting link
 * first, in the generator, not guessing at one here.
 *
 * `church_id` is in the WHERE rather than inferred from the meeting id:
 * isolation is application-layer, so every read states its own tenant boundary
 * (memory/invariants.md → Multi-Tenancy).
 *
 * `topLevelTasksOnly()` is imported rather than re-spelled because a subtask is
 * a checklist item, not a task (#370) — anything reporting a NUMBER of tasks
 * has to count the population `listTasks` and `getTaskCounts` count.
 */
export function meetingLinkedTaskConditions(
  churchId: string,
  meetingId: string
) {
  return [
    eq(tasks.churchId, churchId),
    eq(tasks.relatedType, "meeting"),
    eq(tasks.relatedId, meetingId),
    isNull(tasks.deletedAt),
    topLevelTasksOnly(),
  ];
}

/**
 * The completed-of-total count, as a query.
 *
 * Exported un-awaited so a test can render it with `.toSQL()` and assert the
 * tenant and meeting scoping without a database — the technique
 * `src/lib/wiki/tenancy.test.ts` uses.
 */
export function meetingFollowUpCountQuery(churchId: string, meetingId: string) {
  return db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${tasks.status} = 'complete')::int`,
    })
    .from(tasks)
    .where(and(...meetingLinkedTaskConditions(churchId, meetingId)));
}

/**
 * Follow-up completion for one meeting (VM-020).
 *
 * `null` means "there is no figure to show", for two reasons that both render
 * as nothing rather than as a number:
 *
 *  1. The meeting is not this church's. Scoping is asserted here, not assumed
 *     from the caller having a meeting id.
 *  2. Attendance was never finalized. `actual_attendance` non-null IS the
 *     finalized marker (see the block comment above `runFinalizeAttendance`),
 *     and follow-ups only exist once finalization has run. Before that "0%"
 *     would read as "you have done none of your follow-ups" when the truthful
 *     statement is "there are none yet".
 */
export async function getFollowUpCompletion(
  churchId: string,
  meetingId: string
): Promise<MeetingFollowUpCompletion | null> {
  const [meeting] = await db
    .select({ actualAttendance: churchMeetings.actualAttendance })
    .from(churchMeetings)
    .where(
      and(
        eq(churchMeetings.churchId, churchId),
        eq(churchMeetings.id, meetingId)
      )
    )
    .limit(1);

  if (!meeting || meeting.actualAttendance === null) return null;

  const [row] = await meetingFollowUpCountQuery(churchId, meetingId);

  const total = row?.total ?? 0;
  const completed = row?.completed ?? 0;

  return {
    total,
    completed,
    percent: total === 0 ? null : Math.round((completed / total) * 100),
  };
}
