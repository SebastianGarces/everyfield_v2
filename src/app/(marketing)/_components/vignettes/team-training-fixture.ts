// ============================================================================
// TEAM TRAINING FIXTURE — one real ministry team's training grid, frozen so the
// landing page can render the app's real TrainingMatrix and TeamCardView.
//
// Source: Redemption Hill Church's Children's Ministry team, read 2026-08-05
// through the app's own read layer — `getTrainingMatrix(churchId, teamId)`
// (src/lib/ministry-teams/service.ts:1064) for the programs and the rows, and
// `listTeams(churchId)` (:120) for the team tile. Those are the same calls the
// /teams/<id> Training tab and the /teams board make, so these values are
// shaped exactly as the app's own components receive them. To regenerate,
// re-run both calls for that church and paste the results back over the
// constants below.
//
// Every rendered string is verbatim: program names, the required flag, member
// names, every completion, the team's name, leader and role counts. Only the
// identifiers were scrubbed — none of them reach the DOM here (the matrix uses
// them as React keys, and the team tile's id only feeds an href this page
// overrides), they exist to satisfy the types.
//
// WHY THIS TEAM. Children's Ministry is the team the retired
// r6-team-training.webp capture screenshotted: six members against "Kids
// ministry & safety training" and the church-wide "Launch Team Orientation",
// with completions genuinely split both ways. It is the only Redemption Hill
// team whose grid is both full enough to read as a matrix and honest about
// what is unfinished.
// ============================================================================

import type {
  TrainingMatrixPerson,
  TrainingMatrixProgram,
} from "@/components/ministry-teams/training-matrix";
import type { TeamCardViewTeam } from "@/components/ministry-teams/team-card-view";

const KIDS_SAFETY = "fixture-program-kids-safety";
const LAUNCH_ORIENTATION = "fixture-program-launch-orientation";

/** In the order `getTrainingMatrix` returns them: ascending by name. The
 *  church-wide program (no team) is the required one. */
export const TRAINING_PROGRAMS = [
  {
    id: KIDS_SAFETY,
    name: "Kids ministry & safety training",
    isRequired: false,
  },
  {
    id: LAUNCH_ORIENTATION,
    name: "Launch Team Orientation",
    isRequired: true,
  },
] satisfies TrainingMatrixProgram[];

export const TRAINING_MATRIX = [
  {
    personId: "fixture-person-aisha-carter",
    personName: "Aisha Carter",
    completions: { [KIDS_SAFETY]: true, [LAUNCH_ORIENTATION]: false },
  },
  {
    personId: "fixture-person-ben-camacho",
    personName: "Ben Camacho",
    completions: { [KIDS_SAFETY]: true, [LAUNCH_ORIENTATION]: false },
  },
  {
    personId: "fixture-person-bianca-cortez",
    personName: "Bianca Cortez",
    completions: { [KIDS_SAFETY]: true, [LAUNCH_ORIENTATION]: true },
  },
  {
    personId: "fixture-person-brandon-ellis",
    personName: "Brandon Ellis",
    completions: { [KIDS_SAFETY]: false, [LAUNCH_ORIENTATION]: true },
  },
  {
    personId: "fixture-person-briana-fuentes",
    personName: "Briana Fuentes",
    completions: { [KIDS_SAFETY]: false, [LAUNCH_ORIENTATION]: true },
  },
  {
    personId: "fixture-person-caleb-guzman",
    personName: "Caleb Guzman",
    completions: { [KIDS_SAFETY]: false, [LAUNCH_ORIENTATION]: true },
  },
] satisfies TrainingMatrixPerson[];

/** Below 900px a three-column grid is unreadable, so the compact composition
 *  keeps ONE program — the team's own, which is the column the retired capture
 *  led with — and the four members whose rows show both answers. Same
 *  component, same rows, fewer of them. */
export const TRAINING_PROGRAMS_COMPACT = [
  TRAINING_PROGRAMS[0],
] satisfies TrainingMatrixProgram[];

export const TRAINING_MATRIX_COMPACT = TRAINING_MATRIX.slice(
  0,
  4
) satisfies TrainingMatrixPerson[];

/** The tile the /teams board draws for the same team the matrix belongs to —
 *  the card and the grid are one story, not two. `filledRoles`/`totalRoles`
 *  are what drive the staffing bar and the health dot, so they are the fields
 *  that must stay honest: 2 of 7 is a red dot and five open roles. */
export const CHILDRENS_MINISTRY_TEAM = {
  id: "fixture-team-childrens-ministry",
  name: "Children's Ministry",
  type: "predefined",
  status: "active",
  icon: "baby",
  leaderName: "Aisha Carter",
  filledRoles: 2,
  totalRoles: 7,
} satisfies TeamCardViewTeam;
