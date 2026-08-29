import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  churchMeetings,
  invitations,
  locations,
  meetingAttendance,
  meetingChecklistItems,
  meetingEvaluations,
  meetingResponses,
  notifications,
  persons,
  tasks,
} from "@/db/schema";
import {
  trustedReviewForEvryPlanDocument,
  type EvryArtifactReviewRegistry,
} from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import {
  authorizeEvryEffectCapability,
  eligibleEvryCapabilitiesFor,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  createEvryExecutionCapabilityRegistry,
  defineEvryExecutionCapability,
  type EvryExecutionCapabilityRegistry,
} from "@/lib/evry/executor";
import {
  parseEvryActionPlanCandidate,
  type EvryActionStep,
  type EvryPlanRequestKey,
} from "@/lib/evry/plans";
import { createEvryActionPlanRecord } from "@/lib/evry/plans/repository";
import { defineEvryPlanCapability } from "@/lib/evry/plans/registry";

import {
  MEETINGS_ACTION_CONTRACTS,
  type MeetingsActionExport,
} from "./catalog";
import { MEETINGS_EFFECT_ARGUMENT_SCHEMAS } from "./effect-contracts";
import { executeMeetingsEffect } from "./atomic-effect";
import { MEETINGS_REVIEW_REGISTRY } from "./review";
import type { ResolvedMeetingsEffect } from "./resolver";

const PLAN_BY_EXPORT = Object.fromEntries(
  Object.entries(MEETINGS_ACTION_CONTRACTS).map(([exportName, contract]) => {
    const name = exportName as MeetingsActionExport;
    return [
      name,
      defineEvryPlanCapability({
        identity: contract.operationId,
        effectClass: "database_write",
        arguments: MEETINGS_EFFECT_ARGUMENT_SCHEMAS[name].shape,
      }),
    ];
  })
) as Record<MeetingsActionExport, ReturnType<typeof defineEvryPlanCapability>>;

export const MEETINGS_PLAN_CAPABILITIES = Object.freeze(
  Object.values(PLAN_BY_EXPORT)
);

export const MEETINGS_EXECUTION_CAPABILITIES = Object.freeze(
  (Object.keys(PLAN_BY_EXPORT) as MeetingsActionExport[]).map((exportName) =>
    defineEvryExecutionCapability({
      planCapability: PLAN_BY_EXPORT[exportName],
      executeIfCurrent: executeMeetingsEffect,
    })
  )
);

export const MEETINGS_EXECUTION_REGISTRY: EvryExecutionCapabilityRegistry =
  createEvryExecutionCapabilityRegistry(MEETINGS_EXECUTION_CAPABILITIES);
export const MEETINGS_PLAN_REGISTRY = MEETINGS_EXECUTION_REGISTRY.planRegistry;
export const MEETINGS_ARTIFACT_REVIEW_REGISTRY: EvryArtifactReviewRegistry =
  MEETINGS_REVIEW_REGISTRY;

const EXPORT_BY_IDENTITY = new Map(
  Object.entries(MEETINGS_ACTION_CONTRACTS).map(([exportName, contract]) => [
    contract.operationId,
    exportName as MeetingsActionExport,
  ])
);

export async function proposeMeetingsEvryEffect(input: {
  actor: EvryPlantActor;
  resolved: ResolvedMeetingsEffect;
  requestKey: EvryPlanRequestKey;
}) {
  const { exportName, arguments: resolvedArguments } = input.resolved;
  const contract = MEETINGS_ACTION_CONTRACTS[exportName];
  const authorization = await authorizeEvryEffectCapability(
    contract.operationId
  );
  if (
    !authorization ||
    authorization.actor.userId !== input.actor.userId ||
    authorization.actor.plantId !== input.actor.plantId
  ) {
    return null;
  }
  const parsed =
    MEETINGS_EFFECT_ARGUMENT_SCHEMAS[exportName].safeParse(resolvedArguments);
  if (!parsed.success) return null;
  const stepId = exportName.replace(/Action$/, "");
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: stepId,
          capabilityIdentity: contract.operationId,
          arguments: parsed.data,
          dependsOn: [],
        },
      ],
    },
    registry: MEETINGS_PLAN_REGISTRY,
    eligibleCapabilities: eligibleEvryCapabilitiesFor(authorization.actor),
  });
  const stored = await createEvryActionPlanRecord({
    actorUserId: authorization.actor.userId,
    plantId: authorization.actor.plantId,
    requestKey: input.requestKey,
    document,
  });
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: stored.id,
    fingerprint: stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: MEETINGS_REVIEW_REGISTRY,
  });
  return review ? { plan, confirmation: review.confirmation } : null;
}

