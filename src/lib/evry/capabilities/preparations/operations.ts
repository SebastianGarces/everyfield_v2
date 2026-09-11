import { z } from "zod";
import {
  attendanceStatuses,
  meetingStatuses,
  meetingSubtypes,
  meetingTypes,
  responseCardTypes,
  responseStatuses,
  taskCategories,
  taskPriorities,
  taskRelatedTypes,
  taskStatuses,
  PREDEFINED_TEAM_KEYS,
} from "@/db/schema";
import { defineEvryModelPreparation } from "../model-preparation";
import { createTaskEvryConversationContinuation } from "../tasks/conversation";
import { TASK_ACTION_CONTRACTS } from "../tasks/contracts";
import type { TaskEffectExport } from "../tasks/effect-contracts";
import { createMeetingsEvryConversationContinuation } from "../meetings/conversation";
import {
  MEETINGS_ACTION_CONTRACTS,
  type MeetingsActionExport,
} from "../meetings/catalog";
import { createTeamsEvryConversationContinuation } from "../teams/conversation";
import {
  TEAMS_EFFECT_IDENTITY_BY_OPERATION,
  type TeamsEffectOperation,
} from "../teams/effect-contracts";
import { createLaunchEvryConversationContinuation } from "../launch/conversation";
import {
  LAUNCH_EFFECT_IDENTITIES,
  launchOutcomeArgumentsSchema,
} from "../launch/effects";
import {
  teamCreateSchema,
  teamUpdateSchema,
} from "@/lib/validations/ministry-teams";
import {
  operationCalendarDate,
  operationLocalDatetime as localDatetime,
} from "./operations-dates";

const uuid = z.string().uuid();
const ids = z
  .array(uuid)
  .min(1)
  .max(50)
  .refine(
    (values) => new Set(values).size === values.length,
    "Choose each record only once"
  );
const text = z.string().trim().min(1).max(255);
const note = z.string().max(3000).nullable();
const taskId = { taskId: uuid };
const taskFields = {
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(8000).nullable().optional(),
  status: z.enum(taskStatuses).optional(),
  priority: z.enum(taskPriorities).optional(),
  dueDate: operationCalendarDate.nullable().optional(),
  dueTime: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional(),
  assignedToId: uuid.nullable().optional(),
  category: z.enum(taskCategories).nullable().optional(),
  relatedType: z.enum(taskRelatedTypes).nullable().optional(),
  relatedId: uuid.nullable().optional(),
  parentTaskId: uuid.nullable().optional(),
  prerequisiteTaskIds: z.array(uuid).max(50).optional(),
  recurrence: z
    .enum([
      "none",
      "daily",
      "weekly",
      "biweekly",
      "monthly",
      "quarterly",
      "yearly",
    ])
    .optional(),
  recurrenceEndDate: z.string().date().nullable().optional(),
};

function task<S extends z.ZodRawShape>(
  exportName: TaskEffectExport,
  fields: S
) {
  const identity = TASK_ACTION_CONTRACTS[exportName].operationId;
  return defineEvryModelPreparation({
    id: identity,
    capabilityIdentities: [identity],
    inputSchema: z.strictObject(fields),
    run(input, values) {
      return createTaskEvryConversationContinuation(undefined, {
        kind: "effect",
        exportName,
        values,
      }).continue(input);
    },
  });
}

const taskPreparations = [
  task("createTaskAction", {
    ...taskFields,
    title: z.string().trim().min(1).max(500),
  }),
  task("updateTaskAction", { ...taskId, ...taskFields }),
  task("quickAddTaskAction", {
    title: z.string().trim().min(1).max(500),
    dueDate: operationCalendarDate.nullable().optional(),
    priority: z.enum(taskPriorities).optional(),
  }),
  task("completeTaskAction", taskId),
  task("reopenTaskAction", taskId),
  task("deleteTaskAction", taskId),
  task("updateTaskStatusAction", { ...taskId, status: z.enum(taskStatuses) }),
  task("addSubtaskAction", {
    parentTaskId: uuid,
    title: z.string().trim().min(1).max(500),
  }),
  task("setSubtaskCompletionAction", {
    subtaskId: uuid,
    complete: z.boolean(),
  }),
  task("bulkCompleteTasksAction", { taskIds: ids }),
  task("bulkRescheduleTasksAction", {
    taskIds: ids,
    dueDate: operationCalendarDate,
  }),
  task("assignFollowUpAction", { ...taskId, assigneeId: uuid }),
  task("createAndAssignFollowUpAction", {
    personId: uuid,
    personName: text,
    assigneeId: uuid,
  }),
  task("handOffFollowUpsAction", { fromAssigneeId: uuid, toAssigneeId: uuid }),
  task("importTaskTemplateAction", {
    templateKey: z.string().trim().min(1).max(100),
  }),
  task("importPhaseTemplatesAction", {
    transitionId: uuid,
    templateKeys: z.array(z.string().min(1).max(100)).min(1).max(25),
  }),
  task("dismissPhaseTemplatePromptAction", { transitionId: uuid }),
];

