import { z } from "zod";

import { MEETING_NOTIFICATION_TYPES } from "@/lib/meetings/notifications";

import {
  TEAMS_ACTION_CONTRACTS,
  TEAMS_RESPONSIBILITY_SEED_CONTRACT,
  type TeamsActionExport,
} from "./contracts";

export const TEAMS_EFFECT_TABLES = [
  "churches",
  "ministry_teams",
  "team_roles",
  "team_memberships",
  "team_responsibilities",
  "training_programs",
  "training_completions",
  "locations",
  "church_meetings",
  "meeting_attendance",
  "persons",
  "person_activities",
] as const;

const uuid = z.string().uuid();
const jsonObject = z.record(z.string(), z.json());
const table = z.enum(TEAMS_EFFECT_TABLES);

const snapshotSchema = z.strictObject({
  table,
  id: uuid,
  /** Exact raw PostgreSQL `to_jsonb(row)` document, or a proved absence. */
  state: jsonObject.nullable(),
});

export const TEAMS_EFFECT_SET_KINDS = [
  "church_teams",
  "team_roles",
  "team_active_memberships",
  "team_responsibilities",
  "team_training_programs",
  "team_meetings",
  "active_role_memberships",
  "role_memberships",
  "person_role_memberships",
  "active_person_team_memberships",
  "training_completion_pair",
  "core_group_people",
  "core_group_users",
  "active_team_users",
  "confirmed_owner_people",
] as const;

const setAssertionSchema = z.strictObject({
  kind: z.enum(TEAMS_EFFECT_SET_KINDS),
  scopeId: uuid.nullable(),
  otherId: uuid.nullable(),
  ids: z.array(uuid).superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: "custom", message: "Set IDs must be unique" });
  }),
});

const mutationSchema = z
  .strictObject({
    table,
    id: uuid,
    mode: z.enum(["insert", "update", "delete"]),
    before: jsonObject.nullable(),
    after: jsonObject.nullable(),
  })
  .superRefine((value, context) => {
    if ((value.mode === "insert") !== (value.before === null)) {
      context.addIssue({
        code: "custom",
        message: "Only an insert may have an absent before row",
      });
    }
    if ((value.mode === "delete") !== (value.after === null)) {
      context.addIssue({
        code: "custom",
        message: "Only a delete may have an absent after row",
      });
    }
    if (value.before && value.before.id !== value.id) {
      context.addIssue({
        code: "custom",
        message: "Mutation before row ID drifted",
      });
    }
    if (value.after && value.after.id !== value.id) {
      context.addIssue({
        code: "custom",
        message: "Mutation after row ID drifted",
      });
    }
  });

const notificationIntentSchema = z.strictObject({
  recipientUserId: uuid,
  type: z
    .string()
    .refine(
      (value) => MEETING_NOTIFICATION_TYPES.includes(value),
      "Unknown meeting notification type"
    ),
  scheduledFor: z.string().datetime(),
});

const disclosureSchema = z.strictObject({
  title: z.string().trim().min(1).max(500),
  targets: z
    .array(
      z.strictObject({
        label: z.string().trim().min(1).max(160),
        value: z.string().trim().min(1).max(2_000),
        href: z.string().startsWith("/").max(2_000).nullable(),
      })
    )
    .min(1),
  counts: z.array(
    z.strictObject({
      label: z.string().trim().min(1).max(160),
      count: z.number().int().nonnegative(),
    })
  ),
  changes: z.array(
    z.strictObject({
      label: z.string().trim().min(1).max(160),
      before: z.string(),
      after: z.string(),
    })
  ),
  consequences: z.array(z.string().trim().min(1).max(1_000)).min(1).max(50),
  reversibility: z.enum(["reversible", "difficult_to_reverse", "irreversible"]),
  dateTime: z
    .strictObject({
      instantUtc: z.string().datetime(),
      timeZone: z.string().trim().min(1).max(64),
    })
    .nullable(),
});

export const TEAMS_EFFECT_OPERATIONS = [
  ...Object.entries(TEAMS_ACTION_CONTRACTS).flatMap(([exportName, contract]) =>
    contract.operationKind === "effect" ? [exportName] : []
  ),
  "initializeResponsibilities",
] as const;

export type TeamsEffectOperation = (typeof TEAMS_EFFECT_OPERATIONS)[number];

