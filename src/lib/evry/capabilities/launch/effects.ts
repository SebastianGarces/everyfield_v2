import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  launchMilestones,
  launchMilestoneTasks,
  taskCategories,
  taskRelatedTypes,
  taskStatuses,
  tasks,
  users,
} from "@/db/schema";
import { buildEvryConfirmationArtifact } from "@/lib/evry/artifacts/review";
import {
  assertEvryPlanDocumentReviewable,
  createEvryArtifactReviewRegistry,
  defineEvryArtifactReview,
  trustedReviewForEvryPlanDocument,
} from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import {
  authorizeEvryEffectCapability,
  eligibleEvryCapabilitiesFor,
  evryActorHoldsApplicationCapability,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  createEvryExecutionCapabilityRegistry,
  defineEvryExecutionCapability,
  type EvryEffectInput,
} from "@/lib/evry/executor";
import {
  claimEvryDatabaseEffect,
  claimEvryDatabaseEffectDecision,
} from "@/lib/evry/executor/database-effect";
import {
  parseEvryActionPlanCandidate,
  type EvryPlanRequestKey,
} from "@/lib/evry/plans";
import { createEvryActionPlanRecord } from "@/lib/evry/plans/repository";
import { defineEvryPlanCapability } from "@/lib/evry/plans/registry";
import {
  completeLaunchMilestoneStatement,
  getLaunchReadiness,
  LAUNCH_MILESTONE_TEMPLATES,
  reopenLaunchMilestoneStatement,
  seedLaunchMilestones,
} from "@/lib/launch/milestones";
import {
  canEditOutcome,
  canRecordOutcome,
  reconcileLaunchOutcomeAfterWrite,
  recordLaunchOutcomeEffectMutation,
  updateLaunchOutcomeEffectMutation,
} from "@/lib/launch/outcome";
import { getLaunchForChurch, type LaunchRecord } from "@/lib/launch/queries";
import {
  launchNoteSchema,
  launchTargetDateSchema,
} from "@/lib/launch/validation";
import {
  reconcileLaunchDateChangedAfterWrite,
  setLaunchDateEffectMutation,
} from "@/lib/launch/service";
import {
  completeTaskStatement,
  reconcileNonRecurringCompletedTaskAfterWrite,
  reconcileReopenedTaskAfterWrite,
  reopenTaskStatement,
} from "@/lib/tasks/service";

export const LAUNCH_EFFECT_IDENTITIES = {
  schedule: "launch.schedule",
  completeMilestone: "launch.milestone.complete",
  reopenMilestone: "launch.milestone.reopen",
  setTaskCompletion: "launch.task.set-completion",
  recordOutcome: "launch.outcome.record",
  correctOutcome: "launch.outcome.correct",
} as const;