const meetingFields = {
  title: z.string().min(1).max(255).nullable().optional(),
  datetime: localDatetime.optional(),
  locationId: uuid.nullable().optional(),
  locationName: text.nullable().optional(),
  locationAddress: z.string().min(1).max(500).nullable().optional(),
  meetingSubtype: z.enum(meetingSubtypes).nullable().optional(),
  estimatedAttendance: z.number().int().min(0).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  notes: note.optional(),
};
const locationFields = {
  name: text,
  address: z.string().trim().min(1).max(500),
  contactName: text.nullable().optional(),
  contactPhone: z.string().max(50).nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  cost: z.string().max(50).nullable().optional(),
  capacity: z.number().int().min(0).nullable().optional(),
  notes: note.optional(),
};

function meeting<S extends z.ZodRawShape>(
  exportName: MeetingsActionExport,
  fields: S,
  existingMeeting = true
) {
  const identity = MEETINGS_ACTION_CONTRACTS[exportName].operationId;
  return defineEvryModelPreparation({
    id: identity,
    capabilityIdentities: [identity],
    inputSchema: z.strictObject({
      ...(existingMeeting ? { meetingId: uuid } : {}),
      ...fields,
    }),
    run(input, values) {
      const normalized: Record<string, unknown> = { ...values };
      const meetingId =
        typeof normalized.meetingId === "string"
          ? normalized.meetingId
          : undefined;
      delete normalized.meetingId;
      if (
        exportName === "saveAgendaAction" &&
        Array.isArray(normalized.sections)
      )
        normalized.sections = normalized.sections.map(
          (section: { title: string; minutes: number }, index: number) => ({
            id: `evry-section-${index + 1}`,
            ...section,
          })
        );
      return createMeetingsEvryConversationContinuation(
        undefined,
        undefined,
        { kind: "effect", exportName, values: normalized },
        meetingId
      ).continue(input);
    },
  });
}

const meetingPreparations = [
  meeting(
    "createMeetingAction",
    {
      ...meetingFields,
      type: z.enum(meetingTypes),
      datetime: localDatetime,
      teamId: uuid.nullable().optional(),
    },
    false
  ),
  meeting("updateMeetingAction", meetingFields),
  meeting("deleteMeetingAction", {}),
  meeting("updateMeetingStatusAction", { status: z.enum(meetingStatuses) }),
  meeting("finalizeAttendanceAction", {}),
  meeting("createLocationAction", locationFields, false),
  meeting(
    "updateLocationAction",
    { ...z.object(locationFields).partial().shape, locationId: uuid },
    false
  ),
  ...(
    [
      "addAttendeeAction",
      "addToGuestListAction",
      "addWalkInAttendeeAction",
      "removeAttendeeAction",
      "removeFromGuestListAction",
      "clearResponseCardAction",
    ] as const
  ).map((operation) => meeting(operation, { personId: uuid })),
  ...(
    [
      "quickAddAttendeeAction",
      "quickAddPersonToGuestListAction",
      "quickAddWalkInAction",
    ] as const
  ).map((operation) =>
    meeting(operation, {
      firstName: text,
      lastName: text,
      email: z.string().email().nullable().default(null),
      phone: z.string().max(50).nullable().default(null),
    })
  ),
  meeting("recordAttendanceBatchAction", {
    records: z
      .array(
        z.strictObject({ personId: uuid, status: z.enum(attendanceStatuses) })
      )
      .min(1)
      .max(50),
  }),
  meeting("updateRsvpStatusAction", {
    personId: uuid,
    status: z.enum(responseStatuses),
  }),
  meeting("toggleAttendanceStatusAction", {
    personId: uuid,
    status: z.enum(["attended", "absent"]),
  }),
  meeting("addAttendeeNoteAction", {
    personId: uuid,
    note: z.string().min(1).max(3000),
  }),
  meeting("recordResponseCardAction", {
    personId: uuid,
    responseType: z.enum(responseCardTypes),
    notes: note.default(null),
  }),
  meeting("saveAgendaAction", {
    sections: z
      .array(
        z.strictObject({
          title: text,
          minutes: z.number().int().min(0).max(1440),
        })
      )
      .min(1)
      .max(30),
  }),
  meeting("toggleChecklistItemAction", { itemId: uuid, checked: z.boolean() }),
  meeting("updateChecklistItemAction", {
    itemId: uuid,
    notes: note.optional(),
    assignedTo: uuid.nullable().optional(),
  }),
  meeting("createEvaluationAction", {
    scores: z
      .array(z.number().int().min(1).max(5))
      .length(8)
      .describe(
        "Scores in order: attendance, location, logistics, agenda, vibe, message, close, next steps. Ask for missing scores, do not invent them."
      ),
    notes: note.default(null),
  }),
];

