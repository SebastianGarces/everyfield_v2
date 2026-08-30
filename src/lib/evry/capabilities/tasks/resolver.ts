import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churchMeetings,
  churches,
  communicationRecipients,
  ministryTeams,
  notifications,
  persons,
  phasePromptAnswers,
  phaseTransitions,
  taskDependencies,
  tasks,
  type Task,
} from "@/db/schema";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { tenancyColumns } from "@/lib/auth/tenancy";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryPlanRequestKey } from "@/lib/evry/plans";
import type { EvryResolvedPageContext } from "@/lib/evry/resolvers/contract";
import { normalizeTaskDescription } from "@/lib/tasks/descriptions";
import { mayActOnTaskRow } from "@/lib/tasks/own-duty";
import { taskEntryBody, taskEntryReference } from "@/lib/communication/log";
import { hasCycle } from "@/lib/tasks/dependencies";
import { planTemplateImport } from "@/lib/tasks/import";
import {
  listFollowUpAssignees,
  OWNED_TASK_CATEGORY,
} from "@/lib/tasks/follow-up-ownership";
import { isExactTaskAssignee } from "@/lib/tasks/assignees";
import {
  planTaskNotifications,
  taskNotificationsDiffer,
} from "@/lib/tasks/notifications";
import {
  nextRecurrenceDueDate,
  parseRecurrenceRule,
  seriesIdOf,
} from "@/lib/tasks/recurrence";
import { findTaskTemplate } from "@/lib/tasks/templates";
import { toCalendarDate } from "@/lib/datetime";

import {
  TASKS_EFFECT_ARGUMENT_SCHEMAS,
  type AnyTaskEffectArguments,
  type TaskEffectArguments,
  type TaskEffectExport,
  type TaskEffectSnapshot,
} from "./effect-contracts";
import type { TaskEvryEffectSelection } from "./selection";

type ResolvedFor<ExportName extends TaskEffectExport> = Readonly<{
  exportName: ExportName;
  arguments: TaskEffectArguments<ExportName>;
}>;

export type ResolvedTaskEffect = Readonly<{
  exportName: TaskEffectExport;
  arguments: AnyTaskEffectArguments;
}>;

type TaskWrite = AnyTaskEffectArguments["taskWrites"][number];
type NotificationChange = AnyTaskEffectArguments["notifications"];
type CompletionEffects = AnyTaskEffectArguments["completionEffects"];

function iso(value: Date): string {
  return value.toISOString();
}

function derivedUuid(requestKey: EvryPlanRequestKey, purpose: string): string {
  const hash = createHash("sha256");
  for (const value of ["evry-tasks-row-v1", requestKey, purpose]) {
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

function snapshot(row: Task): TaskEffectSnapshot {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    dueTime: row.dueTime,
    assignedToId: row.assignedToId,
    category: row.category,
    relatedType: row.relatedType,
    relatedId: row.relatedId,
    parentTaskId: row.parentTaskId,
    isRecurring: row.isRecurring,
    recurrenceRule: parseRecurrenceRule(row.recurrenceRule),
    completionEvent: row.completionEvent,
    completedAt: row.completedAt ? iso(row.completedAt) : null,
    completedById: row.completedById,
    createdById: row.createdById,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    deletedAt: row.deletedAt ? iso(row.deletedAt) : null,
  };
}

function uniqueSnapshots(rows: readonly Task[]): TaskEffectSnapshot[] {
  return [...new Map(rows.map((row) => [row.id, snapshot(row)])).values()];
}

function createSnapshot(input: {
  id: string;
  actor: EvryPlantActor;
  now: Date;
  offset?: number;
  title: string;
  description?: string | null;
  status?: TaskEffectSnapshot["status"];
  priority?: TaskEffectSnapshot["priority"];
  dueDate?: string | null;
  dueTime?: string | null;
  assignedToId?: string | null;
  category?: TaskEffectSnapshot["category"];
  relatedType?: TaskEffectSnapshot["relatedType"];
  relatedId?: string | null;
  parentTaskId?: string | null;
  isRecurring?: boolean;
  recurrenceRule?: TaskEffectSnapshot["recurrenceRule"];
  createdById?: string;
}): TaskEffectSnapshot {
  const at = new Date(input.now.getTime() + (input.offset ?? 0)).toISOString();
  return {
    id: input.id,
    title: input.title.trim(),
    description: normalizeTaskDescription(input.description ?? null),
    status: input.status ?? "not_started",
    priority: input.priority ?? "medium",
    dueDate: input.dueDate ?? null,
    dueTime: input.dueTime ?? null,
    assignedToId: input.assignedToId ?? null,
    category: input.category ?? null,
    relatedType: input.relatedType ?? null,
    relatedId: input.relatedId ?? null,
    parentTaskId: input.parentTaskId ?? null,
    isRecurring: input.isRecurring ?? false,
    recurrenceRule: input.recurrenceRule ?? null,
    completionEvent: null,
    completedAt: null,
    completedById: null,
    createdById: input.createdById ?? input.actor.userId,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
}

function updateSnapshot(
  before: TaskEffectSnapshot,
  patch: Partial<TaskEffectSnapshot>,
  now: Date
): TaskEffectSnapshot {
  return { ...before, ...patch, id: before.id, updatedAt: iso(now) };
}

async function loadTask(plantId: string, taskId: string): Promise<Task | null> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.churchId, plantId),
        isNull(tasks.deletedAt)
      )
    )
    .limit(1);
  return row ?? null;
}

async function loadExactTasks(
  plantId: string,
  taskIds: readonly string[]
): Promise<Task[] | null> {
  if (taskIds.length === 0) return [];
  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.churchId, plantId),
        inArray(tasks.id, [...taskIds]),
        isNull(tasks.deletedAt)
      )
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return taskIds.length === rows.length && taskIds.every((id) => byId.has(id))
    ? taskIds.map((id) => byId.get(id)!)
    : null;
}

function mayAct(actor: EvryPlantActor, task: Task): boolean {
  return mayActOnTaskRow({
    canWrite: holdsSeatFor(
      {
        ...tenancyColumns({ type: "church", id: actor.plantId }),
        seat: actor.seat,
      },
      "tasks.write"
    ),
    assignedToId: task.assignedToId,
    viewerId: actor.userId,
  });
}

type BulkSelectionAssertion = Extract<
  AnyTaskEffectArguments["sourceAssertion"],
  { kind: "bulk_selection" }
>;

