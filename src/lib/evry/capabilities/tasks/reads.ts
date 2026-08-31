import { AsyncLocalStorage } from "node:async_hooks";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  churches,
  taskCategories,
  taskPriorities,
  taskStatuses,
  users,
} from "@/db/schema";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import { defineEvryReadRegistration } from "@/lib/evry/reads/contract";
import { createEvryReadContinuation } from "@/lib/evry/reads/core";
import {
  listPrerequisiteCandidates,
  listTaskPrerequisites,
} from "@/lib/tasks/dependencies";
import { taskDescriptionPreview } from "@/lib/tasks/descriptions";
import {
  isOwned,
  listFollowUpAssignees,
  listFollowUpContacts,
  listOpenFollowUpTasks,
  selectUnownedContacts,
} from "@/lib/tasks/follow-up-ownership";
import { readTaskListPage, taskListScope } from "@/lib/tasks/list-page";
import { TASK_STANDARD_LIST_VIEWS } from "@/lib/tasks/list-params";
import { readPhaseTemplatePrompt } from "@/lib/tasks/phase-prompt";
import { getTask, getTaskCounts, listSubtasks } from "@/lib/tasks/service";
import { exactTaskAssigneeJoin } from "@/lib/tasks/assignees";
import { TASK_TEMPLATES, taskTemplateSize } from "@/lib/tasks/templates";

export const TASK_READ_IDENTITIES = {
  counts: "tasks.read.counts",
  detail: "tasks.read.detail",
  followUpOwnership: "tasks.read.follow-up-ownership",
  list: "tasks.read.list",
  phasePrompt: "tasks.read.phase-template-prompt",
  planning: "tasks.read.planning-options",
  templates: "tasks.read.templates",
} as const;

const uuid = z.string().uuid();
const standardTaskListViewSchema = z.enum(TASK_STANDARD_LIST_VIEWS);
const taskStatusSchema = z.enum(taskStatuses);
const taskPrioritySchema = z.enum(taskPriorities);
const taskCategorySchema = z.enum(taskCategories);
export const TASK_RELATED_READ_LIMIT = 25;

async function plantAssigneeOptions(plantId: string) {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(exactTaskAssigneeJoin(plantId));
}

async function readPlantPhase(plantId: string) {
  const [plant] = await db
    .select({ phase: churches.currentPhase })
    .from(churches)
    .where(and(eq(churches.id, plantId)))
    .limit(1);
  return plant ?? null;
}

type TaskReadBoundaries = Readonly<{
  getTask: typeof getTask;
  getTaskCounts: typeof getTaskCounts;
  listFollowUpAssignees: typeof listFollowUpAssignees;
  listFollowUpContacts: typeof listFollowUpContacts;
  listOpenFollowUpTasks: typeof listOpenFollowUpTasks;
  listPrerequisiteCandidates: typeof listPrerequisiteCandidates;
  listSubtasks: typeof listSubtasks;
  listTaskPrerequisites: typeof listTaskPrerequisites;
  plantAssigneeOptions: typeof plantAssigneeOptions;
  readPhaseTemplatePrompt: typeof readPhaseTemplatePrompt;
  readPlantPhase: typeof readPlantPhase;
  readTaskListPage: typeof readTaskListPage;
}>;
export type TaskReadBoundaryName = keyof TaskReadBoundaries;

const TASK_READ_BOUNDARIES: TaskReadBoundaries = {
  getTask,
  getTaskCounts,
  listFollowUpAssignees,
  listFollowUpContacts,
  listOpenFollowUpTasks,
  listPrerequisiteCandidates,
  listSubtasks,
  listTaskPrerequisites,
  plantAssigneeOptions,
  readPhaseTemplatePrompt,
  readPlantPhase,
  readTaskListPage,
};
const taskReadBoundaryScope = new AsyncLocalStorage<
  Partial<TaskReadBoundaries>
>();

function taskReadBoundaries(): TaskReadBoundaries {
  return { ...TASK_READ_BOUNDARIES, ...taskReadBoundaryScope.getStore() };
}

/** Live-proof seam: production callers can never replace backing readers. */
export async function withTaskReadProofBoundaries<Result>(
  overrides: Partial<TaskReadBoundaries>,
  run: () => Promise<Result>
): Promise<Result> {
  if (process.env.LIVE_DB_TESTS !== "1") {
    throw new Error("Task read proof boundaries require LIVE_DB_TESTS=1");
  }
  return taskReadBoundaryScope.run(overrides, run);
}

export async function withTaskReadProofFailure<Result>(
  boundary: TaskReadBoundaryName,
  run: () => Promise<Result>
): Promise<Result> {
  const failure = async () => {
    throw new Error(`Forced Task read boundary failure: ${boundary}`);
  };
  return withTaskReadProofBoundaries(
    { [boundary]: failure } as Partial<TaskReadBoundaries>,
    run
  );
}

function displayText(
  value: string | null | undefined,
  fallback: string,
  maximum: number
) {
  const normalized =
    (value?.normalize("NFKC") ?? "")
      .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
      .trim()
      .replace(/\s+/g, " ") || fallback;
  if (normalized.length <= maximum) return normalized;
  const clipped = normalized.slice(0, maximum - 1);
  const lastCodeUnit = clipped.charCodeAt(clipped.length - 1);
  return `${
    lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff
      ? clipped.slice(0, -1)
      : clipped
  }…`;
}

const artifactTitle = (value: string, fallback: string) =>
  displayText(value, fallback, 200);
const artifactLabel = (value: string, fallback: string) =>
  displayText(value, fallback, 160);
const artifactFact = (value: string | null | undefined, fallback: string) =>
  displayText(value, fallback, 500);

function link(label: string, href: string) {
  return trustedEvryApplicationSourceLink({ label, href });
}

function taskFacts(task: {
  status: string;
  priority: string;
  dueDate: string | null;
  assignedToId?: string | null;
  category?: string | null;
}) {
  return [
    { label: "Status", value: task.status },
    { label: "Priority", value: task.priority },
    { label: "Due date", value: task.dueDate ?? "Not set" },
    { label: "Assignee", value: task.assignedToId ?? "Unassigned" },
    { label: "Category", value: task.category ?? "General" },
  ];
}

type CursorRow = Readonly<{ id: string }>;

function cursorPage<Row extends CursorRow>(
  rows: readonly Row[],
  cursor: string | null,
  limit = TASK_RELATED_READ_LIMIT
): Readonly<{
  items: readonly Row[];
  nextCursor: string | null;
}> | null {
  const cursorIndex = cursor ? rows.findIndex(({ id }) => id === cursor) : -1;
  if (cursor && cursorIndex === -1) return null;

  const start = cursorIndex + 1;
  const items = rows.slice(start, start + limit);
  return {
    items,
    nextCursor:
      start + items.length < rows.length
        ? (items[items.length - 1]?.id ?? null)
        : null,
  };
}

