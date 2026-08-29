import { z } from "zod";

import {
  taskCategories,
  taskPriorities,
  taskRelatedTypes,
  taskStatuses,
} from "@/db/schema/tasks";
import { notificationStatuses } from "@/db/schema/notifications";
import { recurrenceRuleSchema } from "@/lib/tasks/recurrence";

import { TASK_ACTION_CONTRACTS, type TaskActionExport } from "./contracts";

const uuid = z.string().uuid();
const timestamp = z.string().datetime();
const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();
const nullableText = z.string().nullable();
const uniqueUuids = z.array(uuid).superRefine((values, context) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message: "IDs must be unique" });
  }
});

export const taskEffectSnapshotSchema = z.strictObject({
  id: uuid,
  title: z.string().trim().min(1).max(500),
  description: nullableText,
  status: z.enum(taskStatuses),
  priority: z.enum(taskPriorities),
  dueDate: z.string().date().nullable(),
  dueTime: z
    .string()
    .regex(/^\d{2}:\d{2}(?::\d{2})?$/)
    .nullable(),
  assignedToId: nullableUuid,
  category: z.enum(taskCategories).nullable(),
  relatedType: z.enum(taskRelatedTypes).nullable(),
  relatedId: nullableUuid,
  parentTaskId: nullableUuid,
  isRecurring: z.boolean(),
  recurrenceRule: recurrenceRuleSchema.nullable(),
  completionEvent: z.string().max(100).nullable(),
  completedAt: nullableTimestamp,
  completedById: nullableUuid,
  createdById: uuid,
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: nullableTimestamp,
});

export type TaskEffectSnapshot = z.infer<typeof taskEffectSnapshotSchema>;

const taskWriteSchema = z
  .strictObject({
    taskId: uuid,
    before: taskEffectSnapshotSchema.nullable(),
    after: taskEffectSnapshotSchema,
  })
  .superRefine((value, context) => {
    if (
      value.taskId !== value.after.id ||
      (value.before !== null && value.before.id !== value.taskId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Task write IDs must name the exact before and after row",
      });
    }
    if (value.before && value.before.createdAt !== value.after.createdAt) {
      context.addIssue({
        code: "custom",
        message: "Task updates cannot rewrite creation time",
      });
    }
  });

const dependencySetSchema = z.strictObject({
  taskId: uuid,
  beforePrerequisiteIds: uniqueUuids,
  afterPrerequisiteIds: uniqueUuids,
});

const childSetSchema = z.strictObject({
  parentTaskId: uuid,
  taskIds: uniqueUuids,
});

const notificationSnapshotSchema = z.strictObject({
  notificationId: uuid,
  recipientUserId: uuid,
  type: z.enum(["task.due", "task.overdue"]),
  title: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1).max(4_000),
  entityId: uuid,
  dedupeKey: z.string().trim().min(1).max(255),
  scheduledFor: timestamp,
  status: z.enum(notificationStatuses),
  expectedUpdatedAt: nullableTimestamp,
});

const notificationChangeSchema = z.strictObject({
  scopedTaskIds: uniqueUuids,
  before: z.array(notificationSnapshotSchema),
  after: z.array(notificationSnapshotSchema),
});

const phaseTransitionSchema = z.strictObject({
  transitionId: uuid,
  expectedCreatedAt: timestamp,
  answerId: uuid,
  answer: z.enum(["accepted", "declined"]),
  expectedUnanswered: z.literal(true),
});

const materialStampSchema = z.strictObject({
  expectedLastMaterialEventAt: nullableTimestamp,
  expectedChurchUpdatedAt: timestamp,
  nextLastMaterialEventAt: timestamp,
  nextChurchUpdatedAt: timestamp,
});

const contactLogEffectSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("create"),
    taskId: uuid,
    personId: uuid,
    expectedPersonEmail: z.string().max(255).nullable(),
    communicationId: uuid,
    recipientId: uuid,
    subject: z.string().trim().min(1).max(500),
    body: z.string().trim().min(1).max(4_000),
    completedAt: timestamp,
    createdById: uuid,
    createdAt: timestamp,
  }),
  z.strictObject({
    kind: z.literal("already_logged"),
    taskId: uuid,
    existingRecipientId: uuid,
  }),
  z.strictObject({
    kind: z.literal("not_applicable"),
    taskId: uuid,
    reason: z.enum(["not_person", "person_unavailable"]),
    personId: uuid.nullable(),
  }),
]);

