// ============================================================================
// THE TEAM'S CHECKLIST (MT-002b, #311 WS1).
//
// The responsibilities tab used to derive its list from `TEAM_TEMPLATES` on
// every render and label it "planned for a future release": nothing could be
// ticked, nothing could be added, and a custom team got a dead end that said
// so. These are rows now, and the tab is CRUD over them.
// ============================================================================

import { db } from "@/db";
import {
  ministryTeams,
  teamResponsibilities,
  type NewTeamResponsibility,
  type TeamResponsibility,
} from "@/db/schema";
import { and, asc, eq, isNull, isNotNull } from "drizzle-orm";

import { ExpectedError } from "./expected-error";
import { playbookResponsibilities } from "./role-templates";
import { verifyTeamOwnership } from "./shared";

/**
 * Offer a predefined team its Launch Playbook items, exactly once in its life.
 *
 * CLAIM FIRST, THEN THE WORK IT GATES (`memory/invariants.md` → Transactions).
 * The claim is the stamp on `ministry_teams.responsibilities_seeded_at` and it
 * is a same-row compare-and-set: `WHERE responsibilities_seeded_at IS NULL`,
 * re-evaluated by Postgres against the winner's committed row under the row
 * lock, so two concurrent first views of a team produce ONE set of rows and the
 * loser's `returning()` is empty. A reload is the same statement matching
 * nothing.
 *
 * IT RETURNS THE TEMPLATE KEY, so the claim and the question "seed from what?"
 * are one round trip rather than two. `template_key IS NOT NULL` is in the same
 * `WHERE`: a custom team is not a team with an empty playbook, it is a team the
 * playbook does not speak about, so it is never claimed and its stamp stays
 * NULL saying exactly that.
 *
 * WHY THE MARKER IS ON THE TEAM AND NOT A KEY ON THE ROWS. A unique key per
 * seeded item would make the INSERT redo-safe and close the window below — but
 * it only knows about rows that still exist, so the first item the planter
 * deletes comes back on the next page load. The rows are the planter's; the
 * offer is ours to make once.
 *
 * TWO WINDOWS THIS ACCEPTS, both of them named rather than guarded:
 *
 *   1. A crash between the claim and the insert leaves the team stamped with no
 *      rows, and the tab opens on its empty state with the Add form. That is
 *      the trade the claim-first shape names, and the same posture
 *      `leadership-fill.ts` takes — the surface still works and the planter can
 *      type the items in. The alternative loses a deletion, which is worse.
 *   2. The LOSER of a concurrent first view returns from here immediately and
 *      then reads, so it can select before the winner's INSERT commits and
 *      render an empty list for a team that is being seeded. It is one paint in
 *      the losing tab of a double-open, and the next load has the rows.
 */
async function seedPlaybookResponsibilities(
  churchId: string,
  teamId: string,
  userId: string
): Promise<void> {
  const [claimed] = await db
    .update(ministryTeams)
    .set({ responsibilitiesSeededAt: new Date() })
    .where(
      and(
        eq(ministryTeams.churchId, churchId),
        eq(ministryTeams.id, teamId),
        isNull(ministryTeams.responsibilitiesSeededAt),
        isNotNull(ministryTeams.templateKey)
      )
    )
    .returning({ templateKey: ministryTeams.templateKey });

  if (!claimed?.templateKey) return;

  const titles = playbookResponsibilities(claimed.templateKey);
  // An INSERT with no rows is a runtime error rather than a no-op, and a
  // template with an empty description is a legitimate answer.
  if (titles.length === 0) return;

  await db.insert(teamResponsibilities).values(
    titles.map(
      (title, position) =>
        ({
          churchId,
          teamId,
          title,
          sortOrder: position,
          createdBy: userId,
        }) satisfies NewTeamResponsibility
    )
  );
}