function compareDisplayRows<
  Row extends Readonly<{ id: string; displayValue: string }>,
>(left: Row, right: Row): number {
  const leftKey = left.displayValue
    .normalize("NFKC")
    .toLocaleLowerCase("en-US");
  const rightKey = right.displayValue
    .normalize("NFKC")
    .toLocaleLowerCase("en-US");
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function literalSearchMatch(search: string, values: readonly string[]) {
  if (!search) return true;
  const needle = search.normalize("NFKC").toLocaleLowerCase("en-US");
  return values.some((value) =>
    value.normalize("NFKC").toLocaleLowerCase("en-US").includes(needle)
  );
}

function unavailableTaskArtifact(taskId: string) {
  return buildEvryReadArtifact({
    title: "Task unavailable",
    filters: [{ label: "Task", value: taskId }],
    exclusions: [{ reason: "Unavailable in this plant", count: 1 }],
    items: [],
    sourceLinks: [link("Open Tasks", "/tasks")],
  });
}

function unavailableCursorArtifact(input: {
  title: string;
  taskId: string | null;
  section: string;
  cursor: string;
}) {
  return buildEvryReadArtifact({
    title: input.title,
    filters: [
      ...(input.taskId
        ? [{ label: "Task", value: input.taskId }]
        : [{ label: "Task", value: "New task" }]),
      { label: "Section", value: input.section },
      { label: "Page cursor", value: input.cursor },
    ],
    exclusions: [{ reason: "Cursor is not in this result set", count: 1 }],
    items: [],
    sourceLinks: [
      link(
        input.taskId ? "Open task" : "Create a task",
        input.taskId ? `/tasks/${input.taskId}` : "/tasks/new"
      ),
    ],
  });
}

function unavailableTaskListCursorArtifact(input: {
  view: (typeof TASK_STANDARD_LIST_VIEWS)[number];
  cursor: string;
}) {
  return buildEvryReadArtifact({
    title: "Task list cursor unavailable",
    filters: [
      { label: "View", value: input.view },
      { label: "Page cursor", value: input.cursor },
    ],
    exclusions: [{ reason: "Cursor is not in this result set", count: 1 }],
    items: [],
    sourceLinks: [link("Open Tasks", "/tasks")],
  });
}

function taskPageSource(taskId: string | null) {
  return link(
    taskId ? "Open task" : "Create a task",
    taskId ? `/tasks/${taskId}` : "/tasks/new"
  );
}

function detailContinuationCommand(
  section: "checklist" | "prerequisites",
  taskId: string,
  cursor: string | null
) {
  const subject = section === "checklist" ? "checklist items" : "prerequisites";
  return cursor
    ? `Load more ${subject} for task ${taskId} after ${cursor}`
    : `Show ${subject} for task ${taskId}`;
}

function planningContinuationCommand(input: {
  optionKind: "assignees" | "prerequisites";
  taskId: string | null;
  search: string;
  cursor: string | null;
}) {
  const subject = `task ${input.optionKind}`;
  const context = input.taskId ? ` for task ${input.taskId}` : "";
  const search = input.search ? ` matching ${input.search}` : "";
  return input.cursor
    ? `Load more ${subject}${context}${search} after ${input.cursor}`
    : `Show ${subject}${context}${search}`;
}

type StandardTaskListView = (typeof TASK_STANDARD_LIST_VIEWS)[number];
type TaskStatus = (typeof taskStatuses)[number];
type TaskPriority = (typeof taskPriorities)[number];
type TaskCategory = (typeof taskCategories)[number];

function closedValues<Value>(
  literal: string,
  schema: z.ZodType<Value>
): Value[] | null {
  if (literal.toLocaleLowerCase("en-US") === "any") return [];
  const values = literal.split(",").map((value) => value.trim());
  if (values.length === 0 || new Set(values).size !== values.length) {
    return null;
  }
  const parsed = values.map((value) => schema.safeParse(value));
  if (parsed.some((result) => !result.success)) return null;
  return parsed.flatMap((result) => (result.success ? [result.data] : []));
}

function taskListContinuationCommand(input: {
  view: StandardTaskListView;
  showCompleted: boolean;
  status: readonly TaskStatus[];
  priority: readonly TaskPriority[];
  category: readonly TaskCategory[];
  cursor: string;
}) {
  const values = (items: readonly string[]) => items.join(",") || "any";
  return `Load more tasks: view=${input.view}; completed=${String(input.showCompleted)}; status=${values(input.status)}; priority=${values(input.priority)}; category=${values(input.category)}; after=${input.cursor}`;
}

export const TASK_LIST_READ = defineEvryReadRegistration({
  id: "tasks.list",
  capabilityIdentity: TASK_READ_IDENTITIES.list,
  inputShape: {
    view: standardTaskListViewSchema,
    showCompleted: z.boolean(),
    status: z.array(taskStatusSchema).max(taskStatuses.length),
    priority: z.array(taskPrioritySchema).max(taskPriorities.length),
    category: z.array(taskCategorySchema).max(taskCategories.length),
    cursor: uuid.nullable(),
  },
  async run({ authorization }, input) {
    const result = await taskReadBoundaries().readTaskListPage(
      authorization.actor.plantId,
      authorization.actor.userId,
      {
        view: input.view,
        completed: input.showCompleted ? "true" : undefined,
        status: input.status,
        priority: input.priority,
        category: input.category,
      },
      input.cursor ?? undefined
    );
    if (!result.cursorAvailable && input.cursor) {
      return unavailableTaskListCursorArtifact({
        view: input.view,
        cursor: input.cursor,
      });
    }
    return buildEvryReadArtifact({
      title: "Tasks",
      filters: [
        { label: "View", value: input.view },
        {
          label: "Completed",
          value: input.showCompleted ? "Included" : "Excluded",
        },
        { label: "Statuses", value: input.status.join(", ") || "Any" },
        { label: "Priorities", value: input.priority.join(", ") || "Any" },
        { label: "Categories", value: input.category.join(", ") || "Any" },
        { label: "Matching tasks", value: String(result.total) },
        { label: "Page cursor", value: input.cursor ?? "First page" },
        {
          label: "Next page cursor",
          value: result.nextCursor ?? "End of results",
        },
        {
          label: "Next page command",
          value: result.nextCursor
            ? taskListContinuationCommand({
                ...input,
                cursor: result.nextCursor,
              })
            : "End of results",
        },
      ],
      // Pagination is continuation, not exclusion: the next cursor above
      // reaches the remaining matching rows without inflating excluded counts.
      exclusions: [],
      items: result.tasks.map((task) => {
        const note =
          task.relatedType === "person" && task.relatedId
            ? result.personNotes[task.relatedId]
            : undefined;
        return {
          id: task.id,
          label: artifactLabel(task.title, "Untitled task"),
          facts: [
            ...taskFacts(task),
            ...(note
              ? [
                  {
                    label: "Latest person note",
                    value: artifactFact(note, "No note"),
                  },
                ]
              : []),
          ],
          sourceLink: link(
            artifactLabel(`Open ${task.title}`, "Open task"),
            `/tasks/${task.id}`
          ),
        };
      }),
      sourceLinks: [link("Open Tasks", "/tasks")],
    });
  },
});

const taskListScopeInput = {
  view: standardTaskListViewSchema,
  status: z.array(taskStatusSchema).max(taskStatuses.length),
  priority: z.array(taskPrioritySchema).max(taskPriorities.length),
  category: z.array(taskCategorySchema).max(taskCategories.length),
} as const;

export const TASK_COUNTS_READ = defineEvryReadRegistration({
  id: "tasks.counts",
  capabilityIdentity: TASK_READ_IDENTITIES.counts,
  inputShape: taskListScopeInput,
  async run({ authorization }, input) {
    const counts = await taskReadBoundaries().getTaskCounts(
      authorization.actor.plantId,
      taskListScope(authorization.actor.userId, {
        ...input,
        showCompleted: false,
      })
    );
    return buildEvryReadArtifact({
      title: "Task counts",
      filters: [
        { label: "View", value: input.view },
        { label: "Statuses", value: input.status.join(", ") || "Any" },
        { label: "Priorities", value: input.priority.join(", ") || "Any" },
        { label: "Categories", value: input.category.join(", ") || "Any" },
      ],
      exclusions: [],
      items: [
        {
          id: "task-counts",
          label: "Tasks in scope",
          facts: [
            { label: "Not started", value: String(counts.notStarted) },
            { label: "In progress", value: String(counts.inProgress) },
            { label: "Blocked", value: String(counts.blocked) },
            { label: "Complete", value: String(counts.complete) },
            { label: "Overdue", value: String(counts.overdue) },
            { label: "Total", value: String(counts.total) },
            {
              label: "Checklist items",
              value: `${counts.checklistComplete}/${counts.checklistTotal} complete`,
            },
          ],
          sourceLink: link("Open Tasks", "/tasks"),
        },
      ],
      sourceLinks: [link("Open Tasks", "/tasks")],
    });
  },
});

export const TASK_FOLLOW_UP_OWNERSHIP_READ = defineEvryReadRegistration({
  id: "tasks.follow-up-ownership",
  capabilityIdentity: TASK_READ_IDENTITIES.followUpOwnership,
  inputShape: {
    section: z.enum(["contacts", "open_tasks", "assignees"]),
    cursor: uuid.nullable(),
  },
  async run({ authorization }, input) {
    const [assignees, contacts, openTasks] = await Promise.all([
      taskReadBoundaries().listFollowUpAssignees(authorization.actor.plantId),
      taskReadBoundaries().listFollowUpContacts(authorization.actor.plantId),
      taskReadBoundaries().listOpenFollowUpTasks(authorization.actor.plantId),
    ]);
    const unownedContactIds = new Set(
      selectUnownedContacts(contacts, openTasks).map(({ personId }) => personId)
    );
    const rows =
      input.section === "contacts"
        ? contacts.map((contact) => ({
            id: contact.personId,
            label: artifactLabel(contact.name, "Unnamed contact"),
            facts: [
              { label: "Status", value: contact.status },
              {
                label: "Coverage",
                value: unownedContactIds.has(contact.personId)
                  ? "Needs owner"
                  : "Owned",
              },
              {
                label: "Last touched",
                value: contact.lastTouchedAt.toISOString(),
              },
            ],
            sourceLink: link("Open person", `/people/${contact.personId}`),
          }))
        : input.section === "open_tasks"
          ? openTasks.map((task) => ({
              id: task.taskId,
              label: artifactLabel(task.title, "Untitled task"),
              facts: [
                {
                  label: "Owner",
                  value: isOwned(task)
                    ? artifactFact(
                        task.ownerName ?? task.ownerEmail,
                        "Unnamed member"
                      )
                    : "Needs owner",
                },
                { label: "Due date", value: task.dueDate ?? "Not set" },
                { label: "Contact", value: task.contactId ?? "Not linked" },
              ],
              sourceLink: link("Open task", `/tasks/${task.taskId}`),
            }))
          : assignees.map((assignee) => ({
              id: assignee.id,
              label: artifactLabel(
                assignee.name ?? assignee.email,
                "Unnamed member"
              ),
              facts: [
                { label: "Email", value: assignee.email },
                { label: "Status", value: assignee.status },
                {
                  label: "Planter",
                  value: assignee.isPlanter ? "Yes" : "No",
                },
              ],
              sourceLink: link("Open Tasks", "/tasks?view=assignments"),
            }));
    const page = cursorPage(rows, input.cursor);
    if (!page && input.cursor) {
      return unavailableCursorArtifact({
        title: "Task follow-up ownership",
        taskId: null,
        section: input.section,
        cursor: input.cursor,
      });
    }
    return buildEvryReadArtifact({
      title: "Task follow-up ownership",
      filters: [
        { label: "Section", value: input.section },
        { label: "Open follow-up tasks", value: String(openTasks.length) },
        { label: "Follow-up contacts", value: String(contacts.length) },
        { label: "Eligible assignees", value: String(assignees.length) },
        {
          label: "Contacts needing an owner",
          value: String(unownedContactIds.size),
        },
        { label: "Page cursor", value: input.cursor ?? "First page" },
        {
          label: "Next page cursor",
          value: page?.nextCursor ?? "End of results",
        },
      ],
      exclusions: [],
      items: page?.items ?? [],
      sourceLinks: [link("Open Task assignments", "/tasks?view=assignments")],
    });
  },
});

export const TASK_PHASE_TEMPLATE_PROMPT_READ = defineEvryReadRegistration({
  id: "tasks.phase-template-prompt",
  capabilityIdentity: TASK_READ_IDENTITIES.phasePrompt,
  inputShape: {},
  async run({ authorization }) {
    const { transitionId, prompt } =
      await taskReadBoundaries().readPhaseTemplatePrompt(
        authorization.actor.plantId
      );
    if (!prompt) {
      return buildEvryReadArtifact({
        title: "Phase checklist prompt",
        filters: [
          { label: "Latest transition", value: transitionId ?? "None" },
        ],
        exclusions: [
          { reason: "No unanswered phase checklist prompt", count: 1 },
        ],
        items: [],
        sourceLinks: [link("Open Tasks", "/tasks")],
      });
    }
    return buildEvryReadArtifact({
      title: artifactTitle(
        `${prompt.phaseName} checklist prompt`,
        "Phase checklist prompt"
      ),
      filters: [
        { label: "Transition", value: prompt.transitionId },
        { label: "From phase", value: String(prompt.fromPhase) },
        { label: "To phase", value: String(prompt.toPhase) },
        {
          label: "Transitioned at",
          value: prompt.transitionedAt.toISOString(),
        },
        { label: "Tasks offered", value: String(prompt.totalTaskCount) },
      ],
      exclusions: [],
      items: prompt.offers.map((offer) => ({
        id: `${prompt.transitionId}:${offer.key}`,
        label: artifactLabel(offer.name, "Task checklist"),
        facts: [
          { label: "Template key", value: offer.key },
          { label: "Tasks", value: String(offer.taskCount) },
          { label: "First due date", value: offer.firstDueDate },
          { label: "Last due date", value: offer.lastDueDate },
          {
            label: "Description",
            value: artifactFact(offer.description, "No description"),
          },
        ],
        sourceLink: link("Open phase checklist prompt", "/tasks"),
      })),
      sourceLinks: [link("Open phase checklist prompt", "/tasks")],
    });
  },
});

export const TASK_DETAIL_READ = defineEvryReadRegistration({
  id: "tasks.detail",
  capabilityIdentity: TASK_READ_IDENTITIES.detail,
  inputShape: { taskId: uuid },
  async run({ authorization }, { taskId }) {
    const task = await taskReadBoundaries().getTask(
      authorization.actor.plantId,
      taskId
    );
    if (!task) return unavailableTaskArtifact(taskId);
    const [subtasks, prerequisites] = await Promise.all([
      taskReadBoundaries().listSubtasks(authorization.actor.plantId, task.id),
      taskReadBoundaries().listTaskPrerequisites(
        authorization.actor.plantId,
        task.id
      ),
    ]);
    return buildEvryReadArtifact({
      title: artifactTitle(task.title, "Task"),
      filters: [
        { label: "Task", value: task.id },
        { label: "Detail section", value: "Summary" },
        {
          label: "Description scope",
          value: "Plain-text preview; open the Task for full rich text",
        },
        {
          label: "Checklist command",
          value: detailContinuationCommand("checklist", task.id, null),
        },
        {
          label: "Prerequisites command",
          value: detailContinuationCommand("prerequisites", task.id, null),
        },
      ],
      exclusions: [],
      items: [
        {
          id: task.id,
          label: artifactLabel(task.title, "Untitled task"),
          facts: [
            {
              label: "Full title",
              value: artifactFact(task.title, "Untitled task"),
            },
            ...taskFacts(task),
            {
              label: "Description preview",
              value: artifactFact(
                taskDescriptionPreview(task.description),
                "Not set"
              ),
            },
            { label: "Checklist items", value: String(subtasks.length) },
            { label: "Prerequisites", value: String(prerequisites.length) },
          ],
          sourceLink: link(
            artifactLabel(`Open ${task.title}`, "Open task"),
            `/tasks/${task.id}`
          ),
        },
      ],
      sourceLinks: [
        link(
          artifactLabel(`Open ${task.title}`, "Open task"),
          `/tasks/${task.id}`
        ),
      ],
    });
  },
});

export const TASK_CHECKLIST_DETAIL_READ = defineEvryReadRegistration({
  id: "tasks.detail.checklist",
  capabilityIdentity: TASK_READ_IDENTITIES.detail,
  inputShape: { taskId: uuid, cursor: uuid.nullable() },
  async run({ authorization }, { taskId, cursor }) {
    const task = await taskReadBoundaries().getTask(
      authorization.actor.plantId,
      taskId
    );
    if (!task) return unavailableTaskArtifact(taskId);

    const rows = await taskReadBoundaries().listSubtasks(
      authorization.actor.plantId,
      task.id
    );
    const page = cursorPage(rows, cursor);
    if (!page && cursor) {
      return unavailableCursorArtifact({
        title: "Task checklist cursor unavailable",
        taskId,
        section: "Checklist items",
        cursor,
      });
    }
    if (!page) throw new Error("First Task checklist page must be available");

    return buildEvryReadArtifact({
      title: artifactTitle(`${task.title} checklist`, "Task checklist"),
      filters: [
        { label: "Task", value: task.id },
        { label: "Detail section", value: "Checklist items" },
        { label: "Matching checklist items", value: String(rows.length) },
        { label: "Page cursor", value: cursor ?? "First page" },
        {
          label: "Next page cursor",
          value: page.nextCursor ?? "End of results",
        },
        {
          label: "Next page command",
          value: page.nextCursor
            ? detailContinuationCommand("checklist", task.id, page.nextCursor)
            : "End of results",
        },
      ],
      exclusions: [],
      items: page.items.map((subtask) => ({
        id: subtask.id,
        label: artifactLabel(subtask.title, "Untitled checklist item"),
        facts: [
          {
            label: "Full title",
            value: artifactFact(subtask.title, "Untitled checklist item"),
          },
          { label: "Checklist item ID", value: subtask.id },
          ...taskFacts(subtask),
          { label: "Blocked", value: subtask.isBlocked ? "Yes" : "No" },
          {
            label: "Description preview",
            value: artifactFact(
              subtask.descriptionPreview,
              "No description preview"
            ),
          },
        ],
        sourceLink: link(
          artifactLabel(`Open ${subtask.title}`, "Open checklist item"),
          `/tasks/${subtask.id}`
        ),
      })),
      sourceLinks: [taskPageSource(task.id)],
    });
  },
});

export const TASK_PREREQUISITE_DETAIL_READ = defineEvryReadRegistration({
  id: "tasks.detail.prerequisites",
  capabilityIdentity: TASK_READ_IDENTITIES.detail,
  inputShape: { taskId: uuid, cursor: uuid.nullable() },
  async run({ authorization }, { taskId, cursor }) {
    const task = await taskReadBoundaries().getTask(
      authorization.actor.plantId,
      taskId
    );
    if (!task) return unavailableTaskArtifact(taskId);

    const rows = await taskReadBoundaries().listTaskPrerequisites(
      authorization.actor.plantId,
      task.id
    );
    const page = cursorPage(rows, cursor);
    if (!page && cursor) {
      return unavailableCursorArtifact({
        title: "Task prerequisite cursor unavailable",
        taskId,
        section: "Prerequisites",
        cursor,
      });
    }
    if (!page)
      throw new Error("First Task prerequisite page must be available");

    return buildEvryReadArtifact({
      title: artifactTitle(`${task.title} prerequisites`, "Task prerequisites"),
      filters: [
        { label: "Task", value: task.id },
        { label: "Detail section", value: "Prerequisites" },
        { label: "Matching prerequisites", value: String(rows.length) },
        { label: "Page cursor", value: cursor ?? "First page" },
        {
          label: "Next page cursor",
          value: page.nextCursor ?? "End of results",
        },
        {
          label: "Next page command",
          value: page.nextCursor
            ? detailContinuationCommand(
                "prerequisites",
                task.id,
                page.nextCursor
              )
            : "End of results",
        },
      ],
      exclusions: [],
      items: page.items.map((prerequisite) => ({
        id: prerequisite.id,
        label: artifactLabel(prerequisite.title, "Untitled prerequisite"),
        facts: [
          {
            label: "Full title",
            value: artifactFact(prerequisite.title, "Untitled prerequisite"),
          },
          { label: "Prerequisite task ID", value: prerequisite.id },
          { label: "Status", value: prerequisite.status },
        ],
        sourceLink: link(
          artifactLabel(`Open ${prerequisite.title}`, "Open prerequisite"),
          `/tasks/${prerequisite.id}`
        ),
      })),
      sourceLinks: [taskPageSource(task.id)],
    });
  },
});

export const TASK_PLANNING_READ = defineEvryReadRegistration({
  id: "tasks.planning-options",
  capabilityIdentity: TASK_READ_IDENTITIES.planning,
  inputShape: { taskId: uuid.nullable() },
  async run({ authorization }, { taskId }) {
    if (taskId) {
      const task = await taskReadBoundaries().getTask(
        authorization.actor.plantId,
        taskId
      );
      if (!task) return unavailableTaskArtifact(taskId);
    }
    const [plantUsers, prerequisites] = await Promise.all([
      taskReadBoundaries().plantAssigneeOptions(authorization.actor.plantId),
      taskReadBoundaries().listPrerequisiteCandidates(
        authorization.actor.plantId,
        taskId ?? undefined
      ),
    ]);
    return buildEvryReadArtifact({
      title: "Task planning options",
      filters: [
        { label: "Task context", value: taskId ?? "New task" },
        {
          label: "Assignee command",
          value: planningContinuationCommand({
            optionKind: "assignees",
            taskId,
            search: "",
            cursor: null,
          }),
        },
        {
          label: "Prerequisite command",
          value: planningContinuationCommand({
            optionKind: "prerequisites",
            taskId,
            search: "",
            cursor: null,
          }),
        },
      ],
      exclusions: [],
      items: [
        {
          id: "assignees",
          label: "Assignee options",
          facts: [
            { label: "Matching options", value: String(plantUsers.length) },
            {
              label: "Retrieve",
              value: planningContinuationCommand({
                optionKind: "assignees",
                taskId,
                search: "",
                cursor: null,
              }),
            },
          ],
          sourceLink: taskPageSource(taskId),
        },
        {
          id: "prerequisites",
          label: "Prerequisite options",
          facts: [
            { label: "Matching options", value: String(prerequisites.length) },
            {
              label: "Retrieve",
              value: planningContinuationCommand({
                optionKind: "prerequisites",
                taskId,
                search: "",
                cursor: null,
              }),
            },
          ],
          sourceLink: taskPageSource(taskId),
        },
      ],
      sourceLinks: [taskPageSource(taskId)],
    });
  },
});

export const TASK_ASSIGNEE_PLANNING_READ = defineEvryReadRegistration({
  id: "tasks.planning-options.assignees",
  capabilityIdentity: TASK_READ_IDENTITIES.planning,
  inputShape: {
    taskId: uuid.nullable(),
    search: z.string().trim().max(160),
    cursor: uuid.nullable(),
  },
  async run({ authorization }, { taskId, search, cursor }) {
    if (taskId) {
      const task = await taskReadBoundaries().getTask(
        authorization.actor.plantId,
        taskId
      );
      if (!task) return unavailableTaskArtifact(taskId);
    }
    const [plantUsers, followUpAssignees] = await Promise.all([
      taskReadBoundaries().plantAssigneeOptions(authorization.actor.plantId),
      taskReadBoundaries().listFollowUpAssignees(authorization.actor.plantId),
    ]);
    const followUpIds = new Set(followUpAssignees.map(({ id }) => id));
    const rows = plantUsers
      .map((user) => ({
        ...user,
        displayValue: user.name?.trim() || user.email,
      }))
      .filter((user) =>
        literalSearchMatch(search, [user.name ?? "", user.email])
      )
      .sort(compareDisplayRows);
    const page = cursorPage(rows, cursor);
    if (!page && cursor) {
      return unavailableCursorArtifact({
        title: "Task assignee cursor unavailable",
        taskId,
        section: "Assignee options",
        cursor,
      });
    }
    if (!page) throw new Error("First Task assignee page must be available");

    return buildEvryReadArtifact({
      title: "Task assignees",
      filters: [
        { label: "Option type", value: "Assignees" },
        { label: "Task context", value: taskId ?? "New task" },
        ...(search ? [{ label: "Search", value: search }] : []),
        { label: "Matching options", value: String(rows.length) },
        { label: "Page cursor", value: cursor ?? "First page" },
        {
          label: "Next page cursor",
          value: page.nextCursor ?? "End of results",
        },
        {
          label: "Next page command",
          value: page.nextCursor
            ? planningContinuationCommand({
                optionKind: "assignees",
                taskId,
                search,
                cursor: page.nextCursor,
              })
            : "End of results",
        },
      ],
      exclusions: [],
      items: page.items.map((user) => ({
        id: user.id,
        label: artifactLabel(user.displayValue, "Plant member"),
        facts: [
          { label: "User ID", value: user.id },
          ...(user.name
            ? [
                {
                  label: "Full name",
                  value: artifactFact(user.name, "Unnamed plant member"),
                },
              ]
            : []),
          { label: "Email", value: artifactFact(user.email, "No email") },
          {
            label: "Follow-up eligible",
            value: followUpIds.has(user.id) ? "Yes" : "No",
          },
        ],
        sourceLink: taskPageSource(taskId),
      })),
      sourceLinks: [taskPageSource(taskId)],
    });
  },
});

export const TASK_PREREQUISITE_PLANNING_READ = defineEvryReadRegistration({
  id: "tasks.planning-options.prerequisites",
  capabilityIdentity: TASK_READ_IDENTITIES.planning,
  inputShape: {
    taskId: uuid.nullable(),
    search: z.string().trim().max(160),
    cursor: uuid.nullable(),
  },
  async run({ authorization }, { taskId, search, cursor }) {
    if (taskId) {
      const task = await taskReadBoundaries().getTask(
        authorization.actor.plantId,
        taskId
      );
      if (!task) return unavailableTaskArtifact(taskId);
    }
    const rows = (
      await taskReadBoundaries().listPrerequisiteCandidates(
        authorization.actor.plantId,
        taskId ?? undefined
      )
    )
      .map((task) => ({ ...task, displayValue: task.title }))
      .filter((task) => literalSearchMatch(search, [task.title]))
      .sort(compareDisplayRows);
    const page = cursorPage(rows, cursor);
    if (!page && cursor) {
      return unavailableCursorArtifact({
        title: "Task prerequisite option cursor unavailable",
        taskId,
        section: "Prerequisite options",
        cursor,
      });
    }
    if (!page) {
      throw new Error("First Task prerequisite option page must be available");
    }

    return buildEvryReadArtifact({
      title: "Task prerequisite options",
      filters: [
        { label: "Option type", value: "Prerequisites" },
        { label: "Task context", value: taskId ?? "New task" },
        ...(search ? [{ label: "Search", value: search }] : []),
        { label: "Matching options", value: String(rows.length) },
        { label: "Page cursor", value: cursor ?? "First page" },
        {
          label: "Next page cursor",
          value: page.nextCursor ?? "End of results",
        },
        {
          label: "Next page command",
          value: page.nextCursor
            ? planningContinuationCommand({
                optionKind: "prerequisites",
                taskId,
                search,
                cursor: page.nextCursor,
              })
            : "End of results",
        },
      ],
      exclusions: [],
      items: page.items.map((task) => ({
        id: task.id,
        label: artifactLabel(task.title, "Untitled prerequisite"),
        facts: [
          {
            label: "Full title",
            value: artifactFact(task.title, "Untitled prerequisite"),
          },
          { label: "Prerequisite task ID", value: task.id },
          { label: "Status", value: task.status },
        ],
        sourceLink: link(
          artifactLabel(`Open ${task.title}`, "Open prerequisite"),
          `/tasks/${task.id}`
        ),
      })),
      sourceLinks: [taskPageSource(taskId)],
    });
  },
});

export const TASK_TEMPLATES_READ = defineEvryReadRegistration({
  id: "tasks.templates",
  capabilityIdentity: TASK_READ_IDENTITIES.templates,
  inputShape: {},
  async run({ authorization }) {
    const plant = await taskReadBoundaries().readPlantPhase(
      authorization.actor.plantId
    );
    return buildEvryReadArtifact({
      title: "Task checklist templates",
      filters: [
        {
          label: "Current phase",
          value: plant ? String(plant.phase) : "Unavailable",
        },
      ],
      exclusions: [],
      items: TASK_TEMPLATES.map((template) => ({
        id: template.key,
        label: artifactLabel(template.name, "Task checklist"),
        facts: [
          { label: "Phase", value: String(template.phase) },
          { label: "Tasks", value: String(taskTemplateSize(template)) },
          {
            label: "Description",
            value: artifactFact(template.description, "No description"),
          },
        ],
        sourceLink: link("Open checklist templates", "/tasks/templates"),
      })),
      sourceLinks: [link("Open checklist templates", "/tasks/templates")],
    });
  },
});

export type TaskEvryReadSelection =
  | Readonly<{
      kind: "list";
      view: StandardTaskListView;
      showCompleted: boolean;
      status: (typeof taskStatuses)[number][];
      priority: (typeof taskPriorities)[number][];
      category: (typeof taskCategories)[number][];
      cursor: string | null;
    }>
  | Readonly<{
      kind: "counts";
      view: StandardTaskListView;
      status: TaskStatus[];
      priority: TaskPriority[];
      category: TaskCategory[];
    }>
  | Readonly<{
      kind: "follow_up_ownership";
      section: "contacts" | "open_tasks" | "assignees";
      cursor: string | null;
    }>
  | Readonly<{ kind: "detail"; taskId: string | null }>
  | Readonly<{
      kind: "detail_checklist";
      taskId: string | null;
      cursor: string | null;
    }>
  | Readonly<{
      kind: "detail_prerequisites";
      taskId: string | null;
      cursor: string | null;
    }>
  | Readonly<{ kind: "phase_prompt" }>
  | Readonly<{ kind: "planning"; taskId: string | null }>
  | Readonly<{
      kind: "planning_assignees";
      taskId: string | null;
      search: string;
      cursor: string | null;
    }>
  | Readonly<{
      kind: "planning_prerequisites";
      taskId: string | null;
      search: string;
      cursor: string | null;
    }>
  | Readonly<{ kind: "templates" }>;

const UUID =
  "([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})";

export function selectTaskEvryRead(
  literalUserText: string
): TaskEvryReadSelection | null {
  const text = literalUserText.normalize("NFKC").trim();
  let match: RegExpExecArray | null;
  match = new RegExp(
    `^load more tasks: view=(my_tasks|all);\\s*completed=(true|false);\\s*status=([^;]+);\\s*priority=([^;]+);\\s*category=([^;]+);\\s*after=${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2] && match[3] && match[4] && match[5] && match[6]) {
    const view = standardTaskListViewSchema.safeParse(
      match[1].toLocaleLowerCase("en-US")
    );
    const status = closedValues(
      match[3].toLocaleLowerCase("en-US"),
      taskStatusSchema
    );
    const priority = closedValues(
      match[4].toLocaleLowerCase("en-US"),
      taskPrioritySchema
    );
    const category = closedValues(
      match[5].toLocaleLowerCase("en-US"),
      taskCategorySchema
    );
    if (view.success && status && priority && category) {
      return {
        kind: "list",
        view: view.data,
        showCompleted: match[2].toLocaleLowerCase("en-US") === "true",
        status,
        priority,
        category,
        cursor: match[6],
      };
    }
  }
  match =
    /^(?:show|list)(?: me)? tasks: view=(my_tasks|all);\s*completed=(true|false);\s*status=([^;]+);\s*priority=([^;]+);\s*category=([^;.!?]+)[.!?]*$/i.exec(
      text
    );
  if (match?.[1] && match[2] && match[3] && match[4] && match[5]) {
    const view = standardTaskListViewSchema.safeParse(
      match[1].toLocaleLowerCase("en-US")
    );
    const status = closedValues(
      match[3].toLocaleLowerCase("en-US"),
      taskStatusSchema
    );
    const priority = closedValues(
      match[4].toLocaleLowerCase("en-US"),
      taskPrioritySchema
    );
    const category = closedValues(
      match[5].toLocaleLowerCase("en-US"),
      taskCategorySchema
    );
    if (view.success && status && priority && category) {
      return {
        kind: "list",
        view: view.data,
        showCompleted: match[2].toLocaleLowerCase("en-US") === "true",
        status,
        priority,
        category,
        cursor: null,
      };
    }
  }
  match =
    /^(?:show|list)(?: me)? task counts: view=(my_tasks|all);\s*status=([^;]+);\s*priority=([^;]+);\s*category=([^;.!?]+)[.!?]*$/i.exec(
      text
    );
  if (match?.[1] && match[2] && match[3] && match[4]) {
    const view = standardTaskListViewSchema.safeParse(
      match[1].toLocaleLowerCase("en-US")
    );
    const status = closedValues(
      match[2].toLocaleLowerCase("en-US"),
      taskStatusSchema
    );
    const priority = closedValues(
      match[3].toLocaleLowerCase("en-US"),
      taskPrioritySchema
    );
    const category = closedValues(
      match[4].toLocaleLowerCase("en-US"),
      taskCategorySchema
    );
    if (view.success && status && priority && category) {
      return {
        kind: "counts",
        view: view.data,
        status,
        priority,
        category,
      };
    }
  }
  match = new RegExp(
    `^load more all tasks( including completed)? after\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[2]) {
    return {
      kind: "list",
      view: "all",
      showCompleted: Boolean(match[1]),
      status: [],
      priority: [],
      category: [],
      cursor: match[2],
    };
  }
  match = new RegExp(`^load more tasks after\\s+${UUID}[.!?]*$`, "i").exec(
    text
  );
  if (match?.[1]) {
    return {
      kind: "list",
      view: "my_tasks",
      showCompleted: false,
      status: [],
      priority: [],
      category: [],
      cursor: match[1],
    };
  }
  if (/^(?:show|list)(?: me)? tasks[.!?]*$/i.test(text)) {
    return {
      kind: "list",
      view: "my_tasks",
      showCompleted: false,
      status: [],
      priority: [],
      category: [],
      cursor: null,
    };
  }
  match =
    /^(?:show|list)(?: me)? all tasks( including completed)?[.!?]*$/i.exec(
      text
    );
  if (match) {
    return {
      kind: "list",
      view: "all",
      showCompleted: Boolean(match[1]),
      status: [],
      priority: [],
      category: [],
      cursor: null,
    };
  }
  if (/^(?:show|list)(?: me)? task counts[.!?]*$/i.test(text)) {
    return {
      kind: "counts",
      view: "my_tasks",
      status: [],
      priority: [],
      category: [],
    };
  }
  if (/^(?:show|list)(?: me)? (?:task )?assignments[.!?]*$/i.test(text)) {
    return {
      kind: "follow_up_ownership",
      section: "open_tasks",
      cursor: null,
    };
  }
  if (
    /^(?:(?:show|list)(?: me)? )?(?:who needs? follow[ -]?up|(?:which )?(?:people|contacts) (?:need|needs|needing) follow[ -]?up)[.!?]*$/i.test(
      text
    )
  ) {
    return { kind: "follow_up_ownership", section: "contacts", cursor: null };
  }
  match = new RegExp(
    `^load more task follow-up (contacts|tasks|assignees) after\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]) {
    const subject = match[1].toLocaleLowerCase("en-US");
    const section =
      subject === "tasks"
        ? "open_tasks"
        : subject === "contacts"
          ? "contacts"
          : "assignees";
    return {
      kind: "follow_up_ownership",
      section,
      cursor: match[2],
    };
  }
  if (/^(?:show|list)(?: me)? task follow-up contacts[.!?]*$/i.test(text)) {
    return { kind: "follow_up_ownership", section: "contacts", cursor: null };
  }
  if (/^(?:show|list)(?: me)? open task follow-ups[.!?]*$/i.test(text)) {
    return {
      kind: "follow_up_ownership",
      section: "open_tasks",
      cursor: null,
    };
  }
  if (/^(?:show|list)(?: me)? task follow-up assignees[.!?]*$/i.test(text)) {
    return {
      kind: "follow_up_ownership",
      section: "assignees",
      cursor: null,
    };
  }
  match = new RegExp(
    `^load more checklist items for task\\s+${UUID}\\s+after\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]) {
    return {
      kind: "detail_checklist",
      taskId: match[1],
      cursor: match[2],
    };
  }
  match = new RegExp(
    `^load more prerequisites for task\\s+${UUID}\\s+after\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]) {
    return {
      kind: "detail_prerequisites",
      taskId: match[1],
      cursor: match[2],
    };
  }
  match = new RegExp(
    `^show checklist items for task\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1]) {
    return { kind: "detail_checklist", taskId: match[1], cursor: null };
  }
  if (/^show checklist items for this task[.!?]*$/i.test(text)) {
    return { kind: "detail_checklist", taskId: null, cursor: null };
  }
  match = new RegExp(
    `^show prerequisites for task\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1]) {
    return { kind: "detail_prerequisites", taskId: match[1], cursor: null };
  }
  if (/^show prerequisites for this task[.!?]*$/i.test(text)) {
    return { kind: "detail_prerequisites", taskId: null, cursor: null };
  }
  match = new RegExp(`^show task\\s+${UUID}[.!?]*$`, "i").exec(text);
  if (match?.[1]) return { kind: "detail", taskId: match[1] };
  if (/^show (?:this )?task(?: details)?[.!?]*$/i.test(text)) {
    return { kind: "detail", taskId: null };
  }

  match = new RegExp(
    `^load more task assignees for task\\s+${UUID}\\s+matching\\s+(.+?)\\s+after\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2] && match[3]) {
    return {
      kind: "planning_assignees",
      taskId: match[1],
      search: match[2].trim(),
      cursor: match[3],
    };
  }
  match = new RegExp(
    `^load more task assignees matching\\s+(.+?)\\s+after\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]) {
    return {
      kind: "planning_assignees",
      taskId: null,
      search: match[1].trim(),
      cursor: match[2],
    };
  }
  match = new RegExp(
    `^load more task assignees for task\\s+${UUID}\\s+after\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]) {
    return {
      kind: "planning_assignees",
      taskId: match[1],
      search: "",
      cursor: match[2],
    };
  }
  match = new RegExp(
    `^load more task assignees after\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1]) {
    return {
      kind: "planning_assignees",
      taskId: null,
      search: "",
      cursor: match[1],
    };
  }
  match = new RegExp(
    `^load more task prerequisites for task\\s+${UUID}\\s+matching\\s+(.+?)\\s+after\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2] && match[3]) {
    return {
      kind: "planning_prerequisites",
      taskId: match[1],
      search: match[2].trim(),
      cursor: match[3],
    };
  }
  match = new RegExp(
    `^load more task prerequisites matching\\s+(.+?)\\s+after\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]) {
    return {
      kind: "planning_prerequisites",
      taskId: null,
      search: match[1].trim(),
      cursor: match[2],
    };
  }
  match = new RegExp(
    `^load more task prerequisites for task\\s+${UUID}\\s+after\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]) {
    return {
      kind: "planning_prerequisites",
      taskId: match[1],
      search: "",
      cursor: match[2],
    };
  }
  match = new RegExp(
    `^load more task prerequisites after\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1]) {
    return {
      kind: "planning_prerequisites",
      taskId: null,
      search: "",
      cursor: match[1],
    };
  }

  match = new RegExp(
    `^show task assignees for task\\s+${UUID}\\s+matching\\s+(.+?)[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]) {
    return {
      kind: "planning_assignees",
      taskId: match[1],
      search: match[2].trim(),
      cursor: null,
    };
  }
  match = /^show task assignees matching\s+(.+?)[.!?]*$/i.exec(text);
  if (match?.[1]) {
    return {
      kind: "planning_assignees",
      taskId: null,
      search: match[1].trim(),
      cursor: null,
    };
  }
  match = new RegExp(
    `^show task assignees for task\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1]) {
    return {
      kind: "planning_assignees",
      taskId: match[1],
      search: "",
      cursor: null,
    };
  }
  if (/^show task assignees[.!?]*$/i.test(text)) {
    return {
      kind: "planning_assignees",
      taskId: null,
      search: "",
      cursor: null,
    };
  }

  match = new RegExp(
    `^show task prerequisites for task\\s+${UUID}\\s+matching\\s+(.+?)[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]) {
    return {
      kind: "planning_prerequisites",
      taskId: match[1],
      search: match[2].trim(),
      cursor: null,
    };
  }
  match = /^show task prerequisites matching\s+(.+?)[.!?]*$/i.exec(text);
  if (match?.[1]) {
    return {
      kind: "planning_prerequisites",
      taskId: null,
      search: match[1].trim(),
      cursor: null,
    };
  }
  match = new RegExp(
    `^show task prerequisites for task\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1]) {
    return {
      kind: "planning_prerequisites",
      taskId: match[1],
      search: "",
      cursor: null,
    };
  }
  if (/^show task prerequisites[.!?]*$/i.test(text)) {
    return {
      kind: "planning_prerequisites",
      taskId: null,
      search: "",
      cursor: null,
    };
  }

  match = new RegExp(
    `^show planning options for task\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1]) return { kind: "planning", taskId: match[1] };
  if (/^show task planning options[.!?]*$/i.test(text)) {
    return { kind: "planning", taskId: null };
  }
  if (
    /^(?:show|review)(?: the)? (?:pending )?phase (?:checklist )?prompt[.!?]*$/i.test(
      text
    )
  ) {
    return { kind: "phase_prompt" };
  }
  return /^(?:show|list) task (?:checklist )?templates[.!?]*$/i.test(text)
    ? { kind: "templates" }
    : null;
}