async function planBulkSelection(input: {
  actor: EvryPlantActor;
  taskIds: readonly string[];
  ownDuty: boolean;
  completedReason:
    | "Task is already complete"
    | "Task is complete — reopen it before rescheduling";
}): Promise<{
  rows: Task[];
  sourceAssertion: BulkSelectionAssertion;
  exclusions: AnyTaskEffectArguments["exclusions"];
}> {
  const requestedTaskIds = [...new Set(input.taskIds)];
  const found =
    requestedTaskIds.length === 0
      ? []
      : await db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.churchId, input.actor.plantId),
              inArray(tasks.id, requestedTaskIds),
              isNull(tasks.deletedAt)
            )
          );
  const byId = new Map(found.map((row) => [row.id, row]));
  const rows: Task[] = [];
  const excludedTasks: BulkSelectionAssertion["excludedTasks"] = [];

  for (const taskId of requestedTaskIds) {
    const row = byId.get(taskId);
    if (!row) {
      excludedTasks.push({
        taskId,
        reason: "Task not found",
        expectedTask: null,
      });
    } else if (row.status === "complete") {
      excludedTasks.push({
        taskId,
        reason: input.completedReason,
        expectedTask: snapshot(row),
      });
    } else if (input.ownDuty && !mayAct(input.actor, row)) {
      excludedTasks.push({
        taskId,
        reason: "That task is assigned to somebody else",
        expectedTask: snapshot(row),
      });
    } else {
      rows.push(row);
    }
  }

  return {
    rows,
    sourceAssertion: {
      kind: "bulk_selection",
      requestedTaskIds,
      actionableTaskIds: rows.map(({ id }) => id),
      excludedTasks,
    },
    exclusions: excludedTasks.map((excluded) => ({
      target: excluded.expectedTask
        ? `Task ${excluded.taskId}: ${excluded.expectedTask.title}`
        : `Task ${excluded.taskId}`,
      reason: excluded.reason,
    })),
  };
}

async function validPlantUser(
  plantId: string,
  userId: string
): Promise<boolean> {
  return isExactTaskAssignee(plantId, userId);
}

async function validFollowUpAssignee(
  plantId: string,
  userId: string
): Promise<boolean> {
  const rows = await listFollowUpAssignees(plantId);
  return rows.some(({ id }) => id === userId);
}

async function relatedTargetIsValid(input: {
  plantId: string;
  relatedType: TaskEffectSnapshot["relatedType"];
  relatedId: string | null;
}): Promise<boolean> {
  if (!input.relatedId) return true;
  if (input.relatedType === "person") {
    const [row] = await db
      .select({ id: persons.id })
      .from(persons)
      .where(
        and(
          eq(persons.id, input.relatedId),
          eq(persons.churchId, input.plantId),
          isNull(persons.deletedAt)
        )
      )
      .limit(1);
    return Boolean(row);
  }
  if (input.relatedType === "meeting") {
    const [row] = await db
      .select({ id: churchMeetings.id })
      .from(churchMeetings)
      .where(
        and(
          eq(churchMeetings.id, input.relatedId),
          eq(churchMeetings.churchId, input.plantId)
        )
      )
      .limit(1);
    return Boolean(row);
  }
  if (input.relatedType === "team") {
    const [row] = await db
      .select({ id: ministryTeams.id })
      .from(ministryTeams)
      .where(
        and(
          eq(ministryTeams.id, input.relatedId),
          eq(ministryTeams.churchId, input.plantId)
        )
      )
      .limit(1);
    return Boolean(row);
  }
  // Tasks currently have no authoritative Facility entity table.
  return false;
}

async function dependencyIds(
  plantId: string,
  taskId: string
): Promise<string[]> {
  const rows = await db
    .select({ prerequisiteTaskId: taskDependencies.prerequisiteTaskId })
    .from(taskDependencies)
    .where(
      and(
        eq(taskDependencies.churchId, plantId),
        eq(taskDependencies.taskId, taskId)
      )
    )
    .orderBy(taskDependencies.prerequisiteTaskId);
  return rows.map(({ prerequisiteTaskId }) => prerequisiteTaskId);
}

async function validPrerequisiteTasks(input: {
  plantId: string;
  taskId: string;
  ids: readonly string[];
}): Promise<Task[] | null> {
  if (input.ids.includes(input.taskId)) return null;
  const requested = await loadExactTasks(input.plantId, input.ids);
  if (
    !requested ||
    requested.some(({ parentTaskId }) => parentTaskId !== null)
  ) {
    return null;
  }
  const edges = await db
    .select({
      taskId: taskDependencies.taskId,
      prerequisiteTaskId: taskDependencies.prerequisiteTaskId,
    })
    .from(taskDependencies)
    .where(eq(taskDependencies.churchId, input.plantId));
  return hasCycle([
    ...edges.filter(({ taskId }) => taskId !== input.taskId),
    ...input.ids.map((prerequisiteTaskId) => ({
      taskId: input.taskId,
      prerequisiteTaskId,
    })),
  ])
    ? null
    : requested;
}

async function pendingNotifications(
  plantId: string,
  taskIds: readonly string[]
): Promise<NotificationChange["before"]> {
  if (taskIds.length === 0) return [];
  const rows = await db
    .select({
      notificationId: notifications.id,
      recipientUserId: notifications.recipientUserId,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
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
        eq(notifications.category, "tasks"),
        eq(notifications.entityType, "task"),
        inArray(notifications.entityId, [...taskIds]),
        eq(notifications.status, "pending")
      )
    )
    .orderBy(notifications.entityId, notifications.id);
  return rows.flatMap((row) =>
    row.entityId &&
    row.dedupeKey &&
    (row.type === "task.due" || row.type === "task.overdue")
      ? [
          {
            ...row,
            type: row.type,
            entityId: row.entityId,
            dedupeKey: row.dedupeKey,
            scheduledFor: iso(row.scheduledFor),
            expectedUpdatedAt: iso(row.expectedUpdatedAt),
          },
        ]
      : []
  );
}

