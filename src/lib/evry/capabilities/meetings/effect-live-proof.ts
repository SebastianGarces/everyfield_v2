import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mock } from "node:test";

import { and, asc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churchMeetings,
  churches,
  evryActionPlans,
  evryActionPlanStates,
  evryExecutionAttempts,
  evryExecutionOutcomes,
  evryPlanConfirmations,
  evryProductAuditEvents,
  locations,
  meetingAttendance,
  meetingChecklistItems,
  meetingConfirmationTokens,
  meetingEvaluations,
  meetingResponses,
  ministryTeams,
  notifications,
  personActivities,
  persons,
  sessions,
  tasks,
  users,
} from "@/db/schema";
import { UnauthorizedError } from "@/lib/auth/unauthorized";
import type { EvryEffectInput } from "@/lib/evry/executor";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryActionPlanDocument } from "@/lib/evry/plans";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import { deriveAttendanceType } from "@/lib/meetings/attendance-type";
import { buildMeetingMergeData } from "@/lib/communication/merge";

import type { MeetingsActionExport } from "./catalog";
import { MEETINGS_ACTION_CONTRACTS } from "./catalog";
import { meetingsEffectDisclosure } from "./effect-disclosure";
import { MEETINGS_REVIEW_REGISTRY } from "./review";
import type { ResolvedMeetingsEffect } from "./resolver";
import type { MeetingsEvryEffectSelection } from "./selection";

const FIXTURE_SESSION_ID = "9".repeat(64);
const SCRATCH = "__evry meetings atomic proof__";
const NOW = new Date("2026-08-29T12:00:00.000Z");
const MEETING_AT = new Date("2026-09-29T18:00:00.000Z");

type SessionUser = Readonly<{
  id: string;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  seat: "owner" | "admin" | "member" | null;
}>;

let sessionUser: SessionUser | null = null;

mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => {
      if (!sessionUser) throw new UnauthorizedError();
      return { user: sessionUser };
    },
    verifyFreshSession: async () => {
      if (!sessionUser) throw new UnauthorizedError();
      const [fresh] = await db
        .select({
          session: sessions,
          user: {
            id: users.id,
            churchId: users.churchId,
            sendingChurchId: users.sendingChurchId,
            sendingNetworkId: users.sendingNetworkId,
            seat: users.seat,
          },
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.id, FIXTURE_SESSION_ID))
        .limit(1);
      if (!fresh || fresh.session.expiresAt <= new Date()) {
        throw new UnauthorizedError();
      }
      return fresh;
    },
  },
});

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function seedActor(): Promise<
  Readonly<{ userId: string; plantId: string }>