function team<S extends z.ZodRawShape>(
  operation: TeamsEffectOperation,
  fields: S
) {
  const identity = TEAMS_EFFECT_IDENTITY_BY_OPERATION[operation];
  return defineEvryModelPreparation({
    id: identity,
    capabilityIdentities: [identity],
    inputSchema: z.strictObject(fields),
    run(input, values) {
      // The existing form-backed resolver accepts strings, but never phrases.
      const formValues: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) continue;
        if (typeof value === "string") formValues[key] = value;
        else if (typeof value === "number" || typeof value === "boolean")
          formValues[key] = String(value);
        else if (
          Array.isArray(value) &&
          value.every((item) => typeof item === "string")
        )
          formValues[key] = value.join(",");
        else throw new Error("Unsupported team form value");
      }
      return createTeamsEvryConversationContinuation({
        kind: "effect",
        operation,
        values: formValues,
      }).continue(input);
    },
  });
}
const roleFields = {
  name: text.optional(),
  description: z.string().max(2000).optional(),
  isLeadershipRole: z.boolean().optional(),
  timeCommitment: z.enum(["low", "medium", "high"]).optional(),
  desiredSkills: z.string().max(1000).optional(),
  sortOrder: z.number().int().min(0).optional(),
};
const teamPreparations = [
  team("createTeamAction", teamCreateSchema.shape),
  team("updateTeamAction", { teamId: uuid, ...teamUpdateSchema.shape }),
  team("createRoleAction", { teamId: uuid, ...roleFields, name: text }),
  team("updateRoleAction", { roleId: uuid, ...roleFields }),
  team("deleteRoleAction", { roleId: uuid }),
  team("assignMemberAction", {
    teamId: uuid,
    roleId: uuid,
    personId: uuid,
    startDate: z.string().date().optional(),
  }),
  team("removeMemberAction", { membershipId: uuid }),
  team("assignTeamLeaderAction", { teamId: uuid, personId: uuid }),
  team("createResponsibilityAction", { teamId: uuid, title: text }),
  team("updateResponsibilityAction", { responsibilityId: uuid, title: text }),
  team("deleteResponsibilityAction", { responsibilityId: uuid }),
  team("setResponsibilityCompleteAction", {
    responsibilityId: uuid,
    completed: z.boolean(),
  }),
  team("initializeResponsibilities", { teamId: uuid }),
  team("initializeTeamsAction", {
    teamKeys: z.array(z.enum(PREDEFINED_TEAM_KEYS)).min(1).max(10).optional(),
  }),
  team("initializeTeamsWithRolesAction", {}),
  team("importRoleTemplatesAction", {
    teamId: uuid,
    teamKey: z.enum(PREDEFINED_TEAM_KEYS),
    roleKeys: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
  }),
  team("createTrainingProgramAction", {
    name: text,
    description: z.string().max(2000).optional(),
    teamId: uuid.optional(),
    isRequired: z.boolean().optional(),
  }),
  team("markTrainingCompleteAction", { personId: uuid, programId: uuid }),
  // Ministry meeting creation uses meetings.create, which also resolves timezone.
];

const launchPreparations = [
  defineEvryModelPreparation({
    id: LAUNCH_EFFECT_IDENTITIES.schedule,
    capabilityIdentities: [LAUNCH_EFFECT_IDENTITIES.schedule],
    inputSchema: z.strictObject({
      targetDate: z.string().date(),
      postpone: z.boolean().default(false),
      note: note.default(null),
    }),
    run(input, values) {
      return createLaunchEvryConversationContinuation(undefined, {
        kind: "schedule",
        ...values,
      }).continue(input);
    },
  }),
  ...(["complete_milestone", "reopen_milestone"] as const).map((kind) => {
    const identity =
      kind === "complete_milestone"
        ? LAUNCH_EFFECT_IDENTITIES.completeMilestone
        : LAUNCH_EFFECT_IDENTITIES.reopenMilestone;
    return defineEvryModelPreparation({
      id: identity,
      capabilityIdentities: [identity],
      inputSchema: z.strictObject({ milestoneId: uuid }),
      run(input, values) {
        return createLaunchEvryConversationContinuation(undefined, {
          kind,
          ...values,
        }).continue(input);
      },
    });
  }),
  defineEvryModelPreparation({
    id: LAUNCH_EFFECT_IDENTITIES.setTaskCompletion,
    capabilityIdentities: [LAUNCH_EFFECT_IDENTITIES.setTaskCompletion],
    inputSchema: z.strictObject({ taskId: uuid, complete: z.boolean() }),
    run(input, values) {
      return createLaunchEvryConversationContinuation(undefined, {
        kind: "set_task_completion",
        ...values,
      }).continue(input);
    },
  }),
  ...(["record_outcome", "correct_outcome"] as const).map((kind) => {
    const identity =
      kind === "record_outcome"
        ? LAUNCH_EFFECT_IDENTITIES.recordOutcome
        : LAUNCH_EFFECT_IDENTITIES.correctOutcome;
    return defineEvryModelPreparation({
      id: identity,
      capabilityIdentities: [identity],
      inputSchema: z.strictObject({
        outcome: launchOutcomeArgumentsSchema.shape.outcome,
      }),
      run(input, values) {
        return createLaunchEvryConversationContinuation(undefined, {
          kind,
          ...values,
        }).continue(input);
      },
    });
  }),
];

export const OPERATIONS_MODEL_PREPARATIONS = [
  ...taskPreparations,
  ...meetingPreparations,
  ...teamPreparations,
  ...launchPreparations,
] as const;