const completionEffectsSchema = z.strictObject({
  materialStamp: materialStampSchema.nullable(),
  contactLogs: z.array(contactLogEffectSchema).max(100),
});

const sourceAssertionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("none"),
  }),
  z.strictObject({
    kind: z.literal("subtasks"),
    parentTaskId: uuid,
    taskIds: uniqueUuids,
  }),
  z.strictObject({
    kind: z.literal("follow_up_owner"),
    fromAssigneeId: uuid,
    taskIds: uniqueUuids,
  }),
  z.strictObject({
    kind: z.literal("phase_transition"),
    transitionId: uuid,
    templateKeys: z.array(z.string().trim().min(1).max(160)).max(20),
  }),
]);

const exclusionSchema = z.strictObject({
  target: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(1).max(500),
});

const disclosureSchema = z.strictObject({
  title: z.string().trim().min(1).max(500),
  targets: z.array(z.string().trim().min(1).max(500)).min(1),
  counts: z.array(
    z.strictObject({
      label: z.string().trim().min(1).max(160),
      count: z.number().int().nonnegative(),
    })
  ),
  changes: z.array(
    z.strictObject({
      label: z.string().trim().min(1).max(160),
      before: z.string().max(2_000),
      after: z.string().max(2_000),
    })
  ),
  consequences: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20),
  reversibility: z.enum(["reversible", "difficult_to_reverse", "irreversible"]),
});

const commonShape = {
  /** Exact rows on which the `tasks.own` subject rule was decided. */
  subjectTasks: z.array(taskEffectSnapshotSchema).max(100),
  /** Exact existing Task rows used to derive parents or prerequisites. */
  sourceTasks: z.array(taskEffectSnapshotSchema),
  /** Exact live child sets used to decide whether nesting remains legal. */
  childSets: z.array(childSetSchema).max(100),
  // Source-derived effects (handoff, parent deletion, recurrence cloning) do
  // not share the UI's 100-row selection cap. Every valid resolved row must
  // remain representable so confirmation never stores an unreplayable subset.
  taskWrites: z.array(taskWriteSchema),
  dependencySets: z.array(dependencySetSchema).max(100),
  notifications: notificationChangeSchema,
  phaseTransition: phaseTransitionSchema.nullable(),
  completionEffects: completionEffectsSchema,
  sourceAssertion: sourceAssertionSchema,
  exclusions: z.array(exclusionSchema).max(100),
  disclosure: disclosureSchema,
} as const;

function operationShape<ExportName extends TaskActionExport>(
  exportName: ExportName
) {
  return { operation: z.literal(exportName), ...commonShape } as const;
}

