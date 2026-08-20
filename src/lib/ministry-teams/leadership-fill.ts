// ============================================================================
// THE PLANTER LANDS IN THE SENIOR PASTOR ROLE THEY ALREADY ANSWERED FOR
// (#378 WS2, ruled 2026-08-09).
//
// Onboarding asks "will you be the lead pastor?" and stores the answer on
// `churches.leadership_status`. Nothing read it afterwards, so a planter who
// said yes then had to open /teams and assign themselves to a role they had
// already claimed — a second answer to the same question, and the FIRST thing
// they see on a freshly initialized Leadership team is an empty seat with their
// own name missing from it.
//
// WHERE IT HOOKS, AND WHY THERE. `importRoleTemplates` is where the Senior
// Pastor ROLE comes into existence, and it is the only place it does: teams and
// their roles are created by two different statements, and the /teams button,
// the role-import dialog and the onboarding finish-screen offer all reach the
// role half through this one function. Hooking the TEAM insert instead would
// fire before the role exists.
//
// IT NEVER RAISES. Every refusal here — no answer, no linked person, no role,
// somebody already in the seat — is an ordinary outcome, and the templates the
// caller just imported are real and useful whichever way it goes. A planter
// whose auto-fill did not land assigns themselves the ordinary way, which is
// the state the product was in before this file existed.
// ============================================================================

import { db } from "@/db";
import {
  churches,
  persons,
  teamMemberships,
  users,
  type TeamRole,
} from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import { assignMember } from "./memberships";
import {
  getRoleTemplates,
  LEADERSHIP_TEAM_KEY,
  type PredefinedTeamKey,
} from "./role-templates";

/**
 * The ROLE inside the Leadership team this rule fills. The TEAM's key is
 * `LEADERSHIP_TEAM_KEY`, declared once in `role-templates.ts` beside the
 * templates it indexes; the two happen to spell the same word and are not the
 * same thing.
 */
const SENIOR_PASTOR_ROLE_KEY = "senior_pastor";

/**
 * The plant's Owner as a PERSON, but only if they answered "I'm the lead
 * pastor".
 *
 * ONE READ, BOTH HALVES, and the join is what keeps them together: the seat
 * (`users.seat = 'owner'` in THIS church — neither half answers alone,
 * `memory/invariants/seats-and-tenancy.md`), the person row linked to that
 * account, and the church's own recorded answer. `no_planter` and an
 * unanswered `NULL` both fail the `WHERE` and get no row, which is the ruling:
 * the role stays open and somebody fills it by hand.
 *
 * Soft-deleted people are excluded. A planter who deleted their own person
 * record has said something about it, and re-seating them from a migration or
 * a template import would be undoing that quietly.
 */
async function confirmedPlanterPerson(
  churchId: string
): Promise<string | null> {
  const [row] = await db
    .select({ personId: persons.id })
    .from(persons)
    .innerJoin(users, eq(users.id, persons.userId))
    .innerJoin(churches, eq(churches.id, persons.churchId))
    .where(
      and(
        eq(persons.churchId, churchId),
        isNull(persons.deletedAt),
        eq(users.churchId, churchId),
        eq(users.seat, "owner"),
        eq(churches.leadershipStatus, "planter_confirmed")
      )
    )
    .limit(1);

  return row?.personId ?? null;
}

/**
 * Fill the Senior Pastor role on a just-imported Leadership team, when the
 * plant's own answer says who belongs in it.
 *
 * THROUGH `assignMember`, NEVER A RAW INSERT. That function owns the seat index
 * and both of its refusal shapes, flips the role to `filled` in the same batch,
 * and emits `team.member.assigned` / `team.leader.assigned` so the people
 * pipeline sees this assignment exactly as it sees a hand-made one. An INSERT
 * here would be a second assignment path that skips all of it.
 *
 * A FILLED ROLE IS NEVER OVERWRITTEN, and no check here is the reason why —
 * `team_memberships_role_active_unique_idx` is. A seat taken between this
 * function's reads and its write makes `assignMember` throw its already-filled
 * refusal, and it is swallowed below.
 *
 * @param created the rows THIS import just inserted. The role is picked out of
 *   them rather than looked up by name, so a partial import (`roleKeys` naming
 *   other roles) fills nothing and no name is ever matched against a row the
 *   planter may have renamed.
 */
export async function fillLeadershipRole(
  churchId: string,
  teamId: string,
  userId: string,
  teamKey: PredefinedTeamKey,
  created: TeamRole[]
): Promise<void> {
  if (teamKey !== LEADERSHIP_TEAM_KEY) return;

  const roleName = getRoleTemplates(teamKey).find(
    (template) => template.key === SENIOR_PASTOR_ROLE_KEY
  )?.roleName;
  const role = created.find((row) => row.name === roleName);
  if (!role) return;

  const personId = await confirmedPlanterPerson(churchId);
  if (!personId) return;

  // ALREADY ON THIS TEAM IS ALREADY ANSWERED. `importRoleTemplates` carries no
  // ON CONFLICT, so importing a team's templates twice mints a SECOND set of
  // role rows — and without this the planter would be seated on both, reading
  // as two Senior Pastors on one team. A convenience and not a concurrency
  // guard (`memory/invariants.md` → Transactions): two simultaneous imports
  // create two roles and contend on nothing, which is the duplicate-role
  // problem this does not pretend to solve.
  const [seated] = await db
    .select({ id: teamMemberships.id })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.teamId, teamId),
        eq(teamMemberships.personId, personId),
        eq(teamMemberships.status, "active")
      )
    )
    .limit(1);

  if (seated) return;

  try {
    await assignMember(churchId, teamId, role.id, personId, userId);
  } catch (error) {
    // See the module header: the import succeeded and the planter can still
    // assign themselves. Logged rather than swallowed silently, because a
    // failure here is a thing somebody should be able to find.
    console.error("could not auto-fill the Senior Pastor role", {
      churchId,
      teamId,
      error,
    });
  }
}
