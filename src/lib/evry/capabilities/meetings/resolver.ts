import { createHash } from "node:crypto";

import { and, asc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  churchMeetings,
  invitations,
  locations,
  meetingAttendance,
  meetingChecklistItems,
  meetingConfirmationTokens,
  meetingEvaluations,
  meetingResponses,
  ministryTeams,
  notifications,
  persons,
  teamMemberships,
  tasks,
  users,
} from "@/db/schema";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryPlanRequestKey } from "@/lib/evry/plans";
import type { EvryResolvedPageContext } from "@/lib/evry/resolvers/contract";
import {
  defaultAgendaTemplatesForType,
  parseAgenda,
} from "@/lib/meetings/agenda";
import { attendanceTypeFromDerivationFacts } from "@/lib/meetings/attendance-type";
import { meetingFinalizationTaskAssigneeId } from "@/lib/meetings/finalization";
import { kitTemplate } from "@/lib/meetings/kit-template";
import { meetingDisplayTitle } from "@/lib/meetings/labels";
import {
  listCoreGroupUserIds,
  listGuestListUserIds,
  meetingNotificationFactsQuery,
  planMeetingNotifications,
  type MeetingAudience,
  type MeetingNotificationFacts,
} from "@/lib/meetings/notifications";
import { personIsUserInChurch } from "@/lib/people/person-user";
import { addCalendarDays } from "@/lib/datetime";
import { planTaskNotifications } from "@/lib/tasks/notifications";

import type { MeetingsActionExport } from "./catalog";
import {
  MEETINGS_EFFECT_ARGUMENT_SCHEMAS,
  type MeetingsEffectArguments,
} from "./effect-contracts";
import {
  MEETING_GUEST_BATCH_ARGUMENT_SCHEMA,
  type MeetingGuestBatchArguments,
} from "./dependency-output";
import type { MeetingsEvryEffectSelection } from "./selection";

export type ResolvedMeetingsEffect = {
  [ExportName in MeetingsActionExport]: Readonly<{
    exportName: ExportName;
    arguments: MeetingsEffectArguments<ExportName>;
  }>;
}[MeetingsActionExport];

type Meeting = typeof churchMeetings.$inferSelect;
type Attendance = typeof meetingAttendance.$inferSelect;
type Response = typeof meetingResponses.$inferSelect;
type Person = typeof persons.$inferSelect;

function iso(value: Date): string {
  return value.toISOString();
}

function plannedInstant(value: Date | undefined): string {
  if (!value) {
    throw new Error("A planned Meetings notification omitted its schedule");
  }
  return iso(value);
}

function derivedUuid(requestKey: EvryPlanRequestKey, purpose: string): string {
  const hash = createHash("sha256");
  for (const value of ["evry-meetings-row-v1", requestKey, purpose]) {
    const bytes = Buffer.from(value, "utf8");
    hash.update(String(bytes.length));
    hash.update(":");
    hash.update(bytes);
  }
  const bytes = hash.digest("hex").slice(0, 32).split("");
  bytes[12] = "4";
  bytes[16] = ((Number.parseInt(bytes[16] ?? "0", 16) & 0x3) | 0x8).toString(
    16
  );
  return `${bytes.slice(0, 8).join("")}-${bytes
    .slice(8, 12)
    .join("")}-${bytes.slice(12, 16).join("")}-${bytes
    .slice(16, 20)
    .join("")}-${bytes.slice(20).join("")}`;
}

function meetingIdFromContext(
  context: EvryResolvedPageContext | null
): string | null {
  return context?.kind === "meeting" ? context.recordId : null;
}

async function loadMeeting(
  plantId: string,
  context: EvryResolvedPageContext | null
): Promise<Meeting | null> {
  const meetingId = meetingIdFromContext(context);
  if (!meetingId) return null;
  const [meeting] = await db
    .select()
    .from(churchMeetings)
    .where(
      and(
        eq(churchMeetings.id, meetingId),
        eq(churchMeetings.churchId, plantId)
      )
    )
    .limit(1);
  return meeting ?? null;
}

async function loadPerson(plantId: string, personId: string) {
  const [person] = await db
    .select()
    .from(persons)
    .where(
      and(
        eq(persons.id, personId),
        eq(persons.churchId, plantId),
        isNull(persons.deletedAt)
      )
    )
    .limit(1);
  return person ?? null;
}

async function attendanceDerivationBaseline(input: {
  plantId: string;
  meeting: Meeting;
  person: Pick<Person, "id" | "status">;
}) {
  const priorAttendances = await db
    .select({
      attendanceId: meetingAttendance.id,
      meetingId: churchMeetings.id,
      meetingDatetime: churchMeetings.datetime,
    })
    .from(meetingAttendance)
    .innerJoin(
      churchMeetings,
      and(
        eq(churchMeetings.id, meetingAttendance.meetingId),
        eq(churchMeetings.churchId, meetingAttendance.churchId)
      )
    )
    .where(
      and(
        eq(meetingAttendance.churchId, input.plantId),
        eq(meetingAttendance.personId, input.person.id),
        eq(meetingAttendance.status, "attended"),
        ne(meetingAttendance.meetingId, input.meeting.id),
        lt(churchMeetings.datetime, input.meeting.datetime)
      )
    )
    .orderBy(asc(meetingAttendance.id))
    .limit(1_001);
  if (priorAttendances.length > 1_000) return null;
  const baseline = {
    personStatus: input.person.status,
    meetingDatetime: iso(input.meeting.datetime),
    priorAttendances: priorAttendances.map((row) => ({
      attendanceId: row.attendanceId,
      meetingId: row.meetingId,
      meetingDatetime: iso(row.meetingDatetime),
    })),
  };
  return {
    baseline,
    attendanceType: attendanceTypeFromDerivationFacts({
      personStatus: baseline.personStatus,
      hasPriorAttendance: baseline.priorAttendances.length > 0,
    }),
  };
}

async function loadAttendance(
  plantId: string,
  meetingId: string,
  personId: string
): Promise<Attendance | null> {
  const [attendance] = await db
    .select()
    .from(meetingAttendance)
    .where(
      and(
        eq(meetingAttendance.churchId, plantId),
        eq(meetingAttendance.meetingId, meetingId),
        eq(meetingAttendance.personId, personId)
      )
    )
    .limit(1);
  return attendance ?? null;
}

async function loadResponse(
  plantId: string,
  meetingId: string,
  personId: string
): Promise<Response | null> {
  const [response] = await db
    .select()
    .from(meetingResponses)
    .where(
      and(
        eq(meetingResponses.churchId, plantId),
        eq(meetingResponses.meetingId, meetingId),
        eq(meetingResponses.personId, personId)
      )
    )
    .limit(1);
  return response ?? null;
}