const launchStatusSchema = z.enum([
  "planning",
  "scheduled",
  "postponed",
  "completed",
]);
export const launchSnapshotSchema = z.strictObject({
  id: z.string().uuid(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  status: launchStatusSchema,
  outcomeRecordedAt: z.string().datetime().nullable(),
  attendanceCount: z.number().int().min(0).max(1_000_000).nullable(),
  decisionsCount: z.number().int().min(0).max(1_000_000).nullable(),
  outcomeNotes: z.string().max(10_000).nullable(),
  captureTheDay: z.string().max(10_000).nullable(),
  updatedAt: z.string().datetime(),
});
const nullableLaunchSnapshotSchema = launchSnapshotSchema.nullable();
export const launchMilestoneSnapshotSchema = z.strictObject({
  id: z.string().uuid(),
  launchId: z.string().uuid(),
  title: z.string().min(1).max(500),
  completedAt: z.string().datetime().nullable(),
  openTaskCount: z.number().int().min(0),
  updatedAt: z.string().datetime(),
});
export const launchTaskSnapshotSchema = z.strictObject({
  id: z.string().uuid(),
  milestoneId: z.string().uuid(),
  title: z.string().min(1).max(500),
  status: z.enum(taskStatuses),
  assignedToId: z.string().uuid().nullable(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  dueTime: z
    .string()
    .regex(/^\d{2}:\d{2}:\d{2}$/)
    .nullable(),
  category: z.enum(taskCategories).nullable(),
  relatedType: z.enum(taskRelatedTypes).nullable(),
  relatedId: z.string().uuid().nullable(),
  isRecurring: z.boolean(),
  updatedAt: z.string().datetime(),
});
const outcomeShape = {
  attendanceCount: z.number().int().min(0).max(1_000_000).nullable(),
  decisionsCount: z.number().int().min(0).max(1_000_000).nullable(),
  // The literal conversation request is capped at 8,000 bytes. Keeping each
  // field at 3,000 makes every accepted pair reachable through that boundary.
  outcomeNotes: z.string().max(3_000).nullable(),
  captureTheDay: z.string().max(3_000).nullable(),
} as const;

export const launchScheduleArgumentsSchema = z.strictObject({
  expected: nullableLaunchSnapshotSchema,
  targetDate: launchTargetDateSchema,
  postpone: z.boolean(),
  note: launchNoteSchema,
});
export const launchMilestoneArgumentsSchema = z.strictObject({
  expected: launchMilestoneSnapshotSchema,
});
export const launchTaskArgumentsSchema = z.strictObject({
  expected: launchTaskSnapshotSchema,
  complete: z.boolean(),
});
export const launchOutcomeArgumentsSchema = z.strictObject({
  expected: launchSnapshotSchema,
  outcome: z.strictObject(outcomeShape),
});

const PLAN_BY_IDENTITY = {
  [LAUNCH_EFFECT_IDENTITIES.schedule]: defineEvryPlanCapability({
    identity: LAUNCH_EFFECT_IDENTITIES.schedule,
    effectClass: "database_write",
    arguments: launchScheduleArgumentsSchema.shape,
  }),
  [LAUNCH_EFFECT_IDENTITIES.completeMilestone]: defineEvryPlanCapability({
    identity: LAUNCH_EFFECT_IDENTITIES.completeMilestone,
    effectClass: "database_write",
    arguments: launchMilestoneArgumentsSchema.shape,
  }),
  [LAUNCH_EFFECT_IDENTITIES.reopenMilestone]: defineEvryPlanCapability({
    identity: LAUNCH_EFFECT_IDENTITIES.reopenMilestone,
    effectClass: "database_write",
    arguments: launchMilestoneArgumentsSchema.shape,
  }),
  [LAUNCH_EFFECT_IDENTITIES.setTaskCompletion]: defineEvryPlanCapability({
    identity: LAUNCH_EFFECT_IDENTITIES.setTaskCompletion,
    effectClass: "database_write",
    arguments: launchTaskArgumentsSchema.shape,
  }),
  [LAUNCH_EFFECT_IDENTITIES.recordOutcome]: defineEvryPlanCapability({
    identity: LAUNCH_EFFECT_IDENTITIES.recordOutcome,
    effectClass: "database_write",
    arguments: launchOutcomeArgumentsSchema.shape,
  }),
  [LAUNCH_EFFECT_IDENTITIES.correctOutcome]: defineEvryPlanCapability({
    identity: LAUNCH_EFFECT_IDENTITIES.correctOutcome,
    effectClass: "database_write",
    arguments: launchOutcomeArgumentsSchema.shape,
  }),
} as const;

export type LaunchEvryEffectSelection =
  | Readonly<{
      kind: "schedule";
      targetDate: string;
      postpone: boolean;
      note: string | null;
    }>
  | Readonly<{
      kind: "complete_milestone" | "reopen_milestone";
      milestoneId: string;
    }>
  | Readonly<{ kind: "set_task_completion"; taskId: string; complete: boolean }>
  | Readonly<{
      kind: "record_outcome" | "correct_outcome";
      outcome: z.infer<typeof launchOutcomeArgumentsSchema>["outcome"];
    }>;

const UUID =
  "([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})";

function splitOutcomeFields(text: string): string[] | null {
  const fields: string[] = [];
  let current = "";
  let escaped = false;
  for (const character of text) {
    if (escaped) {
      if (character !== "|" && character !== "\\") return null;
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      fields.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped) return null;
  fields.push(current);
  return fields;
}

function parsedOutcome(text: string) {
  const prefix = /^\s*(record|correct) launch outcome\s*\|/i.exec(text);
  if (!prefix) return null;
  const fields = new Map<string, string>();
  const literalFields = splitOutcomeFields(text.slice(prefix[0].length));
  if (!literalFields) return null;
  for (const raw of literalFields) {
    // Whitespace before a field name and around `=` is command syntax. Every
    // code unit after `=` is user content and must survive selection, review,
    // execution, and replay unchanged. In particular, do not NFKC-normalize or
    // trim notes/capture text here.
    const field = /^\s*([a-z]+)\s*=([\s\S]*)$/i.exec(raw);
    if (!field?.[1] || field[2] === undefined) return null;
    const key = field[1].toLowerCase();
    if (fields.has(key)) return null;
    fields.set(key, field[2]);
  }
  if (
    [...fields.keys()].some(
      (key) => !["attendance", "decisions", "notes", "capture"].includes(key)
    )
  )
    return null;
  const count = (key: string) => {
    const value = fields.get(key);
    if (value === undefined || value.trim().toLowerCase() === "null")
      return null;
    return /^\d{1,7}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  };
  const attendanceCount = count("attendance");
  const decisionsCount = count("decisions");
  const parsed = z.strictObject(outcomeShape).safeParse({
    attendanceCount,
    decisionsCount,
    outcomeNotes:
      fields.get("notes") === undefined ||
      fields.get("notes")?.trim().toLowerCase() === "null"
        ? null
        : fields.get("notes"),
    captureTheDay:
      fields.get("capture") === undefined ||
      fields.get("capture")?.trim().toLowerCase() === "null"
        ? null
        : fields.get("capture"),
  });
  return parsed.success
    ? {
        kind:
          prefix[1]?.toLowerCase() === "record"
            ? ("record_outcome" as const)
            : ("correct_outcome" as const),
        outcome: parsed.data,
      }
    : null;
}

export function selectLaunchEvryEffect(
  literalUserText: string
): LaunchEvryEffectSelection | null {
  const text = literalUserText;
  const scheduleWithNote =
    /^\s*(schedule|postpone) launch (?:for|to) (\d{4}-\d{2}-\d{2})\s*\|([\s\S]{1,2000})$/i.exec(
      text
    );
  const scheduleWithoutNote =
    /^\s*(schedule|postpone) launch (?:for|to) (\d{4}-\d{2}-\d{2})[.!?]*\s*$/i.exec(
      text
    );
  const schedule = scheduleWithNote ?? scheduleWithoutNote;
  const targetDate = schedule?.[2]
    ? launchTargetDateSchema.safeParse(schedule[2])
    : null;
  if (targetDate?.success)
    return {
      kind: "schedule",
      targetDate: targetDate.data,
      postpone: schedule?.[1]?.toLowerCase() === "postpone",
      note: scheduleWithNote?.[3] ?? null,
    };
  const complete = new RegExp(
    `^complete launch milestone ${UUID}[.!?]*$`,
    "i"
  ).exec(text.trim());
  if (complete?.[1])
    return { kind: "complete_milestone", milestoneId: complete[1] };
  const reopen = new RegExp(
    `^reopen launch milestone ${UUID}[.!?]*$`,
    "i"
  ).exec(text.trim());
  if (reopen?.[1]) return { kind: "reopen_milestone", milestoneId: reopen[1] };
  const task = new RegExp(
    `^mark launch task ${UUID} (complete|open)[.!?]*$`,
    "i"
  ).exec(text.trim());
  if (task?.[1] && task[2])
    return {
      kind: "set_task_completion",
      taskId: task[1],
      complete: task[2].toLowerCase() === "complete",
    };
  return parsedOutcome(text);
}

function launchSnapshot(launch: LaunchRecord) {
  return launchSnapshotSchema.parse({
    id: launch.id,
    targetDate: launch.targetDate,
    status: launch.status,
    outcomeRecordedAt: launch.outcomeRecordedAt?.toISOString() ?? null,
    attendanceCount: launch.attendanceCount,
    decisionsCount: launch.decisionsCount,
    outcomeNotes: launch.outcomeNotes,
    captureTheDay: launch.captureTheDay,
    updatedAt: launch.updatedAt.toISOString(),
  });
}

async function milestoneSnapshot(plantId: string, milestoneId: string) {
  const [row] = await db
    .select({
      id: launchMilestones.id,
      launchId: launchMilestones.launchId,
      title: launchMilestones.title,
      completedAt: launchMilestones.completedAt,
      updatedAt: launchMilestones.updatedAt,
    })
    .from(launchMilestones)
    .where(
      and(
        eq(launchMilestones.id, milestoneId),
        eq(launchMilestones.churchId, plantId)
      )
    )
    .limit(1);
  if (!row) return null;
  const readiness = await getLaunchReadiness(row.launchId, plantId);
  const view = readiness.milestones.find(({ id }) => id === row.id);
  if (!view) return null;
  return launchMilestoneSnapshotSchema.parse({
    ...row,
    completedAt: row.completedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    openTaskCount: view.openTaskCount,
  });
}

async function taskSnapshot(plantId: string, taskId: string) {
  const [row] = await db
    .select({
      id: tasks.id,
      milestoneId: launchMilestoneTasks.milestoneId,
      title: tasks.title,
      status: tasks.status,
      assignedToId: tasks.assignedToId,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
      category: tasks.category,
      relatedType: tasks.relatedType,
      relatedId: tasks.relatedId,
      isRecurring: tasks.isRecurring,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .innerJoin(
      launchMilestoneTasks,
      and(
        eq(launchMilestoneTasks.taskId, tasks.id),
        eq(launchMilestoneTasks.churchId, plantId)
      )
    )
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.churchId, plantId),
        isNull(tasks.deletedAt)
      )
    )
    .limit(1);
  return row
    ? launchTaskSnapshotSchema.parse({
        ...row,
        updatedAt: row.updatedAt.toISOString(),
      })
    : null;
}

function identityFor(selection: LaunchEvryEffectSelection) {
  switch (selection.kind) {
    case "schedule":
      return LAUNCH_EFFECT_IDENTITIES.schedule;
    case "complete_milestone":
      return LAUNCH_EFFECT_IDENTITIES.completeMilestone;
    case "reopen_milestone":
      return LAUNCH_EFFECT_IDENTITIES.reopenMilestone;
    case "set_task_completion":
      return LAUNCH_EFFECT_IDENTITIES.setTaskCompletion;
    case "record_outcome":
      return LAUNCH_EFFECT_IDENTITIES.recordOutcome;
    case "correct_outcome":
      return LAUNCH_EFFECT_IDENTITIES.correctOutcome;
  }
}

export async function resolveLaunchEvryArguments(
  actor: Readonly<Pick<EvryPlantActor, "userId" | "plantId" | "seat">>,
  selection: LaunchEvryEffectSelection
) {
  const launch = await getLaunchForChurch(actor.plantId);
  switch (selection.kind) {
    case "schedule": {
      if (
        launch?.status === "completed" ||
        (selection.postpone && !launch?.targetDate) ||
        (launch?.targetDate === selection.targetDate &&
          launch.status === (selection.postpone ? "postponed" : "scheduled"))
      ) {
        return null;
      }
      return launchScheduleArgumentsSchema.parse({
        expected: launch ? launchSnapshot(launch) : null,
        targetDate: selection.targetDate,
        postpone: selection.postpone,
        note: selection.note,
      });
    }
    case "complete_milestone":
    case "reopen_milestone": {
      const expected = await milestoneSnapshot(
        actor.plantId,
        selection.milestoneId
      );
      if (
        !expected ||
        (selection.kind === "complete_milestone" &&
          (expected.completedAt !== null || expected.openTaskCount > 0)) ||
        (selection.kind === "reopen_milestone" && expected.completedAt === null)
      ) {
        return null;
      }
      return launchMilestoneArgumentsSchema.parse({ expected });
    }
    case "set_task_completion": {
      const expected = await taskSnapshot(actor.plantId, selection.taskId);
      if (
        expected &&
        !evryActorHoldsApplicationCapability(actor, "tasks.write") &&
        expected.assignedToId !== actor.userId
      ) {
        return null;
      }
      if (expected && (expected.status === "complete") === selection.complete) {
        return null;
      }
      // A recurring completion can mint a successor and copy checklist rows.
      // That is a different, multi-record effect and is not hidden inside this
      // one-task Launch toggle.
      if (expected?.isRecurring) return null;
      return expected
        ? launchTaskArgumentsSchema.parse({
            expected,
            complete: selection.complete,
          })
        : null;
    }
    case "record_outcome": {
      if (!launch || !canRecordOutcome(launch)) return null;
      return launchOutcomeArgumentsSchema.parse({
        expected: launchSnapshot(launch),
        outcome: selection.outcome,
      });
    }
    case "correct_outcome": {
      if (!launch || !canEditOutcome(launch)) return null;
      if (
        launch.attendanceCount === selection.outcome.attendanceCount &&
        launch.decisionsCount === selection.outcome.decisionsCount &&
        launch.outcomeNotes === selection.outcome.outcomeNotes &&
        launch.captureTheDay === selection.outcome.captureTheDay
      )
        return null;
      return launchOutcomeArgumentsSchema.parse({
        expected: launchSnapshot(launch),
        outcome: selection.outcome,
      });
    }
  }
}

function exactTuple(input: EvryEffectInput, identity: string) {
  const actor = input.authorization.actor;
  return (
    input.authorization.registration.identity === identity &&
    input.execution.capabilityIdentity === identity &&
    input.execution.actorUserId === actor.userId &&
    input.execution.plantId === actor.plantId
  );
}

function sameLaunch(
  left: z.infer<typeof launchSnapshotSchema>,
  right: LaunchRecord
) {
  return JSON.stringify(left) === JSON.stringify(launchSnapshot(right));
}

function sameTaskAfterChange(
  current: z.infer<typeof launchTaskSnapshotSchema>,
  expected: z.infer<typeof launchTaskSnapshotSchema>,
  complete: boolean
): boolean {
  return (
    current.id === expected.id &&
    current.milestoneId === expected.milestoneId &&
    current.title === expected.title &&
    current.status === (complete ? "complete" : "not_started") &&
    current.assignedToId === expected.assignedToId &&
    current.dueDate === expected.dueDate &&
    current.dueTime === expected.dueTime &&
    current.category === expected.category &&
    current.relatedType === expected.relatedType &&
    current.relatedId === expected.relatedId &&
    !current.isRecurring
  );
}

function exactWriteEligibility(actor: EvryPlantActor): SQL {
  return sql`exists (
    select 1
    from eligible e
    join users u
      on u.id = e.actor_user_id
     and u.church_id = e.church_id
    where e.church_id = ${actor.plantId}::uuid
      and e.actor_user_id = ${actor.userId}::uuid
      and u.seat = ${actor.seat}
  )`;
}

/** Distinguish source contention from a seat/tenant revocation after a miss. */
async function actorSeatStillCurrent(actor: EvryPlantActor): Promise<boolean> {
  const [current] = await db
    .select({ seat: users.seat })
    .from(users)
    .where(and(eq(users.id, actor.userId), eq(users.churchId, actor.plantId)))
    .limit(1);
  return current?.seat === actor.seat;
}

async function claimLaunchEffect(input: EvryEffectInput, identity: string) {
  const actor = input.authorization.actor;
  const writeEligibility = exactWriteEligibility(actor);

  if (identity === LAUNCH_EFFECT_IDENTITIES.schedule) {
    const parsed = launchScheduleArgumentsSchema.safeParse(input.arguments);
    if (!parsed.success)
      return { status: "refused" as const, excludedCount: 1 };
    const mutation = setLaunchDateEffectMutation({
      churchId: actor.plantId,
      actorUserId: actor.userId,
      targetDate: parsed.data.targetDate,
      postpone: parsed.data.postpone,
      note: parsed.data.note,
      expected: parsed.data.expected
        ? {
            id: parsed.data.expected.id,
            targetDate: parsed.data.expected.targetDate,
            status: parsed.data.expected.status,
            updatedAt: new Date(parsed.data.expected.updatedAt),
          }
        : null,
      writeEligibility,
    });
    const claim = await claimEvryDatabaseEffectDecision({
      execution: input.execution,
      effectKey: input.effectKey,
      mutationCtes: mutation.ctes,
      mutation: mutation.result,
      async targetIsCurrent() {
        if (!(await actorSeatStillCurrent(actor))) return false;
        const current = await getLaunchForChurch(actor.plantId);
        return parsed.data.expected
          ? Boolean(current && sameLaunch(parsed.data.expected, current))
          : current === null;
      },
    });
    if (claim.result.status === "completed") {
      const stored = await getLaunchForChurch(actor.plantId);
      const writtenStatus =
        parsed.data.postpone && parsed.data.expected
          ? "postponed"
          : "scheduled";
      if (
        stored &&
        (!parsed.data.expected || stored.id === parsed.data.expected.id) &&
        stored.targetDate === parsed.data.targetDate &&
        stored.status === writtenStatus
      ) {
        if (claim.disposition === "claimed") {
          await reconcileLaunchDateChangedAfterWrite({
            churchId: actor.plantId,
            launchDate: parsed.data.targetDate,
            changedAt: stored.updatedAt,
          });
        }
        await seedLaunchMilestones({
          launchId: stored.id,
          churchId: actor.plantId,
          actorUserId: actor.userId,
        });
      }
    }
    return claim.result;
  }

  if (
    identity === LAUNCH_EFFECT_IDENTITIES.completeMilestone ||
    identity === LAUNCH_EFFECT_IDENTITIES.reopenMilestone
  ) {
    const parsed = launchMilestoneArgumentsSchema.safeParse(input.arguments);
    if (!parsed.success)
      return { status: "refused" as const, excludedCount: 1 };
    const complete = identity === LAUNCH_EFFECT_IDENTITIES.completeMilestone;
    const statement = complete
      ? completeLaunchMilestoneStatement({
          milestoneId: parsed.data.expected.id,
          churchId: actor.plantId,
          actorUserId: actor.userId,
          expectedTitle: parsed.data.expected.title,
          expectedUpdatedAt: new Date(parsed.data.expected.updatedAt),
          expectedOpenTaskCount: parsed.data.expected.openTaskCount,
          writeEligibility,
        })
      : reopenLaunchMilestoneStatement({
          milestoneId: parsed.data.expected.id,
          churchId: actor.plantId,
          expectedTitle: parsed.data.expected.title,
          expectedCompletedAt: parsed.data.expected.completedAt
            ? new Date(parsed.data.expected.completedAt)
            : undefined,
          expectedUpdatedAt: new Date(parsed.data.expected.updatedAt),
          expectedOpenTaskCount: parsed.data.expected.openTaskCount,
          writeEligibility,
        });
    return claimEvryDatabaseEffect({
      execution: input.execution,
      effectKey: input.effectKey,
      mutation: statement,
      async targetIsCurrent() {
        if (!(await actorSeatStillCurrent(actor))) return false;
        const current = await milestoneSnapshot(
          actor.plantId,
          parsed.data.expected.id
        );
        return (
          current !== null &&
          JSON.stringify(current) === JSON.stringify(parsed.data.expected)
        );
      },
    });
  }

  if (identity === LAUNCH_EFFECT_IDENTITIES.setTaskCompletion) {
    const parsed = launchTaskArgumentsSchema.safeParse(input.arguments);
    if (!parsed.success)
      return { status: "refused" as const, excludedCount: 1 };
    const expected = parsed.data.expected;
    const statement = parsed.data.complete
      ? completeTaskStatement({
          churchId: actor.plantId,
          taskId: expected.id,
          actorUserId: actor.userId,
          completedAt: new Date(),
          expectedTitle: expected.title,
          expectedStatus: expected.status,
          expectedAssignedToId: expected.assignedToId,
          expectedIsRecurring: false,
          expectedUpdatedAt: new Date(expected.updatedAt),
          launchMilestoneId: expected.milestoneId,
          writeEligibility,
        })
      : reopenTaskStatement({
          churchId: actor.plantId,
          taskId: expected.id,
          expectedTitle: expected.title,
          expectedStatus: expected.status,
          expectedAssignedToId: expected.assignedToId,
          expectedIsRecurring: false,
          expectedUpdatedAt: new Date(expected.updatedAt),
          launchMilestoneId: expected.milestoneId,
          writeEligibility,
        });
    const claim = await claimEvryDatabaseEffectDecision({
      execution: input.execution,
      effectKey: input.effectKey,
      mutation: statement,
      async targetIsCurrent() {
        if (!(await actorSeatStillCurrent(actor))) return false;
        const current = await taskSnapshot(actor.plantId, expected.id);
        return (
          current !== null &&
          JSON.stringify(current) === JSON.stringify(expected)
        );
      },
    });
    if (claim.result.status === "completed") {
      const current = await taskSnapshot(actor.plantId, expected.id);
      if (
        current &&
        sameTaskAfterChange(current, expected, parsed.data.complete)
      ) {
        if (parsed.data.complete) {
          await reconcileNonRecurringCompletedTaskAfterWrite(
            {
              id: expected.id,
              churchId: actor.plantId,
              category: expected.category,
              relatedType: expected.relatedType,
              relatedId: expected.relatedId,
              isRecurring: false,
            },
            actor.userId
          );
        } else {
          await reconcileReopenedTaskAfterWrite(
            {
              id: expected.id,
              churchId: actor.plantId,
              title: expected.title,
              status: "not_started",
              dueDate: expected.dueDate,
              dueTime: expected.dueTime,
              assignedToId: expected.assignedToId,
              deletedAt: null,
            },
            true
          );
        }
      }
    }
    return claim.result;
  }

  if (
    identity !== LAUNCH_EFFECT_IDENTITIES.recordOutcome &&
    identity !== LAUNCH_EFFECT_IDENTITIES.correctOutcome
  ) {
    return { status: "refused" as const, excludedCount: 1 };
  }
  const parsed = launchOutcomeArgumentsSchema.safeParse(input.arguments);
  if (!parsed.success) return { status: "refused" as const, excludedCount: 1 };
  const expected = parsed.data.expected;
  const source = {
    ...expected,
    outcomeRecordedAt: expected.outcomeRecordedAt
      ? new Date(expected.outcomeRecordedAt)
      : null,
    updatedAt: new Date(expected.updatedAt),
  };
  const mutation =
    identity === LAUNCH_EFFECT_IDENTITIES.recordOutcome
      ? recordLaunchOutcomeEffectMutation({
          churchId: actor.plantId,
          actorUserId: actor.userId,
          asOfDay: new Date().toISOString().slice(0, 10),
          ...parsed.data.outcome,
          expected: source,
          writeEligibility,
        })
      : updateLaunchOutcomeEffectMutation({
          churchId: actor.plantId,
          actorUserId: actor.userId,
          ...parsed.data.outcome,
          expected: source,
          writeEligibility,
        });
  const claim = await claimEvryDatabaseEffectDecision({
    execution: input.execution,
    effectKey: input.effectKey,
    mutationCtes: mutation.ctes,
    mutation: mutation.result,
    async targetIsCurrent() {
      if (!(await actorSeatStillCurrent(actor))) return false;
      const current = await getLaunchForChurch(actor.plantId);
      return Boolean(current && sameLaunch(expected, current));
    },
  });
  if (claim.result.status === "completed") {
    await reconcileLaunchOutcomeAfterWrite(actor.plantId);
  }
  return claim.result;
}

async function executeLaunchEffect(input: EvryEffectInput, identity: string) {
  if (!exactTuple(input, identity))
    return { status: "refused" as const, excludedCount: 1 };
  return claimLaunchEffect(input, identity);
}

export const LAUNCH_EVRY_EXECUTIONS = Object.entries(PLAN_BY_IDENTITY).map(
  ([identity, planCapability]) =>
    defineEvryExecutionCapability({
      planCapability,
      executeIfCurrent: (input) => executeLaunchEffect(input, identity),
    })
);
export const LAUNCH_EVRY_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry(LAUNCH_EVRY_EXECUTIONS);
export const LAUNCH_EVRY_PLAN_REGISTRY =
  LAUNCH_EVRY_EXECUTION_REGISTRY.planRegistry;

function html(value: string | null) {
  const escaped = (value ?? "(Not recorded)")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return `<pre>${escaped}</pre>`;
}

function reviewFor(identity: string) {
  return defineEvryArtifactReview({
    source: { kind: "generic", capabilityIdentities: [identity] },
    build({ plan, document }) {
      const step = document.steps[0]!;
      let title = "Update Launch Sunday";
      let actionLabel = "Confirm change";
      let target = "Launch Sunday";
      let beforeAfter: {
        label: string;
        before: string;
        after: string;
        count: number;
      }[] = [];
      let contentPreviews: {
        label: string;
        content: string;
        format: "rich_text";
      }[] = [];
      let consequences = [
        "This writes the reviewed change to this plant's Launch Sunday record.",
      ];
      let counts = [{ label: "Records to change", count: 1 }];
      let reversibility: "reversible" | "irreversible" = "reversible";
      if (identity === LAUNCH_EFFECT_IDENTITIES.schedule) {
        const args = launchScheduleArgumentsSchema.parse(step.arguments);
        title = args.postpone
          ? "Postpone Launch Sunday"
          : args.expected
            ? "Move Launch Sunday"
            : "Schedule Launch Sunday";
        actionLabel = args.postpone ? "Postpone launch" : "Save launch date";
        beforeAfter = [
          {
            label: "Launch date",
            before: args.expected?.targetDate ?? "Not scheduled",
            after: args.targetDate,
            count: 1,
          },
          {
            label: "Status",
            before: args.expected?.status ?? "planning",
            after: args.expected
              ? args.postpone
                ? "postponed"
                : "scheduled"
              : "scheduled",
            count: 1,
          },
        ];
        contentPreviews = args.note
          ? [
              {
                label: "Journal note",
                content: html(args.note),
                format: "rich_text",
              },
            ]
          : [];
        const readinessTaskCount = LAUNCH_MILESTONE_TEMPLATES.reduce(
          (total, milestone) => total + milestone.tasks.length,
          0
        );
        consequences = [
          "This changes the Launch Sunday date and status and appends one permanent journal entry.",
          `This idempotently ensures all ${LAUNCH_MILESTONE_TEMPLATES.length} Launch Playbook milestones and ${readinessTaskCount} readiness tasks exist; existing rows are not duplicated or overwritten.`,
          "Oversight recipients may receive a best-effort date-change notification after the durable write.",
        ];
        counts = [
          { label: "Launch records to change", count: 1 },
          { label: "Journal entries to append", count: 1 },
          {
            label: "Required milestones after the change",
            count: LAUNCH_MILESTONE_TEMPLATES.length,
          },
          {
            label: "Required readiness tasks after the change",
            count: readinessTaskCount,
          },
        ];
        reversibility = "irreversible";
      } else if (
        identity === LAUNCH_EFFECT_IDENTITIES.completeMilestone ||
        identity === LAUNCH_EFFECT_IDENTITIES.reopenMilestone
      ) {
        const args = launchMilestoneArgumentsSchema.parse(step.arguments);
        const complete =
          identity === LAUNCH_EFFECT_IDENTITIES.completeMilestone;
        title = `${complete ? "Complete" : "Reopen"} launch milestone`;
        actionLabel = complete ? "Complete milestone" : "Reopen milestone";
        target = args.expected.title;
        beforeAfter = [
          {
            label: "Milestone",
            before: complete ? "Open" : "Complete",
            after: complete ? "Complete" : "Open",
            count: 1,
          },
        ];
      } else if (identity === LAUNCH_EFFECT_IDENTITIES.setTaskCompletion) {
        const args = launchTaskArgumentsSchema.parse(step.arguments);
        title = `${args.complete ? "Complete" : "Reopen"} launch task`;
        actionLabel = args.complete ? "Complete task" : "Reopen task";
        target = args.expected.title;
        beforeAfter = [
          {
            label: "Task",
            before: args.expected.status,
            after: args.complete ? "complete" : "not_started",
            count: 1,
          },
          {
            label: "Assignee",
            before: args.expected.assignedToId ?? "Unassigned",
            after: args.expected.assignedToId ?? "Unassigned",
            count: 1,
          },
        ];
        consequences = args.complete
          ? [
              "This completes exactly this non-recurring task, cancels its pending task notifications, emits its completion event, and marks the plant for a fresh assessment.",
              "It does not create a recurring successor or change any other task.",
            ]
          : [
              "This reopens exactly this non-recurring task and re-enqueues the notifications owed by its current assignment and due date.",
              "It does not create another task or change any other task.",
            ];
        counts = [{ label: "Task records to change", count: 1 }];
      } else {
        const args = launchOutcomeArgumentsSchema.parse(step.arguments);
        const correction = identity === LAUNCH_EFFECT_IDENTITIES.correctOutcome;
        title = correction ? "Correct launch outcome" : "Record launch outcome";
        actionLabel = correction ? "Save correction" : "Record outcome";
        beforeAfter = [
          ...(correction
            ? []
            : [
                {
                  label: "Launch status",
                  before: args.expected.status,
                  after: "completed",
                  count: 1,
                },
                {
                  label: "Launch date",
                  before: args.expected.targetDate ?? "Not scheduled",
                  after: `${args.expected.targetDate ?? "Not scheduled"} (frozen as history)`,
                  count: 1,
                },
              ]),
          {
            label: "Attendance",
            before:
              args.expected.attendanceCount === null
                ? "Not recorded"
                : String(args.expected.attendanceCount),
            after:
              args.outcome.attendanceCount === null
                ? "Not recorded"
                : String(args.outcome.attendanceCount),
            count: 1,
          },
          {
            label: "Decisions",
            before:
              args.expected.decisionsCount === null
                ? "Not recorded"
                : String(args.expected.decisionsCount),
            after:
              args.outcome.decisionsCount === null
                ? "Not recorded"
                : String(args.outcome.decisionsCount),
            count: 1,
          },
        ];
        contentPreviews = [
          ...(correction
            ? [
                {
                  label: "Exact previous outcome notes",
                  content: html(args.expected.outcomeNotes),
                  format: "rich_text" as const,
                },
                {
                  label: "Exact previous capture-the-day record",
                  content: html(args.expected.captureTheDay),
                  format: "rich_text" as const,
                },
              ]
            : []),
          {
            label: "Exact new outcome notes",
            content: html(args.outcome.outcomeNotes),
            format: "rich_text",
          },
          {
            label: "Exact new capture-the-day record",
            content: html(args.outcome.captureTheDay),
            format: "rich_text",
          },
        ];
        consequences = [
          correction
            ? "This replaces the reviewed outcome fields and appends one permanent correction entry to the launch journal."
            : "This marks Launch Sunday completed, freezes its launch date as history, stores the reviewed outcome, and appends one permanent journal entry.",
          "The plant is marked for a fresh phase assessment after the durable write.",
        ];
        counts = [
          { label: "Launch records to change", count: 1 },
          { label: "Journal entries to append", count: 1 },
        ];
        reversibility = "irreversible";
      }
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title,
        actionLabel,
        consequences,
        steps: [
          {
            stepId: step.id,
            title,
            effectKind: "other",
            reversibility,
            resolvedTargets: [
              {
                label: "Target",
                value: target,
                sourceLink: { label: "Open Launch Sunday", href: "/launch" },
              },
            ],
            counts,
            exclusions: [],
            dateTime: null,
            contentPreviews,
            beforeAfter,
          },
        ],
      });
    },
  });
}