> {
  const [plant] = await db
    .insert(churches)
    .values({ name: SCRATCH })
    .returning({ id: churches.id });
  const [actor] = await db
    .insert(users)
    .values({
      email: `${randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: SCRATCH,
      seat: "owner",
      churchId: plant.id,
    })
    .returning({ id: users.id });
  await db.insert(sessions).values({
    id: FIXTURE_SESSION_ID,
    userId: actor.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
  });
  sessionUser = {
    id: actor.id,
    churchId: plant.id,
    sendingChurchId: null,
    sendingNetworkId: null,
    seat: "owner",
  };
  return Object.freeze({ userId: actor.id, plantId: plant.id });
}

async function seedForeignFixtures() {
  const [plant] = await db
    .insert(churches)
    .values({ name: `${SCRATCH} foreign` })
    .returning({ id: churches.id });
  const [user] = await db
    .insert(users)
    .values({
      email: `${randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: `${SCRATCH} foreign`,
      seat: "owner",
      churchId: plant.id,
    })
    .returning({ id: users.id });
  const [meeting] = await db
    .insert(churchMeetings)
    .values({
      churchId: plant.id,
      type: "orientation",
      title: `${SCRATCH} foreign`,
      datetime: MEETING_AT,
      status: "planning",
      agenda: [],
      createdBy: user.id,
    })
    .returning({ id: churchMeetings.id, title: churchMeetings.title });
  const [location] = await db
    .insert(locations)
    .values({
      churchId: plant.id,
      name: `${SCRATCH} foreign`,
      address: "2 Foreign Way",
    })
    .returning({ id: locations.id });
  const [team] = await db
    .insert(ministryTeams)
    .values({
      churchId: plant.id,
      name: `${SCRATCH} foreign`,
      type: "custom",
      createdBy: user.id,
    })
    .returning({ id: ministryTeams.id });
  return { meeting, location, team };
}

async function seedMeeting(actor: EvryPlantActor, vision = false) {
  const meetingNumber = vision
    ? Number.parseInt(randomUUID().slice(0, 4), 16)
    : null;
  const [meeting] = await db
    .insert(churchMeetings)
    .values({
      churchId: actor.plantId,
      type: vision ? "vision_meeting" : "orientation",
      title:
        vision && meetingNumber
          ? `Vision Meeting #${meetingNumber}`
          : `${SCRATCH} ${randomUUID()}`,
      datetime: MEETING_AT,
      status: "planning",
      meetingNumber,
      agenda: [],
      createdBy: actor.userId,
    })
    .returning();
  return meeting;
}

async function seedPerson(actor: EvryPlantActor, createdBy = actor.userId) {
  const [person] = await db
    .insert(persons)
    .values({
      churchId: actor.plantId,
      firstName: "Alex",
      lastName: randomUUID(),
      status: "prospect",
      createdBy,
    })
    .returning();
  return person;
}

async function seedAttendance(input: {
  actor: EvryPlantActor;
  meetingId: string;
  personId: string;
  status?: "attended" | "absent" | "excused";
  attendanceType?: "first_time" | "returning" | "core_group" | null;
}) {
  const [attendance] = await db
    .insert(meetingAttendance)
    .values({
      churchId: input.actor.plantId,
      meetingId: input.meetingId,
      personId: input.personId,
      status: input.status ?? "absent",
      attendanceType: input.attendanceType ?? null,
      createdBy: input.actor.userId,
    })
    .returning();
  return attendance;
}

async function setLeadershipStatus(
  actor: EvryPlantActor,
  leadershipStatus: "no_planter" | "planter_confirmed"
): Promise<void> {
  await db.execute(sql`
    update churches
    set leadership_status = ${leadershipStatus}
    where id = ${actor.plantId}::uuid
  `);
}

async function fixtureSelection(input: {
  actor: EvryPlantActor;
  exportName: MeetingsActionExport;
}): Promise<{
  selection: MeetingsEvryEffectSelection;
  pageContext: Readonly<{
    kind: "meeting";
    recordId: string;
    label: string;
  }> | null;
}> {
  const { actor, exportName } = input;
  if (exportName === "createLocationAction") {
    return {
      selection: {
        kind: "effect",
        exportName,
        values: {
          name: SCRATCH,
          address: "1 Atomic Way",
          contactName: "Alex Rivera",
          contactPhone: "555-0100",
          contactEmail: "alex@example.com",
          cost: "$250",
          capacity: 120,
          notes: "Use the west entrance.",
        },
      },
      pageContext: null,
    };
  }
  if (exportName === "updateLocationAction") {
    const [location] = await db
      .insert(locations)
      .values({
        churchId: actor.plantId,
        name: SCRATCH,
        address: "Before",
        contactName: "Before contact",
        contactPhone: "555-0100",
        contactEmail: "before@example.com",
        cost: "$100",
        capacity: 80,
        notes: "Before notes",
      })
      .returning();
    return {
      selection: {
        kind: "effect",
        exportName,
        values: {
          locationId: location.id,
          name: SCRATCH,
          address: "After",
          contactName: null,
          contactPhone: "555-0101",
          contactEmail: "after@example.com",
          cost: null,
          capacity: 160,
          notes: "After notes",
        },
      },
      pageContext: null,
    };
  }
  if (exportName === "createMeetingAction") {
    return {
      selection: {
        kind: "effect",
        exportName,
        values: {
          type: "vision_meeting",
          title: null,
          datetime: MEETING_AT.toISOString(),
          timezone: "America/New_York",
          locationId: null,
          locationName: `${SCRATCH} hall`,
          locationAddress: "3 Complete Plan Way",
          teamId: null,
          meetingSubtype: null,
          estimatedAttendance: 50,
          durationMinutes: 90,
          notes: "Every create field is disclosed.",
        },
      },
      pageContext: null,
    };
  }

  const meeting = await seedMeeting(
    actor,
    exportName === "finalizeAttendanceAction"
  );
  const pageContext = {
    kind: "meeting" as const,
    recordId: meeting.id,
    label: meeting.title ?? "Meeting",
  };
  if (
    exportName === "deleteMeetingAction" ||
    exportName === "finalizeAttendanceAction" ||
    exportName === "saveAgendaAction" ||
    exportName === "updateMeetingAction" ||
    exportName === "updateMeetingStatusAction" ||
    exportName === "createEvaluationAction"
  ) {
    if (exportName === "deleteMeetingAction") {
      const people = Array.from({ length: 101 }, (_, index) => ({
        id: randomUUID(),
        churchId: actor.plantId,
        firstName: "Delete",
        lastName: `Dependent ${index + 1}`,
        status: "prospect" as const,
        createdBy: actor.userId,
      }));
      await db.insert(persons).values(people);
      await db.insert(meetingAttendance).values(
        people.map((person) => ({
          id: randomUUID(),
          churchId: actor.plantId,
          meetingId: meeting.id,
          personId: person.id,
          status: "absent" as const,
          createdBy: actor.userId,
        }))
      );
      await db.insert(meetingConfirmationTokens).values({
        token: `evry-delete-${randomUUID()}`,
        churchId: actor.plantId,
        meetingId: meeting.id,
        personId: people[0]!.id,
        expiresAt: new Date(MEETING_AT.getTime() + 24 * 60 * 60 * 1_000),
      });
    }
    if (exportName === "updateMeetingAction") {
      const [pending] = await db
        .insert(notifications)
        .values({
          churchId: actor.plantId,
          recipientUserId: actor.userId,
          category: "meetings",
          type: "meeting.reminder.1d",
          title: "Existing reminder",
          body: "This exact pending row must be cancelled by the plan.",
          entityType: "meeting",
          entityId: meeting.id,
          dedupeKey: `meeting.reminder.1d:${meeting.id}:existing`,
          scheduledFor: new Date(MEETING_AT.getTime() - 24 * 60 * 60 * 1_000),
        })
        .returning({ id: notifications.id });
      assert.ok(pending);
      await db.execute(sql`update notifications
        set updated_at = date_trunc('milliseconds', updated_at)
          + interval '0.000123 seconds'
        where id = ${pending.id}::uuid`);
    }
    if (exportName === "finalizeAttendanceAction") {
      const [creator] = await db
        .insert(users)
        .values({
          email: `${randomUUID()}@scratch.invalid`,
          passwordHash: "scratch",
          name: `${SCRATCH} creator`,
          seat: "member",
          churchId: actor.plantId,
        })
        .returning({ id: users.id });
      const person = await seedPerson(actor, creator.id);
      await seedAttendance({
        actor,
        meetingId: meeting.id,
        personId: person.id,
        status: "attended",
        attendanceType: "first_time",
      });
    }
    const values =
      exportName === "saveAgendaAction"
        ? { sections: [{ id: "welcome", title: "Welcome", minutes: 10 }] }
        : exportName === "updateMeetingAction"
          ? {
              title: `${SCRATCH} updated`,
              datetime: new Date(
                MEETING_AT.getTime() + 60 * 60 * 1_000
              ).toISOString(),
              timezone: "America/New_York",
              locationId: null,
              locationName: `${SCRATCH} new hall`,
              locationAddress: "7 Updated Way",
              meetingSubtype: "training",
              estimatedAttendance: 75,
              durationMinutes: 120,
              notes: "Every editable meeting field is covered.",
            }
          : exportName === "updateMeetingStatusAction"
            ? { status: "ready" }
            : exportName === "createEvaluationAction"
              ? { scores: [4, 4, 4, 4, 4, 4, 4, 4], notes: "Good" }
              : {};
    return {
      selection: { kind: "effect", exportName, values },
      pageContext,
    };
  }
  if (
    exportName === "quickAddAttendeeAction" ||
    exportName === "quickAddPersonToGuestListAction" ||
    exportName === "quickAddWalkInAction"
  ) {
    return {
      selection: {
        kind: "effect",
        exportName,
        values: {
          firstName: "Quick",
          lastName: randomUUID(),
          email: null,
          phone: null,
        },
      },
      pageContext,
    };
  }
  if (
    exportName === "toggleChecklistItemAction" ||
    exportName === "updateChecklistItemAction"
  ) {
    const assignedPerson =
      exportName === "updateChecklistItemAction"
        ? await seedPerson(actor)
        : null;
    const [item] = await db
      .insert(meetingChecklistItems)
      .values({
        churchId: actor.plantId,
        meetingId: meeting.id,
        itemName: "Projector",
        category: "av",
        assignedTo: null,
      })
      .returning();
    return {
      selection: {
        kind: "effect",
        exportName,
        values:
          exportName === "toggleChecklistItemAction"
            ? { itemId: item.id, checked: true }
            : {
                itemId: item.id,
                notes: "Bring cable",
                assignedTo: assignedPerson?.id,
              },
      },
      pageContext,
    };
  }

  const person = await seedPerson(actor);
  const needsAbsentAttendance =
    exportName === "addAttendeeAction" ||
    exportName === "addToGuestListAction" ||
    exportName === "addWalkInAttendeeAction" ||
    exportName === "recordAttendanceBatchAction";
  const attendance = needsAbsentAttendance
    ? null
    : await seedAttendance({
        actor,
        meetingId: meeting.id,
        personId: person.id,
      });
  if (
    exportName === "clearResponseCardAction" ||
    exportName === "removeAttendeeAction"
  ) {
    await db.insert(meetingResponses).values({
      churchId: actor.plantId,
      meetingId: meeting.id,
      personId: person.id,
      responseType: "interested",
      recordedById: actor.userId,
    });
  }
  assert.ok(needsAbsentAttendance || attendance);
  const values: Readonly<Record<string, unknown>> =
    exportName === "addAttendeeAction"
      ? { personId: person.id }
      : exportName === "addToGuestListAction"
        ? { personId: person.id }
        : exportName === "addWalkInAttendeeAction"
          ? { personId: person.id }
          : exportName === "recordAttendanceBatchAction"
            ? { records: [{ personId: person.id, status: "attended" }] }
            : exportName === "addAttendeeNoteAction"
              ? { personId: person.id, note: "Call next week" }
              : exportName === "clearResponseCardAction"
                ? { personId: person.id }
                : exportName === "recordResponseCardAction"
                  ? {
                      personId: person.id,
                      responseType: "interested",
                      notes: "Call",
                    }
                  : exportName === "removeAttendeeAction"
                    ? { personId: person.id }
                    : exportName === "removeFromGuestListAction"
                      ? { personId: person.id }
                      : exportName === "toggleAttendanceStatusAction"
                        ? { personId: person.id, status: "attended" }
                        : exportName === "updateRsvpStatusAction"
                          ? { personId: person.id, status: "confirmed" }
                          : {};
  return {
    selection: { kind: "effect", exportName, values },
    pageContext,
  };
}

async function seedExecution(input: {
  actor: EvryPlantActor;
  resolved: ResolvedMeetingsEffect;
}) {
  const planId = randomUUID();
  const attemptId = randomUUID();
  const confirmationId = randomUUID();
  const proposalEventId = randomUUID();
  const correlationId = randomUUID();
  const requestKey = randomUUID();
  const fingerprint = hash(`plan:${planId}`);
  const capabilityIdentity =
    MEETINGS_ACTION_CONTRACTS[input.resolved.exportName].operationId;
  const stepId = capabilityIdentity;
  const createdAt = new Date();
  const document = {
    version: 1,
    steps: [
      {
        id: stepId,
        capabilityIdentity,
        arguments: input.resolved.arguments,
        dependsOn: [],
      },
    ],
  };
  await db.batch([
    db.insert(evryActionPlans).values({
      id: planId,
      churchId: input.actor.plantId,
      actorUserId: input.actor.userId,
      requestKey,
      intentFingerprint: hash(`intent:${planId}`),
      fingerprint,
      document,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 15 * 60 * 1_000),
    }),
    db.insert(evryActionPlanStates).values({
      planId,
      churchId: input.actor.plantId,
      status: "executing",
      changedAt: createdAt,
    }),
    db.insert(evryPlanConfirmations).values({
      id: confirmationId,
      planId,
      churchId: input.actor.plantId,
      actorUserId: input.actor.userId,
      planFingerprint: fingerprint,
      decidedAt: createdAt,
    }),
    db.insert(evryProductAuditEvents).values({
      id: proposalEventId,
      planId,
      churchId: input.actor.plantId,
      actorUserId: input.actor.userId,
      planFingerprint: fingerprint,
      correlationId,
      eventKey: hash(`proposal:${planId}`),
      eventType: "plan_proposed",
      occurredAt: createdAt,
    }),
    db.insert(evryExecutionAttempts).values({
      id: attemptId,
      planId,
      churchId: input.actor.plantId,
      actorUserId: input.actor.userId,
      planFingerprint: fingerprint,
      confirmationId,
      proposalEventId,
      correlationId,
      attemptKey: hash(`attempt:${planId}`),
      startedAt: createdAt,
    }),
  ]);
  return {
    attemptId,
    planId,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    fingerprint,
    correlationId,
    stepId,
    capabilityIdentity,
  };
}

type ExpectedNotification = Readonly<{
  notificationId: string;
  recipientUserId: string;
  category: "meetings" | "tasks";
  type: string;
  entityType: "meeting" | "task";
  entityId: string;
  dedupeKey: string;
}>;