function attendanceBaseline(attendance: Attendance | null) {
  return attendance
    ? {
        id: attendance.id,
        exists: true,
        status: attendance.status,
        attendanceType: attendance.attendanceType,
        responseStatus: attendance.responseStatus,
        notes: attendance.notes,
        updatedAt: iso(attendance.updatedAt),
      }
    : {
        id: null,
        exists: false,
        status: null,
        attendanceType: null,
        responseStatus: null,
        notes: null,
        updatedAt: null,
      };
}

function responseBaseline(response: Response) {
  return {
    responseId: response.id,
    responseType: response.responseType,
    notes: response.notes,
    recordedById: response.recordedById,
    updatedAt: iso(response.updatedAt),
  };
}

function meetingState(meeting: Meeting) {
  return {
    type: meeting.type,
    title: meeting.title,
    datetime: iso(meeting.datetime),
    status: meeting.status,
    locationId: meeting.locationId,
    locationName: meeting.locationName,
    locationAddress: meeting.locationAddress,
    meetingNumber: meeting.meetingNumber,
    teamId: meeting.teamId,
    meetingSubtype: meeting.meetingSubtype,
    estimatedAttendance: meeting.estimatedAttendance,
    actualAttendance: meeting.actualAttendance,
    durationMinutes: meeting.durationMinutes,
    notes: meeting.notes,
    agenda: parseAgenda(meeting.agenda),
  };
}

async function pendingMeetingNotifications(plantId: string, meetingId: string) {
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.churchId, plantId),
        eq(notifications.category, "meetings"),
        eq(notifications.entityType, "meeting"),
        eq(notifications.entityId, meetingId),
        eq(notifications.status, "pending")
      )
    );
  return rows.map((row) => ({
    notificationId: row.id,
    recipientUserId: row.recipientUserId,
    type: row.type,
    entityId: meetingId,
    dedupeKey: row.dedupeKey ?? "",
    scheduledFor: iso(row.scheduledFor),
    beforeStatus: "pending" as const,
    expectedUpdatedAt: iso(row.updatedAt),
  }));
}

async function activeMeetingNotifications(plantId: string, meetingId: string) {
  const rows = await db
    .select({
      notificationId: notifications.id,
      recipientUserId: notifications.recipientUserId,
      type: notifications.type,
      entityId: notifications.entityId,
      dedupeKey: notifications.dedupeKey,
      status: notifications.status,
      scheduledFor: notifications.scheduledFor,
      expectedUpdatedAt: notifications.updatedAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.churchId, plantId),
        eq(notifications.category, "meetings"),
        eq(notifications.entityType, "meeting"),
        eq(notifications.entityId, meetingId),
        sql`${notifications.status} <> 'cancelled'`
      )
    );
  return rows
    .map((row) => ({
      ...row,
      entityId: row.entityId ?? "",
      dedupeKey: row.dedupeKey ?? "",
      scheduledFor: iso(row.scheduledFor),
      expectedUpdatedAt: iso(row.expectedUpdatedAt),
    }))
    .toSorted((left, right) =>
      left.notificationId.localeCompare(right.notificationId)
    );
}

async function meetingAudience(
  facts: MeetingNotificationFacts,
  addPersonId?: string,
  removePersonId?: string
): Promise<MeetingAudience> {
  const [coreGroup, guestUsers, selectedUsers] = await Promise.all([
    listCoreGroupUserIds(facts.churchId),
    removePersonId
      ? db
          .selectDistinct({ userId: users.id })
          .from(meetingAttendance)
          .innerJoin(
            persons,
            and(
              eq(meetingAttendance.personId, persons.id),
              eq(meetingAttendance.churchId, persons.churchId)
            )
          )
          .innerJoin(users, personIsUserInChurch(facts.churchId))
          .where(
            and(
              eq(meetingAttendance.churchId, facts.churchId),
              eq(meetingAttendance.meetingId, facts.id),
              sql`${persons.id} <> ${removePersonId}::uuid`,
              isNull(persons.deletedAt)
            )
          )
          .then((rows) => rows.map(({ userId }) => userId))
      : listGuestListUserIds(facts.churchId, facts.id),
    addPersonId || removePersonId
      ? db
          .select({ userId: users.id, personId: persons.id })
          .from(persons)
          .innerJoin(users, personIsUserInChurch(facts.churchId))
          .where(
            and(
              eq(persons.churchId, facts.churchId),
              eq(persons.id, addPersonId ?? removePersonId ?? ""),
              isNull(persons.deletedAt)
            )
          )
      : Promise.resolve([]),
  ]);
  const selectedUserIds = new Set(selectedUsers.map(({ userId }) => userId));
  const reminders = new Set([facts.createdBy, ...guestUsers]);
  if (addPersonId) selectedUserIds.forEach((id) => reminders.add(id));
  return {
    coreGroup: [...new Set(coreGroup)].toSorted(),
    reminders: [...reminders].toSorted(),
  };
}

async function plannedMeetingNotificationTargets(input: {
  requestKey: EvryPlanRequestKey;
  facts: MeetingNotificationFacts;
  audience: MeetingAudience;
  now: Date;
  cancelling?: Awaited<ReturnType<typeof pendingMeetingNotifications>>;
}) {
  const activeNotifications = await activeMeetingNotifications(
    input.facts.churchId,
    input.facts.id
  );
  const active = new Set(
    activeNotifications.map(
      ({ recipientUserId, dedupeKey }) => `${recipientUserId}:${dedupeKey}`
    )
  );
  for (const row of input.cancelling ?? []) {
    active.delete(`${row.recipientUserId}:${row.dedupeKey}`);
  }
  const notificationTargets = planMeetingNotifications(
    input.facts,
    input.audience,
    input.now
  )
    .notifications.filter(
      (notification) =>
        !active.has(
          `${notification.recipientUserId}:${notification.dedupeKey ?? ""}`
        )
    )
    .map((notification, index) => ({
      notificationId: derivedUuid(
        input.requestKey,
        `meeting-notification:${index}:${notification.recipientUserId}:${notification.dedupeKey}`
      ),
      recipientUserId: notification.recipientUserId,
      category: "meetings" as const,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      entityType: "meeting" as const,
      entityId: input.facts.id,
      dedupeKey: notification.dedupeKey ?? "",
      scheduledFor: plannedInstant(notification.scheduledFor),
      expectedAbsent: true as const,
    }));
  return {
    notificationBaseline: {
      coreGroupUserIds: [...input.audience.coreGroup].toSorted(),
      reminderUserIds: [...input.audience.reminders].toSorted(),
      activeNotifications,
    },
    notificationTargets,
  };
}