function operationSchema<ExportName extends TaskActionExport>(
  exportName: ExportName
) {
  return z
    .strictObject(operationShape(exportName))
    .superRefine((value, context) => {
      const taskIds = value.taskWrites.map(({ taskId }) => taskId);
      if (new Set(taskIds).size !== taskIds.length) {
        context.addIssue({
          code: "custom",
          message: "Task writes must be unique",
        });
      }
      const dependencyIds = value.dependencySets.map(({ taskId }) => taskId);
      if (new Set(dependencyIds).size !== dependencyIds.length) {
        context.addIssue({
          code: "custom",
          message: "Dependency replacement targets must be unique",
        });
      }
      for (const collection of [
        value.notifications.before,
        value.notifications.after,
      ]) {
        const notificationIds = collection.map(
          ({ notificationId }) => notificationId
        );
        if (new Set(notificationIds).size !== notificationIds.length) {
          context.addIssue({
            code: "custom",
            message: "Notification rows must be unique within each state",
          });
        }
      }
      for (const before of value.notifications.before) {
        const retained = value.notifications.after.find(
          ({ notificationId }) => notificationId === before.notificationId
        );
        if (retained && JSON.stringify(retained) !== JSON.stringify(before)) {
          context.addIssue({
            code: "custom",
            message: "A retained notification must remain byte-for-byte exact",
          });
        }
      }
      const effect = TASK_ACTION_CONTRACTS[exportName];
      if (effect.operationKind !== "effect") {
        context.addIssue({
          code: "custom",
          message: "Read actions cannot be planned",
        });
      }
      if (value.taskWrites.length === 0 && value.phaseTransition === null) {
        context.addIssue({
          code: "custom",
          message: "A Task effect must disclose at least one durable write",
        });
      }
      const subjectIds = value.subjectTasks.map(({ id }) => id);
      if (new Set(subjectIds).size !== subjectIds.length) {
        context.addIssue({
          code: "custom",
          message: "Own-duty subjects must be unique",
        });
      }
      const sourceIds = value.sourceTasks.map(({ id }) => id);
      if (new Set(sourceIds).size !== sourceIds.length) {
        context.addIssue({
          code: "custom",
          message: "Task source snapshots must be unique",
        });
      }
      const childSetIds = value.childSets.map(
        ({ parentTaskId }) => parentTaskId
      );
      if (new Set(childSetIds).size !== childSetIds.length) {
        context.addIssue({
          code: "custom",
          message: "Task child-set assertions must be unique",
        });
      }
      const boundSourceIds = new Set([...subjectIds, ...sourceIds]);
      const plannedTaskIds = new Set(taskIds);
      for (const write of value.taskWrites) {
        const parentTaskId = write.after.parentTaskId;
        if (
          parentTaskId &&
          (write.before === null || exportName === "updateTaskAction") &&
          !boundSourceIds.has(parentTaskId) &&
          !plannedTaskIds.has(parentTaskId)
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Every existing parent Task must have an exact source snapshot",
          });
        }
        if (
          write.before !== null &&
          parentTaskId !== null &&
          exportName === "updateTaskAction" &&
          !value.childSets.some(
            ({ parentTaskId }) => parentTaskId === write.taskId
          )
        ) {
          context.addIssue({
            code: "custom",
            message: "Nesting an existing Task must bind its exact child set",
          });
        }
      }
      for (const dependency of value.dependencySets) {
        for (const prerequisiteTaskId of dependency.afterPrerequisiteIds) {
          if (!sourceIds.includes(prerequisiteTaskId)) {
            context.addIssue({
              code: "custom",
              message: "Every prerequisite must have an exact source snapshot",
            });
          }
        }
      }
      const creates = value.taskWrites.filter(({ before }) => before === null);
      const updates = value.taskWrites.filter(({ before }) => before !== null);
      const scoped = [...value.notifications.scopedTaskIds].toSorted();
      const written = value.taskWrites.map(({ taskId }) => taskId).toSorted();
      if (
        scoped.length !== written.length ||
        scoped.some((id, index) => id !== written[index])
      ) {
        context.addIssue({
          code: "custom",
          message: "Notification scope must equal the exact Task write set",
        });
      }
      const phaseOperation =
        exportName === "importPhaseTemplatesAction" ||
        exportName === "dismissPhaseTemplatePromptAction";
      if (phaseOperation !== (value.phaseTransition !== null)) {
        context.addIssue({
          code: "custom",
          message: "Only phase-prompt effects may carry a phase answer",
        });
      }
      const completionOperation = new Set<TaskActionExport>([
        "bulkCompleteTasksAction",
        "completeTaskAction",
        "setSubtaskCompletionAction",
        "updateTaskStatusAction",
      ]).has(exportName);
      const completedIds = completionOperation
        ? value.taskWrites
            .filter(
              ({ before, after }) =>
                before !== null &&
                before.status !== "complete" &&
                after.status === "complete"
            )
            .map(({ taskId }) => taskId)
            .toSorted()
        : [];
      const contactIds = value.completionEffects.contactLogs
        .map(({ taskId }) => taskId)
        .toSorted();
      const communicationIds = value.completionEffects.contactLogs.flatMap(
        (contact) =>
          contact.kind === "create" ? [contact.communicationId] : []
      );
      const recipientIds = value.completionEffects.contactLogs.flatMap(
        (contact) =>
          contact.kind === "create"
            ? [contact.recipientId]
            : contact.kind === "already_logged"
              ? [contact.existingRecipientId]
              : []
      );
      if (
        completedIds.length !== contactIds.length ||
        completedIds.some((id, index) => id !== contactIds[index]) ||
        completedIds.length > 0 !==
          (value.completionEffects.materialStamp !== null)
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Completion side effects must bind every emitted task.completed consequence exactly",
        });
      }
      if (
        new Set(communicationIds).size !== communicationIds.length ||
        new Set(recipientIds).size !== recipientIds.length
      ) {
        context.addIssue({
          code: "custom",
          message: "Completion contact-log identities must be unique",
        });
      }
      if (
        value.completionEffects.materialStamp &&
        value.completionEffects.materialStamp.nextLastMaterialEventAt !==
          value.completionEffects.materialStamp.nextChurchUpdatedAt
      ) {
        context.addIssue({
          code: "custom",
          message: "A material completion stamp must use one exact instant",
        });
      }
      const taskById = new Map(
        value.taskWrites.map((write) => [write.taskId, write])
      );
      for (const contact of value.completionEffects.contactLogs) {
        const write = taskById.get(contact.taskId);
        if (!write?.before || write.after.status !== "complete") {
          context.addIssue({
            code: "custom",
            message: "A contact-log consequence must name its completed Task",
          });
          continue;
        }
        if (
          contact.kind === "create" &&
          (write.after.relatedType !== "person" ||
            write.after.relatedId !== contact.personId ||
            write.after.title !== contact.subject ||
            write.after.completedAt !== contact.completedAt ||
            write.after.completedById !== contact.createdById ||
            contact.createdAt !== contact.completedAt)
        ) {
          context.addIssue({
            code: "custom",
            message:
              "A Task contact log must be derived from the exact completion",
          });
        }
        if (
          contact.kind === "already_logged" &&
          (write.after.relatedType !== "person" || !write.after.relatedId)
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Only a person-related Task may already have a contact log",
          });
        }
        if (
          contact.kind === "not_applicable" &&
          contact.reason === "not_person" &&
          (write.after.relatedType === "person" || contact.personId !== null)
        ) {
          context.addIssue({
            code: "custom",
            message: "Only a non-person Task may omit its person-contact log",
          });
        }
        if (
          contact.kind === "not_applicable" &&
          contact.reason === "person_unavailable" &&
          (write.after.relatedType !== "person" ||
            write.after.relatedId !== contact.personId)
        ) {
          context.addIssue({
            code: "custom",
            message:
              "An unavailable person must match the completed Task target",
          });
        }
      }
      const ownDutyOperation = new Set<TaskActionExport>([
        "addSubtaskAction",
        "bulkCompleteTasksAction",
        "completeTaskAction",
        "reopenTaskAction",
        "setSubtaskCompletionAction",
        "updateTaskStatusAction",
      ]).has(exportName);
      if (ownDutyOperation && value.subjectTasks.length === 0) {
        context.addIssue({
          code: "custom",
          message: `${exportName} must bind its exact own-duty subject`,
        });
      }
      const singleCreate = new Set<TaskActionExport>([
        "addSubtaskAction",
        "createAndAssignFollowUpAction",
        "createTaskAction",
        "quickAddTaskAction",
      ]);
      if (
        singleCreate.has(exportName) &&
        (creates.length !== 1 || updates.length !== 0)
      ) {
        context.addIssue({
          code: "custom",
          message: `${exportName} must create exactly one Task row`,
        });
      }
      const singleUpdate = new Set<TaskActionExport>([
        "assignFollowUpAction",
        "reopenTaskAction",
        "setSubtaskCompletionAction",
        "updateTaskAction",
        "updateTaskStatusAction",
      ]);
      if (
        singleUpdate.has(exportName) &&
        (updates.length !== 1 || creates.length !== 0)
      ) {
        context.addIssue({
          code: "custom",
          message: `${exportName} must update exactly one Task row`,
        });
      }
      if (
        exportName === "deleteTaskAction" &&
        (updates.length === 0 ||
          creates.length !== 0 ||
          updates.some(({ after }) => after.deletedAt === null))
      ) {
        context.addIssue({
          code: "custom",
          message: "Delete must disclose only exact soft-deleted rows",
        });
      }
      if (
        (exportName === "bulkRescheduleTasksAction" ||
          exportName === "handOffFollowUpsAction") &&
        (updates.length === 0 || creates.length !== 0)
      ) {
        context.addIssue({
          code: "custom",
          message: `${exportName} must update one non-empty exact set`,
        });
      }
      if (
        exportName === "completeTaskAction" &&
        (updates.length !== 1 ||
          updates[0]?.after.status !== "complete" ||
          value.subjectTasks.length !== 1)
      ) {
        context.addIssue({
          code: "custom",
          message: "Single completion must bind one exact own-duty subject",
        });
      }
      if (
        exportName === "bulkCompleteTasksAction" &&
        (updates.length === 0 ||
          updates.some(({ after }) => after.status !== "complete") ||
          value.subjectTasks.length !== updates.length)
      ) {
        context.addIssue({
          code: "custom",
          message: "Bulk completion must bind every completed own-duty subject",
        });
      }
      if (
        exportName === "reopenTaskAction" &&
        (updates[0]?.before?.status !== "complete" ||
          updates[0]?.after.status !== "not_started")
      ) {
        context.addIssue({
          code: "custom",
          message: "Reopen must move one completed Task to not started",
        });
      }
      if (
        exportName === "importTaskTemplateAction" &&
        (creates.length === 0 || updates.length !== 0)
      ) {
        context.addIssue({
          code: "custom",
          message: "Template import must create one non-empty exact Task set",
        });
      }
      if (
        exportName === "importPhaseTemplatesAction" &&
        (creates.length === 0 ||
          updates.length !== 0 ||
          value.phaseTransition?.answer !== "accepted" ||
          value.sourceAssertion.kind !== "phase_transition")
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Phase import must atomically accept and create its exact set",
        });
      }
      if (
        exportName === "dismissPhaseTemplatePromptAction" &&
        (value.taskWrites.length !== 0 ||
          value.phaseTransition?.answer !== "declined" ||
          value.sourceAssertion.kind !== "phase_transition")
      ) {
        context.addIssue({
          code: "custom",
          message: "Phase dismissal may only write its exact declined answer",
        });
      }
      if (
        exportName === "handOffFollowUpsAction" &&
        value.sourceAssertion.kind !== "follow_up_owner"
      ) {
        context.addIssue({
          code: "custom",
          message: "Follow-up handoff must bind its complete live source set",
        });
      }
      if (
        exportName === "deleteTaskAction" &&
        value.sourceAssertion.kind !== "subtasks"
      ) {
        context.addIssue({
          code: "custom",
          message: "Delete must bind the complete checklist target set",
        });
      }
      if (
        exportName !== "createTaskAction" &&
        exportName !== "updateTaskAction" &&
        value.dependencySets.length > 0
      ) {
        context.addIssue({
          code: "custom",
          message: "Only full create and update may replace prerequisites",
        });
      }
    });
}