/**
 * The team's responsibilities, seeding the playbook items on the first read.
 *
 * SEEDING ON READ IS WHY EVERY PLANT HAS THEM. Teams already existed when this
 * table did not, and they are created by two paths besides; hanging the seed
 * off the read reaches all of them and needs no backfill. The write is safe to
 * run from a Server Component's render because that render is never cached
 * (`export const dynamic = "force-dynamic"` on the page) and nothing here
 * revalidates.
 */
export async function listResponsibilities(
  churchId: string,
  teamId: string,
  userId: string
): Promise<TeamResponsibility[]> {
  await seedPlaybookResponsibilities(churchId, teamId, userId);

  return listStoredResponsibilities(churchId, teamId);
}

/**
 * Read only the rows a team currently owns. Evry uses this after treating the
 * first-view playbook seed as its own confirmed effect; it must never smuggle
 * that durable initialization through an immediate read.
 */
export async function listStoredResponsibilities(
  churchId: string,
  teamId: string
): Promise<TeamResponsibility[]> {
  return db
    .select()
    .from(teamResponsibilities)
    .where(
      and(
        eq(teamResponsibilities.churchId, churchId),
        eq(teamResponsibilities.teamId, teamId)
      )
    )
    .orderBy(
      asc(teamResponsibilities.sortOrder),
      asc(teamResponsibilities.createdAt)
    );
}

/**
 * Add a responsibility to a team.
 *
 * It sorts LAST, and `sort_order` is where it says so — one more than the
 * team's current maximum would need a read, so a new item takes a value no
 * seeded row can reach and the `created_at` tie-break in `listResponsibilities`
 * orders the additions among themselves. Manual reordering ships later (#311
 * out of scope) and is what would make this column earn a read.
 */
const ADDED_RESPONSIBILITY_SORT_ORDER = 1000;

export async function createResponsibility(
  churchId: string,
  teamId: string,
  userId: string,
  data: { title: string }
): Promise<TeamResponsibility> {
  // The teamId arrives from the client, so prove it belongs to the caller's
  // church before writing a row that points at it — same rule as `createRole`.
  await verifyTeamOwnership(churchId, teamId);

  const [responsibility] = await db
    .insert(teamResponsibilities)
    .values({
      churchId,
      teamId,
      title: data.title,
      sortOrder: ADDED_RESPONSIBILITY_SORT_ORDER,
      createdBy: userId,
    } satisfies NewTeamResponsibility)
    .returning();

  return responsibility;
}

/**
 * Edit a responsibility, or tick it off — ONE writer, because `completed` is a
 * field of the same row and deriving `completed_at` from it is a decision that
 * belongs in one place.
 *
 * CHURCH-SCOPED IN THE `WHERE`, not by a read above it: an id belonging to
 * another church matches nothing, so the refusal and the tenancy check are the
 * same statement.
 */
export async function updateResponsibility(
  churchId: string,
  responsibilityId: string,
  data: { title?: string; completed?: boolean }
): Promise<TeamResponsibility> {
  const updateData: Partial<NewTeamResponsibility> = { updatedAt: new Date() };

  if (data.title !== undefined) updateData.title = data.title;
  if (data.completed !== undefined) {
    updateData.completedAt = data.completed ? new Date() : null;
  }

  const [updated] = await db
    .update(teamResponsibilities)
    .set(updateData)
    .where(
      and(
        eq(teamResponsibilities.churchId, churchId),
        eq(teamResponsibilities.id, responsibilityId)
      )
    )
    .returning();

  // ExpectedError: user copy — surfaced to the planter verbatim (409-6C).
  if (!updated) throw new ExpectedError("Responsibility not found");
  return updated;
}

export async function deleteResponsibility(
  churchId: string,
  responsibilityId: string
): Promise<void> {
  const deleted = await db
    .delete(teamResponsibilities)
    .where(
      and(
        eq(teamResponsibilities.churchId, churchId),
        eq(teamResponsibilities.id, responsibilityId)
      )
    )
    .returning({ id: teamResponsibilities.id });

  if (deleted.length === 0) {
    throw new ExpectedError("Responsibility not found");
  }
}