/** Resolve immutable batch targets for guests added after this exact create. */
export async function resolveMeetingGuestBatchAfterCreate(input: {
  actor: EvryPlantActor;
  create: MeetingsEffectArguments<"createMeetingAction">;
  dependencyStepId: string;
  targets: readonly Readonly<{
    attendanceId: string;
    personId: string;
    expectedPersonUpdatedAt: string;
    expectedAttendanceAbsent: true;
  }>[];
  requestKey: EvryPlanRequestKey;
  now: Date;
}): Promise<MeetingGuestBatchArguments | null> {
  if (
    input.create.attendanceRows.length !== 0 ||
    input.create.resolvedTeamMemberIds.length !== 0
  ) {
    return null;
  }
  const guestRows = await db
    .select({
      personId: persons.id,
      expectedPersonUpdatedAt: persons.updatedAt,
      userId: users.id,
    })
    .from(persons)
    .leftJoin(users, personIsUserInChurch(input.actor.plantId))
    .where(
      and(
        eq(persons.churchId, input.actor.plantId),
        inArray(
          persons.id,
          input.targets.map(({ personId }) => personId)
        ),
        isNull(persons.deletedAt)
      )
    );
  const versions = new Map(
    guestRows.map(({ personId, expectedPersonUpdatedAt }) => [
      personId,
      expectedPersonUpdatedAt.toISOString(),
    ])
  );
  if (
    input.targets.some(
      ({ personId, expectedPersonUpdatedAt }) =>
        versions.get(personId) !== expectedPersonUpdatedAt
    )
  ) {
    return null;
  }
  const expectedCoreGroupUserIds = await listCoreGroupUserIds(
    input.actor.plantId
  );
  const expectedReminderUserIds = [
    ...new Set([
      input.actor.userId,
      ...guestRows.flatMap(({ userId }) => (userId ? [userId] : [])),
    ]),
  ].toSorted();
  const facts: MeetingNotificationFacts = {
    id: input.create.meetingId,
    churchId: input.actor.plantId,
    type: input.create.type,
    title: input.create.title,
    meetingNumber: input.create.meetingNumber,
    teamName: null,
    datetime: new Date(input.create.datetime),
    status: input.create.status,
    createdBy: input.actor.userId,
  };
  const active = new Set(
    input.create.notificationTargets.map(
      ({ recipientUserId, dedupeKey }) => `${recipientUserId}:${dedupeKey}`
    )
  );
  const notificationTargets = planMeetingNotifications(
    facts,
    {
      coreGroup: expectedCoreGroupUserIds,
      reminders: expectedReminderUserIds,
    },
    input.now
  )
    .notifications.filter(
      ({ recipientUserId, dedupeKey }) =>
        !active.has(`${recipientUserId}:${dedupeKey ?? ""}`)
    )
    .map((notification, index) => ({
      notificationId: derivedUuid(
        input.requestKey,
        `invitation-guest-notification:${index}:${notification.recipientUserId}:${notification.dedupeKey}`
      ),
      recipientUserId: notification.recipientUserId,
      category: "meetings" as const,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      entityType: "meeting" as const,
      entityId: input.create.meetingId,
      dedupeKey: notification.dedupeKey ?? "",
      scheduledFor: plannedInstant(notification.scheduledFor),
      expectedAbsent: true as const,
    }));
  const parsed = MEETING_GUEST_BATCH_ARGUMENT_SCHEMA.safeParse({
    mode: "batch-after-create",
    meetingId: input.create.meetingId,
    dependencyStepId: input.dependencyStepId,
    targets: input.targets,
    expectedCoreGroupUserIds: [...expectedCoreGroupUserIds].toSorted(),
    expectedReminderUserIds,
    notificationTargets,
  });
  return parsed.success ? parsed.data : null;
}

async function plannedTaskTargets(input: {
  requestKey: EvryPlanRequestKey;
  taskId: string;
  title: string;
  dueDate: string;
  assignedToId: string;
  plantId: string;
  now: Date;
}) {
  return planTaskNotifications(
    {
      id: input.taskId,
      churchId: input.plantId,
      title: input.title,
      status: "not_started",
      dueDate: input.dueDate,
      dueTime: null,
      assignedToId: input.assignedToId,
      deletedAt: null,
    },
    input.now
  ).notifications.map((notification, index) => ({
    notificationId: derivedUuid(
      input.requestKey,
      `task-notification:${input.taskId}:${index}:${notification.type}`
    ),
    recipientUserId: notification.recipientUserId,
    category: "tasks" as const,
    type: notification.type as "task.due" | "task.overdue",
    title: notification.title,
    body: notification.body,
    entityType: "task" as const,
    entityId: input.taskId,
    dedupeKey: notification.dedupeKey ?? "",
    scheduledFor: plannedInstant(notification.scheduledFor),
    expectedAbsent: true as const,
  }));
}

async function pendingTaskNotificationBaseline(
  plantId: string,
  taskId: string
) {
  const rows = await db
    .select({
      notificationId: notifications.id,
      recipientUserId: notifications.recipientUserId,
      type: notifications.type,
      entityId: notifications.entityId,
      dedupeKey: notifications.dedupeKey,
      scheduledFor: notifications.scheduledFor,
      expectedUpdatedAt: notifications.updatedAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.churchId, plantId),
        eq(notifications.category, "tasks"),
        eq(notifications.entityType, "task"),
        eq(notifications.entityId, taskId),
        eq(notifications.status, "pending")
      )
    )
    .orderBy(asc(notifications.id));
  return rows.map((row) => ({
    notificationId: row.notificationId,
    recipientUserId: row.recipientUserId,
    type: row.type as "task.due" | "task.overdue",
    entityId: row.entityId ?? taskId,
    dedupeKey: row.dedupeKey ?? "",
    scheduledFor: iso(row.scheduledFor),
    beforeStatus: "pending" as const,
    expectedUpdatedAt: iso(row.expectedUpdatedAt),
  }));
}

function parseResolved<ExportName extends MeetingsActionExport>(
  exportName: ExportName,
  value: unknown
): ResolvedMeetingsEffect {
  return {
    exportName,
    arguments: MEETINGS_EFFECT_ARGUMENT_SCHEMAS[exportName].parse(value),
  } as ResolvedMeetingsEffect;
}

