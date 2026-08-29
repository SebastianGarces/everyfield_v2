import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { churches, users } from "@/db/schema";
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
import { listFollowUpAssignees } from "@/lib/tasks/follow-up-ownership";
import { readPhaseTemplatePrompt } from "@/lib/tasks/phase-prompt";
import { getTask, listSubtasks, listTasks } from "@/lib/tasks/service";
import { TASK_TEMPLATES, taskTemplateSize } from "@/lib/tasks/templates";

export const TASK_READ_IDENTITIES = {
  detail: "tasks.read.detail",
  list: "tasks.read.list",
  phasePrompt: "tasks.read.phase-template-prompt",
  planning: "tasks.read.planning-options",
  templates: "tasks.read.templates",
} as const;

const uuid = z.string().uuid();
const TASK_READ_LIMIT = 50;

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

export const TASK_LIST_READ = defineEvryReadRegistration({
  id: "tasks.list",
  capabilityIdentity: TASK_READ_IDENTITIES.list,
  inputShape: {
    search: z.string().trim().max(160),
    includeCompleted: z.boolean(),
    cursor: uuid.nullable(),
  },
  async run({ authorization }, input) {
    const result = await listTasks(authorization.actor.plantId, {
      search: input.search || undefined,
      includeCompleted: input.includeCompleted,
      cursor: input.cursor ?? undefined,
      limit: TASK_READ_LIMIT,
    });
    return buildEvryReadArtifact({
      title: input.search ? `Tasks matching “${input.search}”` : "Tasks",
      filters: [
        ...(input.search ? [{ label: "Search", value: input.search }] : []),
        {
          label: "Completed",
          value: input.includeCompleted ? "Included" : "Excluded",
        },
        { label: "Matching tasks", value: String(result.total) },
        { label: "Page cursor", value: input.cursor ?? "First page" },
        {
          label: "Next page cursor",
          value: result.nextCursor ?? "End of results",
        },
      ],
      // Pagination is continuation, not exclusion: the next cursor above
      // reaches the remaining matching rows without inflating excluded counts.
      exclusions: [],
      items: result.tasks.map((task) => ({
        id: task.id,
        label: artifactLabel(task.title, "Untitled task"),
        facts: taskFacts(task),
        sourceLink: link(
          artifactLabel(`Open ${task.title}`, "Open task"),
          `/tasks/${task.id}`
        ),
      })),
      sourceLinks: [link("Open Tasks", "/tasks")],
    });
  },
});

