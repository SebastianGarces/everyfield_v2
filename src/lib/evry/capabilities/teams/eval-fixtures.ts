import {
  TEAMS_EFFECT_IDENTITY_BY_OPERATION,
  TEAMS_EFFECT_OPERATIONS,
  parseTeamsEffectArguments,
  type TeamsEffectOperation,
} from "./effect-contracts";

const PLANT = "00000000-0000-4000-8000-000000000001";
const ROW = "00000000-0000-4000-8000-000000000002";

const PRIMARY: Readonly<
  Record<
    TeamsEffectOperation,
    readonly [string, "insert" | "update" | "delete"]
  >
> = {
  assignMemberAction: ["team_roles", "update"],
  assignTeamLeaderAction: ["ministry_teams", "update"],
  createMeetingAction: ["church_meetings", "insert"],
  createResponsibilityAction: ["team_responsibilities", "insert"],
  createRoleAction: ["team_roles", "insert"],
  createTeamAction: ["ministry_teams", "insert"],
  createTrainingProgramAction: ["training_programs", "insert"],
  deleteResponsibilityAction: ["team_responsibilities", "delete"],
  deleteRoleAction: ["team_roles", "delete"],
  importRoleTemplatesAction: ["team_roles", "insert"],
  initializeTeamsAction: ["ministry_teams", "insert"],
  initializeTeamsWithRolesAction: ["ministry_teams", "insert"],
  initializeResponsibilities: ["ministry_teams", "update"],
  markTrainingCompleteAction: ["training_completions", "insert"],
  removeMemberAction: ["team_memberships", "update"],
  setResponsibilityCompleteAction: ["team_responsibilities", "update"],
  updateResponsibilityAction: ["team_responsibilities", "update"],
  updateRoleAction: ["team_roles", "update"],
  updateTeamAction: ["ministry_teams", "update"],
};

export function teamsEffectEvalFixture(operation: TeamsEffectOperation) {
  const [table, mode] = PRIMARY[operation];
  const before =
    mode === "insert" ? null : { id: ROW, church_id: PLANT, value: "before" };
  const after =
    mode === "delete" ? null : { id: ROW, church_id: PLANT, value: "after" };
  return parseTeamsEffectArguments(operation, {
    operation,
    expected: [{ table, id: ROW, state: before }],
    sets: [],
    mutations: [{ table, id: ROW, mode, before, after }],
    disclosure: {
      title: `Fixture ${operation}`,
      targets: [{ label: "Fixture", value: operation, href: "/teams" }],
      counts: [{ label: "Rows", count: 1 }],
      changes: [
        {
          label: "Fixture",
          before: JSON.stringify(before),
          after: JSON.stringify(after),
        },
      ],
      consequences: ["Exercises the exact closed capability layer."],
      reversibility: mode === "delete" ? "difficult_to_reverse" : "reversible",
      dateTime:
        operation === "createMeetingAction"
          ? {
              instantUtc: "2030-01-02T18:00:00.000Z",
              timeZone: "America/New_York",
            }
          : null,
    },
  });
}

export const TEAMS_EVAL_FIXTURES = Object.freeze(
  TEAMS_EFFECT_OPERATIONS.map((operation) => ({
    operation,
    identity: TEAMS_EFFECT_IDENTITY_BY_OPERATION[operation],
    arguments: teamsEffectEvalFixture(operation),
    failureArguments: { ...teamsEffectEvalFixture(operation), untrusted: true },
  }))
);
