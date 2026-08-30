import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  churches,
  launchMilestones,
  launchMilestoneTasks,
  launchMilestoneAreas,
  taskCategories,
  taskPriorities,
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
  type EvryClaimedEffectInput,
  type EvryEffectInput,
} from "@/lib/evry/executor";
import {
  claimEvryDatabaseEffect,
  claimEvryDatabaseEffectDecision,
  findExactEvryDatabaseEffectClaim,
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
  assertLaunchMilestoneSeedRows,
  planMissingLaunchMilestoneSeedRows,
  planLaunchMilestoneSeedRows,
  reopenLaunchMilestoneStatement,
  seedLaunchMilestones,
} from "@/lib/launch/milestones";
import { churchAnchor } from "@/lib/notifications/anchor";
import {
  dbEnqueueDeps,
  enqueue,
  enqueueNotificationSchema,
  type EnqueueNotificationInput,
} from "@/lib/notifications/enqueue";
import {
  listOversightRecipientsForChurch,
  type OversightAudience,
} from "@/lib/notifications/oversight-audience";
import { composeMilestone } from "@/lib/notifications/oversight";
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
import { setLaunchDateEffectMutation } from "@/lib/launch/service";
import {
  completeTaskStatement,
  reconcileReopenedTaskAfterWrite,
  reconcileCompletedTaskAfterWrite,
  reopenTaskStatement,
  type ReviewedRecurringTaskRow,
  type ReviewedTaskRecurrencePlan,
} from "@/lib/tasks/service";
import {
  nextRecurrenceDueDate,
  parseRecurrenceRule,
  seriesIdOf,
} from "@/lib/tasks/recurrence";
import { toCalendarDate } from "@/lib/datetime";
import { mayActOnTaskRow } from "@/lib/tasks/own-duty";

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
const launchSeedTaskSchema = z.strictObject({
  taskId: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().nullable(),
});
const launchSeedMilestoneSchema = z.strictObject({
  milestoneId: z.string().uuid(),
  templateKey: z.string().min(1).max(160),
  area: z.enum(launchMilestoneAreas),
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(10_000),
  sortOrder: z.number().int().min(0),
  tasks: z.array(launchSeedTaskSchema).max(100),
});
const launchNotificationSchema = z.strictObject({
  recipientUserId: z.string().uuid(),
  category: z.literal("milestones"),
  type: z.literal("oversight.milestone.launch_date_changed"),
  title: z.string().min(1).max(255),
  body: z.string().min(1).max(10_000),
  dedupeKey: z.string().min(1).max(255),
  scheduledFor: z.string().datetime(),
});
const launchNotificationExclusionSchema = z.strictObject({
  reason: z.enum(["outside_church", "oversight_privacy", "misprovisioned"]),
  count: z.number().int().min(1).max(100),
});
const launchScheduleConsequencesSchema = z.strictObject({
  launchId: z.string().uuid(),
  changedAt: z.string().datetime(),
  plantName: z.string().min(1).max(255),
  readiness: z.array(launchSeedMilestoneSchema).max(32),
  notifications: z.array(launchNotificationSchema).max(100),
  notificationExclusions: z.array(launchNotificationExclusionSchema).max(3),
});
export const launchTaskSnapshotSchema = z.strictObject({
  id: z.string().uuid(),
  milestoneId: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().nullable(),
  status: z.enum(taskStatuses),
  priority: z.enum(taskPriorities),
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
  parentTaskId: z.string().uuid().nullable(),
  isRecurring: z.boolean(),
  recurrenceRule: z.unknown().nullable(),
  completionEvent: z.string().max(100).nullable(),
  createdById: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const reviewedRecurringTaskSchema = z.strictObject({
  id: z.string().uuid(),
  churchId: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().nullable(),
  status: z.literal("not_started"),
  priority: z.enum(taskPriorities),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  dueTime: z
    .string()
    .regex(/^\d{2}:\d{2}:\d{2}$/)
    .nullable(),
  assignedToId: z.string().uuid().nullable(),
  category: z.enum(taskCategories).nullable(),
  relatedType: z.enum(taskRelatedTypes).nullable(),
  relatedId: z.string().uuid().nullable(),
  parentTaskId: z.string().uuid().nullable(),
  isRecurring: z.boolean(),
  recurrenceRule: z.unknown().nullable(),
  createdById: z.string().uuid(),
  createdAt: z.string().datetime(),
});
const reviewedRecurrenceSourceTaskSchema = reviewedRecurringTaskSchema.extend({
  // The source checklist is an exact reviewed snapshot. Its current state is
  // evidence, not the state of the fresh checklist copy, which always starts
  // not_started. A completed source item is therefore valid and must remain
  // bound for execution-time drift detection.
  status: z.enum(taskStatuses),
  updatedAt: z.string().datetime(),
});
const reviewedTaskCompletionSchema = z.strictObject({
  completedAt: z.string().datetime(),
  recurrence: z
    .discriminatedUnion("disposition", [
      z.strictObject({
        disposition: z.literal("existing"),
        seriesId: z.string().uuid(),
        successorId: z.string().uuid(),
      }),
      z.strictObject({
        disposition: z.literal("create"),
        seriesId: z.string().uuid(),
        sourceChildren: z.array(reviewedRecurrenceSourceTaskSchema).max(100),
        successor: reviewedRecurringTaskSchema,
        children: z.array(reviewedRecurringTaskSchema).max(100),
      }),
    ])
    .nullable(),
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
  consequences: launchScheduleConsequencesSchema,
});
export const launchMilestoneArgumentsSchema = z.strictObject({
  expected: launchMilestoneSnapshotSchema,
});
export const launchTaskArgumentsSchema = z.strictObject({
  expected: launchTaskSnapshotSchema,
  complete: z.boolean(),
  completion: reviewedTaskCompletionSchema.nullable(),
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
  let quoted = false;
  for (const character of text) {
    if (escaped) {
      if (quoted) current += `\\${character}`;
      else {
        if (character !== "|" && character !== "\\") return null;
        current += character;
      }
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
      current += character;
    } else if (character === "|" && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped || quoted) return null;
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
    if (value === undefined || value === "null") return null;
    return /^\d{1,7}$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  };
  const nullableLiteral = (key: string): unknown => {
    const value = fields.get(key);
    if (value === undefined || value === "null") return null;
    if (value.startsWith('"') || value.endsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(value);
        return typeof parsed === "string" ? parsed : {};
      } catch {
        return {};
      }
    }
    return value;
  };
  const attendanceCount = count("attendance");
  const decisionsCount = count("decisions");
  const parsed = z.strictObject(outcomeShape).safeParse({
    attendanceCount,
    decisionsCount,
    outcomeNotes: nullableLiteral("notes"),
    captureTheDay: nullableLiteral("capture"),
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

type LaunchScheduleConsequences = z.infer<
  typeof launchScheduleConsequencesSchema
>;

function seedTemplateShape(rows: LaunchScheduleConsequences["readiness"]) {
  return rows.map(({ milestoneId: _milestoneId, tasks: taskRows, ...row }) => ({
    ...row,
    tasks: taskRows.map(({ taskId: _taskId, ...task }) => task),
  }));
}

function groupedNotificationExclusions(input: {
  audience: OversightAudience;
  skipped: readonly ("outside_church" | "oversight_privacy")[];
}) {
  const counts = new Map<string, number>();
  if (input.audience.misprovisioned.length > 0) {
    counts.set("misprovisioned", input.audience.misprovisioned.length);
  }
  for (const reason of input.skipped) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count }));
}

async function resolveScheduleConsequences(input: {
  plantId: string;
  targetDate: string;
  changedAt: Date;
  launchId?: string;
  readiness?: LaunchScheduleConsequences["readiness"];
}): Promise<LaunchScheduleConsequences | null> {
  const [plant] = await db
    .select({ name: churches.name })
    .from(churches)
    .where(eq(churches.id, input.plantId))
    .limit(1);
  if (!plant) return null;
  const audience = await listOversightRecipientsForChurch(input.plantId);
  if (audience.recipients.length > 100) return null;
  const notifications: LaunchScheduleConsequences["notifications"] = [];
  const skipped: ("outside_church" | "oversight_privacy")[] = [];
  for (const recipient of audience.recipients) {
    const composed = composeMilestone(
      {
        anchor: churchAnchor(input.plantId),
        subject: plant.name,
        kind: "launch_date_changed",
        occurrence: `${input.targetDate}@${input.changedAt.toISOString()}`,
        detail: `They are aiming to launch on ${input.targetDate}.`,
      },
      recipient.id
    );
    const permitted = await dbEnqueueDeps.recipientMayBeNotified({
      anchor: churchAnchor(input.plantId),
      recipientUserId: recipient.id,
      category: composed.category,
      type: composed.type,
    });
    if (!permitted.allowed) {
      skipped.push(permitted.reason);
      continue;
    }
    notifications.push(
      launchNotificationSchema.parse({
        recipientUserId: recipient.id,
        category: composed.category,
        type: composed.type,
        title: composed.title,
        body: composed.body,
        dedupeKey: composed.dedupeKey,
        scheduledFor: input.changedAt.toISOString(),
      })
    );
  }
  return launchScheduleConsequencesSchema.parse({
    launchId: input.launchId ?? crypto.randomUUID(),
    changedAt: input.changedAt.toISOString(),
    plantName: plant.name,
    readiness:
      input.readiness ??
      (input.launchId
        ? await planMissingLaunchMilestoneSeedRows({
            launchId: input.launchId,
            churchId: input.plantId,
          })
        : planLaunchMilestoneSeedRows()),
    notifications,
    notificationExclusions: groupedNotificationExclusions({
      audience,
      skipped,
    }),
  });
}

async function scheduleConsequencesAreCurrent(input: {
  plantId: string;
  targetDate: string;
  reviewed: LaunchScheduleConsequences;
}): Promise<boolean> {
  const currentTemplateRows = await planMissingLaunchMilestoneSeedRows({
    launchId: input.reviewed.launchId,
    churchId: input.plantId,
  });
  if (
    JSON.stringify(seedTemplateShape(input.reviewed.readiness)) !==
    JSON.stringify(seedTemplateShape(currentTemplateRows))
  ) {
    return false;
  }
  const current = await resolveScheduleConsequences({
    plantId: input.plantId,
    targetDate: input.targetDate,
    changedAt: new Date(input.reviewed.changedAt),
    launchId: input.reviewed.launchId,
    readiness: input.reviewed.readiness,
  });
  return (
    current !== null &&
    JSON.stringify(current) === JSON.stringify(input.reviewed)
  );
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
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      assignedToId: tasks.assignedToId,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
      category: tasks.category,
      relatedType: tasks.relatedType,
      relatedId: tasks.relatedId,
      parentTaskId: tasks.parentTaskId,
      isRecurring: tasks.isRecurring,
      recurrenceRule: tasks.recurrenceRule,
      completionEvent: tasks.completionEvent,
      createdById: tasks.createdById,
      createdAt: tasks.createdAt,
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
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })
    : null;
}