export const TEAMS_EFFECT_ARGUMENT_SHAPE = {
  operation: z.enum(TEAMS_EFFECT_OPERATIONS),
  /** All rows/absences that influenced eligibility or derived output. */
  expected: z.array(snapshotSchema),
  /** Exact source cardinalities whose membership, not just rows, matters. */
  sets: z.array(setAssertionSchema).max(200),
  /** The exact before/after database rows disclosed at confirmation. */
  mutations: z.array(mutationSchema).min(1),
  /**
   * Best-effort F11 work disclosed by the plan but never materialized as raw
   * database mutations. Execution re-reads the meeting and audience after the
   * durable effect, then crosses the canonical recipient gate and dedupe seam.
   */
  notificationIntents: z.array(notificationIntentSchema),
  disclosure: disclosureSchema,
} as const;

const commonSchema = z
  .strictObject(TEAMS_EFFECT_ARGUMENT_SHAPE)
  .superRefine((value, context) => {
    const mutationKeys = value.mutations.map(
      ({ table: tableName, id }) => `${tableName}:${id}`
    );
    if (new Set(mutationKeys).size !== mutationKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Teams mutations must be unique by table and ID",
      });
    }
    const expectedKeys = value.expected.map(
      ({ table: tableName, id }) => `${tableName}:${id}`
    );
    if (new Set(expectedKeys).size !== expectedKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Teams baselines must be unique by table and ID",
      });
    }
    const expectedByKey = new Map(
      value.expected.map((expected) => [
        `${expected.table}:${expected.id}`,
        expected,
      ])
    );
    for (const mutation of value.mutations) {
      const expected = expectedByKey.get(`${mutation.table}:${mutation.id}`);
      if (
        !expected ||
        JSON.stringify(expected.state) !== JSON.stringify(mutation.before)
      ) {
        context.addIssue({
          code: "custom",
          message: "Every Teams mutation must bind its exact baseline",
        });
      }
    }
    const allowed: Partial<Record<TeamsEffectOperation, ReadonlySet<string>>> =
      {
        createTeamAction: new Set(["ministry_teams:insert"]),
        updateTeamAction: new Set(["ministry_teams:update"]),
        assignTeamLeaderAction: new Set([
          "ministry_teams:update",
          "persons:update",
          "person_activities:insert",
        ]),
        initializeTeamsAction: new Set(["ministry_teams:insert"]),
        initializeTeamsWithRolesAction: new Set([
          "ministry_teams:insert",
          "team_roles:insert",
          "team_memberships:insert",
          "team_roles:update",
          "persons:update",
          "person_activities:insert",
          "churches:update",
        ]),
        createRoleAction: new Set(["team_roles:insert"]),
        updateRoleAction: new Set([
          "team_roles:update",
          "ministry_teams:update",
          "persons:update",
          "person_activities:insert",
        ]),
        deleteRoleAction: new Set([
          "team_roles:delete",
          "team_memberships:delete",
          "ministry_teams:update",
        ]),
        importRoleTemplatesAction: new Set([
          "team_roles:insert",
          "team_memberships:insert",
          "team_roles:update",
          "ministry_teams:update",
          "persons:update",
          "person_activities:insert",
          "churches:update",
        ]),
        initializeResponsibilities: new Set([
          "ministry_teams:update",
          "team_responsibilities:insert",
        ]),
        createResponsibilityAction: new Set(["team_responsibilities:insert"]),
        updateResponsibilityAction: new Set(["team_responsibilities:update"]),
        setResponsibilityCompleteAction: new Set([
          "team_responsibilities:update",
        ]),
        deleteResponsibilityAction: new Set(["team_responsibilities:delete"]),
        assignMemberAction: new Set([
          "team_memberships:insert",
          "team_memberships:update",
          "team_roles:update",
          "ministry_teams:update",
          "persons:update",
          "person_activities:insert",
          "churches:update",
        ]),
        removeMemberAction: new Set([
          "team_memberships:update",
          "team_roles:update",
          "ministry_teams:update",
        ]),
        createMeetingAction: new Set([
          "locations:insert",
          "church_meetings:insert",
          "meeting_attendance:insert",
        ]),
        createTrainingProgramAction: new Set(["training_programs:insert"]),
        markTrainingCompleteAction: new Set(["training_completions:insert"]),
      };
    const primary: Partial<Record<TeamsEffectOperation, string>> = {
      createTeamAction: "ministry_teams:insert",
      updateTeamAction: "ministry_teams:update",
      assignTeamLeaderAction: "ministry_teams:update",
      initializeTeamsAction: "ministry_teams:insert",
      initializeTeamsWithRolesAction: "ministry_teams:insert",
      createRoleAction: "team_roles:insert",
      updateRoleAction: "team_roles:update",
      deleteRoleAction: "team_roles:delete",
      importRoleTemplatesAction: "team_roles:insert",
      initializeResponsibilities: "ministry_teams:update",
      createResponsibilityAction: "team_responsibilities:insert",
      updateResponsibilityAction: "team_responsibilities:update",
      setResponsibilityCompleteAction: "team_responsibilities:update",
      deleteResponsibilityAction: "team_responsibilities:delete",
      assignMemberAction: "team_roles:update",
      removeMemberAction: "team_memberships:update",
      createMeetingAction: "church_meetings:insert",
      createTrainingProgramAction: "training_programs:insert",
      markTrainingCompleteAction: "training_completions:insert",
    };
    const operation = value.operation as TeamsEffectOperation;
    const operationAllowed = allowed[operation];
    const mutationKinds = value.mutations.map(
      ({ table: tableName, mode }) => `${tableName}:${mode}`
    );
    if (
      !operationAllowed ||
      mutationKinds.some((kind) => !operationAllowed.has(kind))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Teams operation contains a mutation outside its closed domain contract",
      });
    }
    if (primary[operation] && !mutationKinds.includes(primary[operation]!)) {
      context.addIssue({
        code: "custom",
        message: "Teams operation is missing its primary mutation",
      });
    }
    if (
      operation !== "createMeetingAction" &&
      value.notificationIntents.length > 0
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Only meeting creation may disclose meeting notification intents",
      });
    }
    if (operation === "createMeetingAction") {
      const meetingIds = value.mutations.flatMap((mutation) =>
        mutation.table === "church_meetings" && mutation.mode === "insert"
          ? [mutation.id]
          : []
      );
      if (meetingIds.length !== 1) {
        context.addIssue({
          code: "custom",
          message: "Meeting creation must bind exactly one meeting row",
        });
      }
      const intentKeys = value.notificationIntents.map(
        ({ recipientUserId, type, scheduledFor }) =>
          `${recipientUserId}:${type}:${scheduledFor}`
      );
      if (new Set(intentKeys).size !== intentKeys.length) {
        context.addIssue({
          code: "custom",
          message: "Meeting notification intents must be unique",
        });
      }
    }
  });

