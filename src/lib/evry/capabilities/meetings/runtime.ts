import { and, eq, inArray, isNull, sql } from "drizzle-orm";

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
  notifications,
  personActivities,
  persons,
  tasks,
  users,
} from "@/db/schema";
import {
  trustedReviewForEvryPlanDocument,
  type EvryArtifactReviewRegistry,
} from "@/lib/evry/artifacts/trusted-plan-review";
import {
  evryConversationPlanIdentitySchema,
  type EvryConversationPlanIdentity,
} from "@/lib/evry/conversations/contract";
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
  parseStoredEvryActionPlan,
  type EvryActionStep,
  type EvryPlanRequestKey,
} from "@/lib/evry/plans";
import { validateStoredEvryActionPlan } from "@/lib/evry/plans/integrity";
import {
  createEvryActionPlanRecord,
  findEvryActionPlanByRequestKey,
  type StoredEvryActionPlan,
} from "@/lib/evry/plans/repository";
import { defineEvryPlanCapability } from "@/lib/evry/plans/registry";

import {
  MEETINGS_ACTION_CONTRACTS,
  type MeetingsActionExport,
} from "./catalog";
import { MEETINGS_EFFECT_ARGUMENT_SCHEMAS } from "./effect-contracts";
import type { MeetingsEffectArguments } from "./effect-contracts";
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

export type MeetingsEvryEffectProposal = Readonly<{
  plan: EvryConversationPlanIdentity;
  confirmation: NonNullable<
    ReturnType<typeof trustedReviewForEvryPlanDocument>
  >["confirmation"];
}>;

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
}): Promise<MeetingsEvryEffectProposal | null> {
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
  // Capability identities are already stable, lowercase semantic IDs that
  // satisfy the durable outcome ledger's step-id contract. JavaScript export
  // names are implementation details and include uppercase characters.
  const stepId = contract.operationId;
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

/**
 * Recover a request-bound immutable Meetings plan before any mutable resolver
 * or source read runs. A scoped row that cannot be reparsed is an integrity
 * failure, not permission to derive different work for the same request key.
 */
export async function recoverMeetingsEvryEffectProposal(input: {
  actor: EvryPlantActor;
  expectedExportName: MeetingsActionExport;
  requestKey: EvryPlanRequestKey;
  findPlan?: typeof findEvryActionPlanByRequestKey;
}): Promise<MeetingsEvryEffectProposal | null> {
  const stored = await (input.findPlan ?? findEvryActionPlanByRequestKey)({
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    requestKey: input.requestKey,
  });
  if (!stored) return null;
  return proposalFromStoredMeetingsPlan(
    stored,
    MEETINGS_ACTION_CONTRACTS[input.expectedExportName].operationId
  );
}

function proposalFromStoredMeetingsPlan(
  stored: StoredEvryActionPlan,
  expectedIdentity: string
): MeetingsEvryEffectProposal {
  if (!validateStoredEvryActionPlan(stored, MEETINGS_PLAN_REGISTRY)) {
    throw new Error("Stored Meetings plan failed its integrity check");
  }
  const document = parseStoredEvryActionPlan({
    document: stored.document,
    registry: MEETINGS_PLAN_REGISTRY,
  });
  const step = document.steps[0];
  if (
    document.steps.length !== 1 ||
    !step ||
    !EXPORT_BY_IDENTITY.has(step.capabilityIdentity) ||
    step.capabilityIdentity !== expectedIdentity
  ) {
    throw new Error("Stored Meetings plan does not match the selected effect");
  }
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: stored.id,
    fingerprint: stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: MEETINGS_REVIEW_REGISTRY,
  });
  if (!review) {
    throw new Error("Stored Meetings plan has no trusted confirmation");
  }
  return { plan, confirmation: review.confirmation };
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
      !("notificationId" in target) ||
      !("recipientUserId" in target) ||
      !("dedupeKey" in target) ||
      typeof target.notificationId !== "string" ||
      typeof target.recipientUserId !== "string" ||
      typeof target.dedupeKey !== "string"
    ) {
      return false;
    }
    const rows = await db.select({ id: notifications.id }).from(notifications)
      .where(sql`${notifications.id} = ${target.notificationId}::uuid or (
        ${notifications.churchId} = ${input.plantId}::uuid
        and ${notifications.recipientUserId} = ${target.recipientUserId}::uuid
        and ${notifications.dedupeKey} = ${target.dedupeKey}
        and ${notifications.status} <> 'cancelled'
      )`);
    if (
      rows.some(
        ({ id }) => id === target.notificationId || !cancelledIds.has(id)
      )
    )
      return false;
  }
  return true;
}

