import { db } from "@/db";
import {
  locations,
  meetingChecklistItems,
  meetingEvaluations,
  persons,
  visionMeetingAttendance,
  visionMeetings,
  type MeetingChecklistItem,
  type MeetingEvaluation,
  type MeetingStatus,
  type NewLocation,
  type NewVisionMeeting,
  type VisionMeeting,
} from "@/db/schema";
import type {
  AttendanceCreateInput,
  ChecklistItemUpdateInput,
  EvaluationCreateInput,
  MeetingCreateInput,
  MeetingUpdateInput,
} from "@/lib/validations/vision-meetings";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  emitAttendanceFinalized,
  emitAttendanceRecorded,
  emitMeetingCompleted,
} from "./events";
import { kitTemplate } from "./kit-template";
import type {
  AttendanceSummary,
  AttendanceWithPerson,
  ListMeetingsOptions,
  MeetingWithCounts,
} from "./types";

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Get the next meeting number for a church.
 * Returns `MAX(meeting_number) + 1`, starting at 1 for the first meeting.
 */
async function getNextMeetingNumber(churchId: string): Promise<number> {
  const result = await db
    .select({
      maxNum: sql<number>`COALESCE(MAX(${visionMeetings.meetingNumber}), 0)`,
    })
    .from(visionMeetings)
    .where(eq(visionMeetings.churchId, churchId));

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
      meetingId: visionMeetingAttendance.meetingId,
      total: sql<number>`count(*)::int`,
      firstTime: sql<number>`count(*) filter (where ${visionMeetingAttendance.attendanceType} = 'first_time')::int`,
      returning: sql<number>`count(*) filter (where ${visionMeetingAttendance.attendanceType} = 'returning')::int`,
    })
    .from(visionMeetingAttendance)
    .where(
      sql`${visionMeetingAttendance.meetingId} IN (${sql.join(
        meetingIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})`
    )
    .groupBy(visionMeetingAttendance.meetingId);

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
      meeting: visionMeetings,
      location: locations,
    })
    .from(visionMeetings)
    .leftJoin(locations, eq(visionMeetings.locationId, locations.id))
    .where(
      and(
        eq(visionMeetings.churchId, churchId),
        eq(visionMeetings.id, meetingId)
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
  };
}

/**
 * List meetings with filtering, pagination, and attendance counts.
 *
 * @param churchId - The church to scope the query to
 * @param options  - Filter by temporal status, limit, and offset
 */
export async function listMeetings(
  churchId: string,
  options: ListMeetingsOptions = {}
): Promise<{ meetings: MeetingWithCounts[]; total: number }> {
  const { status = "all", limit = 25, offset = 0 } = options;

  const safeLimit = Math.min(Math.max(1, limit), 100);
  const now = new Date();

  // Build conditions
  const conditions = [eq(visionMeetings.churchId, churchId)];

  if (status === "upcoming") {
    conditions.push(gte(visionMeetings.datetime, now));
  } else if (status === "past") {
    conditions.push(lt(visionMeetings.datetime, now));
  }

  // Filter by meeting workflow status if provided
  if (options.meetingStatus) {
    conditions.push(
      eq(visionMeetings.status, options.meetingStatus as MeetingStatus)
    );
  }

  // Total count
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(visionMeetings)
    .where(and(...conditions));

  const total = countResult?.count ?? 0;

  // Determine sort order: upcoming → ascending (soonest first), past → descending
  const orderBy =
    status === "upcoming"
      ? [asc(visionMeetings.datetime)]
      : [desc(visionMeetings.datetime)];

  // Fetch meetings with location join
  const rows = await db
    .select({
      meeting: visionMeetings,
      location: locations,
    })
    .from(visionMeetings)
    .leftJoin(locations, eq(visionMeetings.locationId, locations.id))
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
    };
  });

  return { meetings, total };
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new vision meeting.
 * Auto-assigns the next sequential meeting number and snapshots location data.
 * When ad-hoc location details are provided (name/address without a locationId),
 * a Location record is automatically created so it can be reused for future meetings.
 */
export async function createMeeting(
  churchId: string,
  userId: string,
  data: MeetingCreateInput
): Promise<VisionMeeting> {
  const meetingNumber = await getNextMeetingNumber(churchId);

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

  const values: NewVisionMeeting = {
    churchId,
    createdBy: userId,
    meetingNumber,
    datetime: data.datetime,
    locationId,
    locationName,
    locationAddress,
    estimatedAttendance: data.estimatedAttendance ?? null,
    notes: data.notes ?? null,
  };

  const [meeting] = await db.insert(visionMeetings).values(values).returning();

  // Auto-populate the materials checklist from the kit template
  await populateChecklist(churchId, meeting.id);

  return meeting;
}

/**
 * Update an existing vision meeting.
 * Only provided fields are updated. Re-snapshots location data when locationId changes.
 */
export async function updateMeeting(
  churchId: string,
  meetingId: string,
  data: MeetingUpdateInput
): Promise<VisionMeeting> {
  // Verify existence
  const existing = await getMeeting(churchId, meetingId);
  if (!existing) {
    throw new Error("Meeting not found");
  }

  const updateData: Partial<NewVisionMeeting> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  // Only include fields that are provided
  if (data.datetime !== undefined) updateData.datetime = data.datetime;
  if (data.estimatedAttendance !== undefined)
    updateData.estimatedAttendance = data.estimatedAttendance;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.locationName !== undefined)
    updateData.locationName = data.locationName;
  if (data.locationAddress !== undefined)
    updateData.locationAddress = data.locationAddress;

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
    .update(visionMeetings)
    .set(updateData)
    .where(
      and(
        eq(visionMeetings.churchId, churchId),
        eq(visionMeetings.id, meetingId)
      )
    )
    .returning();

  if (!updated) {
    throw new Error("Failed to update meeting");
  }

  return updated;
}