export const LAUNCH_EVRY_REVIEWS = Object.values(LAUNCH_EFFECT_IDENTITIES).map(
  reviewFor
);
export const LAUNCH_EVRY_REVIEW_REGISTRY =
  createEvryArtifactReviewRegistry(LAUNCH_EVRY_REVIEWS);

export async function proposeLaunchEvryEffect(input: {
  actor: EvryPlantActor;
  selection: LaunchEvryEffectSelection;
  requestKey: EvryPlanRequestKey;
}) {
  const identity = identityFor(input.selection);
  const authorization = await authorizeEvryEffectCapability(identity);
  if (
    !authorization ||
    authorization.actor.userId !== input.actor.userId ||
    authorization.actor.plantId !== input.actor.plantId
  )
    return {
      kind: "refusal" as const,
      body: "That Launch change is unavailable.",
    };
  const args = await resolveLaunchEvryArguments(
    authorization.actor,
    input.selection
  );
  if (!args)
    return {
      kind: "refusal" as const,
      body: "That Launch change is unavailable.",
    };
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: `launch-${input.selection.kind.replaceAll("_", "-")}`,
          capabilityIdentity: identity,
          arguments: args,
          dependsOn: [],
        },
      ],
    },
    registry: LAUNCH_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: eligibleEvryCapabilitiesFor(authorization.actor),
  });
  assertEvryPlanDocumentReviewable({
    document,
    reviewRegistry: LAUNCH_EVRY_REVIEW_REGISTRY,
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
    reviewRegistry: LAUNCH_EVRY_REVIEW_REGISTRY,
  });
  if (!review) throw new Error("Stored Launch plan has no trusted review");
  return { kind: "plan" as const, plan, confirmation: review.confirmation };
}

