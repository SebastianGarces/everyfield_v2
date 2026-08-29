import { TASK_ACTION_CONTRACTS } from "./contracts";
import type { TaskEffectExport, TaskEffectSnapshot } from "./effect-contracts";

export const TASK_FIXTURE_ID = "00000000-0000-4000-8000-000000000001";
export const TASK_FIXTURE_ACTOR_ID = "00000000-0000-4000-8000-000000000002";
export const TASK_FIXTURE_TIME = "2026-08-29T12:00:00.000Z";

export const TASK_EFFECT_SELECTION_FIXTURES: Readonly<
  Record<TaskEffectExport, string>
> = Object.freeze({
  addSubtaskAction: `add checklist item to task ${TASK_FIXTURE_ID}: Prepare handout`,
  assignFollowUpAction: `assign follow-up task ${TASK_FIXTURE_ID} to user ${TASK_FIXTURE_ACTOR_ID}`,
  bulkCompleteTasksAction: `complete tasks ${TASK_FIXTURE_ID}, 00000000-0000-4000-8000-000000000003`,
  bulkRescheduleTasksAction: `reschedule tasks ${TASK_FIXTURE_ID}, 00000000-0000-4000-8000-000000000003 to 2026-09-14`,
  completeTaskAction: `complete task ${TASK_FIXTURE_ID}`,
  createAndAssignFollowUpAction: `create follow-up for person ${TASK_FIXTURE_ID} named Ada Lovelace|assigned to user ${TASK_FIXTURE_ACTOR_ID}`,
  createTaskAction: "create task: title=Prepare launch|priority=high",
  deleteTaskAction: `delete task ${TASK_FIXTURE_ID}`,
  dismissPhaseTemplatePromptAction: `dismiss phase checklist for transition ${TASK_FIXTURE_ID}`,
  handOffFollowUpsAction: `hand off follow-ups from user ${TASK_FIXTURE_ID} to user ${TASK_FIXTURE_ACTOR_ID}`,
  importPhaseTemplatesAction: `import phase checklists for transition ${TASK_FIXTURE_ID}: discernment-and-preparation`,
  importTaskTemplateAction: "import task checklist discernment-and-preparation",
  quickAddTaskAction: "quick add task: Call venue|2026-09-14|urgent",
  reopenTaskAction: `reopen task ${TASK_FIXTURE_ID}`,
  setSubtaskCompletionAction: `check subtask ${TASK_FIXTURE_ID}`,
  updateTaskAction: `update task ${TASK_FIXTURE_ID}: title=Updated title`,
  updateTaskStatusAction: `set task ${TASK_FIXTURE_ID} status to in_progress`,
});

export function taskFixtureSnapshot(
  id: string,
  status: TaskEffectSnapshot["status"] = "not_started"
): TaskEffectSnapshot {
  return {
    id,
    title: `Task ${id.slice(-1)}`,
    description: null,
    status,
    priority: "medium",
    dueDate: "2026-09-01",
    dueTime: null,
    assignedToId: TASK_FIXTURE_ACTOR_ID,
    category: "general",
    relatedType: null,
    relatedId: null,
    parentTaskId: null,
    isRecurring: false,
    recurrenceRule: null,
    completionEvent: null,
    completedAt: status === "complete" ? TASK_FIXTURE_TIME : null,
    completedById: status === "complete" ? TASK_FIXTURE_ACTOR_ID : null,
    createdById: TASK_FIXTURE_ACTOR_ID,
    createdAt: TASK_FIXTURE_TIME,
    updatedAt: TASK_FIXTURE_TIME,
    deletedAt: null,
  };
}