async function notificationChange(input: {
  actor: EvryPlantActor;
  requestKey: EvryPlanRequestKey;
  writes: readonly TaskWrite[];
  now: Date;
}): Promise<NotificationChange> {
  const scopedTaskIds = input.writes.map(({ taskId }) => taskId);
  const before = await pendingNotifications(input.actor.plantId, scopedTaskIds);
  const beforeByTask = new Map<string, typeof before>();
  for (const row of before) {
    const values = beforeByTask.get(row.entityId) ?? [];
    values.push(row);
    beforeByTask.set(row.entityId, values);
  }
  const after = input.writes.flatMap((write) => {
    const current = beforeByTask.get(write.taskId) ?? [];
    if (
      write.before &&
      !taskNotificationsDiffer(
        {
          ...write.before,
          churchId: input.actor.plantId,
          deletedAt: write.before.deletedAt
            ? new Date(write.before.deletedAt)
            : null,
        },
        {
          ...write.after,
          churchId: input.actor.plantId,
          deletedAt: write.after.deletedAt
            ? new Date(write.after.deletedAt)
            : null,
        }
      )
    ) {
      return current;
    }
    const plan = planTaskNotifications(
      {
        ...write.after,
        churchId: input.actor.plantId,
        deletedAt: write.after.deletedAt
          ? new Date(write.after.deletedAt)
          : null,
      },
      input.now
    );
    return plan.notifications.map((planned, index) => ({
      notificationId: derivedUuid(
        input.requestKey,
        `notification:${write.taskId}:${planned.type}:${index}`
      ),
      recipientUserId: planned.recipientUserId,
      type: planned.type as "task.due" | "task.overdue",
      title: planned.title,
      body: planned.body,
      entityId: write.taskId,
      dedupeKey: planned.dedupeKey!,
      scheduledFor: iso(planned.scheduledFor!),
      status: "pending" as const,
      expectedUpdatedAt: null,
    }));
  });
  return { scopedTaskIds, before, after };
}

const COMPLETION_EVENT_EXPORTS = new Set<TaskEffectExport>([
  "bulkCompleteTasksAction",
  "completeTaskAction",
  "setSubtaskCompletionAction",
  "updateTaskStatusAction",
]);

async function completionEffects(input: {
  exportName: TaskEffectExport;
  actor: EvryPlantActor;
  requestKey: EvryPlanRequestKey;
  writes: readonly TaskWrite[];
  now: Date;
}): Promise<CompletionEffects | null> {
  const completed = COMPLETION_EVENT_EXPORTS.has(input.exportName)
    ? input.writes.filter(
        ({ before, after }) =>
          before !== null &&
          before.status !== "complete" &&
          after.status === "complete"
      )
    : [];
  if (completed.length === 0) {
    return { materialStamp: null, contactLogs: [] };
  }
  const [plant] = await db
    .select({
      lastMaterialEventAt: churches.lastMaterialEventAt,
      updatedAt: churches.updatedAt,
    })
    .from(churches)
    .where(eq(churches.id, input.actor.plantId))
    .limit(1);
  if (!plant) return null;

  const personIds = completed.flatMap(({ after }) =>
    after.relatedType === "person" && after.relatedId ? [after.relatedId] : []
  );
  const [peopleRows, existingRows] = await Promise.all([
    personIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ id: persons.id, email: persons.email })
          .from(persons)
          .where(
            and(
              eq(persons.churchId, input.actor.plantId),
              inArray(persons.id, personIds),
              isNull(persons.deletedAt)
            )
          ),
    db
      .select({
        id: communicationRecipients.id,
        externalId: communicationRecipients.externalId,
      })
      .from(communicationRecipients)
      .where(
        and(
          eq(communicationRecipients.churchId, input.actor.plantId),
          inArray(
            communicationRecipients.externalId,
            completed.map(({ taskId }) => taskEntryReference(taskId))
          )
        )
      ),
  ]);
  const personById = new Map(peopleRows.map((person) => [person.id, person]));
  const existingByTaskReference = new Map(
    existingRows.flatMap((row) =>
      row.externalId ? [[row.externalId, row] as const] : []
    )
  );
  const createdAt = iso(input.now);
  const contactLogs: CompletionEffects["contactLogs"] = completed.map(
    ({ taskId, after }) => {
      if (after.relatedType !== "person" || !after.relatedId) {
        return {
          kind: "not_applicable" as const,
          taskId,
          reason: "not_person" as const,
          personId: null,
        };
      }
      const existing = existingByTaskReference.get(taskEntryReference(taskId));
      if (existing) {
        return {
          kind: "already_logged" as const,
          taskId,
          existingRecipientId: existing.id,
        };
      }
      const person = personById.get(after.relatedId);
      if (!person) {
        return {
          kind: "not_applicable" as const,
          taskId,
          reason: "person_unavailable" as const,
          personId: after.relatedId,
        };
      }
      return {
        kind: "create" as const,
        taskId,
        personId: person.id,
        expectedPersonEmail: person.email,
        communicationId: derivedUuid(
          input.requestKey,
          `contact:${taskId}:entry`
        ),
        recipientId: derivedUuid(
          input.requestKey,
          `contact:${taskId}:recipient`
        ),
        subject: after.title,
        body: taskEntryBody(
          after.title,
          after.category,
          new Date(after.completedAt!)
        ),
        completedAt: after.completedAt!,
        createdById: input.actor.userId,
        createdAt,
      };
    }
  );
  return {
    materialStamp: {
      expectedLastMaterialEventAt: plant.lastMaterialEventAt
        ? iso(plant.lastMaterialEventAt)
        : null,
      expectedChurchUpdatedAt: iso(plant.updatedAt),
      nextLastMaterialEventAt: createdAt,
      nextChurchUpdatedAt: createdAt,
    },
    contactLogs,
  };
}

function change(label: string, before: unknown, after: unknown) {
  const render = (value: unknown) =>
    typeof value === "string" ? value : JSON.stringify(value);
  return { label, before: render(before), after: render(after) };
}

function disclosure(input: {
  title: string;
  writes: readonly TaskWrite[];
  consequences: readonly string[];
  difficult?: boolean;
  extraTargets?: readonly string[];
}) {
  return {
    title: input.title,
    targets: [
      ...input.writes.map(
        ({ taskId, after }) => `Task ${taskId}: ${after.title}`
      ),
      ...(input.extraTargets ?? []),
    ],
    counts: [
      { label: "Tasks changed", count: input.writes.length },
      {
        label: "Tasks created",
        count: input.writes.filter(({ before }) => before === null).length,
      },
    ],
    changes: input.writes.flatMap(({ before, after }) => [
      change(
        `${after.title} — status`,
        before?.status ?? "Absent",
        after.status
      ),
      change(
        `${after.title} — due date`,
        before?.dueDate ?? "None",
        after.dueDate ?? "None"
      ),
      change(
        `${after.title} — assignee`,
        before?.assignedToId ?? "Unassigned",
        after.assignedToId ?? "Unassigned"
      ),
    ]),
    consequences: [...input.consequences],
    reversibility: input.difficult
      ? ("difficult_to_reverse" as const)
      : ("reversible" as const),
  };
}