export type TeamsEffectArguments = z.infer<typeof commonSchema>;

const effectExports = Object.entries(TEAMS_ACTION_CONTRACTS).flatMap(
  ([exportName, contract]) =>
    contract.operationKind === "effect" ? [exportName as TeamsActionExport] : []
);

export const TEAMS_EFFECT_ARGUMENT_SCHEMAS = Object.freeze(
  Object.fromEntries([
    ...effectExports.map((exportName) => [
      exportName,
      commonSchema.refine((value) => value.operation === exportName, {
        message: `Teams plan operation must be ${exportName}`,
      }),
    ]),
    [
      "initializeResponsibilities",
      commonSchema.refine(
        (value) => value.operation === "initializeResponsibilities",
        {
          message: "Teams plan operation must be initializeResponsibilities",
        }
      ),
    ],
  ])
) as Readonly<Record<TeamsEffectOperation, typeof commonSchema>>;

export const TEAMS_EFFECT_IDENTITY_BY_OPERATION = Object.freeze({
  ...Object.fromEntries(
    effectExports.map((exportName) => [
      exportName,
      TEAMS_ACTION_CONTRACTS[exportName].operationId,
    ])
  ),
  initializeResponsibilities: TEAMS_RESPONSIBILITY_SEED_CONTRACT.operationId,
}) as Readonly<Record<TeamsEffectOperation, string>>;

export function parseTeamsEffectArguments(
  operation: TeamsEffectOperation,
  value: unknown
): TeamsEffectArguments {
  return TEAMS_EFFECT_ARGUMENT_SCHEMAS[operation].parse(value);
}