/** Resolve protected ids and complete before/after state inside one plant. */
export async function resolveMeetingsEvryEffect(input: {
  actor: EvryPlantActor;
  selection: MeetingsEvryEffectSelection;
  pageContext: EvryResolvedPageContext | null;
  requestKey: EvryPlanRequestKey;
  now: Date;
}): Promise<ResolvedMeetingsEffect | null> {
  const { actor, selection, requestKey, now } = input;
  const values = selection.values;
  const exportName = selection.exportName;

  if (exportName === "createLocationAction") {
    return parseResolved(exportName, {
      locationId: derivedUuid(requestKey, "location"),
      name: values.name,
      address: values.address,
      contactName: values.contactName ?? null,
      contactPhone: values.contactPhone ?? null,
      contactEmail: values.contactEmail ?? null,
      cost: values.cost ?? null,
      capacity: values.capacity ?? null,
      notes: values.notes ?? null,
      expectedLocationAbsent: true,
    });
  }
  if (exportName === "updateLocationAction") {
    if (typeof values.locationId !== "string") return null;
    const [location] = await db
      .select()
      .from(locations)
      .where(
        and(
          eq(locations.id, values.locationId),
          eq(locations.churchId, actor.plantId)
        )
      )
      .limit(1);
    if (!location) return null;
    const before = {
      name: location.name,
      address: location.address,
      contactName: location.contactName,
      contactPhone: location.contactPhone,
      contactEmail: location.contactEmail,
      cost: location.cost,
      capacity: location.capacity,
      notes: location.notes,
      isActive: location.isActive,
    };
    const afterCandidate = {
      ...before,
      ...(Object.hasOwn(values, "name") ? { name: values.name } : {}),
      ...(Object.hasOwn(values, "address") ? { address: values.address } : {}),
      ...(Object.hasOwn(values, "contactName")
        ? { contactName: values.contactName }
        : {}),
      ...(Object.hasOwn(values, "contactPhone")
        ? { contactPhone: values.contactPhone }
        : {}),
      ...(Object.hasOwn(values, "contactEmail")
        ? { contactEmail: values.contactEmail }
        : {}),
      ...(Object.hasOwn(values, "cost") ? { cost: values.cost } : {}),
      ...(Object.hasOwn(values, "capacity")
        ? { capacity: values.capacity }
        : {}),
      ...(Object.hasOwn(values, "notes") ? { notes: values.notes } : {}),
    };
    const parsedAfter =
      MEETINGS_EFFECT_ARGUMENT_SCHEMAS.updateLocationAction.shape.after.safeParse(
        afterCandidate
      );
    if (!parsedAfter.success) return null;
    const after = parsedAfter.data;
    if (JSON.stringify(before) === JSON.stringify(after)) return null;
    return parseResolved(exportName, {
      locationId: location.id,
      expectedUpdatedAt: iso(location.updatedAt),
      before,
      after,
    });
  }
  if (exportName === "createMeetingAction") {
    const type = values.type;
    const datetime = values.datetime;
    const selectedTeamId =
      typeof values.teamId === "string" ? values.teamId : null;
    const selectedLocationId =
      typeof values.locationId === "string" ? values.locationId : null;
    const locationName =
      typeof values.locationName === "string" ? values.locationName : null;
    const locationAddress =
      typeof values.locationAddress === "string"
        ? values.locationAddress
        : null;
    if (
      (type !== "vision_meeting" &&
        type !== "orientation" &&
        type !== "team_meeting") ||
      typeof datetime !== "string" ||
      typeof values.timezone !== "string" ||
      (type === "team_meeting") !== (selectedTeamId !== null) ||
      (selectedLocationId !== null &&
        (locationName !== null || locationAddress !== null)) ||
      (locationName === null) !== (locationAddress === null)
    ) {
      return null;
    }
    const meetingId = derivedUuid(requestKey, "meeting");
    const [savedLocation, team] = await Promise.all([
      selectedLocationId
        ? db
            .select()
            .from(locations)
            .where(
              and(
                eq(locations.id, selectedLocationId),
                eq(locations.churchId, actor.plantId),
                eq(locations.isActive, true)
              )
            )
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      selectedTeamId
        ? db
            .select({ id: ministryTeams.id, name: ministryTeams.name })
            .from(ministryTeams)
            .where(
              and(
                eq(ministryTeams.id, selectedTeamId),
                eq(ministryTeams.churchId, actor.plantId)
              )
            )
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
    ]);
    if ((selectedLocationId && !savedLocation) || (selectedTeamId && !team)) {
      return null;
    }
    const resolvedLocationId =
      savedLocation?.id ??
      (locationName ? derivedUuid(requestKey, "saved-location") : null);
    const savedLocationId = locationName ? resolvedLocationId : null;
    const resolvedLocationName = savedLocation?.name ?? locationName;
    const resolvedLocationAddress = savedLocation?.address ?? locationAddress;
    const teamMembers = selectedTeamId
      ? await db
          .select({
            personId: persons.id,
            expectedPersonUpdatedAt: persons.updatedAt,
          })
          .from(teamMemberships)
          .innerJoin(
            persons,
            and(
              eq(persons.id, teamMemberships.personId),
              eq(persons.churchId, teamMemberships.churchId)
            )
          )
          .where(
            and(
              eq(teamMemberships.teamId, selectedTeamId),
              eq(teamMemberships.churchId, actor.plantId),
              eq(teamMemberships.status, "active"),
              isNull(persons.deletedAt)
            )
          )
      : [];
    teamMembers.sort((left, right) =>
      left.personId.localeCompare(right.personId)
    );
    const agenda = defaultAgendaTemplatesForType(type).map(
      (section, index) => ({
        id: derivedUuid(requestKey, `agenda:${index}`),
        ...section,
      })
    );
    const checklistItems =
      type === "vision_meeting"
        ? kitTemplate.map((item, index) => ({
            itemId: derivedUuid(requestKey, `checklist:${index}`),
            ...item,
          }))
        : [];
    const [meetingNumberRow] =
      type === "vision_meeting"
        ? await db
            .select({
              value: sql<number>`coalesce(max(${churchMeetings.meetingNumber}), 0) + 1`,
            })
            .from(churchMeetings)
            .where(eq(churchMeetings.churchId, actor.plantId))
        : [{ value: null }];
    const meetingNumber = meetingNumberRow?.value ?? null;
    const requestedTitle =
      typeof values.title === "string" ? values.title : null;
    if (type === "vision_meeting" && requestedTitle !== null) return null;
    const storedTitle =
      type === "vision_meeting" && meetingNumber
        ? meetingDisplayTitle({
            type,
            title: null,
            meetingNumber,
            teamName: null,
          })
        : requestedTitle;
    const facts: MeetingNotificationFacts = {
      id: meetingId,
      churchId: actor.plantId,
      type,
      title: storedTitle,
      meetingNumber,
      teamName: team?.name ?? null,
      datetime: new Date(datetime),
      status: "planning",
      createdBy: actor.userId,
    };
    const audience = await meetingAudience(facts);
    if (teamMembers.length > 0) {
      const teamUsers = await db
        .select({ userId: users.id })
        .from(persons)
        .innerJoin(users, personIsUserInChurch(actor.plantId))
        .where(
          and(
            eq(persons.churchId, actor.plantId),
            inArray(
              persons.id,
              teamMembers.map(({ personId }) => personId)
            ),
            isNull(persons.deletedAt)
          )
        );
      audience.reminders = [
        ...new Set([
          ...audience.reminders,
          ...teamUsers.map(({ userId }) => userId),
        ]),
      ].toSorted();
    }
    const { notificationBaseline, notificationTargets } =
      await plannedMeetingNotificationTargets({
        requestKey,
        facts,
        audience,
        now,
      });
    return parseResolved(exportName, {
      meetingId,
      type,
      title: facts.title,
      datetime,
      timezone: values.timezone,
      status: "planning",
      locationId: resolvedLocationId,
      locationName: resolvedLocationName,
      locationAddress: resolvedLocationAddress,
      savedLocationId,
      teamId: selectedTeamId,
      meetingSubtype: values.meetingSubtype ?? null,
      estimatedAttendance: values.estimatedAttendance ?? null,
      actualAttendance: null,
      durationMinutes: values.durationMinutes ?? null,
      notes: values.notes ?? null,
      agenda,
      meetingNumber: facts.meetingNumber,
      checklistItems,
      resolvedTeamMemberIds: teamMembers.map(({ personId }) => personId),
      attendanceRows: teamMembers.map(
        ({ personId, expectedPersonUpdatedAt }, index) => ({
          attendanceId: derivedUuid(
            requestKey,
            `team-attendance:${index}:${personId}`
          ),
          personId,
          expectedPersonUpdatedAt: iso(expectedPersonUpdatedAt),
        })
      ),
      notificationBaseline,
      notificationTargets,
      expectedMeetingAbsent: true,
      createdById: actor.userId,
    });
  }

  const meeting = await loadMeeting(actor.plantId, input.pageContext);
  if (!meeting) return null;
  const expectedMeetingUpdatedAt = iso(meeting.updatedAt);
  const [facts] = await meetingNotificationFactsQuery(
    actor.plantId,
    meeting.id
  );
  if (!facts) return null;

  if (exportName === "deleteMeetingAction") {
    const [
      attendance,
      checklist,
      responses,
      evaluation,
      invitationRows,
      confirmationTokenRows,
      pending,
    ] = await Promise.all([
      db
        .select({ id: meetingAttendance.id })
        .from(meetingAttendance)
        .where(
          and(
            eq(meetingAttendance.churchId, actor.plantId),
            eq(meetingAttendance.meetingId, meeting.id)
          )
        ),
      db
        .select({ id: meetingChecklistItems.id })
        .from(meetingChecklistItems)
        .where(
          and(
            eq(meetingChecklistItems.churchId, actor.plantId),
            eq(meetingChecklistItems.meetingId, meeting.id)
          )
        ),
      db
        .select({ id: meetingResponses.id })
        .from(meetingResponses)
        .where(
          and(
            eq(meetingResponses.churchId, actor.plantId),
            eq(meetingResponses.meetingId, meeting.id)
          )
        ),
      db
        .select({ id: meetingEvaluations.id })
        .from(meetingEvaluations)
        .where(
          and(
            eq(meetingEvaluations.churchId, actor.plantId),
            eq(meetingEvaluations.meetingId, meeting.id)
          )
        )
        .limit(1),
      db
        .select({ id: invitations.id })
        .from(invitations)
        .where(
          and(
            eq(invitations.churchId, actor.plantId),
            eq(invitations.meetingId, meeting.id)
          )
        ),
      db
        .select({ id: meetingConfirmationTokens.id })
        .from(meetingConfirmationTokens)
        .where(
          and(
            eq(meetingConfirmationTokens.churchId, actor.plantId),
            eq(meetingConfirmationTokens.meetingId, meeting.id)
          )
        ),
      pendingMeetingNotifications(actor.plantId, meeting.id),
    ]);
    return parseResolved(exportName, {
      meetingId: meeting.id,
      timezone: "UTC",
      expectedUpdatedAt: expectedMeetingUpdatedAt,
      before: meetingState(meeting),
      expectedAttendanceIds: attendance.map(({ id }) => id),
      expectedChecklistItemIds: checklist.map(({ id }) => id),
      expectedResponseIds: responses.map(({ id }) => id),
      expectedEvaluationId: evaluation[0]?.id ?? null,
      expectedInvitationIds: invitationRows.map(({ id }) => id),
      expectedConfirmationTokenIds: confirmationTokenRows.map(({ id }) => id),
      pendingNotifications: pending,
    });
  }
  if (exportName === "updateMeetingAction") {
    if (typeof values.timezone !== "string") return null;
    if (meeting.type === "vision_meeting" && Object.hasOwn(values, "title")) {
      return null;
    }
    const before = meetingState(meeting);
    const hasLocationId = Object.hasOwn(values, "locationId");
    const hasLocationName = Object.hasOwn(values, "locationName");
    const hasLocationAddress = Object.hasOwn(values, "locationAddress");
    if (hasLocationName !== hasLocationAddress) return null;
    if (typeof values.locationId === "string" && hasLocationName) return null;
    const [selectedLocation] =
      typeof values.locationId === "string"
        ? await db
            .select()
            .from(locations)
            .where(
              and(
                eq(locations.id, values.locationId),
                eq(locations.churchId, actor.plantId),
                eq(locations.isActive, true)
              )
            )
            .limit(1)
        : [null];
    if (typeof values.locationId === "string" && !selectedLocation) return null;
    const locationPatch = selectedLocation
      ? {
          locationId: selectedLocation.id,
          locationName: selectedLocation.name,
          locationAddress: selectedLocation.address,
        }
      : hasLocationId || hasLocationName
        ? {
            locationId: null,
            locationName: hasLocationName ? values.locationName : null,
            locationAddress: hasLocationAddress ? values.locationAddress : null,
          }
        : {};
    const afterCandidate = {
      ...before,
      ...locationPatch,
      ...(meeting.type === "vision_meeting"
        ? {
            title:
              meeting.meetingNumber === null
                ? null
                : meetingDisplayTitle({
                    type: meeting.type,
                    title: null,
                    meetingNumber: meeting.meetingNumber,
                    teamName: null,
                  }),
          }
        : Object.hasOwn(values, "title")
          ? { title: values.title }
          : {}),
      ...(Object.hasOwn(values, "datetime")
        ? { datetime: values.datetime }
        : {}),
      ...(Object.hasOwn(values, "meetingSubtype")
        ? { meetingSubtype: values.meetingSubtype }
        : {}),
      ...(Object.hasOwn(values, "estimatedAttendance")
        ? { estimatedAttendance: values.estimatedAttendance }
        : {}),
      ...(Object.hasOwn(values, "durationMinutes")
        ? { durationMinutes: values.durationMinutes }
        : {}),
      ...(Object.hasOwn(values, "notes") ? { notes: values.notes } : {}),
    };
    const parsedAfter =
      MEETINGS_EFFECT_ARGUMENT_SCHEMAS.updateMeetingAction.shape.after.safeParse(
        afterCandidate
      );
    if (!parsedAfter.success) return null;
    const after = parsedAfter.data;
    if (JSON.stringify(before) === JSON.stringify(after)) return null;
    const pending = await pendingMeetingNotifications(
      actor.plantId,
      meeting.id
    );
    const afterFacts = {
      ...facts,
      title: after.title,
      datetime: new Date(after.datetime),
    };
    const audience = await meetingAudience(afterFacts);
    const { notificationBaseline, notificationTargets } =
      await plannedMeetingNotificationTargets({
        requestKey,
        facts: afterFacts,
        audience,
        now,
        cancelling: pending,
      });
    return parseResolved(exportName, {
      meetingId: meeting.id,
      timezone: values.timezone,
      expectedUpdatedAt: expectedMeetingUpdatedAt,
      before,
      after,
      pendingNotifications: pending,
      notificationBaseline,
      notificationTargets,
    });
  }
  if (exportName === "updateMeetingStatusAction") {
    const afterStatus = values.status;
    if (typeof afterStatus !== "string") return null;
    const pending = await pendingMeetingNotifications(
      actor.plantId,
      meeting.id
    );
    const afterFacts = { ...facts, status: afterStatus as Meeting["status"] };
    const audience = await meetingAudience(afterFacts);
    const { notificationBaseline, notificationTargets } =
      await plannedMeetingNotificationTargets({
        requestKey,
        facts: afterFacts,
        audience,
        now,
        cancelling: pending,
      });
    return parseResolved(exportName, {
      meetingId: meeting.id,
      beforeStatus: meeting.status,
      afterStatus,
      expectedUpdatedAt: expectedMeetingUpdatedAt,
      pendingNotifications: pending,
      notificationBaseline,
      notificationTargets,
    });
  }

  if (exportName === "saveAgendaAction") {
    return parseResolved(exportName, {
      meetingId: meeting.id,
      expectedUpdatedAt: expectedMeetingUpdatedAt,
      beforeSections: parseAgenda(meeting.agenda),
      afterSections: values.sections,
    });
  }
  if (
    exportName === "toggleChecklistItemAction" ||
    exportName === "updateChecklistItemAction"
  ) {
    if (typeof values.itemId !== "string") return null;
    const [item] = await db
      .select()
      .from(meetingChecklistItems)
      .where(
        and(
          eq(meetingChecklistItems.id, values.itemId),
          eq(meetingChecklistItems.meetingId, meeting.id),
          eq(meetingChecklistItems.churchId, actor.plantId)
        )
      )
      .limit(1);
    if (!item) return null;
    if (exportName === "toggleChecklistItemAction") {
      return parseResolved(exportName, {
        itemId: item.id,
        meetingId: meeting.id,
        beforeChecked: item.isChecked,
        afterChecked: values.checked,
        expectedUpdatedAt: iso(item.updatedAt),
      });
    }
    const changesNotes = Object.hasOwn(values, "notes");
    const changesAssignee = Object.hasOwn(values, "assignedTo");
    if (!changesNotes && !changesAssignee) return null;
    const afterAssignedTo = changesAssignee
      ? values.assignedTo
      : item.assignedTo;
    if (afterAssignedTo !== null && typeof afterAssignedTo !== "string") {
      return null;
    }
    const [assignedPerson] = afterAssignedTo
      ? await db
          .select({ id: persons.id, updatedAt: persons.updatedAt })
          .from(persons)
          .where(
            and(
              eq(persons.id, afterAssignedTo),
              eq(persons.churchId, actor.plantId),
              isNull(persons.deletedAt)
            )
          )
          .limit(1)
      : [null];
    if (afterAssignedTo && !assignedPerson) return null;
    return parseResolved(exportName, {
      itemId: item.id,
      meetingId: meeting.id,
      beforeNotes: item.notes,
      afterNotes: changesNotes ? values.notes : item.notes,
      beforeAssignedTo: item.assignedTo,
      afterAssignedTo,
      expectedAssignedPersonUpdatedAt: assignedPerson
        ? iso(assignedPerson.updatedAt)
        : null,
      expectedUpdatedAt: iso(item.updatedAt),
    });
  }

  if (exportName === "createEvaluationAction") {
    const scores = Array.isArray(values.scores) ? values.scores : [];
    const [evaluation, evaluationTask] = await Promise.all([
      db
        .select({ id: meetingEvaluations.id })
        .from(meetingEvaluations)
        .where(
          and(
            eq(meetingEvaluations.churchId, actor.plantId),
            eq(meetingEvaluations.meetingId, meeting.id)
          )
        )
        .limit(1),
      db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.churchId, actor.plantId),
            eq(tasks.relatedType, "meeting"),
            eq(tasks.relatedId, meeting.id),
            eq(tasks.completionEvent, "meeting.evaluation.completed"),
            isNull(tasks.deletedAt)
          )
        )
        .limit(1),
    ]);
    if (evaluation[0] || scores.length !== 8) return null;
    const task = evaluationTask[0];
    return parseResolved(exportName, {
      meetingId: meeting.id,
      evaluationId: derivedUuid(requestKey, "evaluation"),
      attendanceScore: scores[0],
      locationScore: scores[1],
      logisticsScore: scores[2],
      agendaScore: scores[3],
      vibeScore: scores[4],
      messageScore: scores[5],
      closeScore: scores[6],
      nextStepsScore: scores[7],
      notes: values.notes,
      expectedMeetingUpdatedAt,
      expectedEvaluationAbsent: true,
      evaluationTask: task
        ? {
            taskId: task.id,
            title: task.title,
            beforeStatus: task.status,
            expectedUpdatedAt: iso(task.updatedAt),
          }
        : null,
    });
  }

  const personId = typeof values.personId === "string" ? values.personId : null;
  if (
    exportName === "quickAddAttendeeAction" ||
    exportName === "quickAddPersonToGuestListAction" ||
    exportName === "quickAddWalkInAction"
  ) {
    const quickPersonId = derivedUuid(requestKey, "person");
    const audience = await meetingAudience(facts);
    if (typeof values.email === "string") {
      const matchingUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.churchId, actor.plantId),
            sql`lower(${users.email}) = lower(${values.email})`
          )
        );
      audience.reminders = [
        ...new Set([
          ...audience.reminders,
          ...matchingUsers.map(({ id }) => id),
        ]),
      ].toSorted();
    }
    const { notificationBaseline, notificationTargets } =
      await plannedMeetingNotificationTargets({
        requestKey,
        facts,
        audience,
        now,
      });
    const common = {
      meetingId: meeting.id,
      personId: quickPersonId,
      personActivityId: derivedUuid(requestKey, "person-activity"),
      attendanceId: derivedUuid(requestKey, "attendance"),
      firstName: values.firstName,
      lastName: values.lastName,
      email: values.email,
      phone: values.phone,
      expectedMeetingUpdatedAt,
      expectedPersonAbsent: true,
      expectedAttendanceAbsent: true,
      notificationBaseline,
      notificationTargets,
      expectedChurchMaterialEventAt:
        (
          await db
            .select({ value: churches.lastMaterialEventAt })
            .from(churches)
            .where(eq(churches.id, actor.plantId))
            .limit(1)
        )[0]?.value?.toISOString() ?? null,
    };
    return parseResolved(exportName, {
      ...common,
      ...(exportName === "quickAddPersonToGuestListAction"
        ? {}
        : { attendanceType: "first_time" }),
      ...(exportName === "quickAddAttendeeAction" ? { invitedById: null } : {}),
    });
  }
  if (
    !personId &&
    exportName !== "recordAttendanceBatchAction" &&
    exportName !== "finalizeAttendanceAction"
  )
    return null;

  if (exportName === "recordAttendanceBatchAction") {
    const selected = Array.isArray(values.records) ? values.records : [];
    const ids = selected.flatMap((record) =>
      typeof record === "object" &&
      record &&
      "personId" in record &&
      typeof record.personId === "string"
        ? [record.personId]
        : []
    );
    if (ids.length !== selected.length || new Set(ids).size !== ids.length)
      return null;
    const [personRows, attendanceRows] = await Promise.all([
      db
        .select()
        .from(persons)
        .where(
          and(
            eq(persons.churchId, actor.plantId),
            inArray(persons.id, ids),
            isNull(persons.deletedAt)
          )
        ),
      db
        .select()
        .from(meetingAttendance)
        .where(
          and(
            eq(meetingAttendance.churchId, actor.plantId),
            eq(meetingAttendance.meetingId, meeting.id),
            inArray(meetingAttendance.personId, ids)
          )
        ),
    ]);
    if (personRows.length !== ids.length) return null;
    const personById = new Map(personRows.map((row) => [row.id, row]));
    const attendanceByPerson = new Map(
      attendanceRows.map((row) => [row.personId, row])
    );
    const records = await Promise.all(
      selected.map(async (record, index) => {
        const selectedRecord = record as {
          personId: string;
          status: "attended" | "absent" | "excused";
        };
        const before = attendanceByPerson.get(selectedRecord.personId) ?? null;
        const person = personById.get(selectedRecord.personId);
        if (!person) return null;
        const derivation =
          selectedRecord.status === "attended"
            ? await attendanceDerivationBaseline({
                plantId: actor.plantId,
                meeting,
                person,
              })
            : null;
        if (selectedRecord.status === "attended" && !derivation) return null;
        return {
          attendanceId:
            before?.id ??
            derivedUuid(
              requestKey,
              `attendance:${index}:${selectedRecord.personId}`
            ),
          personId: selectedRecord.personId,
          before: attendanceBaseline(before),
          afterStatus: selectedRecord.status,
          afterAttendanceType:
            selectedRecord.status === "attended"
              ? derivation!.attendanceType
              : null,
          attendanceDerivation: derivation?.baseline ?? null,
        };
      })
    );
    if (records.some((record) => record === null)) return null;
    return parseResolved(exportName, {
      meetingId: meeting.id,
      expectedMeetingUpdatedAt,
      records,
    });
  }

  if (exportName === "finalizeAttendanceAction") {
    const [
      attended,
      prospectRows,
      ownerRows,
      churchRows,
      followUps,
      evaluationTasks,
    ] = await Promise.all([
      db
        .select()
        .from(meetingAttendance)
        .where(
          and(
            eq(meetingAttendance.churchId, actor.plantId),
            eq(meetingAttendance.meetingId, meeting.id),
            eq(meetingAttendance.status, "attended")
          )
        ),
      db
        .select()
        .from(persons)
        .where(
          and(
            eq(persons.churchId, actor.plantId),
            eq(persons.status, "prospect"),
            isNull(persons.deletedAt)
          )
        ),
      db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.churchId, actor.plantId), eq(users.seat, "owner")))
        .limit(1),
      db
        .select({
          leadershipStatus: churches.leadershipStatus,
          lastMaterialEventAt: churches.lastMaterialEventAt,
        })
        .from(churches)
        .where(eq(churches.id, actor.plantId))
        .limit(1),
      db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.churchId, actor.plantId),
            eq(tasks.category, "follow_up"),
            eq(tasks.relatedType, "person"),
            isNull(tasks.deletedAt)
          )
        ),
      db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.churchId, actor.plantId),
            eq(tasks.relatedType, "meeting"),
            eq(tasks.relatedId, meeting.id),
            eq(tasks.completionEvent, "meeting.evaluation.completed"),
            isNull(tasks.deletedAt)
          )
        )
        .limit(1),
    ]);
    const leadershipStatus = churchRows[0]?.leadershipStatus ?? null;
    const taskAssigneeId = meetingFinalizationTaskAssigneeId({
      meetingType: meeting.type,
      leadershipStatus,
      ownerId: ownerRows[0]?.id ?? null,
    });
    const personById = new Map(
      prospectRows.map((person) => [person.id, person])
    );
    const statusChanges =
      meeting.type === "vision_meeting"
        ? attended.flatMap((attendance, index) => {
            const person = personById.get(attendance.personId);
            return person
              ? [
                  {
                    personId: person.id,
                    beforeStatus: "prospect" as const,
                    afterStatus: "attendee" as const,
                    expectedUpdatedAt: iso(person.updatedAt),
                    activityId: derivedUuid(
                      requestKey,
                      `status-activity:${index}:${person.id}`
                    ),
                    performedById: person.createdBy,
                  },
                ]
              : [];
          })
        : [];
    const firstTimers =
      taskAssigneeId !== null
        ? attended.filter(
            ({ attendanceType }) => attendanceType === "first_time"
          )
        : [];
    const dueDate = addCalendarDays(meeting.datetime, 2);
    const unresolvedFollowUpTaskTargets = await Promise.all(
      firstTimers.map(async (attendance, index) => {
        if (!taskAssigneeId) return null;
        const existing = followUps.find(
          (task) =>
            task.relatedId === attendance.personId && task.dueDate === dueDate
        );
        const person = await loadPerson(actor.plantId, attendance.personId);
        if (!person) return null;
        const taskId =
          existing?.id ??
          derivedUuid(requestKey, `follow-up:${index}:${attendance.personId}`);
        const title =
          existing?.title ??
          `Follow up with ${person.firstName} ${person.lastName}`;
        return {
          taskId,
          personId: attendance.personId,
          title,
          dueDate,
          assignedToId: existing ? existing.assignedToId : taskAssigneeId,
          priority: existing?.priority ?? ("high" as const),
          expectedTaskAbsent: !existing,
          beforeStatus: existing?.status ?? null,
          expectedUpdatedAt: existing ? iso(existing.updatedAt) : null,
          notificationBaseline: existing
            ? await pendingTaskNotificationBaseline(actor.plantId, taskId)
            : [],
          notificationTargets: existing
            ? []
            : await plannedTaskTargets({
                requestKey,
                taskId,
                title,
                dueDate,
                assignedToId: taskAssigneeId,
                plantId: actor.plantId,
                now,
              }),
        };
      })
    );
    if (unresolvedFollowUpTaskTargets.some((target) => target === null)) {
      return null;
    }
    const followUpTaskTargets = unresolvedFollowUpTaskTargets.filter(
      (target): target is NonNullable<typeof target> => target !== null
    );
    const existingEvaluation = taskAssigneeId ? evaluationTasks[0] : undefined;
    const evaluationTaskId =
      existingEvaluation?.id ?? derivedUuid(requestKey, "evaluation-task");
    const evaluationTitle =
      existingEvaluation?.title ??
      `Complete evaluation for ${meeting.title ?? "Vision Meeting"}`;
    const evaluationDueDate =
      existingEvaluation?.dueDate ?? addCalendarDays(now, 1);
    const evaluationTaskTarget =
      taskAssigneeId !== null
        ? {
            taskId: evaluationTaskId,
            title: evaluationTitle,
            dueDate: evaluationDueDate,
            assignedToId: existingEvaluation
              ? existingEvaluation.assignedToId
              : taskAssigneeId,
            priority: existingEvaluation?.priority ?? ("high" as const),
            expectedTaskAbsent: !existingEvaluation,
            beforeStatus: existingEvaluation?.status ?? null,
            expectedUpdatedAt: existingEvaluation
              ? iso(existingEvaluation.updatedAt)
              : null,
            notificationBaseline: existingEvaluation
              ? await pendingTaskNotificationBaseline(
                  actor.plantId,
                  evaluationTaskId
                )
              : [],
            notificationTargets: existingEvaluation
              ? []
              : await plannedTaskTargets({
                  requestKey,
                  taskId: evaluationTaskId,
                  title: evaluationTitle,
                  dueDate: evaluationDueDate,
                  assignedToId: taskAssigneeId,
                  plantId: actor.plantId,
                  now,
                }),
          }
        : null;
    return parseResolved(exportName, {
      meetingId: meeting.id,
      meetingType: meeting.type,
      meetingTitle: meeting.title,
      meetingDatetime: iso(meeting.datetime),
      timezone: "UTC",
      expectedMeetingUpdatedAt,
      expectedActualAttendance: meeting.actualAttendance,
      attendees: attended.map((attendance) => ({
        attendanceId: attendance.id,
        personId: attendance.personId,
        attendanceType: attendance.attendanceType,
        expectedUpdatedAt: iso(attendance.updatedAt),
      })),
      personStatusChanges: statusChanges,
      followUpTaskTargets,
      evaluationTaskTarget,
      expectedTaskAssigneeId: taskAssigneeId,
      expectedLeadershipStatus: leadershipStatus,
      expectedChurchMaterialEventAt:
        churchRows[0]?.lastMaterialEventAt?.toISOString() ?? null,
    });
  }

  const person = personId ? await loadPerson(actor.plantId, personId) : null;
  if (!person) return null;
  const attendance = await loadAttendance(actor.plantId, meeting.id, person.id);
  const response = await loadResponse(actor.plantId, meeting.id, person.id);

  if (
    exportName === "addAttendeeAction" ||
    exportName === "addToGuestListAction" ||
    exportName === "addWalkInAttendeeAction"
  ) {
    if (attendance) return null;
    const audience = await meetingAudience(facts, person.id);
    const { notificationBaseline, notificationTargets } =
      await plannedMeetingNotificationTargets({
        requestKey,
        facts,
        audience,
        now,
      });
    const common = {
      meetingId: meeting.id,
      attendanceId: derivedUuid(requestKey, `attendance:${person.id}`),
      personId: person.id,
      expectedMeetingUpdatedAt,
      expectedPersonUpdatedAt: iso(person.updatedAt),
      expectedAttendanceAbsent: true,
      notificationBaseline,
      notificationTargets,
    };
    if (exportName === "addAttendeeAction") {
      const derivation = await attendanceDerivationBaseline({
        plantId: actor.plantId,
        meeting,
        person,
      });
      if (!derivation) return null;
      return parseResolved(exportName, {
        ...common,
        attendanceType: derivation.attendanceType,
        attendanceDerivation: derivation.baseline,
        status: "attended",
        invitedById: null,
        responseStatus: null,
        notes: null,
      });
    }
    if (exportName === "addWalkInAttendeeAction") {
      const derivation = await attendanceDerivationBaseline({
        plantId: actor.plantId,
        meeting,
        person,
      });
      if (!derivation) return null;
      return parseResolved(exportName, {
        ...common,
        attendanceType: derivation.attendanceType,
        attendanceDerivation: derivation.baseline,
      });
    }
    return parseResolved(exportName, common);
  }
  if (!attendance) return null;

  if (
    exportName === "removeAttendeeAction" ||
    exportName === "removeFromGuestListAction"
  ) {
    const pending = await pendingMeetingNotifications(
      actor.plantId,
      meeting.id
    );
    const audience = await meetingAudience(facts, undefined, person.id);
    const { notificationBaseline, notificationTargets } =
      await plannedMeetingNotificationTargets({
        requestKey,
        facts,
        audience,
        now,
        cancelling: pending,
      });
    const common = {
      meetingId: meeting.id,
      personId: person.id,
      beforeAttendance: attendanceBaseline(attendance),
      expectedAttendanceUpdatedAt: iso(attendance.updatedAt),
      pendingNotifications: pending,
      notificationBaseline,
      notificationTargets,
    };
    return exportName === "removeAttendeeAction"
      ? parseResolved(exportName, {
          ...common,
          beforeResponse: response ? responseBaseline(response) : null,
          expectedResponseUpdatedAt: response ? iso(response.updatedAt) : null,
        })
      : parseResolved(exportName, common);
  }
  if (exportName === "updateRsvpStatusAction")
    return parseResolved(exportName, {
      meetingId: meeting.id,
      personId: person.id,
      beforeStatus: attendance.responseStatus,
      afterStatus: values.status,
      expectedAttendanceUpdatedAt: iso(attendance.updatedAt),
    });
  if (exportName === "toggleAttendanceStatusAction") {
    const derivation =
      values.status === "attended"
        ? await attendanceDerivationBaseline({
            plantId: actor.plantId,
            meeting,
            person,
          })
        : null;
    if (values.status === "attended" && !derivation) return null;
    return parseResolved(exportName, {
      meetingId: meeting.id,
      personId: person.id,
      beforeStatus: attendance.status,
      afterStatus: values.status,
      afterAttendanceType:
        values.status === "attended" ? derivation!.attendanceType : null,
      attendanceDerivation: derivation?.baseline ?? null,
      expectedAttendanceUpdatedAt: iso(attendance.updatedAt),
    });
  }
  if (exportName === "addAttendeeNoteAction")
    return parseResolved(exportName, {
      meetingId: meeting.id,
      personId: person.id,
      meetingType: meeting.type,
      note: values.note,
      activityId: derivedUuid(requestKey, `attendee-note:${person.id}`),
      expectedMeetingUpdatedAt,
      expectedPersonUpdatedAt: iso(person.updatedAt),
    });
  if (exportName === "recordResponseCardAction")
    return parseResolved(exportName, {
      meetingId: meeting.id,
      personId: person.id,
      responseType: values.responseType,
      notes: values.notes,
      responseId:
        response?.id ?? derivedUuid(requestKey, `response:${person.id}`),
      expectedAttendanceUpdatedAt: iso(attendance.updatedAt),
      beforeResponse: response ? responseBaseline(response) : null,
    });
  if (exportName === "clearResponseCardAction" && response)
    return parseResolved(exportName, {
      meetingId: meeting.id,
      personId: person.id,
      responseId: response.id,
      beforeResponse: responseBaseline(response),
      expectedAttendanceUpdatedAt: iso(attendance.updatedAt),
    });

  return null;
}