async function reviewedTaskCompletion(
  plantId: string,
  expected: z.infer<typeof launchTaskSnapshotSchema>
) {
  const completedAt = new Date();
  if (!expected.isRecurring) {
    return reviewedTaskCompletionSchema.parse({
      completedAt: completedAt.toISOString(),
      recurrence: null,
    });
  }
  const rule = parseRecurrenceRule(expected.recurrenceRule);
  if (!rule) return null;
  const nextDueDate = nextRecurrenceDueDate(
    rule,
    expected.dueDate,
    toCalendarDate(completedAt)
  );
  if (!nextDueDate) {
    return reviewedTaskCompletionSchema.parse({
      completedAt: completedAt.toISOString(),
      recurrence: null,
    });
  }
  const seriesId = seriesIdOf({
    id: expected.id,
    recurrenceRule: expected.recurrenceRule,
  });
  const open = await findOtherOpenRecurringInstance(plantId, expected);
  if (open) {
    return reviewedTaskCompletionSchema.parse({
      completedAt: completedAt.toISOString(),
      recurrence: {
        disposition: "existing",
        seriesId,
        successorId: open,
      },
    });
  }
  const sourceChildren = await db
    .select({
      id: tasks.id,
      churchId: tasks.churchId,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
      assignedToId: tasks.assignedToId,
      category: tasks.category,
      relatedType: tasks.relatedType,
      relatedId: tasks.relatedId,
      parentTaskId: tasks.parentTaskId,
      isRecurring: tasks.isRecurring,
      recurrenceRule: tasks.recurrenceRule,
      createdById: tasks.createdById,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.churchId, plantId),
        eq(tasks.parentTaskId, expected.id),
        isNull(tasks.deletedAt)
      )
    )
    .orderBy(tasks.createdAt, tasks.id);
  const successorId = crypto.randomUUID();
  const successor = {
    id: successorId,
    churchId: plantId,
    title: expected.title,
    description: expected.description,
    status: "not_started" as const,
    priority: expected.priority,
    dueDate: nextDueDate,
    dueTime: expected.dueTime,
    assignedToId: expected.assignedToId,
    category: expected.category,
    relatedType: expected.relatedType,
    relatedId: expected.relatedId,
    parentTaskId: expected.parentTaskId,
    isRecurring: true,
    recurrenceRule: { ...rule, seriesId },
    createdById: expected.createdById,
    createdAt: completedAt.toISOString(),
  };
  const children = sourceChildren.map((child, index) => ({
    id: crypto.randomUUID(),
    churchId: plantId,
    title: child.title,
    description: child.description,
    status: "not_started" as const,
    priority: child.priority,
    dueDate: null,
    dueTime: child.dueTime,
    assignedToId: child.assignedToId,
    category: child.category,
    relatedType: child.relatedType,
    relatedId: child.relatedId,
    parentTaskId: successorId,
    isRecurring: false,
    recurrenceRule: null,
    createdById: expected.createdById,
    createdAt: new Date(completedAt.getTime() + index + 1).toISOString(),
  }));
  return reviewedTaskCompletionSchema.parse({
    completedAt: completedAt.toISOString(),
    recurrence: {
      disposition: "create",
      seriesId,
      sourceChildren: sourceChildren.map((child) => ({
        ...child,
        createdAt: child.createdAt.toISOString(),
        updatedAt: child.updatedAt.toISOString(),
      })),
      successor,
      children,
    },
  });
}