export const TASK_EVRY_READ_REGISTRATIONS = [
  TASK_LIST_READ,
  TASK_COUNTS_READ,
  TASK_FOLLOW_UP_OWNERSHIP_READ,
  TASK_DETAIL_READ,
  TASK_CHECKLIST_DETAIL_READ,
  TASK_PREREQUISITE_DETAIL_READ,
  TASK_PHASE_TEMPLATE_PROMPT_READ,
  TASK_PLANNING_READ,
  TASK_ASSIGNEE_PLANNING_READ,
  TASK_PREREQUISITE_PLANNING_READ,
  TASK_TEMPLATES_READ,
] as const;

export const continueTaskEvryRead = createEvryReadContinuation({
  registrations: TASK_EVRY_READ_REGISTRATIONS,
  async select({ literalUserText, pageContext, eligibleReadIds }) {
    const selection = selectTaskEvryRead(literalUserText);
    if (!selection) return null;
    const selected = (() => {
      switch (selection.kind) {
        case "list":
          return {
            readId: TASK_LIST_READ.id,
            input: {
              view: selection.view,
              showCompleted: selection.showCompleted,
              status: selection.status,
              priority: selection.priority,
              category: selection.category,
              cursor: selection.cursor,
            },
          };
        case "counts":
          return {
            readId: TASK_COUNTS_READ.id,
            input: {
              view: selection.view,
              status: selection.status,
              priority: selection.priority,
              category: selection.category,
            },
          };
        case "follow_up_ownership":
          return {
            readId: TASK_FOLLOW_UP_OWNERSHIP_READ.id,
            input: {
              section: selection.section,
              cursor: selection.cursor,
            },
          };
        case "detail": {
          const taskId =
            selection.taskId ??
            (pageContext?.kind === "task" ? pageContext.recordId : null);
          return taskId
            ? { readId: TASK_DETAIL_READ.id, input: { taskId } }
            : null;
        }
        case "detail_checklist": {
          const taskId =
            selection.taskId ??
            (pageContext?.kind === "task" ? pageContext.recordId : null);
          return taskId
            ? {
                readId: TASK_CHECKLIST_DETAIL_READ.id,
                input: { taskId, cursor: selection.cursor },
              }
            : null;
        }
        case "detail_prerequisites": {
          const taskId =
            selection.taskId ??
            (pageContext?.kind === "task" ? pageContext.recordId : null);
          return taskId
            ? {
                readId: TASK_PREREQUISITE_DETAIL_READ.id,
                input: { taskId, cursor: selection.cursor },
              }
            : null;
        }
        case "planning":
          return {
            readId: TASK_PLANNING_READ.id,
            input: {
              taskId:
                selection.taskId ??
                (pageContext?.kind === "task" ? pageContext.recordId : null),
            },
          };
        case "planning_assignees":
          return {
            readId: TASK_ASSIGNEE_PLANNING_READ.id,
            input: {
              taskId:
                selection.taskId ??
                (pageContext?.kind === "task" ? pageContext.recordId : null),
              search: selection.search,
              cursor: selection.cursor,
            },
          };
        case "planning_prerequisites":
          return {
            readId: TASK_PREREQUISITE_PLANNING_READ.id,
            input: {
              taskId:
                selection.taskId ??
                (pageContext?.kind === "task" ? pageContext.recordId : null),
              search: selection.search,
              cursor: selection.cursor,
            },
          };
        case "phase_prompt":
          return { readId: TASK_PHASE_TEMPLATE_PROMPT_READ.id, input: {} };
        case "templates":
          return { readId: TASK_TEMPLATES_READ.id, input: {} };
      }
    })();
    return selected && eligibleReadIds.includes(selected.readId)
      ? selected
      : null;
  },
});
