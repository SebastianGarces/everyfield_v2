export type TeamsOperationKind = "read" | "effect";

export type TeamsMutationShape =
  | "single_create"
  | "single_update"
  | "single_delete"
  | "association_add"
  | "association_remove"
  | "bulk_import"
  | "compound_write";

export type TeamsActionContract = Readonly<{
  operationId: string;
  domain:
    | "teams"
    | "roles"
    | "responsibilities"
    | "members"
    | "meetings"
    | "training";
  operationKind: TeamsOperationKind;
  label: string;
  actionLabel: string | null;
  argumentKeys: readonly string[];
  difficultToReverse: boolean;
  mutationShape: TeamsMutationShape | null;
}>;

function effect(
  operationId: string,
  domain: TeamsActionContract["domain"],
  label: string,
  argumentKeys: readonly string[],
  mutationShape: TeamsMutationShape,
  difficultToReverse = false
): TeamsActionContract {
  return Object.freeze({
    operationId,
    domain,
    operationKind: "effect",
    label,
    actionLabel: label,
    argumentKeys: Object.freeze([...argumentKeys]),
    difficultToReverse,
    mutationShape,
  });
}

function read(
  operationId: string,
  domain: TeamsActionContract["domain"],
  label: string,
  argumentKeys: readonly string[]
): TeamsActionContract {
  return Object.freeze({
    operationId,
    domain,
    operationKind: "read",
    label,
    actionLabel: null,
    argumentKeys: Object.freeze([...argumentKeys]),
    difficultToReverse: false,
    mutationShape: null,
  });
}

/** The closed semantic contract for every authenticated Teams action export. */
export const TEAMS_ACTION_CONTRACTS = {
  assignMemberAction: effect(
    "teams.members.assign",
    "members",
    "Assign team member",
    [
      "team",
      "role",
      "person",
      "membership",
      "roleAfter",
      "teamAfter",
      "personAfter",
      "activity",
      "materialStamp",
    ],
    "compound_write"
  ),
  assignTeamLeaderAction: effect(
    "teams.leader.assign",
    "teams",
    "Assign team leader",
    ["team", "person", "teamAfter", "personAfter", "activity"],
    "compound_write"
  ),
  createMeetingAction: effect(
    "teams.meetings.create",
    "meetings",
    "Schedule team meeting",
    ["team", "meeting", "guests", "notifications"],
    "compound_write"
  ),
  createResponsibilityAction: effect(
    "teams.responsibilities.create",
    "responsibilities",
    "Add team responsibility",
    ["team", "responsibility"],
    "single_create"
  ),
  createRoleAction: effect(
    "teams.roles.create",
    "roles",
    "Create team role",
    ["team", "role"],
    "single_create"
  ),
  createTeamAction: effect(
    "teams.create",
    "teams",
    "Create ministry team",
    ["team"],
    "single_create"
  ),
  createTrainingProgramAction: effect(
    "teams.training.create-program",
    "training",
    "Create training program",
    ["team", "program"],
    "single_create"
  ),
  deleteResponsibilityAction: effect(
    "teams.responsibilities.delete",
    "responsibilities",
    "Delete team responsibility",
    ["responsibility"],
    "single_delete",
    true
  ),
  deleteRoleAction: effect(
    "teams.roles.delete",
    "roles",
    "Delete team role and membership history",
    ["team", "role", "memberships", "teamAfter"],
    "compound_write",
    true
  ),
  importRoleTemplatesAction: effect(
    "teams.roles.import",
    "roles",
    "Import team role templates",
    ["team", "teamTemplateKey", "roleTemplateKeys", "roles", "leadershipFill"],
    "bulk_import"
  ),
  initializeTeamsAction: effect(
    "teams.initialize",
    "teams",
    "Set up predefined ministry teams",
    ["existingTeams", "teamTemplateKeys", "teams"],
    "bulk_import"
  ),
  initializeTeamsWithRolesAction: effect(
    "teams.initialize-with-roles",
    "teams",
    "Set up predefined ministry teams and roles",
    ["existingTeams", "teams", "roles", "leadershipFills"],
    "compound_write"
  ),
  listTeamsAction: read("teams.read.list", "teams", "List ministry teams", [
    "status",
  ]),
  markTrainingCompleteAction: effect(
    "teams.training.complete",
    "training",
    "Mark training complete",
    ["person", "program", "completion"],
    "association_add"
  ),
  removeMemberAction: effect(
    "teams.members.remove",
    "members",
    "Remove team member",
    ["team", "role", "membership", "membershipAfter", "roleAfter", "teamAfter"],
    "compound_write",
    true
  ),
  searchTeamCandidatesAction: read(
    "teams.read.candidates",
    "members",
    "Search team candidates",
    ["query"]
  ),
  setResponsibilityCompleteAction: effect(
    "teams.responsibilities.completion",
    "responsibilities",
    "Update responsibility completion",
    ["responsibility", "after"],
    "single_update"
  ),
  updateResponsibilityAction: effect(
    "teams.responsibilities.update",
    "responsibilities",
    "Update team responsibility",
    ["responsibility", "after"],
    "single_update"
  ),
  updateRoleAction: effect(
    "teams.roles.update",
    "roles",
    "Update team role",
    [
      "team",
      "role",
      "holder",
      "roleAfter",
      "teamAfter",
      "personAfter",
      "activity",
    ],
    "compound_write"
  ),
  updateTeamAction: effect(
    "teams.update",
    "teams",
    "Update ministry team",
    ["team", "after"],
    "single_update"
  ),
} as const satisfies Readonly<Record<string, TeamsActionContract>>;

/** The first-view seed is a durable write hidden behind an RSC render. */
export const TEAMS_RESPONSIBILITY_SEED_CONTRACT = effect(
  "teams.responsibilities.initialize",
  "responsibilities",
  "Initialize team responsibilities",
  ["team", "teamAfter", "responsibilities"],
  "compound_write"
);

export type TeamsActionExport = keyof typeof TEAMS_ACTION_CONTRACTS;