const EFFECT_EXPORTS = Object.keys(TASK_ACTION_CONTRACTS).filter(
  (exportName) =>
    TASK_ACTION_CONTRACTS[exportName as TaskActionExport].operationKind ===
    "effect"
) as Exclude<TaskActionExport, "loadMoreTasksAction">[];

export const TASKS_EFFECT_ARGUMENT_SHAPES = Object.freeze(
  Object.fromEntries(
    EFFECT_EXPORTS.map((exportName) => [exportName, operationShape(exportName)])
  )
) as {
  [ExportName in Exclude<TaskActionExport, "loadMoreTasksAction">]: ReturnType<
    typeof operationShape<ExportName>
  >;
};

export const TASKS_EFFECT_ARGUMENT_SCHEMAS = Object.freeze(
  Object.fromEntries(
    EFFECT_EXPORTS.map((exportName) => [
      exportName,
      operationSchema(exportName),
    ])
  )
) as {
  [ExportName in Exclude<TaskActionExport, "loadMoreTasksAction">]: ReturnType<
    typeof operationSchema<ExportName>
  >;
};

export type TaskEffectExport = keyof typeof TASKS_EFFECT_ARGUMENT_SCHEMAS;
export type TaskEffectArguments<ExportName extends TaskEffectExport> = z.infer<
  (typeof TASKS_EFFECT_ARGUMENT_SCHEMAS)[ExportName]
>;

export type AnyTaskEffectArguments = TaskEffectArguments<TaskEffectExport>;