async function findOtherOpenRecurringInstance(
  plantId: string,
  task: Pick<
    z.infer<typeof launchTaskSnapshotSchema>,
    "id" | "isRecurring" | "recurrenceRule"
  >
): Promise<string | null> {
  if (!task.isRecurring) return null;
  const seriesId = seriesIdOf({
    id: task.id,
    recurrenceRule: task.recurrenceRule,
  });
  const [open] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.churchId, plantId),
        sql`${tasks.id} <> ${task.id}::uuid`,
        eq(tasks.isRecurring, true),
        sql`${tasks.status} <> 'complete'`,
        isNull(tasks.deletedAt),
        sql`${tasks.recurrenceRule} ->> 'seriesId' = ${seriesId}`
      )
    )
    .limit(1);
  return open?.id ?? null;
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
      const consequences = await resolveScheduleConsequences({
        plantId: actor.plantId,
        targetDate: selection.targetDate,
        changedAt: new Date(),
        launchId: launch?.id,
      });
      if (!consequences) return null;
      return launchScheduleArgumentsSchema.parse({
        expected: launch ? launchSnapshot(launch) : null,
        targetDate: selection.targetDate,
        postpone: selection.postpone,
        note: selection.note,
        consequences,
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
      if (!expected) return null;
      if (
        !selection.complete &&
        (await findOtherOpenRecurringInstance(actor.plantId, expected))
      ) {
        return null;
      }
      const completion = selection.complete
        ? await reviewedTaskCompletion(actor.plantId, expected)
        : null;
      if (selection.complete && !completion) return null;
      return launchTaskArgumentsSchema.parse({
        expected,
        complete: selection.complete,
        completion,
      });
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
    current.description === expected.description &&
    current.status === (complete ? "complete" : "not_started") &&
    current.priority === expected.priority &&
    current.assignedToId === expected.assignedToId &&
    current.dueDate === expected.dueDate &&
    current.dueTime === expected.dueTime &&
    current.category === expected.category &&
    current.relatedType === expected.relatedType &&
    current.relatedId === expected.relatedId &&
    current.parentTaskId === expected.parentTaskId &&
    current.isRecurring === expected.isRecurring &&
    JSON.stringify(current.recurrenceRule) ===
      JSON.stringify(expected.recurrenceRule) &&
    current.completionEvent === expected.completionEvent &&
    current.createdById === expected.createdById &&
    current.createdAt === expected.createdAt
  );
}

