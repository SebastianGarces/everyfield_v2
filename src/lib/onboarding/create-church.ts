/**
 * F12 / OB-001 + OB-002 + #198 — step 1's write path: create the church, link
 * the planter to it, and give it a privacy-settings row.
 *
 * WHY THIS IS NOT IN THE ACTION. `"use server"` modules are an auth surface —
 * every export is a POSTable endpoint (`memory/invariants.md` →
 * Authentication) — so the action next to the page keeps exactly one job: mint
 * the actor from `verifySession()` and hand it here. Everything below is
 * ordinary server code, and `runCreateChurch` is unit testable through
 * `CreateChurchDeps` without a request, a session or a database.
 *
 * WHY IT IS ONE BATCH (#198). The three writes used to be three awaited
 * statements, so a failure at the privacy-settings insert — the last one — left
 * a church row LINKED to the planter with no privacy settings behind it.
 * Nothing in the product could then create that row: `createChurchBasics`
 * refuses a planter who already has a church, so the retry that would fix it is
 * the one path the guard rejects, and every `canAccessFeatureData` read for
 * that plant answered from a row that did not exist.
 *
 * `db.transaction()` throws on neon-http, and all three writes are known up
 * front, so the sanctioned shape is one `db.batch([...])` — a Neon batched
 * transaction, all-or-nothing (`src/db/index.ts`). A failure anywhere in it now
 * rolls back the church too, which is the state a retry can actually recover
 * from: no church, no link, nothing half-applied, and the planter simply
 * submits again. The privacy insert is additionally `ON CONFLICT DO NOTHING`,
 * so a retry that races its own predecessor cannot dead-end on the
 * `church_privacy_settings_church_id_unique` index.
 *
 * WHAT THE BATCH IS *NOT*. `db.batch` is not a concurrency guard: an empty
 * `returning()` is not an error and rolls nothing back. The guard against a
 * double submit is still #183's compare-and-set — `linkUserToChurchFilter`,
 * `id = ? AND church_id IS NULL` — and it is a real guard here because both
 * requests update the SAME users row, so the second waits on the first's row
 * lock and then re-evaluates `church_id IS NULL` against what the winner
 * committed (`memory/invariants.md` → Atomicity: a compare-and-set serialises
 * requests that write the same row, which is exactly this case, so no separate
 * `FOR UPDATE` is needed). What the batch cannot undo is the LOSER's own church
 * insert, which commits alongside its no-op update; `discardChurchStatements`
 * sweeps that row up afterwards, guarded so it can only ever delete a church
 * nobody is linked to.
 */

import { db } from "@/db";
import { churches, churchPrivacySettings, users } from "@/db/schema";
import { linkUserToChurchFilter } from "@/lib/churches/link-user";
import {
  parseChurchBasics,
  type ChurchBasicsFieldErrors,
  type ChurchBasicsInput,
} from "@/lib/validations/onboarding";
import { and, eq, notExists, type SQL } from "drizzle-orm";

import { isChurchLevelOwner, type SeatFields } from "@/lib/auth/tenancy";

/**
 * The subset of the signed-in user this path needs. Minted from
 * `verifySession()` by the action; never accepted from a request
 * (`memory/invariants.md` → Authentication).
 */
export type OnboardingActor = { id: string } & SeatFields;

/** Everything one church-creation batch writes, decided before it is sent. */
export type ChurchCreationWrite = ChurchBasicsInput & {
  churchId: string;
  plantedBy: string;
};

export type CreateChurchOutcome =
  | { status: "created" }
  | { status: "error"; error?: string; fieldErrors?: ChurchBasicsFieldErrors };

export type CreateChurchDeps = {
  /** The church's id, decided up front so every statement can name it. */
  newChurchId: () => string;
  /**
   * The one all-or-nothing batch. Resolves `true` when this request won the
   * link, `false` when a concurrent one had already taken it. Rejects only when
   * the batch itself failed — in which case NOTHING was written.
   */
  commitChurch: (write: ChurchCreationWrite) => Promise<boolean>;
  /** Remove the church a lost link left behind. Best effort by construction. */
  discardChurch: (churchId: string) => Promise<void>;
  /** `revalidatePath` — injected so `next/cache` stays in the action. */
  revalidate: () => void;
};

export const NOT_A_PLANTER_MESSAGE = "Only church planters can create a church";

export const CHURCH_SAVE_FAILED_MESSAGE =
  "We could not save your church plant. Please try again.";

/**
 * Step 1, end to end.
 *
 * Two branches deliberately report `created` without creating anything: a
 * planter who already has a church, and one whose link lost a race. In both,
 * the fact the planter cares about is true — their church exists — so the flow
 * must move them ON to step 2 rather than sit on step 1 showing an error about
 * a church they own. Both revalidate first, which is what gives the LOSING TAB
 * of a double submit a fresh render instead of the copy it painted before the
 * other tab won (#243).
 */