async function assertExactNotifications(
  plantId: string,
  expected: readonly ExpectedNotification[]
): Promise<void> {
  if (expected.length === 0) return;
  const rows = await db
    .select({
      id: notifications.id,
      recipientUserId: notifications.recipientUserId,
      category: notifications.category,
      type: notifications.type,
      entityType: notifications.entityType,
      entityId: notifications.entityId,
      dedupeKey: notifications.dedupeKey,
      status: notifications.status,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.churchId, plantId),
        inArray(
          notifications.id,
          expected.map(({ notificationId }) => notificationId)
        )
      )
    );
  assert.equal(rows.length, expected.length, "notification cardinality");
  const rowById = new Map(rows.map((row) => [row.id, row]));
  for (const target of expected) {
    const row = rowById.get(target.notificationId);
    assert.deepEqual(
      row && {
        recipientUserId: row.recipientUserId,
        category: row.category,
        type: row.type,
        entityType: row.entityType,
        entityId: row.entityId,
        dedupeKey: row.dedupeKey,
        status: row.status,
      },
      {
        recipientUserId: target.recipientUserId,
        category: target.category,
        type: target.type,
        entityType: target.entityType,
        entityId: target.entityId,
        dedupeKey: target.dedupeKey,
        status: "pending",
      },
      target.notificationId
    );
  }
}

async function assertMutationCardinality(
  plantId: string,
  actorUserId: string,
  resolved: ResolvedMeetingsEffect
): Promise<void> {
  const topLevelNotifications =
    "notificationTargets" in resolved.arguments
      ? resolved.arguments.notificationTargets
      : [];
  await assertExactNotifications(plantId, topLevelNotifications);

  if (
    resolved.exportName === "createLocationAction" ||
    resolved.exportName === "updateLocationAction"
  ) {
    const args = resolved.arguments;
    const [row] = await db
      .select()
      .from(locations)
      .where(eq(locations.id, args.locationId));
    assert.ok(row);
    const expected =
      resolved.exportName === "createLocationAction"
        ? {
            name: resolved.arguments.name,
            address: resolved.arguments.address,
            contactName: resolved.arguments.contactName,
            contactPhone: resolved.arguments.contactPhone,
            contactEmail: resolved.arguments.contactEmail,
            cost: resolved.arguments.cost,
            capacity: resolved.arguments.capacity,
            notes: resolved.arguments.notes,
            isActive: true,
          }
        : resolved.arguments.after;
    assert.deepEqual(
      {
        name: row.name,
        address: row.address,
        contactName: row.contactName,
        contactPhone: row.contactPhone,
        contactEmail: row.contactEmail,
        cost: row.cost,
        capacity: row.capacity,
        notes: row.notes,
        isActive: row.isActive,
      },
      {
        name: expected.name,
        address: expected.address,
        contactName: expected.contactName,
        contactPhone: expected.contactPhone,
        contactEmail: expected.contactEmail,
        cost: expected.cost,
        capacity: expected.capacity,
        notes: expected.notes,
        isActive: expected.isActive,
      }
    );
  }

  if ("pendingNotifications" in resolved.arguments) {
    const pending = resolved.arguments.pendingNotifications;
    const cancelled =
      pending.length === 0
        ? []
        : await db
            .select({ id: notifications.id, status: notifications.status })
            .from(notifications)
            .where(
              inArray(
                notifications.id,
                pending.map(({ notificationId }) => notificationId)
              )
            );
    assert.equal(cancelled.length, pending.length, "cancelled cardinality");
    assert.ok(
      cancelled.every(({ status }) => status === "cancelled"),
      "every disclosed pending notification is cancelled"
    );
  }

  if (resolved.exportName === "createMeetingAction") {
    const args = resolved.arguments;
    assert.equal(args.title, `Vision Meeting #${args.meetingNumber}`);
    assert.equal(
      buildMeetingMergeData({
        title: args.title,
        type: args.type,
        datetime: new Date(args.datetime),
        locationName: args.locationName,
        locationAddress: args.locationAddress,
        agenda: args.agenda,
      }).meeting_title,
      args.title,
      "Communication changed the canonical vision meeting title"
    );
    const [meetingRows, checklistRows, attendanceRows, locationRows] =
      await Promise.all([
        db
          .select({
            id: churchMeetings.id,
            title: churchMeetings.title,
            meetingNumber: churchMeetings.meetingNumber,
          })
          .from(churchMeetings)
          .where(eq(churchMeetings.id, args.meetingId)),
        args.checklistItems.length === 0
          ? Promise.resolve([])
          : db
              .select({ id: meetingChecklistItems.id })
              .from(meetingChecklistItems)
              .where(
                inArray(
                  meetingChecklistItems.id,
                  args.checklistItems.map(({ itemId }) => itemId)
                )
              ),
        args.attendanceRows.length === 0
          ? Promise.resolve([])
          : db
              .select({ id: meetingAttendance.id })
              .from(meetingAttendance)
              .where(
                inArray(
                  meetingAttendance.id,
                  args.attendanceRows.map(({ attendanceId }) => attendanceId)
                )
              ),
        args.savedLocationId
          ? db
              .select({ id: locations.id })
              .from(locations)
              .where(eq(locations.id, args.savedLocationId))
          : Promise.resolve([]),
      ]);
    assert.equal(meetingRows.length, 1);
    assert.equal(
      meetingRows[0]?.title,
      `Vision Meeting #${meetingRows[0]?.meetingNumber}`,
      "untitled vision meeting did not store the canonical numbered title"
    );
    assert.equal(checklistRows.length, args.checklistItems.length);
    assert.equal(attendanceRows.length, args.attendanceRows.length);
    assert.equal(locationRows.length, args.savedLocationId ? 1 : 0);
  }

  if (resolved.exportName === "updateMeetingAction") {
    const args = resolved.arguments;
    const [row] = await db
      .select()
      .from(churchMeetings)
      .where(eq(churchMeetings.id, args.meetingId));
    assert.ok(row);
    assert.deepEqual(
      {
        title: row.title,
        datetime: row.datetime.toISOString(),
        locationId: row.locationId,
        locationName: row.locationName,
        locationAddress: row.locationAddress,
        meetingSubtype: row.meetingSubtype,
        estimatedAttendance: row.estimatedAttendance,
        durationMinutes: row.durationMinutes,
        notes: row.notes,
      },
      {
        title: args.after.title,
        datetime: args.after.datetime,
        locationId: args.after.locationId,
        locationName: args.after.locationName,
        locationAddress: args.after.locationAddress,
        meetingSubtype: args.after.meetingSubtype,
        estimatedAttendance: args.after.estimatedAttendance,
        durationMinutes: args.after.durationMinutes,
        notes: args.after.notes,
      }
    );
  }

  if (resolved.exportName === "updateChecklistItemAction") {
    const args = resolved.arguments;
    const [row] = await db
      .select({
        notes: meetingChecklistItems.notes,
        assignedTo: meetingChecklistItems.assignedTo,
      })
      .from(meetingChecklistItems)
      .where(eq(meetingChecklistItems.id, args.itemId));
    assert.deepEqual(row, {
      notes: args.afterNotes,
      assignedTo: args.afterAssignedTo,
    });
  }

  if (resolved.exportName === "deleteMeetingAction") {
    const args = resolved.arguments;
    const [meetingRows, attendanceRows] = await Promise.all([
      db
        .select({ id: churchMeetings.id })
        .from(churchMeetings)
        .where(eq(churchMeetings.id, args.meetingId)),
      db
        .select({ id: meetingAttendance.id })
        .from(meetingAttendance)
        .where(inArray(meetingAttendance.id, args.expectedAttendanceIds)),
    ]);
    assert.equal(meetingRows.length, 0, "deleted meeting remains");
    assert.equal(attendanceRows.length, 0, "dependent attendance remains");
    assert.equal(
      (
        await db
          .select({ id: meetingConfirmationTokens.id })
          .from(meetingConfirmationTokens)
          .where(
            inArray(
              meetingConfirmationTokens.id,
              args.expectedConfirmationTokenIds
            )
          )
      ).length,
      0,
      "dependent confirmation token remains"
    );
  }

  if (
    resolved.exportName === "quickAddAttendeeAction" ||
    resolved.exportName === "quickAddPersonToGuestListAction" ||
    resolved.exportName === "quickAddWalkInAction"
  ) {
    const args = resolved.arguments;
    const [personRows, attendanceRows, activityRows] = await Promise.all([
      db.select().from(persons).where(eq(persons.id, args.personId)),
      db
        .select()
        .from(meetingAttendance)
        .where(eq(meetingAttendance.id, args.attendanceId)),
      db
        .select()
        .from(personActivities)
        .where(eq(personActivities.id, args.personActivityId)),
    ]);
    assert.equal(personRows.length, 1);
    assert.equal(attendanceRows.length, 1);
    assert.equal(activityRows.length, 1);
    assert.deepEqual(activityRows[0]?.metadata, {
      source:
        resolved.exportName === "quickAddAttendeeAction"
          ? "meeting_attendance"
          : "meeting_guest_list",
    });
  }

  if (resolved.exportName === "addAttendeeNoteAction") {
    const rows = await db
      .select({ id: personActivities.id })
      .from(personActivities)
      .where(eq(personActivities.id, resolved.arguments.activityId));
    assert.equal(rows.length, 1);
  }

  if (resolved.exportName === "createEvaluationAction") {
    const rows = await db
      .select({ id: meetingEvaluations.id })
      .from(meetingEvaluations)
      .where(eq(meetingEvaluations.id, resolved.arguments.evaluationId));
    assert.equal(rows.length, 1);
  }

  if (resolved.exportName === "finalizeAttendanceAction") {
    const args = resolved.arguments;
    const taskTargets = [
      ...args.followUpTaskTargets,
      ...(args.evaluationTaskTarget ? [args.evaluationTaskTarget] : []),
    ];
    const taskRows =
      taskTargets.length === 0
        ? []
        : await db
            .select({
              id: tasks.id,
              assignedToId: tasks.assignedToId,
              relatedId: tasks.relatedId,
            })
            .from(tasks)
            .where(
              and(
                eq(tasks.churchId, plantId),
                inArray(
                  tasks.id,
                  taskTargets.map(({ taskId }) => taskId)
                )
              )
            );
    assert.equal(taskRows.length, taskTargets.length, "task cardinality");
    const taskById = new Map(taskRows.map((row) => [row.id, row]));
    for (const target of taskTargets) {
      const row = taskById.get(target.taskId);
      assert.equal(row?.assignedToId, target.assignedToId);
      if ("personId" in target) assert.equal(row?.relatedId, target.personId);
    }
    if (args.evaluationTaskTarget?.expectedTaskAbsent) {
      assert.equal(
        args.evaluationTaskTarget.title,
        `Complete evaluation for ${args.meetingTitle}`,
        "evaluation task changed the stored meeting title"
      );
    }
    const taskNotifications = taskTargets.flatMap(
      ({ notificationTargets }) => notificationTargets
    );
    await assertExactNotifications(plantId, taskNotifications);
    const activities =
      args.personStatusChanges.length === 0
        ? []
        : await db
            .select({
              id: personActivities.id,
              performedBy: personActivities.performedBy,
            })
            .from(personActivities)
            .where(
              inArray(
                personActivities.id,
                args.personStatusChanges.map(({ activityId }) => activityId)
              )
            );
    assert.equal(activities.length, args.personStatusChanges.length);
    const activityById = new Map(activities.map((row) => [row.id, row]));
    for (const change of args.personStatusChanges) {
      assert.equal(
        activityById.get(change.activityId)?.performedBy,
        change.performedById,
        "automatic status activity performer diverged from the person creator"
      );
      assert.notEqual(change.performedById, actorUserId);
    }
    const [meeting] = await db
      .select({ actualAttendance: churchMeetings.actualAttendance })
      .from(churchMeetings)
      .where(eq(churchMeetings.id, args.meetingId));
    assert.equal(meeting?.actualAttendance, args.attendees.length);
  }
}