function sameInstant(value: Date, expected: string): boolean {
  return value.getTime() === new Date(expected).getTime();
}

function sameStrings(
  left: readonly string[],
  right: readonly string[]
): boolean {
  const expected = [...right].toSorted();
  return (
    left.length === expected.length &&
    [...left].toSorted().every((value, index) => value === expected[index])
  );
}

function sameNullable<T>(left: T | null, right: T | null): boolean {
  return left === right;
}

async function pendingNotificationsAreCurrent(input: {
  plantId: string;
  meetingId: string;
  pending: unknown;
}): Promise<boolean> {
  if (!Array.isArray(input.pending)) return false;
  const rows = await db
    .select({
      notificationId: notifications.id,
      recipientUserId: notifications.recipientUserId,
      type: notifications.type,
      entityId: notifications.entityId,
      dedupeKey: notifications.dedupeKey,
      scheduledFor: notifications.scheduledFor,
      updatedAt: notifications.updatedAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.churchId, input.plantId),
        eq(notifications.category, "meetings"),
        eq(notifications.entityType, "meeting"),
        eq(notifications.entityId, input.meetingId),
        eq(notifications.status, "pending")
      )
    );
  const actual = rows.map((row) =>
    JSON.stringify({
      notificationId: row.notificationId,
      recipientUserId: row.recipientUserId,
      type: row.type,
      entityId: row.entityId,
      dedupeKey: row.dedupeKey,
      scheduledFor: row.scheduledFor.toISOString(),
      beforeStatus: "pending",
      expectedUpdatedAt: row.updatedAt.toISOString(),
    })
  );
  return sameStrings(
    actual,
    input.pending.map((row) => JSON.stringify(row))
  );
}

async function notificationTargetsRemainAbsent(input: {
  plantId: string;
  targets: unknown;
  cancelling: unknown;
}): Promise<boolean> {
  if (!Array.isArray(input.targets) || !Array.isArray(input.cancelling)) {
    return false;
  }
  const cancelledIds = new Set(
    input.cancelling.flatMap((row) =>
      row &&
      typeof row === "object" &&
      "notificationId" in row &&
      typeof row.notificationId === "string"
        ? [row.notificationId]
        : []
    )
  );
  for (const target of input.targets) {
    if (
      !target ||
      typeof target !== "object" ||
      !("recipientUserId" in target) ||
      !("dedupeKey" in target) ||
      typeof target.recipientUserId !== "string" ||
      typeof target.dedupeKey !== "string"
    ) {
      return false;
    }
    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.churchId, input.plantId),
          eq(notifications.recipientUserId, target.recipientUserId),
          eq(notifications.dedupeKey, target.dedupeKey),
          sql`${notifications.status} <> 'cancelled'`
        )
      );
    if (rows.some(({ id }) => !cancelledIds.has(id))) return false;
  }
  return true;
}