export function taskEffectPlanFixture(exportName: TaskEffectExport) {
  const before = taskFixtureSnapshot(
    TASK_FIXTURE_ID,
    exportName === "reopenTaskAction" ? "complete" : "not_started"
  );
  const completes =
    exportName === "completeTaskAction" ||
    exportName === "bulkCompleteTasksAction";
  const update = {
    taskId: TASK_FIXTURE_ID,
    before,
    after: {
      ...before,
      status: completes
        ? ("complete" as const)
        : exportName === "reopenTaskAction"
          ? ("not_started" as const)
          : before.status,
      completedAt: completes
        ? TASK_FIXTURE_TIME
        : exportName === "reopenTaskAction"
          ? null
          : before.completedAt,
      completedById: completes
        ? TASK_FIXTURE_ACTOR_ID
        : exportName === "reopenTaskAction"
          ? null
          : before.completedById,
      deletedAt: exportName === "deleteTaskAction" ? TASK_FIXTURE_TIME : null,
    },
  };
  const create = {
    taskId: TASK_FIXTURE_ID,
    before: null,
    after: taskFixtureSnapshot(TASK_FIXTURE_ID),
  };
  const singleCreate = new Set<TaskEffectExport>([
    "addSubtaskAction",
    "createAndAssignFollowUpAction",
    "createTaskAction",
    "quickAddTaskAction",
  ]);
  const createSet = new Set<TaskEffectExport>([
    ...singleCreate,
    "importTaskTemplateAction",
    "importPhaseTemplatesAction",
  ]);
  const dismiss = exportName === "dismissPhaseTemplatePromptAction";
  const writes = dismiss ? [] : createSet.has(exportName) ? [create] : [update];
  const phase =
    exportName === "importPhaseTemplatesAction" || dismiss
      ? {
          transitionId: TASK_FIXTURE_ID,
          expectedCreatedAt: TASK_FIXTURE_TIME,
          answerId: TASK_FIXTURE_ACTOR_ID,
          answer: dismiss ? ("declined" as const) : ("accepted" as const),
          expectedUnanswered: true as const,
        }
      : null;
  const sourceAssertion =
    exportName === "deleteTaskAction"
      ? {
          kind: "subtasks" as const,
          parentTaskId: TASK_FIXTURE_ID,
          taskIds: [],
        }
      : exportName === "handOffFollowUpsAction"
        ? {
            kind: "follow_up_owner" as const,
            fromAssigneeId: TASK_FIXTURE_ACTOR_ID,
            taskIds: [TASK_FIXTURE_ID],
          }
        : phase
          ? {
              kind: "phase_transition" as const,
              transitionId: TASK_FIXTURE_ID,
              templateKeys: dismiss ? [] : ["template"],
            }
          : { kind: "none" as const };
  const own = new Set<TaskEffectExport>([
    "addSubtaskAction",
    "bulkCompleteTasksAction",
    "completeTaskAction",
    "reopenTaskAction",
    "setSubtaskCompletionAction",
    "updateTaskStatusAction",
  ]);
  return {
    operation: exportName,
    subjectTasks: own.has(exportName) ? [before] : [],
    sourceTasks: [],
    childSets: [],
    taskWrites: writes,
    dependencySets:
      exportName === "createTaskAction" || exportName === "updateTaskAction"
        ? [
            {
              taskId: TASK_FIXTURE_ID,
              beforePrerequisiteIds: [],
              afterPrerequisiteIds: [],
            },
          ]
        : [],
    notifications: {
      scopedTaskIds: writes.map(({ taskId }) => taskId),
      before: [],
      after: [],
    },
    phaseTransition: phase,
    completionEffects: completes
      ? {
          materialStamp: {
            expectedLastMaterialEventAt: null,
            expectedChurchUpdatedAt: TASK_FIXTURE_TIME,
            nextLastMaterialEventAt: TASK_FIXTURE_TIME,
            nextChurchUpdatedAt: TASK_FIXTURE_TIME,
          },
          contactLogs: [
            {
              kind: "not_applicable" as const,
              taskId: TASK_FIXTURE_ID,
              reason: "not_person" as const,
              personId: null,
            },
          ],
        }
      : { materialStamp: null, contactLogs: [] },
    sourceAssertion,
    exclusions: [],
    disclosure: {
      title: TASK_ACTION_CONTRACTS[exportName].label,
      targets: dismiss
        ? [`Phase transition ${TASK_FIXTURE_ID}`]
        : [`Task ${TASK_FIXTURE_ID}`],
      counts: [{ label: "Tasks", count: writes.length }],
      changes: [{ label: "State", before: "Before", after: "After" }],
      consequences: ["Only the disclosed exact state will be changed."],
      reversibility: TASK_ACTION_CONTRACTS[exportName].difficultToReverse
        ? ("difficult_to_reverse" as const)
        : ("reversible" as const),
    },
  };
}
