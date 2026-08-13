// ============================================================================
// Ministry-teams service — the façade.
//
// The implementation lives in five domain modules, split by concern so that
// parallel work (roles, memberships, training, health) does not collide in one
// 1400-line file:
//
//   teams.ts        team CRUD + predefined-team initialization (the #306 guard)
//   roles.ts        role CRUD + role-template import
//   memberships.ts  assignments, removals, per-person views
//   training.ts     programs, completions, matrices
//   health.ts       the read-model: health metrics + staffing summary
//   shared.ts       private helpers the modules share (ownership check,
//                   staffing counts) — deliberately NOT re-exported here
//   expected-error.ts  ExpectedError — a thrown message that IS user copy
//                   (ruling 409-6C); the action shell surfaces it verbatim
//   membership-copy.ts the two seat refusals (#409 D1). An IMPORT-FREE leaf,
//                   deliberately NOT re-exported here: the assign dialog is a
//                   client component and this barrel opens with `@/db`, so a
//                   pass-through would put the database client one import away
//                   from a browser chunk (same rule as
//                   `src/lib/invitations/register-path.ts`).
//   membership-conflict.ts which of those two sentences a driver
//                   unique-violation means, decided by `isUniqueViolation`
//                   (`@/db/errors`). Server-only, so it is a sibling of the
//                   leaf rather than part of it — and also not re-exported.
//
// This barrel preserves the import path every caller already uses
// (`@/lib/ministry-teams/service`) and its exact export surface. New callers
// may import from the domain modules directly; existing ones need not move.
// ============================================================================

export {
  listTeams,
  getTeam,
  createTeam,
  updateTeam,
  assignTeamLeader,
  initializePredefinedTeams,
} from "./teams";
export type { TeamWithStats, TeamDetail } from "./teams";

export {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  importRoleTemplates,
} from "./roles";

export {
  assignMember,
  removeMember,
  getPersonTeams,
  getTeamCountsForPeople,
} from "./memberships";
export type { PersonTeamAssignment } from "./memberships";

export {
  listTrainingPrograms,
  createTrainingProgram,
  markTrainingComplete,
  getPersonTraining,
  getTrainingMatrix,
} from "./training";
export type { TrainingMatrixRow, PersonTrainingItem } from "./training";

export { getTeamHealth, getAllTeamsHealth, getStaffingSummary } from "./health";
export type { StaffingSummary, TeamHealthMetrics } from "./health";