/** Read-only stale-confirmation gate; execution repeats the complete predicate. */
export async function meetingsPlanTargetIsCurrent(input: {
  actor: EvryPlantActor;
  step: EvryActionStep;
}): Promise<boolean> {
  const exportName = EXPORT_BY_IDENTITY.get(input.step.capabilityIdentity);
  if (!exportName) return false;
  const parsed = MEETINGS_EFFECT_ARGUMENT_SCHEMAS[exportName].safeParse(
    input.step.arguments
  );
  if (!parsed.success) return false;
  const args = parsed.data as Readonly<Record<string, unknown>>;
  const plantId = input.actor.plantId;

  if (exportName === "createLocationAction") {
    const create = MEETINGS_EFFECT_ARGUMENT_SCHEMAS.createLocationAction.parse(
      input.step.arguments
    );
    const [row] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.id, create.locationId))
      .limit(1);
    return !row;
  }
  if (exportName === "updateLocationAction") {
    const update = MEETINGS_EFFECT_ARGUMENT_SCHEMAS.updateLocationAction.parse(
      input.step.arguments
    );
    const [row] = await db
      .select({ updatedAt: locations.updatedAt })
      .from(locations)
      .where(
        and(
          eq(locations.id, update.locationId),
          eq(locations.churchId, plantId)
        )
      )
      .limit(1);
    return Boolean(row && sameInstant(row.updatedAt, update.expectedUpdatedAt));
  }
  if (exportName === "createMeetingAction") {
    const create = MEETINGS_EFFECT_ARGUMENT_SCHEMAS.createMeetingAction.parse(
      input.step.arguments
    );
    const [meetings, checklist, attendance] = await Promise.all([
      db
        .select({ id: churchMeetings.id })
        .from(churchMeetings)
        .where(
          sql`${churchMeetings.id} = ${create.meetingId}::uuid
            or (${churchMeetings.churchId} = ${plantId}::uuid
              and ${churchMeetings.meetingNumber} = ${create.meetingNumber})`
        ),
      create.checklistItems.length === 0
        ? Promise.resolve([])
        : db
            .select({ id: meetingChecklistItems.id })
            .from(meetingChecklistItems)
            .where(
              inArray(
                meetingChecklistItems.id,
                create.checklistItems.map(({ itemId }) => itemId)
              )
            ),
      create.attendanceRows.length === 0
        ? Promise.resolve([])
        : db
            .select({ id: meetingAttendance.id })
            .from(meetingAttendance)
            .where(
              inArray(
                meetingAttendance.id,
                create.attendanceRows.map(({ attendanceId }) => attendanceId)
              )
            ),
    ]);
    return (
      meetings.length === 0 &&
      checklist.length === 0 &&
      attendance.length === 0 &&
      (await notificationTargetsRemainAbsent({
        plantId,
        targets: create.notificationTargets,
        cancelling: [],
      }))
    );
  }
  if (exportName === "createEvaluationAction") {
    const evaluationArgs =
      MEETINGS_EFFECT_ARGUMENT_SCHEMAS.createEvaluationAction.parse(
        input.step.arguments
      );
    const [meeting, evaluation] = await Promise.all([
      db
        .select({ updatedAt: churchMeetings.updatedAt })
        .from(churchMeetings)
        .where(
          and(
            eq(churchMeetings.id, evaluationArgs.meetingId),
            eq(churchMeetings.churchId, plantId)
          )
        )
        .limit(1),
      db
        .select({ id: meetingEvaluations.id })
        .from(meetingEvaluations)
        .where(eq(meetingEvaluations.meetingId, evaluationArgs.meetingId))
        .limit(1),
    ]);
    return Boolean(
      meeting[0] &&
      sameInstant(
        meeting[0].updatedAt,
        evaluationArgs.expectedMeetingUpdatedAt
      ) &&
      !evaluation[0]
    );
  }

  const meetingId = typeof args.meetingId === "string" ? args.meetingId : null;
  if (!meetingId) return false;
  const meetingExpected =
    typeof args.expectedMeetingUpdatedAt === "string"
      ? args.expectedMeetingUpdatedAt
      : typeof args.expectedUpdatedAt === "string" &&
          (exportName === "deleteMeetingAction" ||
            exportName === "updateMeetingAction" ||
            exportName === "updateMeetingStatusAction" ||
            exportName === "saveAgendaAction")
        ? args.expectedUpdatedAt
        : null;
  if (meetingExpected) {
    const [meeting] = await db
      .select({ updatedAt: churchMeetings.updatedAt })
      .from(churchMeetings)
      .where(
        and(
          eq(churchMeetings.id, meetingId),
          eq(churchMeetings.churchId, plantId)
        )
      )
      .limit(1);
    if (!meeting || !sameInstant(meeting.updatedAt, meetingExpected)) {
      return false;
    }
  }

  const cancelling = args.pendingNotifications ?? [];
  if (
    args.pendingNotifications !== undefined &&
    !(await pendingNotificationsAreCurrent({
      plantId,
      meetingId,
      pending: args.pendingNotifications,
    }))
  ) {
    return false;
  }
  if (
    args.notificationTargets !== undefined &&
    !(await notificationTargetsRemainAbsent({
      plantId,
      targets: args.notificationTargets,
      cancelling,
    }))
  ) {
    return false;
  }

  if (
    typeof args.personId === "string" &&
    typeof args.expectedPersonUpdatedAt === "string"
  ) {
    const [person] = await db
      .select({ updatedAt: persons.updatedAt })
      .from(persons)
      .where(
        and(
          eq(persons.id, args.personId),
          eq(persons.churchId, plantId),
          sql`${persons.deletedAt} is null`
        )
      )
      .limit(1);
    if (
      !person ||
      !sameInstant(person.updatedAt, args.expectedPersonUpdatedAt)
    ) {
      return false;
    }
  }
  if (
    typeof args.personId === "string" &&
    args.expectedAttendanceAbsent === true &&
    typeof args.attendanceId === "string"
  ) {
    const rows = await db
      .select({ id: meetingAttendance.id })
      .from(meetingAttendance)
      .where(
        sql`(${meetingAttendance.id} = ${args.attendanceId}::uuid)
          or (${meetingAttendance.meetingId} = ${meetingId}::uuid
            and ${meetingAttendance.personId} = ${args.personId}::uuid)`
      );
    if (rows.length > 0) return false;
  }
  if (typeof args.personId === "string" && args.expectedPersonAbsent === true) {
    const [person] = await db
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.id, args.personId))
      .limit(1);
    if (person) return false;
  }

  if (typeof args.itemId === "string") {
    const [item] = await db
      .select({ updatedAt: meetingChecklistItems.updatedAt })
      .from(meetingChecklistItems)
      .where(
        and(
          eq(meetingChecklistItems.id, args.itemId),
          eq(meetingChecklistItems.meetingId, meetingId),
          eq(meetingChecklistItems.churchId, plantId)
        )
      )
      .limit(1);
    return Boolean(
      item &&
      typeof args.expectedUpdatedAt === "string" &&
      sameInstant(item.updatedAt, args.expectedUpdatedAt)
    );
  }
  if (
    typeof args.personId === "string" &&
    typeof args.expectedAttendanceUpdatedAt === "string"
  ) {
    const [attendance] = await db
      .select()
      .from(meetingAttendance)
      .where(
        and(
          eq(meetingAttendance.meetingId, meetingId),
          eq(meetingAttendance.personId, args.personId),
          eq(meetingAttendance.churchId, plantId)
        )
      )
      .limit(1);
    if (
      !attendance ||
      !sameInstant(attendance.updatedAt, args.expectedAttendanceUpdatedAt)
    ) {
      return false;
    }
    if (
      args.beforeAttendance &&
      typeof args.beforeAttendance === "object" &&
      !Array.isArray(args.beforeAttendance)
    ) {
      const before = args.beforeAttendance as Record<string, unknown>;
      if (
        attendance.id !== before.id ||
        attendance.status !== before.status ||
        attendance.attendanceType !== before.attendanceType ||
        attendance.responseStatus !== before.responseStatus ||
        attendance.notes !== before.notes
      ) {
        return false;
      }
    }
  }
  if (
    typeof args.personId === "string" &&
    exportName === "addAttendeeNoteAction"
  ) {
    const [person] = await db
      .select({ updatedAt: persons.updatedAt })
      .from(persons)
      .where(
        and(
          eq(persons.id, args.personId),
          eq(persons.churchId, plantId),
          sql`${persons.deletedAt} is null`
        )
      )
      .limit(1);
    return Boolean(
      person &&
      typeof args.expectedPersonUpdatedAt === "string" &&
      sameInstant(person.updatedAt, args.expectedPersonUpdatedAt)
    );
  }
  if (
    typeof args.responseId === "string" &&
    exportName === "clearResponseCardAction"
  ) {
    const [response] = await db
      .select()
      .from(meetingResponses)
      .where(
        and(
          eq(meetingResponses.id, args.responseId),
          eq(meetingResponses.meetingId, meetingId),
          eq(meetingResponses.churchId, plantId)
        )
      )
      .limit(1);
    const before =
      args.beforeResponse &&
      typeof args.beforeResponse === "object" &&
      !Array.isArray(args.beforeResponse)
        ? (args.beforeResponse as Record<string, unknown>)
        : null;
    return Boolean(
      response &&
      before &&
      response.responseType === before.responseType &&
      response.notes === before.notes &&
      response.recordedById === before.recordedById &&
      typeof before.updatedAt === "string" &&
      sameInstant(response.updatedAt, before.updatedAt)
    );
  }

  if (exportName === "deleteMeetingAction") {
    const deletion = MEETINGS_EFFECT_ARGUMENT_SCHEMAS.deleteMeetingAction.parse(
      input.step.arguments
    );
    const [attendance, checklist, responses, evaluations, invitationRows] =
      await Promise.all([
        db
          .select({ id: meetingAttendance.id })
          .from(meetingAttendance)
          .where(
            and(
              eq(meetingAttendance.churchId, plantId),
              eq(meetingAttendance.meetingId, meetingId)
            )
          ),
        db
          .select({ id: meetingChecklistItems.id })
          .from(meetingChecklistItems)
          .where(
            and(
              eq(meetingChecklistItems.churchId, plantId),
              eq(meetingChecklistItems.meetingId, meetingId)
            )
          ),
        db
          .select({ id: meetingResponses.id })
          .from(meetingResponses)
          .where(
            and(
              eq(meetingResponses.churchId, plantId),
              eq(meetingResponses.meetingId, meetingId)
            )
          ),
        db
          .select({ id: meetingEvaluations.id })
          .from(meetingEvaluations)
          .where(
            and(
              eq(meetingEvaluations.churchId, plantId),
              eq(meetingEvaluations.meetingId, meetingId)
            )
          ),
        db
          .select({ id: invitations.id })
          .from(invitations)
          .where(
            and(
              eq(invitations.churchId, plantId),
              eq(invitations.meetingId, meetingId)
            )
          ),
      ]);
    return (
      sameStrings(
        attendance.map(({ id }) => id),
        deletion.expectedAttendanceIds
      ) &&
      sameStrings(
        checklist.map(({ id }) => id),
        deletion.expectedChecklistItemIds
      ) &&
      sameStrings(
        responses.map(({ id }) => id),
        deletion.expectedResponseIds
      ) &&
      sameStrings(
        invitationRows.map(({ id }) => id),
        deletion.expectedInvitationIds
      ) &&
      sameNullable(evaluations[0]?.id ?? null, deletion.expectedEvaluationId)
    );
  }

  if (exportName === "recordAttendanceBatchAction") {
    const batch =
      MEETINGS_EFFECT_ARGUMENT_SCHEMAS.recordAttendanceBatchAction.parse(
        input.step.arguments
      );
    for (const record of batch.records) {
      const [attendance] = await db
        .select()
        .from(meetingAttendance)
        .where(
          and(
            eq(meetingAttendance.churchId, plantId),
            eq(meetingAttendance.meetingId, meetingId),
            eq(meetingAttendance.personId, record.personId)
          )
        )
        .limit(1);
      if (
        record.before.exists !== Boolean(attendance) ||
        (attendance &&
          (record.before.id !== attendance.id ||
            record.before.status !== attendance.status ||
            record.before.attendanceType !== attendance.attendanceType ||
            record.before.responseStatus !== attendance.responseStatus ||
            record.before.notes !== attendance.notes ||
            !record.before.updatedAt ||
            !sameInstant(attendance.updatedAt, record.before.updatedAt)))
      ) {
        return false;
      }
    }
  }

  if (exportName === "finalizeAttendanceAction") {
    const finalization =
      MEETINGS_EFFECT_ARGUMENT_SCHEMAS.finalizeAttendanceAction.parse(
        input.step.arguments
      );
    const [attended, church] = await Promise.all([
      db
        .select({
          attendanceId: meetingAttendance.id,
          personId: meetingAttendance.personId,
          attendanceType: meetingAttendance.attendanceType,
          expectedUpdatedAt: meetingAttendance.updatedAt,
        })
        .from(meetingAttendance)
        .where(
          and(
            eq(meetingAttendance.churchId, plantId),
            eq(meetingAttendance.meetingId, meetingId),
            eq(meetingAttendance.status, "attended")
          )
        ),
      db
        .select({ lastMaterialEventAt: churches.lastMaterialEventAt })
        .from(churches)
        .where(eq(churches.id, plantId))
        .limit(1),
    ]);
    if (
      !sameStrings(
        attended.map((row) =>
          JSON.stringify({
            ...row,
            expectedUpdatedAt: row.expectedUpdatedAt.toISOString(),
          })
        ),
        finalization.attendees.map((row) => JSON.stringify(row))
      ) ||
      (church[0]?.lastMaterialEventAt?.toISOString() ?? null) !==
        finalization.expectedChurchMaterialEventAt
    ) {
      return false;
    }
    for (const change of finalization.personStatusChanges) {
      const [person] = await db
        .select({ status: persons.status, updatedAt: persons.updatedAt })
        .from(persons)
        .where(
          and(
            eq(persons.id, change.personId),
            eq(persons.churchId, plantId),
            isNull(persons.deletedAt)
          )
        )
        .limit(1);
      if (
        !person ||
        person.status !== change.beforeStatus ||
        !sameInstant(person.updatedAt, change.expectedUpdatedAt)
      ) {
        return false;
      }
    }
    for (const target of [
      ...finalization.followUpTaskTargets,
      ...(finalization.evaluationTaskTarget
        ? [finalization.evaluationTaskTarget]
        : []),
    ]) {
      const [task] = await db
        .select({ status: tasks.status, updatedAt: tasks.updatedAt })
        .from(tasks)
        .where(
          and(
            eq(tasks.id, target.taskId),
            eq(tasks.churchId, plantId),
            isNull(tasks.deletedAt)
          )
        )
        .limit(1);
      if (
        (target.expectedTaskAbsent && task) ||
        (!target.expectedTaskAbsent &&
          (!task ||
            task.status !== target.beforeStatus ||
            !target.expectedUpdatedAt ||
            !sameInstant(task.updatedAt, target.expectedUpdatedAt)))
      ) {
        return false;
      }
    }
  }
  return true;
}