async function resolved<ExportName extends TaskEffectExport>(input: {
  exportName: ExportName;
  actor: EvryPlantActor;
  requestKey: EvryPlanRequestKey;
  now: Date;
  writes: TaskWrite[];
  subjectTasks?: TaskEffectSnapshot[];
  sourceTasks?: TaskEffectSnapshot[];
  childSets?: AnyTaskEffectArguments["childSets"];
  dependencySets?: AnyTaskEffectArguments["dependencySets"];
  phaseTransition?: AnyTaskEffectArguments["phaseTransition"];
  sourceAssertion?: AnyTaskEffectArguments["sourceAssertion"];
  exclusions?: AnyTaskEffectArguments["exclusions"];
  disclosure: AnyTaskEffectArguments["disclosure"];
}): Promise<ResolvedFor<ExportName> | null> {
  const completion = await completionEffects({
    exportName: input.exportName,
    actor: input.actor,
    requestKey: input.requestKey,
    writes: input.writes,
    now: input.now,
  });
  if (!completion) return null;
  const createdLogs = completion.contactLogs.filter(
    (effect) => effect.kind === "create"
  );
  const skippedLogs = completion.contactLogs.filter(
    (effect) => effect.kind !== "create"
  );
  const args = {
    operation: input.exportName,
    subjectTasks: input.subjectTasks ?? [],
    sourceTasks: input.sourceTasks ?? [],
    childSets: input.childSets ?? [],
    taskWrites: input.writes,
    dependencySets: input.dependencySets ?? [],
    notifications: await notificationChange({
      actor: input.actor,
      requestKey: input.requestKey,
      writes: input.writes,
      now: input.now,
    }),
    phaseTransition: input.phaseTransition ?? null,
    completionEffects: completion,
    sourceAssertion: input.sourceAssertion ?? { kind: "none" as const },
    exclusions: [
      ...(input.exclusions ?? []),
      ...skippedLogs.map((effect) => ({
        target: `Task ${effect.taskId}`,
        reason:
          effect.kind === "already_logged"
            ? "The completed contact is already present in the person's communication log."
            : effect.reason === "person_unavailable"
              ? "The related person is unavailable in this plant, so no contact-log entry will be added."
              : "This Task is not related to a person, so no contact-log entry applies.",
      })),
    ],
    disclosure: {
      ...input.disclosure,
      targets: [
        ...input.disclosure.targets,
        ...createdLogs.map(
          (effect) =>
            `Person ${effect.personId} contact log from Task ${effect.taskId}`
        ),
      ],
      counts: [
        ...input.disclosure.counts,
        ...(completion.materialStamp
          ? [{ label: "Plant assessment freshness stamps", count: 1 }]
          : []),
        ...(completion.contactLogs.length > 0
          ? [{ label: "Person contact log entries", count: createdLogs.length }]
          : []),
      ],
      changes: [
        ...input.disclosure.changes,
        ...(completion.materialStamp
          ? [
              change(
                "Plant assessment freshness",
                completion.materialStamp.expectedLastMaterialEventAt ?? "Never",
                completion.materialStamp.nextLastMaterialEventAt
              ),
            ]
          : []),
        ...createdLogs.map((effect) =>
          change(`Contact log for ${effect.personId}`, "Absent", effect.body)
        ),
      ],
      consequences: [
        ...input.disclosure.consequences,
        ...(completion.materialStamp
          ? [
              "Completing the disclosed Task work marks this plant for a fresh Plant Intelligence assessment.",
            ]
          : []),
        ...(createdLogs.length > 0
          ? [
              "Each disclosed person-related completion adds the shown logged-contact entry; no message is sent.",
            ]
          : []),
      ],
    },
  };
  const parsed =
    TASKS_EFFECT_ARGUMENT_SCHEMAS[input.exportName].safeParse(args);
  return parsed.success
    ? ({
        exportName: input.exportName,
        arguments: parsed.data,
      } as ResolvedFor<ExportName>)
    : null;
}

function taskIdFrom(input: {
  values: Readonly<Record<string, unknown>>;
  pageContext: EvryResolvedPageContext | null;
  key?: string;
}): string | null {
  const key = input.key ?? "taskId";
  const explicit = input.values[key];
  if (typeof explicit === "string") return explicit;
  return input.pageContext?.kind === "task" ? input.pageContext.recordId : null;
}

async function completionWrites(input: {
  actor: EvryPlantActor;
  requestKey: EvryPlanRequestKey;
  rows: readonly Task[];
  now: Date;
}): Promise<Readonly<{
  writes: TaskWrite[];
  sourceTasks: TaskEffectSnapshot[];
  childSets: AnyTaskEffectArguments["childSets"];
}> | null> {
  const writes: TaskWrite[] = [];
  const sourceTasks: TaskEffectSnapshot[] = [];
  const childSets: AnyTaskEffectArguments["childSets"] = [];
  for (const row of input.rows) {
    if (row.status === "complete" || !mayAct(input.actor, row)) return null;
    const before = snapshot(row);
    writes.push({
      taskId: row.id,
      before,
      after: updateSnapshot(
        before,
        {
          status: "complete",
          completedAt: iso(input.now),
          completedById: input.actor.userId,
        },
        input.now
      ),
    });
    const rule = parseRecurrenceRule(row.recurrenceRule);
    if (!row.isRecurring || !rule) continue;
    const nextDueDate = nextRecurrenceDueDate(
      rule,
      row.dueDate,
      toCalendarDate(input.now)
    );
    if (!nextDueDate) continue;
    const seriesId = seriesIdOf(row);
    const [openSuccessor] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, input.actor.plantId),
          ne(tasks.id, row.id),
          ne(tasks.status, "complete"),
          isNull(tasks.deletedAt),
          eq(tasks.isRecurring, true),
          sql`(
            ${tasks.id} = ${seriesId}::uuid
            or ${tasks.recurrenceRule}->>'seriesId' = ${seriesId}
          )`
        )
      )
      .limit(1);
    if (openSuccessor) continue;
    const successorId = derivedUuid(
      input.requestKey,
      `recurrence:${row.id}:successor`
    );
    const successor = createSnapshot({
      id: successorId,
      actor: input.actor,
      now: input.now,
      title: row.title,
      description: row.description,
      priority: row.priority,
      dueDate: nextDueDate,
      dueTime: row.dueTime,
      assignedToId: row.assignedToId,
      category: row.category,
      relatedType: row.relatedType,
      relatedId: row.relatedId,
      parentTaskId: row.parentTaskId,
      isRecurring: true,
      recurrenceRule: { ...rule, seriesId },
      createdById: row.createdById,
    });
    writes.push({ taskId: successorId, before: null, after: successor });
    const children = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, input.actor.plantId),
          eq(tasks.parentTaskId, row.id),
          isNull(tasks.deletedAt)
        )
      )
      .orderBy(asc(tasks.createdAt), asc(tasks.id));
    sourceTasks.push(...children.map(snapshot));
    childSets.push({
      parentTaskId: row.id,
      taskIds: children.map(({ id }) => id),
    });
    children.forEach((child, index) => {
      const id = derivedUuid(
        input.requestKey,
        `recurrence:${row.id}:child:${child.id}`
      );
      writes.push({
        taskId: id,
        before: null,
        after: createSnapshot({
          id,
          actor: input.actor,
          now: input.now,
          offset: index + 1,
          title: child.title,
          description: child.description,
          priority: child.priority,
          dueTime: child.dueTime,
          assignedToId: child.assignedToId,
          category: child.category,
          relatedType: child.relatedType,
          relatedId: child.relatedId,
          parentTaskId: successorId,
          createdById: row.createdById,
        }),
      });
    });
  }
  return { writes, sourceTasks, childSets };
}