async function runEffect(input: {
  actor: EvryPlantActor;
  exportName: MeetingsActionExport;
  resolveMeetingsEvryEffect: typeof import("./resolver").resolveMeetingsEvryEffect;
  mintEvryPlanRequestKey: typeof import("@/lib/evry/plans").mintEvryPlanRequestKey;
  authorizeEvryEffectCapability: typeof import("@/lib/evry/eligibility/capabilities").authorizeEvryEffectCapability;
  executionEffectKey: typeof import("@/lib/evry/audit/identity").executionEffectKey;
  executeMeetingsEffect: typeof import("./atomic-effect").executeMeetingsEffect;
}) {
  const fixture = await fixtureSelection(input);
  const resolved = await input.resolveMeetingsEvryEffect({
    actor: input.actor,
    selection: fixture.selection,
    pageContext: fixture.pageContext,
    requestKey: input.mintEvryPlanRequestKey(),
    now: NOW,
  });
  assert.ok(resolved, `${input.exportName} did not resolve`);
  if (resolved.exportName === "addAttendeeAction") {
    const [meeting] = await db
      .select({ datetime: churchMeetings.datetime })
      .from(churchMeetings)
      .where(eq(churchMeetings.id, resolved.arguments.meetingId));
    assert.ok(meeting);
    assert.equal(
      resolved.arguments.attendanceType,
      await deriveAttendanceType(
        resolved.arguments.personId,
        resolved.arguments.meetingId,
        meeting.datetime,
        db
      ),
      "omitted attendance type diverged from the UI derivation"
    );
  }
  const execution = await seedExecution({ actor: input.actor, resolved });
  if (resolved.exportName === "deleteMeetingAction") {
    assert.equal(
      resolved.arguments.expectedAttendanceIds.length,
      101,
      "resolver truncated source-owned attendance dependents"
    );
    assert.equal(
      resolved.arguments.expectedConfirmationTokenIds.length,
      1,
      "resolver omitted a source-owned confirmation-token cascade"
    );
    const document: EvryActionPlanDocument = {
      version: 1,
      steps: [
        {
          id: execution.stepId,
          capabilityIdentity: execution.capabilityIdentity,
          effectClass: "database_write",
          arguments: resolved.arguments,
          dependsOn: [],
        },
      ],
    };
    const reviewRegistration =
      MEETINGS_REVIEW_REGISTRY.registrationFor(document);
    assert.ok(reviewRegistration);
    const confirmation = reviewRegistration.build({
      plan: evryConversationPlanIdentitySchema.parse({
        planId: execution.planId,
        fingerprint: execution.fingerprint,
      }),
      document,
    });
    assert.deepEqual(
      confirmation.steps[0]?.resolvedTargets
        .filter(({ label }) => label === "Attendance record")
        .map(({ value }) => value),
      resolved.arguments.expectedAttendanceIds,
      "trusted confirmation omitted a source-owned dependent"
    );
    assert.deepEqual(
      confirmation.steps[0]?.resolvedTargets
        .filter(({ label }) => label === "Confirmation token")
        .map(({ value }) => value),
      resolved.arguments.expectedConfirmationTokenIds,
      "trusted confirmation omitted a confirmation-token cascade"
    );
    assert.equal(
      (
        await db
          .select({ id: evryPlanConfirmations.id })
          .from(evryPlanConfirmations)
          .where(eq(evryPlanConfirmations.planId, execution.planId))
      ).length,
      1,
      "large delete plan was not durably confirmed"
    );
  }
  const authorization = await input.authorizeEvryEffectCapability(
    execution.capabilityIdentity
  );
  assert.ok(authorization);
  const effectKey = input.executionEffectKey(
    execution.planId,
    execution.fingerprint,
    execution.stepId
  );
  const effectInput = {
    authorization,
    execution,
    effectKey,
    arguments: resolved.arguments,
  };
  let staleArguments: EvryEffectInput["arguments"];
  if (input.exportName === "createLocationAction") {
    const args = resolved.arguments as Readonly<{ locationId: string }>;
    await db.insert(locations).values({
      id: args.locationId,
      churchId: input.actor.plantId,
      name: `${SCRATCH} stale collision`,
      address: "9 Stale Way",
    });
    staleArguments = resolved.arguments;
  } else if (input.exportName === "createMeetingAction") {
    staleArguments = { ...resolved.arguments, createdById: randomUUID() };
  } else {
    const staleTimestamp = Object.keys(resolved.arguments).find((key) =>
      /^expected.*UpdatedAt$/.test(key)
    );
    assert.ok(staleTimestamp, `${input.exportName} has no stale baseline`);
    staleArguments = {
      ...resolved.arguments,
      [staleTimestamp]: "2000-01-01T00:00:00.000Z",
    };
  }
  const stale = await input.executeMeetingsEffect({
    ...effectInput,
    arguments: staleArguments,
  });
  assert.equal(
    stale.status,
    "refused",
    `${input.exportName} accepted stale state`
  );
  assert.equal(
    (
      await db
        .select({ id: evryExecutionOutcomes.id })
        .from(evryExecutionOutcomes)
        .where(eq(evryExecutionOutcomes.effectKey, effectKey))
    ).length,
    0,
    `${input.exportName} claimed a stale effect`
  );
  if (input.exportName === "createLocationAction") {
    const args = resolved.arguments as Readonly<{ locationId: string }>;
    await db.delete(locations).where(eq(locations.id, args.locationId));
  }
  if (resolved.exportName === "deleteMeetingAction") {
    const [attendance] = await db
      .select({ personId: meetingAttendance.personId })
      .from(meetingAttendance)
      .where(
        and(
          eq(meetingAttendance.meetingId, resolved.arguments.meetingId),
          sql`${meetingAttendance.id} <> ${resolved.arguments.expectedAttendanceIds[0]}::uuid`
        )
      )
      .limit(1);
    assert.ok(attendance);
    const [lateToken] = await db
      .insert(meetingConfirmationTokens)
      .values({
        token: `evry-late-delete-${randomUUID()}`,
        churchId: input.actor.plantId,
        meetingId: resolved.arguments.meetingId,
        personId: attendance.personId,
        expiresAt: new Date(MEETING_AT.getTime() + 24 * 60 * 60 * 1_000),
      })
      .returning({ id: meetingConfirmationTokens.id });
    assert.ok(lateToken);
    assert.equal(
      (await input.executeMeetingsEffect(effectInput)).status,
      "refused",
      "delete accepted a confirmation token added after review"
    );
    assert.equal(
      (
        await db
          .select({ id: churchMeetings.id })
          .from(churchMeetings)
          .where(eq(churchMeetings.id, resolved.arguments.meetingId))
      ).length,
      1,
      "stale cascade validation partially deleted the meeting"
    );
    assert.equal(
      (
        await db
          .select({ id: evryExecutionOutcomes.id })
          .from(evryExecutionOutcomes)
          .where(eq(evryExecutionOutcomes.effectKey, effectKey))
      ).length,
      0,
      "stale confirmation-token cascade claimed an execution outcome"
    );
    await db
      .delete(meetingConfirmationTokens)
      .where(eq(meetingConfirmationTokens.id, lateToken.id));
  }
  console.log(`PASS ${execution.capabilityIdentity}:errors`);

  const concurrent = await Promise.all([
    input.executeMeetingsEffect(effectInput),
    input.executeMeetingsEffect(effectInput),
  ]);
  assert.deepEqual(
    concurrent.map(({ status }) => status),
    ["completed", "completed"],
    input.exportName
  );
  const expectedDisclosure = meetingsEffectDisclosure(
    input.exportName,
    resolved.arguments
  );
  for (const result of concurrent) {
    assert.equal(result.status, "completed", input.exportName);
    if (result.status === "completed") {
      assert.equal(
        result.affectedCount,
        expectedDisclosure.affectedCount,
        `${input.exportName} receipt count diverged from confirmation`
      );
    }
  }
  const outcomes = await db
    .select({ id: evryExecutionOutcomes.id })
    .from(evryExecutionOutcomes)
    .where(
      and(
        eq(evryExecutionOutcomes.planId, execution.planId),
        eq(evryExecutionOutcomes.effectKey, effectKey)
      )
    );
  assert.equal(outcomes.length, 1, input.exportName);
  await assertMutationCardinality(
    input.actor.plantId,
    input.actor.userId,
    resolved
  );
  console.log(`PASS ${execution.capabilityIdentity}:execution`);

  // Simulate a response lost after commit: source rows are now in their
  // post-mutation state, but the same immutable attempt must recover exactly.
  const replay = await input.executeMeetingsEffect(effectInput);
  assert.deepEqual(replay, concurrent[0], input.exportName);
  assert.equal(
    (
      await db
        .select({ id: evryExecutionOutcomes.id })
        .from(evryExecutionOutcomes)
        .where(eq(evryExecutionOutcomes.effectKey, effectKey))
    ).length,
    1,
    input.exportName
  );
  console.log(`PASS ${execution.capabilityIdentity}:idempotency`);

  const refusedArguments = await input.executeMeetingsEffect({
    ...effectInput,
    arguments: { ...resolved.arguments, genericUrl: "https://invalid.test" },
  });
  assert.equal(refusedArguments.status, "refused", input.exportName);
}

