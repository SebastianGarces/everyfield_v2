// ============================================================================
// FS_TEAMS_FIXTURE — two real ministry teams, frozen so the landing page can
// render the real team tile.
//
// Source: Redemption Hill Church's ministry teams as of 2026-08-04, read
// read-only from the dev database with `listTeams(churchId)`
// (src/lib/ministry-teams/service.ts) and projected onto the eight fields the
// tile actually reads. To regenerate, re-run `listTeams` for that church and
// paste the two rows back over the constants below.
//
// Every rendered string is verbatim — team name, leader name, status, icon key
// — and both staffing ratios are the church's real ones. Only the team ids
// were scrubbed: they are inert here (the marketing embed passes its own
// `href`, so the id never reaches the DOM) and exist to satisfy the type.
//
// WHY THESE TWO. The panel's primary visual is the Team Health Dashboard
// capture, whose "All Teams" list shows Children's Ministry with a red dot
// (staffing 29%) and Prayer with a green one (staffing 67%). The tile derives
// its own dot from the same ratio, so these two are the pair that cannot
// disagree with the screen behind them: one team the dashboard is flagging,
// one it is not.
//
// `TeamCardViewTeam` rather than `TeamWithStats` on purpose: the tile's own
// prop type is the narrower one (`TeamWithStats` satisfies it structurally),
// so this fixture does not have to invent a churchId or audit timestamps that
// nothing renders. Type-only import — `team-card-view.tsx` reaches
// `@/db/schema` for its status/type unions, and a value import of that module
// would pull Drizzle into the marketing bundle.
// ============================================================================

import type { TeamCardViewTeam } from "@/components/ministry-teams/team-card-view";

const CHILDRENS_TEAM_ID = "fixture-team-childrens";
const PRAYER_TEAM_ID = "fixture-team-prayer";

export const FS_TEAMS_FIXTURE = [
  {
    id: CHILDRENS_TEAM_ID,
    name: "Children's Ministry",
    type: "predefined",
    status: "active",
    icon: "baby",
    leaderName: "Aisha Carter",
    filledRoles: 2,
    totalRoles: 7,
  },
  {
    id: PRAYER_TEAM_ID,
    name: "Prayer",
    type: "predefined",
    status: "active",
    icon: "heart",
    leaderName: "Alicia Garza",
    filledRoles: 2,
    totalRoles: 3,
  },
] satisfies TeamCardViewTeam[];

/** Redemption Hill runs eleven ministry teams; the embed shows two of them, and
 *  the mobile composition's footnote has to name the number it leaves out. */
export const FS_TEAMS_TOTAL = 11;