function exactWriteEligibility(actor: EvryPlantActor): SQL {
  return sql`exists (
    select 1
    from eligible e
    join users u
      on u.id = e.actor_user_id
     and u.church_id = e.church_id
     and u.sending_church_id is null
     and u.sending_network_id is null
    where e.church_id = ${actor.plantId}::uuid
      and e.actor_user_id = ${actor.userId}::uuid
      and u.seat = ${actor.seat}
  )`;
}

/** Fresh seat plus the tasks.own subject rule, evaluated on the locked row. */
function exactTaskWriteEligibility(actor: EvryPlantActor): SQL {
  return sql`exists (
    select 1
    from eligible e
    join users u
      on u.id = e.actor_user_id
     and u.church_id = e.church_id
     and u.sending_church_id is null
     and u.sending_network_id is null
    where e.church_id = ${actor.plantId}::uuid
      and e.actor_user_id = ${actor.userId}::uuid
      and u.seat = ${actor.seat}
      and (u.seat in ('owner', 'admin') or (u.seat = 'member' and t.assigned_to_id = u.id))
  )`;
}

/** Reopening cannot put an older recurring instance beside its successor. */
function exactTaskReopenWriteEligibility(actor: EvryPlantActor): SQL {
  return sql`${exactTaskWriteEligibility(actor)} and (
    not t.is_recurring or not exists (
      select 1 from tasks other
      where other.church_id = t.church_id
        and other.id <> t.id
        and other.is_recurring
        and other.status <> 'complete'
        and other.deleted_at is null
        and coalesce(other.recurrence_rule ->> 'seriesId', other.id::text)
          = coalesce(t.recurrence_rule ->> 'seriesId', t.id::text)
    )
  )`;
}

/** Distinguish source contention from a fresh seat/tenant revocation. */
async function actorStillAuthorized(
  actor: EvryPlantActor,
  applicationCapability: "launch.schedule" | "launch.milestone"
): Promise<boolean> {
  const [current] = await db
    .select({ seat: users.seat })
    .from(users)
    .where(
      and(
        eq(users.id, actor.userId),
        eq(users.churchId, actor.plantId),
        isNull(users.sendingChurchId),
        isNull(users.sendingNetworkId)
      )
    )
    .limit(1);
  if (!current?.seat) return false;
  return evryActorHoldsApplicationCapability(
    { plantId: actor.plantId, seat: current.seat },
    applicationCapability
  );
}