export const TASK_PHASE_TEMPLATE_PROMPT_READ = defineEvryReadRegistration({
  id: "tasks.phase-template-prompt",
  capabilityIdentity: TASK_READ_IDENTITIES.phasePrompt,
  inputShape: {},
  async run({ authorization }) {
    const { transitionId, prompt } = await readPhaseTemplatePrompt(
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
    const task = await getTask(authorization.actor.plantId, taskId);
    if (!task) {
      return buildEvryReadArtifact({
        title: "Task unavailable",
        filters: [{ label: "Task", value: taskId }],
        exclusions: [{ reason: "Unavailable in this plant", count: 1 }],
        items: [],
        sourceLinks: [link("Open Tasks", "/tasks")],
      });
    }
    const [subtasks, prerequisites] = await Promise.all([
      listSubtasks(authorization.actor.plantId, task.id),
      listTaskPrerequisites(authorization.actor.plantId, task.id),
    ]);
    return buildEvryReadArtifact({
      title: artifactTitle(task.title, "Task"),
      filters: [{ label: "Task", value: task.id }],
      exclusions: [],
      items: [
        {
          id: task.id,
          label: artifactLabel(task.title, "Untitled task"),
          facts: [
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
            ...(subtasks.length > 0
              ? [
                  {
                    label: "Checklist",
                    value: artifactFact(
                      subtasks
                        .map((row) => `${row.title} (${row.status})`)
                        .join("; "),
                      "No checklist items"
                    ),
                  },
                ]
              : []),
            ...(prerequisites.length > 0
              ? [
                  {
                    label: "Waits on",
                    value: artifactFact(
                      prerequisites
                        .map((row) => `${row.title} (${row.status})`)
                        .join("; "),
                      "No prerequisites"
                    ),
                  },
                ]
              : []),
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

export const TASK_PLANNING_READ = defineEvryReadRegistration({
  id: "tasks.planning-options",
  capabilityIdentity: TASK_READ_IDENTITIES.planning,
  inputShape: { taskId: uuid.nullable() },
  async run({ authorization }, { taskId }) {
    const [plantUsers, followUpAssignees, prerequisites] = await Promise.all([
      db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.churchId, authorization.actor.plantId)),
      listFollowUpAssignees(authorization.actor.plantId),
      listPrerequisiteCandidates(
        authorization.actor.plantId,
        taskId ?? undefined
      ),
    ]);
    const items = [
      ...plantUsers.slice(0, TASK_READ_LIMIT).map((user) => ({
        id: `assignee:${user.id}`,
        label: artifactLabel(user.name?.trim() || user.email, "Plant member"),
        facts: [
          { label: "Kind", value: "Task assignee" },
          {
            label: "Follow-up eligible",
            value: followUpAssignees.some(({ id }) => id === user.id)
              ? "Yes"
              : "No",
          },
        ],
        sourceLink: link("Open Tasks", "/tasks"),
      })),
      ...prerequisites.slice(0, TASK_READ_LIMIT).map((task) => ({
        id: `prerequisite:${task.id}`,
        label: artifactLabel(task.title, "Untitled task"),
        facts: [
          { label: "Kind", value: "Prerequisite candidate" },
          { label: "Status", value: task.status },
        ],
        sourceLink: link(
          artifactLabel(`Open ${task.title}`, "Open task"),
          `/tasks/${task.id}`
        ),
      })),
    ].slice(0, TASK_READ_LIMIT);
    const total = plantUsers.length + prerequisites.length;
    return buildEvryReadArtifact({
      title: "Task planning options",
      filters: taskId ? [{ label: "Editing task", value: taskId }] : [],
      exclusions:
        total > items.length
          ? [
              {
                reason: "Not shown on this result page",
                count: total - items.length,
              },
            ]
          : [],
      items,
      sourceLinks: [
        link(
          taskId ? "Open task" : "Create a task",
          taskId ? `/tasks/${taskId}` : "/tasks/new"
        ),
      ],
    });
  },
});

export const TASK_TEMPLATES_READ = defineEvryReadRegistration({
  id: "tasks.templates",
  capabilityIdentity: TASK_READ_IDENTITIES.templates,
  inputShape: {},
  async run({ authorization }) {
    const [plant] = await db
      .select({ phase: churches.currentPhase })
      .from(churches)
      .where(and(eq(churches.id, authorization.actor.plantId)))
      .limit(1);
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
      search: string;
      includeCompleted: boolean;
      cursor: string | null;
    }>
  | Readonly<{ kind: "detail"; taskId: string | null }>
  | Readonly<{ kind: "phase_prompt" }>
  | Readonly<{ kind: "planning"; taskId: string | null }>
  | Readonly<{ kind: "templates" }>;

const UUID =
  "([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})";

export function selectTaskEvryRead(
  literalUserText: string
): TaskEvryReadSelection | null {
  const text = literalUserText.normalize("NFKC").trim();
  let match: RegExpExecArray | null;
  match = new RegExp(
    `^load more tasks matching\\s+(.+?)\\s+after\\s+${UUID}[.!?]*$`,
    "i"
  ).exec(text);
  if (match?.[1] && match[2]) {
    return {
      kind: "list",
      search: match[1].trim(),
      includeCompleted: true,
      cursor: match[2],
    };
  }
  match = new RegExp(`^load more all tasks after\\s+${UUID}[.!?]*$`, "i").exec(
    text
  );
  if (match?.[1]) {
    return {
      kind: "list",
      search: "",
      includeCompleted: true,
      cursor: match[1],
    };
  }
  match = new RegExp(`^load more tasks after\\s+${UUID}[.!?]*$`, "i").exec(
    text
  );
  if (match?.[1]) {
    return {
      kind: "list",
      search: "",
      includeCompleted: false,
      cursor: match[1],
    };
  }
  if (/^(?:show|list)(?: me)? tasks[.!?]*$/i.test(text)) {
    return { kind: "list", search: "", includeCompleted: false, cursor: null };
  }
  if (/^(?:show|list)(?: me)? all tasks[.!?]*$/i.test(text)) {
    return { kind: "list", search: "", includeCompleted: true, cursor: null };
  }
  match = /^find tasks matching\s+(.+?)[.!?]*$/i.exec(text);
  if (match?.[1]) {
    return {
      kind: "list",
      search: match[1].trim(),
      includeCompleted: true,
      cursor: null,
    };
  }
  match = new RegExp(`^show task\\s+${UUID}[.!?]*$`, "i").exec(text);
  if (match?.[1]) return { kind: "detail", taskId: match[1] };
  if (/^show (?:this )?task(?: details)?[.!?]*$/i.test(text)) {
    return { kind: "detail", taskId: null };
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
  TASK_DETAIL_READ,
  TASK_PHASE_TEMPLATE_PROMPT_READ,
  TASK_PLANNING_READ,
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
              search: selection.search,
              includeCompleted: selection.includeCompleted,
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
        case "planning":
          return {
            readId: TASK_PLANNING_READ.id,
            input: {
              taskId:
                selection.taskId ??
                (pageContext?.kind === "task" ? pageContext.recordId : null),
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