async function assertAttendanceDerivationDriftRefuses(input: {
  actor: EvryPlantActor;
  resolveMeetingsEvryEffect: typeof import("./resolver").resolveMeetingsEvryEffect;
  mintEvryPlanRequestKey: typeof import("@/lib/evry/plans").mintEvryPlanRequestKey;
  authorizeEvryEffectCapability: typeof import("@/lib/evry/eligibility/capabilities").authorizeEvryEffectCapability;
  executionEffectKey: typeof import("@/lib/evry/audit/identity").executionEffectKey;
  executeMeetingsEffect: typeof import("./atomic-effect").executeMeetingsEffect;
}) {
  async function seedPrior(personId: string) {
    const [meeting] = await db
      .insert(churchMeetings)
      .values({
        churchId: input.actor.plantId,
        type: "orientation",
        title: `${SCRATCH} prior`,
        datetime: new Date(MEETING_AT.getTime() - 24 * 60 * 60 * 1_000),
        status: "completed",
        agenda: [],
        createdBy: input.actor.userId,
      })
      .returning({ id: churchMeetings.id });
    const attendance = await seedAttendance({
      actor: input.actor,
      meetingId: meeting.id,
      personId,
      status: "attended",
      attendanceType: "first_time",
    });
    return { meeting, attendance };
  }

  async function refuseScenario(inputScenario: {
    exportName:
      | "addAttendeeAction"
      | "addWalkInAttendeeAction"
      | "toggleAttendanceStatusAction"
      | "recordAttendanceBatchAction";
    withPrior: boolean;
    mutate: (input: {
      meeting: Awaited<ReturnType<typeof seedMeeting>>;
      personId: string;
      prior: Awaited<ReturnType<typeof seedPrior>> | null;
    }) => Promise<void>;
  }) {
    const meeting = await seedMeeting(input.actor);
    const person = await seedPerson(input.actor);
    const prior = inputScenario.withPrior ? await seedPrior(person.id) : null;
    const needsCurrentAttendance =
      inputScenario.exportName === "toggleAttendanceStatusAction" ||
      inputScenario.exportName === "recordAttendanceBatchAction";
    const currentAttendance = needsCurrentAttendance
      ? await seedAttendance({
          actor: input.actor,
          meetingId: meeting.id,
          personId: person.id,
          status: "absent",
        })
      : null;
    const selection: MeetingsEvryEffectSelection = {
      kind: "effect",
      exportName: inputScenario.exportName,
      values:
        inputScenario.exportName === "recordAttendanceBatchAction"
          ? { records: [{ personId: person.id, status: "attended" }] }
          : inputScenario.exportName === "toggleAttendanceStatusAction"
            ? { personId: person.id, status: "attended" }
            : { personId: person.id },
    };
    const resolved = await input.resolveMeetingsEvryEffect({
      actor: input.actor,
      selection,
      pageContext: {
        kind: "meeting",
        recordId: meeting.id,
        label: meeting.title ?? "Meeting",
      },
      requestKey: input.mintEvryPlanRequestKey(),
      now: NOW,
    });
    assert.ok(
      resolved,
      `${inputScenario.exportName} drift plan did not resolve`
    );
    const execution = await seedExecution({ actor: input.actor, resolved });
    await inputScenario.mutate({ meeting, personId: person.id, prior });
    const authorization = await input.authorizeEvryEffectCapability(
      execution.capabilityIdentity
    );
    assert.ok(authorization);
    const effectKey = input.executionEffectKey(
      execution.planId,
      execution.fingerprint,
      execution.stepId
    );
    const result = await input.executeMeetingsEffect({
      authorization,
      execution,
      effectKey,
      arguments: resolved.arguments,
    });
    assert.equal(
      result.status,
      "refused",
      `${inputScenario.exportName} accepted changed derivation inputs`
    );
    assert.equal(
      (
        await db
          .select({ id: evryExecutionOutcomes.id })
          .from(evryExecutionOutcomes)
          .where(eq(evryExecutionOutcomes.effectKey, effectKey))
      ).length,
      0,
      `${inputScenario.exportName} claimed a stale derivation`
    );
    const attendanceRows = await db
      .select({ status: meetingAttendance.status })
      .from(meetingAttendance)
      .where(
        and(
          eq(meetingAttendance.churchId, input.actor.plantId),
          eq(meetingAttendance.meetingId, meeting.id),
          eq(meetingAttendance.personId, person.id)
        )
      );
    assert.equal(attendanceRows.length, currentAttendance ? 1 : 0);
    if (currentAttendance) assert.equal(attendanceRows[0]?.status, "absent");
  }

  await refuseScenario({
    exportName: "addAttendeeAction",
    withPrior: false,
    mutate: async ({ personId }) => {
      await db
        .update(persons)
        .set({ status: "attendee", updatedAt: new Date() })
        .where(eq(persons.id, personId));
    },
  });
  await refuseScenario({
    exportName: "addWalkInAttendeeAction",
    withPrior: true,
    mutate: async ({ prior }) => {
      assert.ok(prior);
      await db
        .update(churchMeetings)
        .set({
          datetime: new Date(MEETING_AT.getTime() - 12 * 60 * 60 * 1_000),
        })
        .where(eq(churchMeetings.id, prior.meeting.id));
    },
  });
  await refuseScenario({
    exportName: "toggleAttendanceStatusAction",
    withPrior: true,
    mutate: async ({ personId }) => {
      await seedPrior(personId);
    },
  });
  await refuseScenario({
    exportName: "recordAttendanceBatchAction",
    withPrior: false,
    mutate: async ({ meeting }) => {
      await db
        .update(churchMeetings)
        .set({
          datetime: new Date(MEETING_AT.getTime() + 60 * 60 * 1_000),
          updatedAt: meeting.updatedAt,
        })
        .where(eq(churchMeetings.id, meeting.id));
    },
  });
  console.log("PASS meetings:attendance-derivation-drift-matrix");
}