async function taskActorStillAuthorized(
  actor: EvryPlantActor,
  assignedToId: string | null
): Promise<boolean> {
  const [current] = await db
    .select({ seat: users.seat })
    .from(users)
    .where(
      and(
        eq(users.id, actor.userId),
        eq(users.churchId, actor.plantId),
        isNull(users.sendingChurchId),
        isNull(users.sendingNetworkId)
      )
    )
    .limit(1);
  if (!current?.seat) return false;
  const currentActor = { plantId: actor.plantId, seat: current.seat };
  return (
    evryActorHoldsApplicationCapability(currentActor, "tasks.own") &&
    mayActOnTaskRow({
      canWrite: evryActorHoldsApplicationCapability(
        currentActor,
        "tasks.write"
      ),
      assignedToId,
      viewerId: actor.userId,
    })
  );
}

function serviceRecurrencePlan(
  completion: z.infer<typeof reviewedTaskCompletionSchema>
): ReviewedTaskRecurrencePlan | null {
  if (
    !completion.recurrence ||
    completion.recurrence.disposition === "existing"
  ) {
    return null;
  }
  const row = (
    value: z.infer<typeof reviewedRecurringTaskSchema>
  ): ReviewedRecurringTaskRow => ({
    ...value,
    createdAt: new Date(value.createdAt),
  });
  return {
    successor: row(completion.recurrence.successor),
    children: completion.recurrence.children.map(row),
  };
}

async function reviewedRecurrenceIsCurrent(input: {
  plantId: string;
  expected: z.infer<typeof launchTaskSnapshotSchema>;
  completion: z.infer<typeof reviewedTaskCompletionSchema>;
}): Promise<boolean> {
  if (!input.expected.isRecurring) return input.completion.recurrence === null;
  const rule = parseRecurrenceRule(input.expected.recurrenceRule);
  if (!rule) return false;
  const expectedDueDate = nextRecurrenceDueDate(
    rule,
    input.expected.dueDate,
    toCalendarDate(new Date(input.completion.completedAt))
  );
  if (!expectedDueDate) return input.completion.recurrence === null;
  const seriesId = seriesIdOf({
    id: input.expected.id,
    recurrenceRule: input.expected.recurrenceRule,
  });
  const open = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.churchId, input.plantId),
        sql`${tasks.id} <> ${input.expected.id}::uuid`,
        eq(tasks.isRecurring, true),
        sql`${tasks.status} <> 'complete'`,
        isNull(tasks.deletedAt),
        sql`${tasks.recurrenceRule} ->> 'seriesId' = ${seriesId}`
      )
    )
    .orderBy(tasks.id);
  if (input.completion.recurrence?.disposition === "existing") {
    return (
      input.completion.recurrence.seriesId === seriesId &&
      open.length === 1 &&
      open[0]?.id === input.completion.recurrence.successorId
    );
  }
  if (!input.completion.recurrence || open.length > 0) return false;
  if (
    input.completion.recurrence.seriesId !== seriesId ||
    input.completion.recurrence.successor.dueDate !== expectedDueDate
  ) {
    return false;
  }
  const currentChildren = await db
    .select({
      id: tasks.id,
      churchId: tasks.churchId,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
      assignedToId: tasks.assignedToId,
      category: tasks.category,
      relatedType: tasks.relatedType,
      relatedId: tasks.relatedId,
      parentTaskId: tasks.parentTaskId,
      isRecurring: tasks.isRecurring,
      recurrenceRule: tasks.recurrenceRule,
      createdById: tasks.createdById,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.churchId, input.plantId),
        eq(tasks.parentTaskId, input.expected.id),
        isNull(tasks.deletedAt)
      )
    )
    .orderBy(tasks.createdAt, tasks.id);
  return (
    JSON.stringify(
      currentChildren.map((child) => ({
        ...child,
        createdAt: child.createdAt.toISOString(),
        updatedAt: child.updatedAt.toISOString(),
      }))
    ) === JSON.stringify(input.completion.recurrence.sourceChildren)
  );
}

async function reconcileFrozenSchedule(input: {
  plantId: string;
  actorUserId: string;
  expectedLaunchId: string | null;
  targetDate: string;
  consequences: LaunchScheduleConsequences;
}): Promise<void> {
  const stored = await getLaunchForChurch(input.plantId);
  if (
    !stored ||
    (input.expectedLaunchId !== null && stored.id !== input.expectedLaunchId) ||
    stored.targetDate !== input.targetDate
  ) {
    throw new Error("Claimed Launch schedule no longer matches its write");
  }
  await seedLaunchMilestones({
    launchId: stored.id,
    churchId: input.plantId,
    actorUserId: input.actorUserId,
    rows: input.consequences.readiness,
  });
  await assertLaunchMilestoneSeedRows({
    launchId: stored.id,
    churchId: input.plantId,
    actorUserId: input.actorUserId,
    rows: input.consequences.readiness,
  });
  for (const notification of input.consequences.notifications) {
    const result = await enqueue(
      enqueueNotificationSchema.parse({
        churchId: input.plantId,
        ...notification,
        scheduledFor: new Date(notification.scheduledFor),
      }) as EnqueueNotificationInput
    );
    if (result.status !== "recorded") {
      throw new Error("Reviewed Launch notification is no longer permitted");
    }
  }
}