export async function launchEvryPlanTargetIsCurrent(input: {
  actor: EvryPlantActor;
  step: { capabilityIdentity: string; arguments: Record<string, unknown> };
}) {
  const identity = input.step.capabilityIdentity;
  if (identity === LAUNCH_EFFECT_IDENTITIES.schedule) {
    const parsed = launchScheduleArgumentsSchema.safeParse(
      input.step.arguments
    );
    if (!parsed.success) return false;
    const current = await getLaunchForChurch(input.actor.plantId);
    return parsed.data.expected === null
      ? current === null
      : Boolean(current && sameLaunch(parsed.data.expected, current));
  }
  if (
    identity === LAUNCH_EFFECT_IDENTITIES.completeMilestone ||
    identity === LAUNCH_EFFECT_IDENTITIES.reopenMilestone
  ) {
    const parsed = launchMilestoneArgumentsSchema.safeParse(
      input.step.arguments
    );
    const current = parsed.success
      ? await milestoneSnapshot(input.actor.plantId, parsed.data.expected.id)
      : null;
    return Boolean(
      parsed.success &&
      current &&
      JSON.stringify(current) === JSON.stringify(parsed.data.expected)
    );
  }
  if (identity === LAUNCH_EFFECT_IDENTITIES.setTaskCompletion) {
    const parsed = launchTaskArgumentsSchema.safeParse(input.step.arguments);
    const current = parsed.success
      ? await taskSnapshot(input.actor.plantId, parsed.data.expected.id)
      : null;
    return Boolean(
      parsed.success &&
      current &&
      JSON.stringify(current) === JSON.stringify(parsed.data.expected)
    );
  }
  const parsed = launchOutcomeArgumentsSchema.safeParse(input.step.arguments);
  const current = parsed.success
    ? await getLaunchForChurch(input.actor.plantId)
    : null;
  return Boolean(
    parsed.success && current && sameLaunch(parsed.data.expected, current)
  );
}