export async function runCreateChurch(
  deps: CreateChurchDeps,
  actor: OnboardingActor,
  formData: FormData
): Promise<CreateChurchOutcome> {
  // `isChurchLevelOwner`, not `isPlantOwner`: this is the path that CREATES the
  // plant, so the actor holds the Owner seat and no tenancy yet. The
  // church-level half still refuses an oversight org's Owner, who also holds
  // `owner`.
  if (!isChurchLevelOwner(actor)) {
    return { status: "error", error: NOT_A_PLANTER_MESSAGE };
  }

  if (actor.churchId) {
    deps.revalidate();
    return { status: "created" };
  }

  const parsed = parseChurchBasics(formData);

  if (!parsed.ok) {
    return { status: "error", fieldErrors: parsed.fieldErrors };
  }

  const churchId = deps.newChurchId();

  let linked: boolean;
  try {
    linked = await deps.commitChurch({
      churchId,
      plantedBy: actor.id,
      ...parsed.values,
    });
  } catch (error) {
    // The batch rolled back, so there is no church, no link and no privacy row
    // to clean up — the planter's next submit starts from exactly where this
    // one did. Reported rather than thrown so the step renders the failure and
    // keeps what they typed (FRD NFR: a failure on one step loses no other).
    console.error("church creation batch failed", error);
    return { status: "error", error: CHURCH_SAVE_FAILED_MESSAGE };
  }

  if (!linked) {
    // Best effort, and swallowed on purpose: this planter's church exists and
    // is linked — by the request that won — so a failed sweep costs a stray row
    // nobody can reach, not the planter's step. Loud, because a stray row is
    // still a thing somebody should see.
    try {
      await deps.discardChurch(churchId);
    } catch (error) {
      console.error("could not discard the church a lost link left behind", {
        churchId,
        error,
      });
    }
  }

  deps.revalidate();
  return { status: "created" };
}

// ============================================================================
// The statements
// ============================================================================

/**
 * The three writes, in the only order the FK allows: the church exists before
 * anything points at it, the compare-and-set claims the planter, and the
 * privacy row lands last. Returned as a tuple so `db.batch` gets its
 * non-empty-tuple type and the unit tests can read the SQL without a database.
 */
export function churchCreationStatements(write: ChurchCreationWrite) {
  return [
    db.insert(churches).values({
      id: write.churchId,
      name: write.name,
      city: write.city,
      stateRegion: write.stateRegion,
      country: write.country,
    }),
    db
      .update(users)
      .set({ churchId: write.churchId, updatedAt: new Date() })
      .where(linkUserToChurchFilter(write.plantedBy))
      .returning({ id: users.id }),
    db
      .insert(churchPrivacySettings)
      .values({ churchId: write.churchId, updatedBy: write.plantedBy })
      .onConflictDoNothing(),
  ] as const;
}

/**
 * `NOT EXISTS (SELECT … FROM users WHERE church_id = ?)` — the predicate that
 * makes the loser's cleanup unable to delete a real plant.
 *
 * The id being swept up was minted by this request and lost its link, so in
 * practice nobody can be pointing at it. The guard is here because the cost of
 * being wrong is somebody else's church, and BOTH cleanup statements carry it:
 * deleting the privacy row while leaving the church would recreate the very
 * defect #198 is about.
 */
export function noUserLinkedTo(churchId: string): SQL {
  return notExists(
    db.select({ id: users.id }).from(users).where(eq(users.churchId, churchId))
  );
}

function bothOf(left: SQL, right: SQL): SQL {
  const filter = and(left, right);
  if (!filter) throw new Error("unreachable: both conditions are defined");
  return filter;
}

/** Privacy row first, then the church — the FK points that way. */
export function discardChurchStatements(churchId: string) {
  return [
    db
      .delete(churchPrivacySettings)
      .where(
        bothOf(
          eq(churchPrivacySettings.churchId, churchId),
          noUserLinkedTo(churchId)
        )
      ),
    db
      .delete(churches)
      .where(bothOf(eq(churches.id, churchId), noUserLinkedTo(churchId))),
  ] as const;
}

/**
 * The real deps: one batch to write, one batch to sweep up.
 *
 * `revalidate` is a parameter rather than an import because `next/cache`
 * belongs to the action layer — keeping it out of here is what lets the
 * orchestration above be driven by a test.
 */
export function createChurchDeps(revalidate: () => void): CreateChurchDeps {
  return {
    newChurchId: () => crypto.randomUUID(),
    revalidate,

    async commitChurch(write) {
      const [, linked] = await db.batch(churchCreationStatements(write));
      return linked.length > 0;
    },

    async discardChurch(churchId) {
      await db.batch(discardChurchStatements(churchId));
    },
  };
}