async function reconcileFrozenTaskCompletion(input: {
  plantId: string;
  actorUserId: string;
  expected: z.infer<typeof launchTaskSnapshotSchema>;
  completion: z.infer<typeof reviewedTaskCompletionSchema>;
  effectKey: string;
}): Promise<void> {
  const completedAt = new Date(input.completion.completedAt);
  await reconcileCompletedTaskAfterWrite(
    {
      id: input.expected.id,
      churchId: input.plantId,
      title: input.expected.title,
      description: input.expected.description,
      status: "complete",
      priority: input.expected.priority,
      dueDate: input.expected.dueDate,
      dueTime: input.expected.dueTime,
      assignedToId: input.expected.assignedToId,
      category: input.expected.category,
      relatedType: input.expected.relatedType,
      relatedId: input.expected.relatedId,
      parentTaskId: input.expected.parentTaskId,
      isRecurring: input.expected.isRecurring,
      recurrenceRule: input.expected.recurrenceRule,
      completionEvent: input.expected.completionEvent,
      completedAt,
      completedById: input.actorUserId,
      createdById: input.expected.createdById,
      createdAt: new Date(input.expected.createdAt),
      updatedAt: completedAt,
      deletedAt: null,
    },
    input.actorUserId,
    serviceRecurrencePlan(input.completion),
    completedAt,
    input.effectKey
  );
}

async function reconcileClaimedLaunchEffect(
  input: EvryClaimedEffectInput,
  identity: string,
  result: NonNullable<
    Awaited<ReturnType<typeof findExactEvryDatabaseEffectClaim>>
  >
) {
  if (identity === LAUNCH_EFFECT_IDENTITIES.schedule) {
    const parsed = launchScheduleArgumentsSchema.parse(input.arguments);
    await reconcileFrozenSchedule({
      plantId: input.execution.plantId,
      actorUserId: input.execution.actorUserId,
      expectedLaunchId: parsed.expected?.id ?? parsed.consequences.launchId,
      targetDate: parsed.targetDate,
      consequences: parsed.consequences,
    });
  } else if (identity === LAUNCH_EFFECT_IDENTITIES.setTaskCompletion) {
    const parsed = launchTaskArgumentsSchema.parse(input.arguments);
    if (parsed.complete && parsed.completion) {
      await reconcileFrozenTaskCompletion({
        plantId: input.execution.plantId,
        actorUserId: input.execution.actorUserId,
        expected: parsed.expected,
        completion: parsed.completion,
        effectKey: input.effectKey,
      });
    } else if (!parsed.complete) {
      const current = await taskSnapshot(
        input.execution.plantId,
        parsed.expected.id
      );
      if (current && sameTaskAfterChange(current, parsed.expected, false)) {
        await reconcileReopenedTaskAfterWrite(
          {
            id: current.id,
            churchId: input.execution.plantId,
            title: current.title,
            status: current.status,
            dueDate: current.dueDate,
            dueTime: current.dueTime,
            assignedToId: current.assignedToId,
            deletedAt: null,
          },
          true
        );
      }
    }
  } else if (
    identity === LAUNCH_EFFECT_IDENTITIES.recordOutcome ||
    identity === LAUNCH_EFFECT_IDENTITIES.correctOutcome
  ) {
    await reconcileLaunchOutcomeAfterWrite(input.execution.plantId);
  }
  return result;
}