async function pendingTaskNotificationsAreCurrent(input: {
  plantId: string;
  taskId: string;
  pending: readonly Readonly<{
    notificationId: string;
    recipientUserId: string;
    type: string;
    entityId: string;
    dedupeKey: string;
    scheduledFor: string;
    beforeStatus: "pending";
    expectedUpdatedAt: string;
  }>[];
}): Promise<boolean> {
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
        eq(notifications.churchId, input.plantId),
        eq(notifications.category, "tasks"),
        eq(notifications.entityType, "task"),
        eq(notifications.entityId, input.taskId),
        eq(notifications.status, "pending")
      )
    );
  return sameStrings(
    rows.map((row) =>
      JSON.stringify({
        ...row,
        entityId: row.entityId ?? "",
        dedupeKey: row.dedupeKey ?? "",
        scheduledFor: row.scheduledFor.toISOString(),
        beforeStatus: "pending",
        expectedUpdatedAt: row.expectedUpdatedAt.toISOString(),
      })
    ),
    input.pending.map((row) => JSON.stringify(row))
  );
}

type NotificationBaseline =
  MeetingsEffectArguments<"createMeetingAction">["notificationBaseline"];

async function notificationBaselineIsCurrent(input: {
  actor: EvryPlantActor;
  exportName: MeetingsActionExport;
  meetingId: string;
  baseline: NotificationBaseline;
  args: Readonly<Record<string, unknown>>;
}): Promise<boolean> {
  const { plantId, userId } = input.actor;
  const coreRows = await db.execute<{ id: string }>(sql`
    select distinct u.id::text as id
    from persons p
    join users u on u.church_id = ${plantId}::uuid
      and lower(u.email) = lower(p.email)
    where p.church_id = ${plantId}::uuid
      and p.deleted_at is null and p.email is not null
      and p.status in ('core_group', 'launch_team', 'leader')
    order by id
  `);

  const create = input.exportName === "createMeetingAction";
  const addPerson =
    input.exportName === "addAttendeeAction" ||
    input.exportName === "addToGuestListAction" ||
    input.exportName === "addWalkInAttendeeAction";
  const removePerson =
    input.exportName === "removeAttendeeAction" ||
    input.exportName === "removeFromGuestListAction";
  const quickAdd =
    input.exportName === "quickAddAttendeeAction" ||
    input.exportName === "quickAddPersonToGuestListAction" ||
    input.exportName === "quickAddWalkInAction";
  const personId =
    typeof input.args.personId === "string" ? input.args.personId : null;
  const email = typeof input.args.email === "string" ? input.args.email : null;
  const rosterPersonIds = Array.isArray(input.args.resolvedTeamMemberIds)
    ? input.args.resolvedTeamMemberIds.filter(
        (value): value is string => typeof value === "string"
      )
    : [];
  const reminderRows = create
    ? await db.execute<{ id: string }>(sql`
        select ${userId}::uuid::text as id
        where exists (
          select 1 from users u
          where u.id = ${userId}::uuid and u.church_id = ${plantId}::uuid
        )
        union
        select distinct u.id::text
        from persons p
        join users u on u.church_id = ${plantId}::uuid
          and lower(u.email) = lower(p.email)
        where p.church_id = ${plantId}::uuid
          and p.id in (
            select value::uuid
            from jsonb_array_elements_text(${JSON.stringify(rosterPersonIds)}::jsonb) value
          )
          and p.deleted_at is null and p.email is not null
        order by id
      `)
    : await db.execute<{ id: string }>(sql`
        select distinct actual.id::text as id from (
          select m.created_by as id
          from church_meetings m
          where m.id = ${input.meetingId}::uuid
            and m.church_id = ${plantId}::uuid
          union
          select u.id
          from meeting_attendance a
          join persons p on p.id = a.person_id and p.church_id = a.church_id
          join users u on u.church_id = a.church_id
            and lower(u.email) = lower(p.email)
          where a.meeting_id = ${input.meetingId}::uuid
            and a.church_id = ${plantId}::uuid
            and p.deleted_at is null and p.email is not null
            and (${removePerson ? personId : null}::uuid is null
              or p.id <> ${removePerson ? personId : null}::uuid)
          union
          select u.id
          from persons p
          join users u on u.church_id = p.church_id
            and lower(u.email) = lower(p.email)
          where p.id = ${addPerson ? personId : null}::uuid
            and p.church_id = ${plantId}::uuid
            and p.deleted_at is null and p.email is not null
          union
          select u.id from users u
          where u.church_id = ${plantId}::uuid
            and ${quickAdd ? email : null}::text is not null
            and lower(u.email) = lower(${quickAdd ? email : null}::text)
        ) actual
        order by id
      `);

  const activeRows = await db
    .select({
      notificationId: notifications.id,
      recipientUserId: notifications.recipientUserId,
      type: notifications.type,
      entityId: notifications.entityId,
      dedupeKey: notifications.dedupeKey,
      scheduledFor: notifications.scheduledFor,
      status: notifications.status,
      expectedUpdatedAt: notifications.updatedAt,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.churchId, plantId),
        eq(notifications.category, "meetings"),
        eq(notifications.entityType, "meeting"),
        eq(notifications.entityId, input.meetingId),
        sql`${notifications.status} <> 'cancelled'`
      )
    );
  const active = activeRows.map((row) =>
    JSON.stringify({
      ...row,
      entityId: row.entityId ?? "",
      dedupeKey: row.dedupeKey ?? "",
      scheduledFor: row.scheduledFor.toISOString(),
      expectedUpdatedAt: row.expectedUpdatedAt.toISOString(),
    })
  );
  return (
    sameStrings(
      coreRows.rows.map(({ id }) => id),
      input.baseline.coreGroupUserIds
    ) &&
    sameStrings(
      reminderRows.rows.map(({ id }) => id),
      input.baseline.reminderUserIds
    ) &&
    sameStrings(
      active,
      input.baseline.activeNotifications.map((row) => JSON.stringify(row))
    )
  );
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
    const [
      meetings,
      checklist,
      attendance,
      savedLocation,
      existingLocation,
      teamRoster,
      rosterPeople,
    ] = await Promise.all([
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
      create.savedLocationId
        ? db
            .select({ id: locations.id })
            .from(locations)
            .where(eq(locations.id, create.savedLocationId))
            .limit(1)
        : Promise.resolve([]),
      create.locationId && !create.savedLocationId
        ? db
            .select({ id: locations.id })
            .from(locations)
            .where(
              and(
                eq(locations.id, create.locationId),
                eq(locations.churchId, plantId),
                eq(locations.isActive, true),
                eq(locations.name, create.locationName ?? ""),
                eq(locations.address, create.locationAddress ?? "")
              )
            )
            .limit(1)
        : Promise.resolve([]),
      create.teamId
        ? db
            .execute<{ id: string }>(
              sql`
            select tm.person_id::text as id
            from team_memberships tm
            join ministry_teams t on t.id = tm.team_id
              and t.church_id = tm.church_id
            join persons p on p.id = tm.person_id
              and p.church_id = tm.church_id
            where tm.team_id = ${create.teamId}::uuid
              and tm.church_id = ${plantId}::uuid
              and tm.status = 'active' and p.deleted_at is null
            order by id
          `
            )
            .then(({ rows }) => rows)
        : Promise.resolve([]),
      create.attendanceRows.length > 0
        ? db
            .select({ id: persons.id, updatedAt: persons.updatedAt })
            .from(persons)
            .where(
              and(
                eq(persons.churchId, plantId),
                inArray(
                  persons.id,
                  create.attendanceRows.map(({ personId }) => personId)
                ),
                isNull(persons.deletedAt)
              )
            )
        : Promise.resolve([]),
    ]);
    const personById = new Map(
      rosterPeople.map((person) => [person.id, person.updatedAt])
    );
    const locationCurrent = create.locationId
      ? create.savedLocationId
        ? create.savedLocationId === create.locationId &&
          create.locationName !== null &&
          create.locationAddress !== null
        : existingLocation.length === 1
      : create.savedLocationId === null &&
        create.locationName === null &&
        create.locationAddress === null;
    return (
      meetings.length === 0 &&
      checklist.length === 0 &&
      attendance.length === 0 &&
      savedLocation.length === 0 &&
      locationCurrent &&
      sameStrings(
        teamRoster.map(({ id }) => id),
        create.resolvedTeamMemberIds
      ) &&
      create.attendanceRows.every(({ personId, expectedPersonUpdatedAt }) => {
        const updatedAt = personById.get(personId);
        return Boolean(
          updatedAt && sameInstant(updatedAt, expectedPersonUpdatedAt)
        );
      }) &&
      (await notificationBaselineIsCurrent({
        actor: input.actor,
        exportName,
        meetingId: create.meetingId,
        baseline: create.notificationBaseline,
        args: create,
      })) &&
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
    const [meeting, evaluation, evaluationTasks] = await Promise.all([
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
      db
        .select({
          id: tasks.id,
          churchId: tasks.churchId,
          title: tasks.title,
          status: tasks.status,
          completionEvent: tasks.completionEvent,
          relatedType: tasks.relatedType,
          relatedId: tasks.relatedId,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .where(
          and(
            eq(tasks.churchId, plantId),
            eq(tasks.completionEvent, "meeting.evaluation.completed"),
            eq(tasks.relatedType, "meeting"),
            eq(tasks.relatedId, evaluationArgs.meetingId),
            isNull(tasks.deletedAt)
          )
        ),
    ]);
    const expectedTask = evaluationArgs.evaluationTask;
    const taskCurrent = expectedTask
      ? evaluationTasks.length === 1 &&
        evaluationTasks[0]?.id === expectedTask.taskId &&
        evaluationTasks[0].title === expectedTask.title &&
        evaluationTasks[0].status === expectedTask.beforeStatus &&
        evaluationTasks[0].completionEvent === "meeting.evaluation.completed" &&
        evaluationTasks[0].relatedType === "meeting" &&
        evaluationTasks[0].relatedId === evaluationArgs.meetingId &&
        sameInstant(
          evaluationTasks[0].updatedAt,
          expectedTask.expectedUpdatedAt
        )
      : evaluationTasks.every(({ status }) => status === "complete");
    return Boolean(
      meeting[0] &&
      sameInstant(
        meeting[0].updatedAt,
        evaluationArgs.expectedMeetingUpdatedAt
      ) &&
      !evaluation[0] &&
      taskCurrent
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
    args.notificationBaseline !== undefined &&
    !(await notificationBaselineIsCurrent({
      actor: input.actor,
      exportName,
      meetingId,
      baseline: args.notificationBaseline as NotificationBaseline,
      args,
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
    const [
      attendance,
      checklist,
      responses,
      evaluations,
      invitationRows,
      confirmationTokenRows,
    ] = await Promise.all([
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
      db
        .select({ id: meetingConfirmationTokens.id })
        .from(meetingConfirmationTokens)
        .where(
          and(
            eq(meetingConfirmationTokens.churchId, plantId),
            eq(meetingConfirmationTokens.meetingId, meetingId)
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
      sameStrings(
        confirmationTokenRows.map(({ id }) => id),
        deletion.expectedConfirmationTokenIds
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
    const [attended, church, meeting] = await Promise.all([
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
      db
        .select({
          type: churchMeetings.type,
          title: churchMeetings.title,
          datetime: churchMeetings.datetime,
          actualAttendance: churchMeetings.actualAttendance,
        })
        .from(churchMeetings)
        .where(
          and(
            eq(churchMeetings.id, meetingId),
            eq(churchMeetings.churchId, plantId)
          )
        )
        .limit(1),
    ]);
    if (
      !meeting[0] ||
      meeting[0].type !== finalization.meetingType ||
      meeting[0].title !== finalization.meetingTitle ||
      !sameInstant(meeting[0].datetime, finalization.meetingDatetime) ||
      meeting[0].actualAttendance !== finalization.expectedActualAttendance ||
      (finalization.meetingType === "vision_meeting") !==
        (finalization.evaluationTaskTarget !== null) ||
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
    const firstTimePeople =
      finalization.meetingType === "vision_meeting"
        ? finalization.attendees
            .filter(({ attendanceType }) => attendanceType === "first_time")
            .map(({ personId }) => personId)
        : [];
    if (
      !sameStrings(
        firstTimePeople,
        finalization.followUpTaskTargets.map(({ personId }) => personId)
      ) ||
      finalization.personStatusChanges.some(
        ({ performedById }) => performedById !== input.actor.userId
      )
    ) {
      return false;
    }
    for (const change of finalization.personStatusChanges) {
      const [[person], [activity]] = await Promise.all([
        db
          .select({ status: persons.status, updatedAt: persons.updatedAt })
          .from(persons)
          .where(
            and(
              eq(persons.id, change.personId),
              eq(persons.churchId, plantId),
              isNull(persons.deletedAt)
            )
          )
          .limit(1),
        db
          .select({ id: personActivities.id })
          .from(personActivities)
          .where(eq(personActivities.id, change.activityId))
          .limit(1),
      ]);
      if (
        !person ||
        activity ||
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
      const taskRows = await db
        .select({
          id: tasks.id,
          churchId: tasks.churchId,
          title: tasks.title,
          status: tasks.status,
          priority: tasks.priority,
          category: tasks.category,
          dueDate: tasks.dueDate,
          assignedToId: tasks.assignedToId,
          relatedType: tasks.relatedType,
          relatedId: tasks.relatedId,
          completionEvent: tasks.completionEvent,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .where(
          sql`${tasks.id} = ${target.taskId}::uuid or (
            ${tasks.churchId} = ${plantId}::uuid
            and ${tasks.category} = ${"personId" in target ? "follow_up" : "vision_meeting"}
            and ${tasks.relatedType} = ${"personId" in target ? "person" : "meeting"}
            and ${tasks.relatedId} = ${"personId" in target ? target.personId : meetingId}::uuid
            and ${tasks.dueDate} = ${target.dueDate}::date
            and ${tasks.deletedAt} is null
          )`
        );
      const task = taskRows.find(({ id }) => id === target.taskId);
      const exactTask = Boolean(
        task &&
        taskRows.length === 1 &&
        task.churchId === plantId &&
        task.title === target.title &&
        task.status === target.beforeStatus &&
        task.priority === "high" &&
        task.category ===
          ("personId" in target ? "follow_up" : "vision_meeting") &&
        task.dueDate === target.dueDate &&
        task.assignedToId === target.assignedToId &&
        task.relatedType === ("personId" in target ? "person" : "meeting") &&
        task.relatedId ===
          ("personId" in target ? target.personId : meetingId) &&
        ("personId" in target ||
          task.completionEvent === "meeting.evaluation.completed") &&
        target.expectedUpdatedAt &&
        sameInstant(task.updatedAt, target.expectedUpdatedAt)
      );
      const [assignee] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, target.assignedToId),
            eq(users.churchId, plantId),
            eq(users.seat, "owner")
          )
        )
        .limit(1);
      if (
        !assignee ||
        (target.expectedTaskAbsent && taskRows.length > 0) ||
        (!target.expectedTaskAbsent && !exactTask)
      ) {
        return false;
      }
      const pending =
        "pendingNotifications" in target ? target.pendingNotifications : [];
      if (
        !(await pendingTaskNotificationsAreCurrent({
          plantId,
          taskId: target.taskId,
          pending,
        })) ||
        !(await notificationTargetsRemainAbsent({
          plantId,
          targets: target.notificationTargets,
          cancelling: pending,
        }))
      ) {
        return false;
      }
    }
  }
  return true;
}