/** Resolve every Task command to an immutable, exact, tenant-scoped write set. */
export async function resolveTaskEvryEffect(input: {
  actor: EvryPlantActor;
  selection: TaskEvryEffectSelection;
  pageContext: EvryResolvedPageContext | null;
  requestKey: EvryPlanRequestKey;
  now: Date;
}): Promise<ResolvedTaskEffect | null> {
  const { actor, selection, pageContext, requestKey, now } = input;
  const { exportName, values } = selection;

  if (
    exportName === "createTaskAction" ||
    exportName === "quickAddTaskAction"
  ) {
    const taskId = derivedUuid(requestKey, "task:create");
    const assignedToId =
      exportName === "quickAddTaskAction"
        ? actor.userId
        : typeof values.assignedToId === "string"
          ? values.assignedToId
          : null;
    const category =
      typeof values.category === "string"
        ? (values.category as TaskEffectSnapshot["category"])
        : null;
    const recurrence =
      typeof values.recurrence === "string" ? values.recurrence : "none";
    const after = createSnapshot({
      id: taskId,
      actor,
      now,
      title: String(values.title),
      description:
        typeof values.description === "string" ? values.description : null,
      status:
        typeof values.status === "string"
          ? (values.status as TaskEffectSnapshot["status"])
          : "not_started",
      priority:
        typeof values.priority === "string"
          ? (values.priority as TaskEffectSnapshot["priority"])
          : "medium",
      dueDate: typeof values.dueDate === "string" ? values.dueDate : null,
      dueTime: typeof values.dueTime === "string" ? values.dueTime : null,
      assignedToId,
      category,
      relatedType:
        typeof values.relatedType === "string"
          ? (values.relatedType as TaskEffectSnapshot["relatedType"])
          : null,
      relatedId: typeof values.relatedId === "string" ? values.relatedId : null,
      parentTaskId:
        typeof values.parentTaskId === "string" ? values.parentTaskId : null,
      isRecurring: recurrence !== "none",
      recurrenceRule:
        recurrence === "none"
          ? null
          : {
              interval: recurrence as NonNullable<
                TaskEffectSnapshot["recurrenceRule"]
              >["interval"],
              endDate:
                typeof values.recurrenceEndDate === "string"
                  ? values.recurrenceEndDate
                  : null,
            },
    });
    if (
      !(await relatedTargetIsValid({
        plantId: actor.plantId,
        relatedType: after.relatedType,
        relatedId: after.relatedId,
      }))
    ) {
      return null;
    }
    let parent: Task | null = null;
    if (after.parentTaskId) {
      parent = await loadTask(actor.plantId, after.parentTaskId);
      if (!parent || parent.parentTaskId || !mayAct(actor, parent)) return null;
      after.assignedToId = after.assignedToId ?? parent.assignedToId;
    }
    if (
      after.assignedToId &&
      (!(await validPlantUser(actor.plantId, after.assignedToId)) ||
        (after.category === OWNED_TASK_CATEGORY &&
          !(await validFollowUpAssignee(actor.plantId, after.assignedToId))))
    ) {
      return null;
    }
    const prerequisiteTaskIds = Array.isArray(values.prerequisiteTaskIds)
      ? values.prerequisiteTaskIds.filter(
          (value): value is string => typeof value === "string"
        )
      : [];
    const prerequisiteTasks = await validPrerequisiteTasks({
      plantId: actor.plantId,
      taskId,
      ids: prerequisiteTaskIds,
    });
    if (!prerequisiteTasks) return null;
    const writes = [{ taskId, before: null, after }];
    return resolved({
      exportName,
      actor,
      requestKey,
      now,
      writes,
      sourceTasks: uniqueSnapshots([
        ...(parent ? [parent] : []),
        ...prerequisiteTasks,
      ]),
      dependencySets:
        exportName === "createTaskAction"
          ? [
              {
                taskId,
                beforePrerequisiteIds: [],
                afterPrerequisiteIds: prerequisiteTaskIds,
              },
            ]
          : [],
      disclosure: disclosure({
        title:
          exportName === "quickAddTaskAction"
            ? "Quick add task"
            : "Create task",
        writes,
        consequences: [
          "The disclosed task, prerequisite edges, and due notifications will be created together.",
        ],
      }),
    });
  }

  if (exportName === "updateTaskAction") {
    const taskId = taskIdFrom({ values, pageContext });
    const row = taskId ? await loadTask(actor.plantId, taskId) : null;
    if (!row) return null;
    const before = snapshot(row);
    const recurrence = values.recurrence;
    const after = updateSnapshot(
      before,
      {
        ...(typeof values.title === "string"
          ? { title: values.title.trim() }
          : {}),
        ...(values.description !== undefined
          ? {
              description: normalizeTaskDescription(
                values.description as string | null
              ),
            }
          : {}),
        ...(typeof values.status === "string"
          ? { status: values.status as TaskEffectSnapshot["status"] }
          : {}),
        ...(typeof values.priority === "string"
          ? { priority: values.priority as TaskEffectSnapshot["priority"] }
          : {}),
        ...(values.dueDate !== undefined
          ? { dueDate: values.dueDate as string | null }
          : {}),
        ...(values.dueTime !== undefined
          ? { dueTime: values.dueTime as string | null }
          : {}),
        ...(values.assignedToId !== undefined
          ? { assignedToId: values.assignedToId as string | null }
          : {}),
        ...(values.category !== undefined
          ? { category: values.category as TaskEffectSnapshot["category"] }
          : {}),
        ...(values.relatedType !== undefined
          ? {
              relatedType:
                values.relatedType as TaskEffectSnapshot["relatedType"],
            }
          : {}),
        ...(values.relatedId !== undefined
          ? { relatedId: values.relatedId as string | null }
          : {}),
        ...(values.parentTaskId !== undefined
          ? { parentTaskId: values.parentTaskId as string | null }
          : {}),
        ...(typeof recurrence === "string"
          ? recurrence === "none"
            ? { isRecurring: false, recurrenceRule: null }
            : {
                isRecurring: true,
                recurrenceRule: {
                  interval: recurrence as NonNullable<
                    TaskEffectSnapshot["recurrenceRule"]
                  >["interval"],
                  endDate:
                    typeof values.recurrenceEndDate === "string"
                      ? values.recurrenceEndDate
                      : null,
                  seriesId: before.recurrenceRule?.seriesId,
                },
              }
          : {}),
      },
      now
    );
    if (
      after.assignedToId &&
      (!(await validPlantUser(actor.plantId, after.assignedToId)) ||
        (after.category === OWNED_TASK_CATEGORY &&
          !(await validFollowUpAssignee(actor.plantId, after.assignedToId))))
    ) {
      return null;
    }
    if (
      !(await relatedTargetIsValid({
        plantId: actor.plantId,
        relatedType: after.relatedType,
        relatedId: after.relatedId,
      }))
    ) {
      return null;
    }
    let parent: Task | null = null;
    let childIds: string[] | null = null;
    if (after.parentTaskId) {
      parent = await loadTask(actor.plantId, after.parentTaskId);
      const children = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.churchId, actor.plantId),
            eq(tasks.parentTaskId, row.id),
            isNull(tasks.deletedAt)
          )
        );
      childIds = children.map(({ id }) => id).toSorted();
      if (
        !parent ||
        parent.parentTaskId ||
        children.length > 0 ||
        parent.id === row.id
      ) {
        return null;
      }
    }
    const beforePrerequisiteIds = await dependencyIds(actor.plantId, row.id);
    const afterPrerequisiteIds = Array.isArray(values.prerequisiteTaskIds)
      ? values.prerequisiteTaskIds.filter(
          (value): value is string => typeof value === "string"
        )
      : beforePrerequisiteIds;
    const prerequisiteTasks = await validPrerequisiteTasks({
      plantId: actor.plantId,
      taskId: row.id,
      ids: afterPrerequisiteIds,
    });
    if (!prerequisiteTasks) return null;
    const writes = [{ taskId: row.id, before, after }];
    return resolved({
      exportName,
      actor,
      requestKey,
      now,
      writes,
      sourceTasks: uniqueSnapshots([
        ...(parent ? [parent] : []),
        ...prerequisiteTasks,
      ]),
      childSets:
        childIds === null ? [] : [{ parentTaskId: row.id, taskIds: childIds }],
      dependencySets: [
        { taskId: row.id, beforePrerequisiteIds, afterPrerequisiteIds },
      ],
      disclosure: disclosure({
        title: "Update task",
        writes,
        consequences: [
          "The task, prerequisites, and any changed due notifications will move to the disclosed state together.",
        ],
      }),
    });
  }

  if (exportName === "completeTaskAction") {
    const ids = [taskIdFrom({ values, pageContext })].filter(
      (value): value is string => value !== null
    );
    const rows = await loadExactTasks(actor.plantId, ids);
    const completion = rows
      ? await completionWrites({ actor, requestKey, rows, now })
      : null;
    if (!rows || !completion || rows.length === 0) return null;
    return resolved({
      exportName,
      actor,
      requestKey,
      now,
      writes: completion.writes,
      subjectTasks: rows.map(snapshot),
      sourceTasks: completion.sourceTasks,
      childSets: completion.childSets,
      disclosure: disclosure({
        title: "Complete task",
        writes: completion.writes,
        consequences: [
          "The disclosed task will be completed and its pending due notifications cancelled.",
          "Any disclosed recurring successor and fresh checklist will be created in the same transaction.",
        ],
      }),
    });
  }

  if (exportName === "bulkCompleteTasksAction") {
    const ids = Array.isArray(values.taskIds)
      ? values.taskIds.filter(
          (value): value is string => typeof value === "string"
        )
      : [];
    const selection = await planBulkSelection({
      actor,
      taskIds: ids,
      ownDuty: true,
      completedReason: "Task is already complete",
    });
    const completion = await completionWrites({
      actor,
      requestKey,
      rows: selection.rows,
      now,
    });
    if (!completion || selection.rows.length === 0) return null;
    return resolved({
      exportName,
      actor,
      requestKey,
      now,
      writes: completion.writes,
      subjectTasks: selection.rows.map(snapshot),
      sourceTasks: completion.sourceTasks,
      childSets: completion.childSets,
      sourceAssertion: selection.sourceAssertion,
      exclusions: selection.exclusions,
      disclosure: disclosure({
        title: "Complete selected tasks",
        writes: completion.writes,
        consequences: [
          "Every eligible disclosed task will be completed and its pending due notifications cancelled.",
          "Every named exclusion will remain unchanged.",
          "Any disclosed recurring successor and fresh checklist will be created in the same transaction.",
        ],
      }),
    });
  }

  if (exportName === "updateTaskStatusAction" && values.status === "complete") {
    const taskId = taskIdFrom({ values, pageContext });
    const row = taskId ? await loadTask(actor.plantId, taskId) : null;
    const completion = row
      ? await completionWrites({ actor, requestKey, rows: [row], now })
      : null;
    if (!row || !completion) return null;
    return resolved({
      exportName,
      actor,
      requestKey,
      now,
      writes: completion.writes,
      subjectTasks: [snapshot(row)],
      sourceTasks: completion.sourceTasks,
      childSets: completion.childSets,
      disclosure: disclosure({
        title: "Complete task",
        writes: completion.writes,
        consequences: [
          "The disclosed task will be completed and its pending due notifications cancelled.",
          "Any disclosed recurring successor and fresh checklist will be created in the same transaction.",
        ],
      }),
    });
  }

  if (
    exportName === "reopenTaskAction" ||
    exportName === "updateTaskStatusAction" ||
    exportName === "setSubtaskCompletionAction"
  ) {
    const taskId = taskIdFrom({
      values,
      pageContext,
      key: exportName === "setSubtaskCompletionAction" ? "subtaskId" : "taskId",
    });
    const row = taskId ? await loadTask(actor.plantId, taskId) : null;
    if (!row || !mayAct(actor, row)) return null;
    if (exportName === "setSubtaskCompletionAction" && !row.parentTaskId)
      return null;
    const before = snapshot(row);
    const afterStatus =
      exportName === "reopenTaskAction"
        ? "not_started"
        : exportName === "setSubtaskCompletionAction"
          ? values.complete === true
            ? "complete"
            : "not_started"
          : (values.status as TaskEffectSnapshot["status"]);
    if (
      (afterStatus === "complete" && before.status === "complete") ||
      (exportName === "reopenTaskAction" && before.status !== "complete")
    ) {
      return null;
    }
    const writes = [
      {
        taskId: row.id,
        before,
        after: updateSnapshot(
          before,
          afterStatus === "complete"
            ? {
                status: "complete",
                completedAt: iso(now),
                completedById: actor.userId,
              }
            : {
                status: afterStatus,
                completedAt: null,
                completedById: null,
              },
          now
        ),
      },
    ];
    return resolved({
      exportName,
      actor,
      requestKey,
      now,
      writes,
      subjectTasks: [before],
      disclosure: disclosure({
        title:
          exportName === "setSubtaskCompletionAction"
            ? "Update checklist item"
            : exportName === "reopenTaskAction"
              ? "Reopen task"
              : "Update task status",
        writes,
        consequences: [
          "The exact status and due-notification state shown here will be changed together.",
          ...(exportName === "setSubtaskCompletionAction"
            ? ["The parent task will not be completed automatically."]
            : []),
        ],
      }),
    });
  }

  if (exportName === "deleteTaskAction") {
    const taskId = taskIdFrom({ values, pageContext });
    const row = taskId ? await loadTask(actor.plantId, taskId) : null;
    if (!row) return null;
    const children = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, actor.plantId),
          eq(tasks.parentTaskId, row.id),
          isNull(tasks.deletedAt)
        )
      )
      .orderBy(asc(tasks.createdAt), asc(tasks.id));
    const rows = [row, ...children];
    const writes = rows.map((task) => {
      const before = snapshot(task);
      return {
        taskId: task.id,
        before,
        after: updateSnapshot(before, { deletedAt: iso(now) }, now),
      };
    });
    return resolved({
      exportName,
      actor,
      requestKey,
      now,
      writes,
      sourceAssertion: {
        kind: "subtasks",
        parentTaskId: row.id,
        taskIds: children.map(({ id }) => id),
      },
      disclosure: disclosure({
        title: "Delete task and checklist",
        writes,
        difficult: true,
        consequences: [
          "The task and every disclosed checklist item will be hidden and their pending notifications cancelled.",
          "This change has no restore control in the Tasks interface.",
        ],
      }),
    });
  }

  if (exportName === "addSubtaskAction") {
    const parentId = taskIdFrom({ values, pageContext, key: "parentTaskId" });
    const parent = parentId ? await loadTask(actor.plantId, parentId) : null;
    if (!parent || parent.parentTaskId || !mayAct(actor, parent)) return null;
    const id = derivedUuid(requestKey, `subtask:${parent.id}`);
    const after = createSnapshot({
      id,
      actor,
      now,
      title: String(values.title),
      assignedToId: parent.assignedToId,
      parentTaskId: parent.id,
    });
    const writes = [{ taskId: id, before: null, after }];
    return resolved({
      exportName,
      actor,
      requestKey,
      now,
      writes,
      subjectTasks: [snapshot(parent)],
      disclosure: disclosure({
        title: "Add checklist item",
        writes,
        extraTargets: [`Parent task ${parent.id}: ${parent.title}`],
        consequences: [
          "A one-level checklist item will be added under the disclosed parent task.",
        ],
      }),
    });
  }

  if (exportName === "bulkRescheduleTasksAction") {
    const ids = Array.isArray(values.taskIds)
      ? values.taskIds.filter(
          (value): value is string => typeof value === "string"
        )
      : [];
    const selection = await planBulkSelection({
      actor,
      taskIds: ids,
      ownDuty: false,
      completedReason: "Task is complete — reopen it before rescheduling",
    });
    if (selection.rows.length === 0) return null;
    const writes = selection.rows.map((row) => {
      const before = snapshot(row);
      return {
        taskId: row.id,
        before,
        after: updateSnapshot(before, { dueDate: String(values.dueDate) }, now),
      };
    });
    return resolved({
      exportName,
      actor,
      requestKey,
      now,
      writes,
      sourceAssertion: selection.sourceAssertion,
      exclusions: selection.exclusions,
      disclosure: disclosure({
        title: "Reschedule selected tasks",
        writes,
        consequences: [
          "Every eligible selected task will move to the disclosed due date and its due notifications will be replaced exactly.",
          "Every named exclusion will remain unchanged.",
        ],
      }),
    });
  }

  if (exportName === "assignFollowUpAction") {
    const taskId = String(values.taskId);
    const assigneeId = String(values.assigneeId);
    const row = await loadTask(actor.plantId, taskId);
    if (
      !row ||
      row.category !== OWNED_TASK_CATEGORY ||
      !(await validFollowUpAssignee(actor.plantId, assigneeId))
    ) {
      return null;
    }
    const before = snapshot(row);
    const writes = [
      {
        taskId: row.id,
        before,
        after: updateSnapshot(before, { assignedToId: assigneeId }, now),
      },
    ];
    return resolved({
      exportName,
      actor,
      requestKey,
      now,
      writes,
      disclosure: disclosure({
        title: "Assign follow-up",
        writes,
        consequences: [
          "The open follow-up and any due notifications will move to the disclosed committed member.",
        ],
      }),
    });
  }

  if (exportName === "createAndAssignFollowUpAction") {
    const personId = String(values.personId);
    const assigneeId = String(values.assigneeId);
    const [[person], assigneeValid] = await Promise.all([
      db
        .select({ id: persons.id })
        .from(persons)
        .where(
          and(
            eq(persons.id, personId),
            eq(persons.churchId, actor.plantId),
            isNull(persons.deletedAt)
          )
        )
        .limit(1),
      validFollowUpAssignee(actor.plantId, assigneeId),
    ]);
    if (!person || !assigneeValid) return null;
    const taskId = derivedUuid(requestKey, `follow-up:${personId}`);
    const after = createSnapshot({
      id: taskId,
      actor,
      now,
      title: `Follow up with ${String(values.personName)}`.trim(),
      assignedToId: assigneeId,
      category: "follow_up",
      relatedType: "person",
      relatedId: personId,
    });
    const writes = [{ taskId, before: null, after }];
    return resolved({
      exportName,
      actor,
      requestKey,
      now,
      writes,
      disclosure: disclosure({
        title: "Create and assign follow-up",
        writes,
        extraTargets: [`Person ${personId}`],
        consequences: [
          "A plant-visible follow-up will be created for the disclosed person and assigned to the disclosed committed member.",
        ],
      }),
    });
  }

  if (exportName === "handOffFollowUpsAction") {
    const fromAssigneeId = String(values.fromAssigneeId);
    const toAssigneeId = String(values.toAssigneeId);
    if (!(await validFollowUpAssignee(actor.plantId, toAssigneeId)))
      return null;
    const rows = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, actor.plantId),
          eq(tasks.category, OWNED_TASK_CATEGORY),
          eq(tasks.assignedToId, fromAssigneeId),
          ne(tasks.status, "complete"),
          isNull(tasks.deletedAt)
        )
      )
      .orderBy(tasks.id);
    if (rows.length === 0) return null;
    const writes = rows.map((row) => {
      const before = snapshot(row);
      return {
        taskId: row.id,
        before,
        after: updateSnapshot(before, { assignedToId: toAssigneeId }, now),
      };
    });
    return resolved({
      exportName,
      actor,
      requestKey,
      now,
      writes,
      sourceAssertion: {
        kind: "follow_up_owner",
        fromAssigneeId,
        taskIds: rows.map(({ id }) => id),
      },
      disclosure: disclosure({
        title: "Hand off follow-ups",
        writes,
        extraTargets: [
          `From user ${fromAssigneeId}`,
          `To user ${toAssigneeId}`,
        ],
        consequences: [
          "The exact open follow-up set and its due notifications will move together; any source-set drift refuses the plan.",
        ],
      }),
    });
  }

  if (exportName === "importTaskTemplateAction") {
    const templateKey = String(values.templateKey);
    const template = findTaskTemplate(templateKey);
    if (!template) return null;
    const plan = planTemplateImport(template, now);
    const writes = plan.tasks.map((item, index) => {
      const id = derivedUuid(
        requestKey,
        `template:${template.key}:${item.itemKey}`
      );
      return {
        taskId: id,
        before: null,
        after: createSnapshot({
          id,
          actor,
          now,
          offset: index,
          title: item.title,
          description: item.description,
          priority: item.priority,
          dueDate: item.dueDate,
          assignedToId: actor.userId,
          category: item.category,
        }),
      };
    });
    return resolved({
      exportName,
      actor,
      requestKey,
      now,
      writes,
      disclosure: disclosure({
        title: `Import checklist: ${template.name}`,
        writes,
        consequences: [
          "Every disclosed checklist task and due notification will be created together.",
          "Importing this checklist again creates a separate second copy.",
        ],
      }),
    });
  }

  if (
    exportName === "importPhaseTemplatesAction" ||
    exportName === "dismissPhaseTemplatePromptAction"
  ) {
    const transitionId = String(values.transitionId);
    const [transition] = await db
      .select({
        id: phaseTransitions.id,
        createdAt: phaseTransitions.createdAt,
        fromPhase: phaseTransitions.fromPhase,
        toPhase: phaseTransitions.toPhase,
        kind: phaseTransitions.kind,
      })
      .from(phaseTransitions)
      .leftJoin(
        phasePromptAnswers,
        eq(phasePromptAnswers.transitionId, phaseTransitions.id)
      )
      .where(
        and(
          eq(phaseTransitions.churchId, actor.plantId),
          eq(phaseTransitions.kind, "transition"),
          isNull(phasePromptAnswers.id)
        )
      )
      .orderBy(desc(phaseTransitions.createdAt), desc(phaseTransitions.id))
      .limit(1);
    if (!transition || transition.id !== transitionId) return null;
    const answerId = derivedUuid(requestKey, `phase-answer:${transition.id}`);
    const templateKeys =
      exportName === "importPhaseTemplatesAction" &&
      Array.isArray(values.templateKeys)
        ? values.templateKeys.filter(
            (value): value is string => typeof value === "string"
          )
        : [];
    const templates = templateKeys.map(findTaskTemplate);
    if (
      templates.some((template) => !template) ||
      templates.some((template) => template!.phase !== transition.toPhase)
    ) {
      return null;
    }
    const writes = templates.flatMap((template, templateIndex) => {
      const plan = planTemplateImport(template!, transition.createdAt);
      return plan.tasks.map((item, itemIndex) => {
        const id = derivedUuid(
          requestKey,
          `phase:${transition.id}:${template!.key}:${item.itemKey}`
        );
        return {
          taskId: id,
          before: null,
          after: createSnapshot({
            id,
            actor,
            now: transition.createdAt,
            offset: templateIndex * 100 + itemIndex,
            title: item.title,
            description: item.description,
            priority: item.priority,
            dueDate: item.dueDate,
            assignedToId: actor.userId,
            category: item.category,
          }),
        };
      });
    });
    const isDismiss = exportName === "dismissPhaseTemplatePromptAction";
    return resolved({
      exportName,
      actor,
      requestKey,
      now,
      writes,
      phaseTransition: {
        transitionId: transition.id,
        expectedCreatedAt: iso(transition.createdAt),
        answerId,
        answer: isDismiss ? "declined" : "accepted",
        expectedUnanswered: true,
      },
      sourceAssertion: {
        kind: "phase_transition",
        transitionId: transition.id,
        templateKeys,
      },
      disclosure: {
        ...disclosure({
          title: isDismiss
            ? "Dismiss phase checklist suggestions"
            : "Import phase checklists",
          writes,
          extraTargets: [`Phase transition ${transition.id}`],
          difficult: isDismiss,
          consequences: isDismiss
            ? [
                "The plant-wide checklist prompt will be permanently marked declined for this transition.",
              ]
            : [
                "The transition will be marked accepted and every disclosed task will be imported from the transition date.",
              ],
        }),
        targets:
          writes.length > 0
            ? disclosure({
                title: "phase",
                writes,
                extraTargets: [`Phase transition ${transition.id}`],
                consequences: ["phase"],
              }).targets
            : [`Phase transition ${transition.id}`],
      },
    });
  }

  return null;
}