async function claimLaunchEffect(input: EvryEffectInput, identity: string) {
  const actor = input.authorization.actor;
  const writeEligibility = exactWriteEligibility(actor);

  if (identity === LAUNCH_EFFECT_IDENTITIES.schedule) {
    const parsed = launchScheduleArgumentsSchema.safeParse(input.arguments);
    if (!parsed.success)
      return { status: "refused" as const, excludedCount: 1 };
    if (
      !(await scheduleConsequencesAreCurrent({
        plantId: actor.plantId,
        targetDate: parsed.data.targetDate,
        reviewed: parsed.data.consequences,
      }))
    ) {
      return { status: "refused" as const, excludedCount: 1 };
    }
    const mutation = setLaunchDateEffectMutation({
      churchId: actor.plantId,
      actorUserId: actor.userId,
      targetDate: parsed.data.targetDate,
      postpone: parsed.data.postpone,
      note: parsed.data.note,
      changedAt: new Date(parsed.data.consequences.changedAt),
      launchId:
        parsed.data.expected === null
          ? parsed.data.consequences.launchId
          : undefined,
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
        if (!(await actorStillAuthorized(actor, "launch.schedule")))
          return false;
        const current = await getLaunchForChurch(actor.plantId);
        return parsed.data.expected
          ? Boolean(current && sameLaunch(parsed.data.expected, current))
          : current === null;
      },
    });
    return claim.result.status === "completed"
      ? await reconcileClaimedLaunchEffect(
          {
            effectKey: input.effectKey,
            execution: input.execution,
            arguments: input.arguments,
          },
          identity,
          claim.result
        )
      : claim.result;
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
        if (!(await actorStillAuthorized(actor, "launch.milestone")))
          return false;
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
    if (parsed.data.complete !== (parsed.data.completion !== null)) {
      return { status: "refused" as const, excludedCount: 1 };
    }
    if (
      parsed.data.complete &&
      parsed.data.completion &&
      !(await reviewedRecurrenceIsCurrent({
        plantId: actor.plantId,
        expected,
        completion: parsed.data.completion,
      }))
    ) {
      return { status: "refused" as const, excludedCount: 1 };
    }
    if (
      !parsed.data.complete &&
      (await findOtherOpenRecurringInstance(actor.plantId, expected))
    ) {
      return { status: "refused" as const, excludedCount: 1 };
    }
    const completedAt = parsed.data.completion
      ? new Date(parsed.data.completion.completedAt)
      : new Date();
    const taskWriteEligibility = parsed.data.complete
      ? exactTaskWriteEligibility(actor)
      : exactTaskReopenWriteEligibility(actor);
    const commonExpected = {
      expectedTitle: expected.title,
      expectedStatus: expected.status,
      expectedAssignedToId: expected.assignedToId,
      expectedIsRecurring: expected.isRecurring,
      expectedDescription: expected.description,
      expectedPriority: expected.priority,
      expectedDueDate: expected.dueDate,
      expectedDueTime: expected.dueTime,
      expectedCategory: expected.category,
      expectedRelatedType: expected.relatedType,
      expectedRelatedId: expected.relatedId,
      expectedParentTaskId: expected.parentTaskId,
      expectedRecurrenceRule: expected.recurrenceRule,
      expectedCompletionEvent: expected.completionEvent,
      expectedCreatedById: expected.createdById,
      expectedUpdatedAt: new Date(expected.updatedAt),
      launchMilestoneId: expected.milestoneId,
      writeEligibility: taskWriteEligibility,
    };
    const statement = parsed.data.complete
      ? completeTaskStatement({
          churchId: actor.plantId,
          taskId: expected.id,
          actorUserId: actor.userId,
          completedAt,
          ...commonExpected,
        })
      : reopenTaskStatement({
          churchId: actor.plantId,
          taskId: expected.id,
          ...commonExpected,
        });
    const claim = await claimEvryDatabaseEffectDecision({
      execution: input.execution,
      effectKey: input.effectKey,
      mutation: statement,
      async targetIsCurrent() {
        if (!(await taskActorStillAuthorized(actor, expected.assignedToId)))
          return false;
        const current = await taskSnapshot(actor.plantId, expected.id);
        return (
          current !== null &&
          JSON.stringify(current) === JSON.stringify(expected)
        );
      },
    });
    return claim.result.status === "completed"
      ? await reconcileClaimedLaunchEffect(
          {
            effectKey: input.effectKey,
            execution: input.execution,
            arguments: input.arguments,
          },
          identity,
          claim.result
        )
      : claim.result;
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
      if (!(await actorStillAuthorized(actor, "launch.schedule"))) return false;
      const current = await getLaunchForChurch(actor.plantId);
      return Boolean(current && sameLaunch(expected, current));
    },
  });
  return claim.result.status === "completed"
    ? await reconcileClaimedLaunchEffect(
        {
          effectKey: input.effectKey,
          execution: input.execution,
          arguments: input.arguments,
        },
        identity,
        claim.result
      )
    : claim.result;
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
      async reconcileClaimed(input) {
        try {
          const claim = await findExactEvryDatabaseEffectClaim(input);
          if (!claim) return null;
          return await reconcileClaimedLaunchEffect(input, identity, claim);
        } catch {
          return { status: "retryable" };
        }
      },
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
      let resolvedTargets:
        | {
            label: string;
            value: string;
            sourceLink: { label: string; href: string };
          }[]
        | null = null;
      let exclusions: { reason: string; count: number }[] = [];
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
        contentPreviews = [
          ...(args.note
            ? [
                {
                  label: "Journal note",
                  content: html(args.note),
                  format: "rich_text" as const,
                },
              ]
            : []),
          {
            label: "Exact readiness rows",
            content: html(JSON.stringify(args.consequences.readiness, null, 2)),
            format: "rich_text",
          },
          ...args.consequences.notifications.map((notification, index) => ({
            label: `Exact oversight notification ${index + 1}`,
            content: html(JSON.stringify(notification, null, 2)),
            format: "rich_text" as const,
          })),
        ];
        const readinessTaskCount = args.consequences.readiness.reduce(
          (total, milestone) => total + milestone.tasks.length,
          0
        );
        consequences = [
          "This changes the Launch Sunday date and status and appends one permanent journal entry.",
          `This idempotently ensures the ${args.consequences.readiness.length} exact reviewed Launch Playbook milestones and ${readinessTaskCount} exact readiness tasks exist; existing rows are not duplicated or overwritten.`,
          `${args.consequences.notifications.length} exact reviewed oversight notification(s) are queued after the durable write; audience and privacy are rechecked before the write.`,
        ];
        counts = [
          { label: "Launch records to change", count: 1 },
          { label: "Journal entries to append", count: 1 },
          {
            label: "Required milestones after the change",
            count: args.consequences.readiness.length,
          },
          {
            label: "Required readiness tasks after the change",
            count: readinessTaskCount,
          },
        ];
        reversibility = "irreversible";
        resolvedTargets = [
          {
            label: "Launch record",
            value: args.expected?.id ?? args.consequences.launchId,
            sourceLink: { label: "Open Launch Sunday", href: "/launch" },
          },
          ...args.consequences.readiness.map((row) => ({
            label: "Readiness milestone",
            value: `${row.milestoneId}: ${row.title}`,
            sourceLink: { label: "Open Launch Sunday", href: "/launch" },
          })),
          ...args.consequences.notifications.map((row) => ({
            label: "Oversight recipient",
            value: row.recipientUserId,
            sourceLink: { label: "Open Launch Sunday", href: "/launch" },
          })),
        ];
        exclusions = args.consequences.notificationExclusions.map(
          ({ reason, count }) => ({ reason, count })
        );
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
        resolvedTargets = [
          {
            label: "Launch milestone",
            value: `${args.expected.id}: ${args.expected.title}`,
            sourceLink: { label: "Open Launch Sunday", href: "/launch" },
          },
        ];
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
        const reviewedTaskTarget = {
          label: "Launch task",
          value: `${args.expected.id}: ${args.expected.title}`,
          sourceLink: { label: "Open Launch Sunday", href: "/launch" },
        };
        resolvedTargets = [reviewedTaskTarget];
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
              "This completes exactly this task, reconciles its pending notifications, emits its completion event, and marks the plant for a fresh assessment.",
              args.completion?.recurrence?.disposition === "create"
                ? `It creates the exact reviewed recurring successor and ${args.completion.recurrence.children.length} exact fresh checklist item(s).`
                : args.completion?.recurrence?.disposition === "existing"
                  ? `The series already has the exact open successor ${args.completion.recurrence.successorId}; this creates no duplicate.`
                  : "It creates no recurring successor.",
            ]
          : [
              args.expected.isRecurring
                ? "This reopens exactly this recurring task only if its series still has no other open instance, then re-enqueues the notifications owed by its current assignment and due date."
                : "This reopens exactly this non-recurring task and re-enqueues the notifications owed by its current assignment and due date.",
              "It does not create another task or change any other task.",
            ];
        counts = [
          { label: "Task records to change", count: 1 },
          ...(args.completion?.recurrence?.disposition === "create"
            ? [
                { label: "Successor tasks to create", count: 1 },
                {
                  label: "Successor checklist items to create",
                  count: args.completion.recurrence.children.length,
                },
              ]
            : []),
        ];
        contentPreviews = args.completion?.recurrence
          ? [
              {
                label: "Exact recurring successor and checklist",
                content: html(
                  JSON.stringify(args.completion.recurrence, null, 2)
                ),
                format: "rich_text",
              },
            ]
          : [];
        if (args.completion?.recurrence?.disposition === "create") {
          resolvedTargets = [
            reviewedTaskTarget,
            {
              label: "Recurring successor",
              value: args.completion.recurrence.successor.id,
              sourceLink: { label: "Open Launch Sunday", href: "/launch" },
            },
            ...args.completion.recurrence.children.map((child) => ({
              label: "Successor checklist item",
              value: `${child.id}: ${child.title}`,
              sourceLink: { label: "Open Launch Sunday", href: "/launch" },
            })),
          ];
        } else if (args.completion?.recurrence?.disposition === "existing") {
          resolvedTargets = [
            reviewedTaskTarget,
            {
              label: "Existing recurring successor",
              value: args.completion.recurrence.successorId,
              sourceLink: { label: "Open Launch Sunday", href: "/launch" },
            },
          ];
        }
      } else {
        const args = launchOutcomeArgumentsSchema.parse(step.arguments);
        const correction = identity === LAUNCH_EFFECT_IDENTITIES.correctOutcome;
        title = correction ? "Correct launch outcome" : "Record launch outcome";
        actionLabel = correction ? "Save correction" : "Record outcome";
        resolvedTargets = [
          {
            label: "Launch record",
            value: args.expected.id,
            sourceLink: { label: "Open Launch Sunday", href: "/launch" },
          },
        ];
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
            resolvedTargets: resolvedTargets ?? [
              {
                label: "Target",
                value: target,
                sourceLink: { label: "Open Launch Sunday", href: "/launch" },
              },
            ],
            counts,
            exclusions,
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