async function assertFinalizationParity(input: {
  actor: EvryPlantActor;
  resolveMeetingsEvryEffect: typeof import("./resolver").resolveMeetingsEvryEffect;
  mintEvryPlanRequestKey: typeof import("@/lib/evry/plans").mintEvryPlanRequestKey;
  authorizeEvryEffectCapability: typeof import("@/lib/evry/eligibility/capabilities").authorizeEvryEffectCapability;
  executionEffectKey: typeof import("@/lib/evry/audit/identity").executionEffectKey;
  executeMeetingsEffect: typeof import("./atomic-effect").executeMeetingsEffect;
}) {
  async function resolveFinalization(meetingId: string, title: string | null) {
    const resolved = await input.resolveMeetingsEvryEffect({
      actor: input.actor,
      selection: {
        kind: "effect",
        exportName: "finalizeAttendanceAction",
        values: {},
      },
      pageContext: {
        kind: "meeting",
        recordId: meetingId,
        label: title ?? "Meeting",
      },
      requestKey: input.mintEvryPlanRequestKey(),
      now: NOW,
    });
    assert.ok(resolved);
    assert.equal(resolved.exportName, "finalizeAttendanceAction");
    return resolved as Extract<
      ResolvedMeetingsEffect,
      { exportName: "finalizeAttendanceAction" }
    >;
  }

  async function execute(
    resolved: Extract<
      ResolvedMeetingsEffect,
      { exportName: "finalizeAttendanceAction" }
    >,
    existingExecution?: Awaited<ReturnType<typeof seedExecution>>
  ) {
    const execution =
      existingExecution ??
      (await seedExecution({ actor: input.actor, resolved }));
    const authorization = await input.authorizeEvryEffectCapability(
      execution.capabilityIdentity
    );
    assert.ok(authorization);
    return {
      execution,
      result: await input.executeMeetingsEffect({
        authorization,
        execution,
        effectKey: input.executionEffectKey(
          execution.planId,
          execution.fingerprint,
          execution.stepId
        ),
        arguments: resolved.arguments,
      }),
    };
  }

  const [creator] = await db
    .insert(users)
    .values({
      email: `${randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: `${SCRATCH} alternate creator`,
      seat: "member",
      churchId: input.actor.plantId,
    })
    .returning({ id: users.id });
  await db.insert(persons).values({
    churchId: input.actor.plantId,
    userId: creator.id,
    firstName: "Committed",
    lastName: "Assignee",
    status: "core_group",
    createdBy: input.actor.userId,
  });

  await setLeadershipStatus(input.actor, "no_planter");
  const noPlanterMeeting = await seedMeeting(input.actor, true);
  const noPlanterPerson = await seedPerson(input.actor, creator.id);
  await seedAttendance({
    actor: input.actor,
    meetingId: noPlanterMeeting.id,
    personId: noPlanterPerson.id,
    status: "attended",
    attendanceType: "first_time",
  });
  const noPlanter = await resolveFinalization(
    noPlanterMeeting.id,
    noPlanterMeeting.title
  );
  assert.equal(noPlanter.arguments.expectedTaskAssigneeId, null);
  assert.equal(noPlanter.arguments.expectedLeadershipStatus, "no_planter");
  assert.deepEqual(noPlanter.arguments.followUpTaskTargets, []);
  assert.equal(noPlanter.arguments.evaluationTaskTarget, null);
  assert.equal((await execute(noPlanter)).result.status, "completed");
  const [noPlanterPersonAfter] = await db
    .select({ status: persons.status })
    .from(persons)
    .where(eq(persons.id, noPlanterPerson.id));
  assert.equal(noPlanterPersonAfter?.status, "attendee");
  assert.equal(
    (
      await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.churchId, input.actor.plantId),
            or(
              eq(tasks.relatedId, noPlanterMeeting.id),
              eq(tasks.relatedId, noPlanterPerson.id)
            )
          )
        )
    ).length,
    0
  );

  await setLeadershipStatus(input.actor, "planter_confirmed");
  await db
    .update(users)
    .set({ seat: "admin" })
    .where(eq(users.id, input.actor.userId));
  sessionUser = sessionUser ? { ...sessionUser, seat: "admin" } : null;
  const noOwnerMeeting = await seedMeeting(input.actor, true);
  const noOwnerPerson = await seedPerson(input.actor, creator.id);
  await seedAttendance({
    actor: input.actor,
    meetingId: noOwnerMeeting.id,
    personId: noOwnerPerson.id,
    status: "attended",
    attendanceType: "first_time",
  });
  const noOwner = await resolveFinalization(
    noOwnerMeeting.id,
    noOwnerMeeting.title
  );
  assert.equal(noOwner.arguments.expectedTaskAssigneeId, null);
  assert.equal(noOwner.arguments.expectedLeadershipStatus, "planter_confirmed");
  assert.deepEqual(noOwner.arguments.followUpTaskTargets, []);
  assert.equal(noOwner.arguments.evaluationTaskTarget, null);
  assert.equal((await execute(noOwner)).result.status, "completed");
  const [noOwnerPersonAfter] = await db
    .select({ status: persons.status })
    .from(persons)
    .where(eq(persons.id, noOwnerPerson.id));
  assert.equal(noOwnerPersonAfter?.status, "attendee");
  assert.equal(
    (
      await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.churchId, input.actor.plantId),
            or(
              eq(tasks.relatedId, noOwnerMeeting.id),
              eq(tasks.relatedId, noOwnerPerson.id)
            )
          )
        )
    ).length,
    0
  );
  await db
    .update(users)
    .set({ seat: "owner" })
    .where(eq(users.id, input.actor.userId));
  sessionUser = sessionUser ? { ...sessionUser, seat: "owner" } : null;

  const convergenceMeeting = await seedMeeting(input.actor, true);
  const firstPerson = await seedPerson(input.actor, creator.id);
  await seedAttendance({
    actor: input.actor,
    meetingId: convergenceMeeting.id,
    personId: firstPerson.id,
    status: "attended",
    attendanceType: "first_time",
  });
  const initialFinalization = await resolveFinalization(
    convergenceMeeting.id,
    convergenceMeeting.title
  );
  assert.ok(
    initialFinalization.arguments.followUpTaskTargets.every(
      ({ expectedTaskAbsent }) => expectedTaskAbsent
    )
  );
  assert.equal(
    initialFinalization.arguments.evaluationTaskTarget?.expectedTaskAbsent,
    true
  );
  assert.equal((await execute(initialFinalization)).result.status, "completed");
  const originalTaskIds = [
    ...initialFinalization.arguments.followUpTaskTargets.map(
      ({ taskId }) => taskId
    ),
    initialFinalization.arguments.evaluationTaskTarget?.taskId,
  ].filter((taskId): taskId is string => Boolean(taskId));
  const originalFollowUpId =
    initialFinalization.arguments.followUpTaskTargets[0]?.taskId;
  assert.ok(originalFollowUpId);
  await db.insert(notifications).values(
    Array.from({ length: 101 }, (_, index) => ({
      id: randomUUID(),
      churchId: input.actor.plantId,
      recipientUserId: input.actor.userId,
      category: "tasks" as const,
      type: index % 2 === 0 ? "task.due" : "task.overdue",
      title: `Retained reminder ${index + 1}`,
      body: "This pending task notification must survive repeat finalization.",
      entityType: "task" as const,
      entityId: originalFollowUpId,
      dedupeKey: `retained-proof:${originalFollowUpId}:${index + 1}`,
      scheduledFor: new Date(NOW.getTime() + (index + 1) * 60_000),
    }))
  );
  const originalNotificationRows = await db
    .select({
      id: notifications.id,
      recipientUserId: notifications.recipientUserId,
      type: notifications.type,
      entityId: notifications.entityId,
      dedupeKey: notifications.dedupeKey,
      scheduledFor: notifications.scheduledFor,
      status: notifications.status,
      updatedAt: notifications.updatedAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.churchId, input.actor.plantId),
        eq(notifications.category, "tasks"),
        inArray(notifications.entityId, originalTaskIds)
      )
    )
    .orderBy(asc(notifications.id));
  assert.ok(
    originalNotificationRows.length > 100,
    "real task notification baseline did not exceed the former boundary"
  );
  const latePerson = await seedPerson(input.actor, creator.id);
  await seedAttendance({
    actor: input.actor,
    meetingId: convergenceMeeting.id,
    personId: latePerson.id,
    status: "attended",
    attendanceType: "first_time",
  });
  const repeatFinalization = await resolveFinalization(
    convergenceMeeting.id,
    convergenceMeeting.title
  );
  const repeatTargets = [
    ...repeatFinalization.arguments.followUpTaskTargets,
    ...(repeatFinalization.arguments.evaluationTaskTarget
      ? [repeatFinalization.arguments.evaluationTaskTarget]
      : []),
  ];
  assert.deepEqual(
    repeatTargets
      .filter(({ expectedTaskAbsent }) => !expectedTaskAbsent)
      .flatMap(({ notificationBaseline }) => notificationBaseline)
      .map(({ notificationId }) => notificationId)
      .toSorted(),
    originalNotificationRows.map(({ id }) => id).toSorted(),
    "repeat plan omitted or duplicated a retained notification"
  );
  assert.equal(
    repeatFinalization.arguments.followUpTaskTargets.filter(
      ({ expectedTaskAbsent }) => expectedTaskAbsent
    ).length,
    1,
    "late attendee did not produce exactly one new follow-up"
  );
  const repeatDisclosure = meetingsEffectDisclosure(
    "finalizeAttendanceAction",
    repeatFinalization.arguments
  );
  assert.equal(
    repeatDisclosure.counts.find(
      ({ label }) => label === "Pending task notifications retained"
    )?.count,
    originalNotificationRows.length
  );
  assert.equal(
    (await execute(repeatFinalization)).result.status,
    "completed",
    "normal reminders blocked repeat finalization"
  );
  const retainedNotificationRowsAfter = await db
    .select({
      id: notifications.id,
      recipientUserId: notifications.recipientUserId,
      type: notifications.type,
      entityId: notifications.entityId,
      dedupeKey: notifications.dedupeKey,
      scheduledFor: notifications.scheduledFor,
      status: notifications.status,
      updatedAt: notifications.updatedAt,
    })
    .from(notifications)
    .where(
      inArray(
        notifications.id,
        originalNotificationRows.map(({ id }) => id)
      )
    )
    .orderBy(asc(notifications.id));
  assert.deepEqual(
    retainedNotificationRowsAfter,
    originalNotificationRows,
    "repeat finalization changed a retained task notification"
  );
  assert.equal(
    (
      await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          inArray(
            tasks.id,
            repeatTargets.map(({ taskId }) => taskId)
          )
        )
    ).length,
    3,
    "repeat finalization lost or duplicated a task"
  );
  const [convergenceMeetingAfter] = await db
    .select({ actualAttendance: churchMeetings.actualAttendance })
    .from(churchMeetings)
    .where(eq(churchMeetings.id, convergenceMeeting.id));
  assert.equal(convergenceMeetingAfter?.actualAttendance, 2);
  assert.equal(
    await input.resolveMeetingsEvryEffect({
      actor: input.actor,
      selection: {
        kind: "effect",
        exportName: "updateMeetingAction",
        values: { timezone: "UTC", title: "Custom Night" },
      },
      pageContext: {
        kind: "meeting",
        recordId: convergenceMeeting.id,
        label: convergenceMeeting.title ?? "Meeting",
      },
      requestKey: input.mintEvryPlanRequestKey(),
      now: NOW,
    }),
    null,
    "a custom title was selectable for a vision meeting"
  );
  console.log("PASS meetings:finalization-repeat-notification-convergence");

  const retainedMeeting = await seedMeeting(input.actor, true);
  const retainedPerson = await seedPerson(input.actor, creator.id);
  await seedAttendance({
    actor: input.actor,
    meetingId: retainedMeeting.id,
    personId: retainedPerson.id,
    status: "attended",
    attendanceType: "first_time",
  });
  const [followUp, evaluation] = await db
    .insert(tasks)
    .values([
      {
        churchId: input.actor.plantId,
        title: "Legally reassigned follow-up",
        status: "in_progress" as const,
        priority: "medium" as const,
        dueDate: "2026-10-01",
        assignedToId: creator.id,
        category: "follow_up" as const,
        relatedType: "person" as const,
        relatedId: retainedPerson.id,
        createdById: input.actor.userId,
      },
      {
        churchId: input.actor.plantId,
        title: "Legally unassigned evaluation",
        status: "blocked" as const,
        priority: "urgent" as const,
        dueDate: "2026-09-30",
        assignedToId: null,
        category: "vision_meeting" as const,
        relatedType: "meeting" as const,
        relatedId: retainedMeeting.id,
        completionEvent: "meeting.evaluation.completed",
        createdById: input.actor.userId,
      },
    ])
    .returning();
  assert.ok(followUp && evaluation);
  const retained = await resolveFinalization(
    retainedMeeting.id,
    retainedMeeting.title
  );
  assert.deepEqual(
    retained.arguments.followUpTaskTargets.map((target) => ({
      taskId: target.taskId,
      assignedToId: target.assignedToId,
      priority: target.priority,
      expectedTaskAbsent: target.expectedTaskAbsent,
    })),
    [
      {
        taskId: followUp.id,
        assignedToId: creator.id,
        priority: "medium",
        expectedTaskAbsent: false,
      },
    ]
  );
  assert.deepEqual(
    retained.arguments.evaluationTaskTarget && {
      taskId: retained.arguments.evaluationTaskTarget.taskId,
      assignedToId: retained.arguments.evaluationTaskTarget.assignedToId,
      priority: retained.arguments.evaluationTaskTarget.priority,
      expectedTaskAbsent:
        retained.arguments.evaluationTaskTarget.expectedTaskAbsent,
    },
    {
      taskId: evaluation.id,
      assignedToId: null,
      priority: "urgent",
      expectedTaskAbsent: false,
    }
  );
  assert.equal((await execute(retained)).result.status, "completed");
  const retainedRows = await db
    .select({
      id: tasks.id,
      assignedToId: tasks.assignedToId,
      priority: tasks.priority,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .where(inArray(tasks.id, [followUp.id, evaluation.id]));
  const retainedById = new Map(retainedRows.map((row) => [row.id, row]));
  assert.deepEqual(retainedById.get(followUp.id), {
    id: followUp.id,
    assignedToId: creator.id,
    priority: "medium",
    updatedAt: followUp.updatedAt,
  });
  assert.deepEqual(retainedById.get(evaluation.id), {
    id: evaluation.id,
    assignedToId: null,
    priority: "urgent",
    updatedAt: evaluation.updatedAt,
  });

  async function prepareNotificationDrift() {
    const meeting = await seedMeeting(input.actor, true);
    const person = await seedPerson(input.actor, creator.id);
    await seedAttendance({
      actor: input.actor,
      meetingId: meeting.id,
      personId: person.id,
      status: "attended",
      attendanceType: "first_time",
    });
    const [followUp] = await db
      .insert(tasks)
      .values({
        churchId: input.actor.plantId,
        title: "Notification drift follow-up",
        status: "not_started",
        priority: "medium",
        dueDate: "2026-10-01",
        assignedToId: creator.id,
        category: "follow_up",
        relatedType: "person",
        relatedId: person.id,
        createdById: input.actor.userId,
      })
      .returning();
    assert.ok(followUp);
    await db.insert(tasks).values({
      churchId: input.actor.plantId,
      title: "Notification drift evaluation",
      status: "blocked",
      priority: "urgent",
      dueDate: "2026-09-30",
      assignedToId: null,
      category: "vision_meeting",
      relatedType: "meeting",
      relatedId: meeting.id,
      completionEvent: "meeting.evaluation.completed",
      createdById: input.actor.userId,
    });
    const [notification] = await db
      .insert(notifications)
      .values({
        churchId: input.actor.plantId,
        recipientUserId: creator.id,
        category: "tasks",
        type: "task.due",
        title: "Notification drift reminder",
        body: "The exact pending row is part of the immutable plan.",
        entityType: "task",
        entityId: followUp.id,
        dedupeKey: `notification-drift:${followUp.id}`,
        scheduledFor: new Date("2026-09-30T12:00:00.000Z"),
      })
      .returning();
    assert.ok(notification);
    const resolved = await resolveFinalization(meeting.id, meeting.title);
    const planned = resolved.arguments.followUpTaskTargets.find(
      ({ taskId }) => taskId === followUp.id
    );
    assert.equal(planned?.notificationBaseline.length, 1);
    return {
      resolved,
      execution: await seedExecution({ actor: input.actor, resolved }),
      followUp,
      notification,
    };
  }

  const insertedDrift = await prepareNotificationDrift();
  await db.insert(notifications).values({
    churchId: input.actor.plantId,
    recipientUserId: creator.id,
    category: "tasks",
    type: "task.overdue",
    title: "Unexpected reminder",
    body: "This row was not in the plan.",
    entityType: "task",
    entityId: insertedDrift.followUp.id,
    dedupeKey: `notification-drift:insert:${insertedDrift.followUp.id}`,
    scheduledFor: new Date("2026-10-02T12:00:00.000Z"),
  });
  assert.equal(
    (await execute(insertedDrift.resolved, insertedDrift.execution)).result
      .status,
    "refused",
    "an inserted task notification did not invalidate finalization"
  );

  const deletedDrift = await prepareNotificationDrift();
  await db
    .delete(notifications)
    .where(eq(notifications.id, deletedDrift.notification.id));
  assert.equal(
    (await execute(deletedDrift.resolved, deletedDrift.execution)).result
      .status,
    "refused",
    "a deleted task notification did not invalidate finalization"
  );

  const changedDrift = await prepareNotificationDrift();
  await db
    .update(notifications)
    .set({ scheduledFor: new Date("2026-10-03T12:00:00.000Z") })
    .where(eq(notifications.id, changedDrift.notification.id));
  assert.equal(
    (await execute(changedDrift.resolved, changedDrift.execution)).result
      .status,
    "refused",
    "a changed task notification did not invalidate finalization"
  );
  console.log("PASS meetings:finalization-notification-drift-matrix");

  const taskDriftMeeting = await seedMeeting(input.actor, true);
  const taskDriftPerson = await seedPerson(input.actor, creator.id);
  await seedAttendance({
    actor: input.actor,
    meetingId: taskDriftMeeting.id,
    personId: taskDriftPerson.id,
    status: "attended",
    attendanceType: "first_time",
  });
  const [taskDriftFollowUp] = await db
    .insert(tasks)
    .values({
      churchId: input.actor.plantId,
      title: "Task drift follow-up",
      status: "not_started",
      priority: "medium",
      dueDate: "2026-10-01",
      assignedToId: creator.id,
      category: "follow_up",
      relatedType: "person",
      relatedId: taskDriftPerson.id,
      createdById: input.actor.userId,
    })
    .returning();
  assert.ok(taskDriftFollowUp);
  const taskDriftPlan = await resolveFinalization(
    taskDriftMeeting.id,
    taskDriftMeeting.title
  );
  const taskDriftExecution = await seedExecution({
    actor: input.actor,
    resolved: taskDriftPlan,
  });
  await db
    .update(tasks)
    .set({ priority: "urgent" })
    .where(eq(tasks.id, taskDriftFollowUp.id));
  assert.equal(
    (await execute(taskDriftPlan, taskDriftExecution)).result.status,
    "refused"
  );

  const driftMeeting = await seedMeeting(input.actor, true);
  const driftPlan = await resolveFinalization(
    driftMeeting.id,
    driftMeeting.title
  );
  assert.equal(
    driftPlan.arguments.expectedLeadershipStatus,
    "planter_confirmed"
  );
  const driftExecution = await seedExecution({
    actor: input.actor,
    resolved: driftPlan,
  });
  await setLeadershipStatus(input.actor, "no_planter");
  assert.equal(
    (await execute(driftPlan, driftExecution)).result.status,
    "refused"
  );
  await setLeadershipStatus(input.actor, "planter_confirmed");

  console.log("PASS meetings:finalization-canonical-parity");
}

async function assertCrossPlantRefusals(input: {
  actor: EvryPlantActor;
  resolveMeetingsEvryEffect: typeof import("./resolver").resolveMeetingsEvryEffect;
  mintEvryPlanRequestKey: typeof import("@/lib/evry/plans").mintEvryPlanRequestKey;
}) {
  const foreign = await seedForeignFixtures();
  const pageContext = {
    kind: "meeting" as const,
    recordId: foreign.meeting.id,
    label: foreign.meeting.title ?? "Foreign meeting",
  };
  for (const exportName of Object.keys(
    MEETINGS_ACTION_CONTRACTS
  ) as MeetingsActionExport[]) {
    if (
      exportName === "createLocationAction" ||
      exportName === "updateLocationAction" ||
      exportName === "createMeetingAction"
    ) {
      continue;
    }
    const resolved = await input.resolveMeetingsEvryEffect({
      actor: input.actor,
      selection: { kind: "effect", exportName, values: {} },
      pageContext,
      requestKey: input.mintEvryPlanRequestKey(),
      now: NOW,
    });
    assert.equal(resolved, null, `${exportName} exposed a foreign meeting`);
  }
  const foreignLocation = await input.resolveMeetingsEvryEffect({
    actor: input.actor,
    selection: {
      kind: "effect",
      exportName: "updateLocationAction",
      values: {
        locationId: foreign.location.id,
        name: "Foreign",
        address: "Foreign",
      },
    },
    pageContext: null,
    requestKey: input.mintEvryPlanRequestKey(),
    now: NOW,
  });
  assert.equal(foreignLocation, null);
  const foreignTeam = await input.resolveMeetingsEvryEffect({
    actor: input.actor,
    selection: {
      kind: "effect",
      exportName: "createMeetingAction",
      values: {
        type: "team_meeting",
        datetime: MEETING_AT.toISOString(),
        timezone: "America/New_York",
        title: "Foreign",
        locationId: null,
        locationName: null,
        locationAddress: null,
        teamId: foreign.team.id,
        meetingSubtype: "training",
        estimatedAttendance: 1,
        durationMinutes: 60,
        notes: "Foreign",
      },
    },
    pageContext: null,
    requestKey: input.mintEvryPlanRequestKey(),
    now: NOW,
  });
  assert.equal(foreignTeam, null);
  const foreignCreateLocation = await input.resolveMeetingsEvryEffect({
    actor: input.actor,
    selection: {
      kind: "effect",
      exportName: "createMeetingAction",
      values: {
        type: "orientation",
        datetime: MEETING_AT.toISOString(),
        timezone: "America/New_York",
        title: "Foreign",
        locationId: foreign.location.id,
        locationName: null,
        locationAddress: null,
        teamId: null,
        meetingSubtype: null,
        estimatedAttendance: null,
        durationMinutes: null,
        notes: null,
      },
    },
    pageContext: null,
    requestKey: input.mintEvryPlanRequestKey(),
    now: NOW,
  });
  assert.equal(foreignCreateLocation, null);
  console.log("PASS meetings:cross-plant-refusal");
}

async function main() {
  await seedActor();
  const [resolver, plans, eligibility, audit, atomic] = await Promise.all([
    import("./resolver"),
    import("@/lib/evry/plans"),
    import("@/lib/evry/eligibility/capabilities"),
    import("@/lib/evry/audit/identity"),
    import("./atomic-effect"),
  ]);
  const initialAuthorization = await eligibility.authorizeEvryEffectCapability(
    MEETINGS_ACTION_CONTRACTS.createLocationAction.operationId
  );
  assert.ok(initialAuthorization);
  const actor = initialAuthorization.actor;
  await assertCrossPlantRefusals({
    actor,
    resolveMeetingsEvryEffect: resolver.resolveMeetingsEvryEffect,
    mintEvryPlanRequestKey: plans.mintEvryPlanRequestKey,
  });
  for (const contract of Object.values(MEETINGS_ACTION_CONTRACTS)) {
    console.log(`PASS ${contract.operationId}:tenancy`);
  }
  await db
    .update(users)
    .set({ seat: "member" })
    .where(eq(users.id, actor.userId));
  sessionUser = sessionUser ? { ...sessionUser, seat: "member" } : null;
  for (const contract of Object.values(MEETINGS_ACTION_CONTRACTS)) {
    assert.equal(
      await eligibility.authorizeEvryEffectCapability(contract.operationId),
      null,
      `${contract.operationId} admitted a Member`
    );
    console.log(`PASS ${contract.operationId}:permission`);
  }
  await db
    .update(users)
    .set({ seat: "owner" })
    .where(eq(users.id, actor.userId));
  sessionUser = sessionUser ? { ...sessionUser, seat: "owner" } : null;
  for (const exportName of Object.keys(
    MEETINGS_ACTION_CONTRACTS
  ) as MeetingsActionExport[]) {
    await runEffect({
      actor,
      exportName,
      resolveMeetingsEvryEffect: resolver.resolveMeetingsEvryEffect,
      mintEvryPlanRequestKey: plans.mintEvryPlanRequestKey,
      authorizeEvryEffectCapability: eligibility.authorizeEvryEffectCapability,
      executionEffectKey: audit.executionEffectKey,
      executeMeetingsEffect: atomic.executeMeetingsEffect,
    });
  }
  await assertAttendanceDerivationDriftRefuses({
    actor,
    resolveMeetingsEvryEffect: resolver.resolveMeetingsEvryEffect,
    mintEvryPlanRequestKey: plans.mintEvryPlanRequestKey,
    authorizeEvryEffectCapability: eligibility.authorizeEvryEffectCapability,
    executionEffectKey: audit.executionEffectKey,
    executeMeetingsEffect: atomic.executeMeetingsEffect,
  });
  await assertFinalizationParity({
    actor,
    resolveMeetingsEvryEffect: resolver.resolveMeetingsEvryEffect,
    mintEvryPlanRequestKey: plans.mintEvryPlanRequestKey,
    authorizeEvryEffectCapability: eligibility.authorizeEvryEffectCapability,
    executionEffectKey: audit.executionEffectKey,
    executeMeetingsEffect: atomic.executeMeetingsEffect,
  });
  console.log("Meetings atomic effect live proof passed");
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  }
);