/**
 * Delete a vision meeting (hard delete).
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
    .delete(visionMeetings)
    .where(
      and(
        eq(visionMeetings.churchId, churchId),
        eq(visionMeetings.id, meetingId)
      )
    );
}

/**
 * Update a meeting's workflow status (e.g. planning → ready → in_progress → completed).
 */
export async function updateMeetingStatus(
  churchId: string,
  meetingId: string,
  newStatus: MeetingStatus
): Promise<VisionMeeting> {
  const existing = await getMeeting(churchId, meetingId);
  if (!existing) {
    throw new Error("Meeting not found");
  }

  const [updated] = await db
    .update(visionMeetings)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(
      and(
        eq(visionMeetings.churchId, churchId),
        eq(visionMeetings.id, meetingId)
      )
    )
    .returning();

  if (!updated) {
    throw new Error("Failed to update meeting status");
  }

  // Emit meeting.completed event when status changes to completed
  if (newStatus === "completed") {
    await emitMeetingCompleted(
      meetingId,
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
 * Add an attendee to a vision meeting.
 */
export async function addAttendee(
  churchId: string,
  meetingId: string,
  data: AttendanceCreateInput
) {
  const [record] = await db
    .insert(visionMeetingAttendance)
    .values({
      churchId,
      meetingId,
      personId: data.personId,
      attendanceType: data.attendanceType,
      invitedById: data.invitedById ?? null,
      responseStatus: data.responseStatus ?? null,
      notes: data.notes ?? null,
    })
    .returning();

  return record;
}

/**
 * Remove an attendee from a vision meeting.
 */
export async function removeAttendee(
  churchId: string,
  meetingId: string,
  personId: string
): Promise<void> {
  const deleted = await db
    .delete(visionMeetingAttendance)
    .where(
      and(
        eq(visionMeetingAttendance.churchId, churchId),
        eq(visionMeetingAttendance.meetingId, meetingId),
        eq(visionMeetingAttendance.personId, personId)
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
    .from(visionMeetingAttendance)
    .where(
      and(
        eq(visionMeetingAttendance.churchId, churchId),
        eq(visionMeetingAttendance.meetingId, meetingId)
      )
    )
    .orderBy(desc(visionMeetingAttendance.createdAt));

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
      firstTime: sql<number>`count(*) filter (where ${visionMeetingAttendance.attendanceType} = 'first_time')::int`,
      returning: sql<number>`count(*) filter (where ${visionMeetingAttendance.attendanceType} = 'returning')::int`,
      coreGroup: sql<number>`count(*) filter (where ${visionMeetingAttendance.attendanceType} = 'core_group')::int`,
    })
    .from(visionMeetingAttendance)
    .where(
      and(
        eq(visionMeetingAttendance.churchId, churchId),
        eq(visionMeetingAttendance.meetingId, meetingId)
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

/**
 * Finalize attendance for a meeting.
 * Updates the meeting's actual attendance count and emits events.
 */
export async function finalizeAttendance(
  churchId: string,
  meetingId: string,
  userId: string
): Promise<void> {
  const records = await db
    .select()
    .from(visionMeetingAttendance)
    .where(
      and(
        eq(visionMeetingAttendance.churchId, churchId),
        eq(visionMeetingAttendance.meetingId, meetingId)
      )
    );

  const total = records.length;
  const newAttendeeIds = records
    .filter((r) => r.attendanceType === "first_time")
    .map((r) => r.personId);

  // Update meeting's actual attendance count
  await db
    .update(visionMeetings)
    .set({ actualAttendance: total, updatedAt: new Date() })
    .where(
      and(
        eq(visionMeetings.churchId, churchId),
        eq(visionMeetings.id, meetingId)
      )
    );

  // Emit per-attendee events (F2 subscribes to auto-advance prospect -> attendee)
  for (const record of records) {
    await emitAttendanceRecorded(
      meetingId,
      record.personId,
      churchId,
      record.attendanceType
    );
  }

  // Emit finalized event (F5 subscribes to create follow-up tasks)
  await emitAttendanceFinalized(meetingId, churchId, newAttendeeIds, total);
}

// ============================================================================
// Evaluations
// ============================================================================

/**
 * Create an evaluation for a vision meeting.
 * Calculates totalScore as the average of all 8 quality factor scores.
 */
export async function createEvaluation(
  churchId: string,
  meetingId: string,
  userId: string,
  data: EvaluationCreateInput
): Promise<MeetingEvaluation> {
  const avg =
    (data.attendanceScore +
      data.locationScore +
      data.logisticsScore +
      data.agendaScore +
      data.vibeScore +
      data.messageScore +
      data.closeScore +
      data.nextStepsScore) /
    8;

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
 */
export async function getEvaluationTrend(
  churchId: string,
  limit = 10
): Promise<{ meetingNumber: number; totalScore: number; datetime: Date }[]> {
  const rows = await db
    .select({
      meetingNumber: visionMeetings.meetingNumber,
      totalScore: meetingEvaluations.totalScore,
      datetime: visionMeetings.datetime,
    })
    .from(meetingEvaluations)
    .innerJoin(
      visionMeetings,
      eq(meetingEvaluations.meetingId, visionMeetings.id)
    )
    .where(eq(meetingEvaluations.churchId, churchId))
    .orderBy(desc(visionMeetings.datetime))
    .limit(limit);

  // Return in chronological order (oldest first)
  return rows.reverse().map((r) => ({
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
 * Called automatically when a meeting is created.
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
