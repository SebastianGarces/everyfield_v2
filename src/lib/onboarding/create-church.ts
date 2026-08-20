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
import { churches, churchPrivacySettings, persons, users } from "@/db/schema";
import { linkUserToChurchFilter } from "@/lib/churches/link-user";
import { accountPersonValues } from "@/lib/people/account-person";
import {
  parseChurchBasics,
  type ChurchBasicsFieldErrors,
  type ChurchBasicsInput,
} from "@/lib/validations/onboarding";
import { and, eq, isNotNull, notExists, sql, type SQL } from "drizzle-orm";

import { assertSeatFor } from "@/lib/auth/seat-rules";
import type { SeatFields } from "@/lib/auth/tenancy";

/**
 * The subset of the signed-in user this path needs. Minted from
 * `verifySession()` by the action; never accepted from a request
 * (`memory/invariants.md` → Authentication).
 */
export type OnboardingActor = { id: string } & SeatFields;

/**
 * The actor for the ONE path that creates a plant, which needs two fields more
 * than the rest of onboarding: this batch mints the planter's own `persons` row
 * (AS-013, #378), and that row's name and address come from the ACCOUNT, never
 * from the form — the same rule that keeps the actor itself out of the action's
 * arguments (`memory/invariants.md` → Authentication).
 *
 * A SEPARATE TYPE rather than two more fields on `OnboardingActor`, because
 * `runDeclareJourney` shares that type and has no person to write: widening it
 * would thread a value through a caller that never reads it.
 */
export type ChurchCreatorActor = OnboardingActor & {
  name: string | null;
  email: string;
};

/** Everything one church-creation batch writes, decided before it is sent. */
export type ChurchCreationWrite = ChurchBasicsInput & {
  churchId: string;
  plantedBy: string;
  /**
   * The planter's own name and address, for the `persons` row this batch mints
   * them (AS-013, #378). Required rather than optional: the row is part of the
   * church-creation contract now, and a caller that forgets it should be a
   * compile error rather than a plant whose Owner is missing from its people.
   */
  plantedByName: string | null;
  plantedByEmail: string;
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
  actor: ChurchCreatorActor,
  formData: FormData
): Promise<CreateChurchOutcome> {
  // THE ONE TABLE, not a predicate spelled here. `church.create` is
  // `OWNER_ONLY + "church-level"`, which is `isChurchLevelOwner` by
  // construction — the Owner seat with no tenancy yet, because this is the path
  // that CREATES the plant, and still refusing an oversight org's Owner, who
  // also holds `owner`.
  //
  // IT THROWS rather than returning the refusal it used to. The action above
  // calls `requireSeat("church.create")` on line one (#498), so by the time
  // this runs the answer is already yes — a `false` here means a caller reached
  // the service some other way, which is a defect to see and not an outcome to
  // render. `assertSeatFor` is the same decision either way.
  assertSeatFor(actor, "church.create");

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
      plantedByName: actor.name,
      plantedByEmail: actor.email,
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
 * The four writes, in the only order the FKs allow: the church exists before
 * anything points at it, the compare-and-set claims the planter, the privacy
 * row lands, and the planter's own `persons` row last. Returned as a tuple so
 * `db.batch` gets its non-empty-tuple type and the unit tests can read the SQL
 * without a database.
 *
 * WHY THE PERSON ROW IS HERE AND NOT IN A CALLER (AS-013, #378). This tuple is
 * the ONE spelling of "an account just gained a plant" — onboarding step 1
 * batches it and `createAccountEntities` spreads it whole for an invited
 * planter (ruling 408-4B) — so a row added here reaches both church-gain paths
 * with no edit at either. A per-caller insert would be two spellings of one
 * rule, and the invited path would be the one that silently lacked it.
 *
 * IT IS THE LAST STATEMENT because it is the only one that can be skipped
 * without leaving a half-built plant: the batch is all-or-nothing either way,
 * and ordering it after the link keeps the FK order obvious.
 *
 * `ON CONFLICT DO NOTHING` AGAINST `persons_church_user_unique_idx`, for the
 * same reason the privacy row carries one: a retry that races its own
 * predecessor must not dead-end on the index, and re-sending this tuple against
 * a plant that already has the row is a no-op rather than a second planter in
 * the people list.
 *
 * *** REPEAT THE INDEX PREDICATE VERBATIM. *** It renders as the ON CONFLICT
 * index_predicate, and Postgres has to satisfy itself that the index covers
 * every row this statement could conflict on — a job its inference does by
 * reasoning about the two predicates, not by comparing their text. Which cases
 * it can prove is not a contract worth learning, and a predicate that "should
 * be equivalent" is a bet on the planner. So the discipline is textual even
 * though the mechanism is not: copy `persons_church_user_unique_idx`'s
 * predicate, change the two together, and inference cannot fail.
 *
 * When it does fail there is no degraded mode — every church creation raises
 * "there is no unique or exclusion constraint matching the ON CONFLICT
 * specification", which is why `person-link-live.test.ts` exercises this
 * statement against a real index rather than trusting the rendered SQL.
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
    db
      .insert(persons)
      .values(
        accountPersonValues({
          userId: write.plantedBy,
          churchId: write.churchId,
          name: write.plantedByName,
          email: write.plantedByEmail,
        })
      )
      .onConflictDoNothing({
        target: [persons.churchId, persons.userId],
        where: sql`${persons.userId} is not null`,
      }),
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

/**
 * Dependents first, then the church — the FKs point that way.
 *
 * THE PERSON ROW IS A DEPENDENT AND HAS TO BE SWEPT TOO. It carries
 * `church_id`, so leaving it behind does not merely litter: the `churches`
 * delete below fails on the FK and the loser's church survives forever, which
 * is the exact orphan this sweep exists to prevent.
 *
 * *** IT DELETES THE MINTED ROW AND NOTHING ELSE. *** `user_id IS NOT NULL` is
 * not decoration beside `noUserLinkedTo`, it is a DIFFERENT rule and it is the
 * narrow one. `noUserLinkedTo` asks whether anybody holds this church; it says
 * nothing about WHICH of that church's people this statement may take, and
 * `church_id` alone names all of them. A church that has acquired a people list
 * is not a discardable shell whatever its links say, and a sweep that could
 * empty one — reached by a mis-call, a re-used id, or a future caller that
 * reads this signature and trusts it — would delete a plant's contacts with no
 * error and nothing to restore them from.
 *
 * So the scope here is exactly what `churchCreationStatements` wrote: the ONE
 * linked row, which by `persons_church_user_unique_idx` is at most one per
 * account per church. Any OTHER person on that church is left standing on
 * purpose, and the `churches` delete then fails on the FK — loudly, with a
 * constraint name, which is the correct outcome. A church with contacts in it
 * is not this function's to discard, and finding out by exception beats finding
 * out by absence.
 */
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
      .delete(persons)
      .where(
        bothOf(
          bothOf(eq(persons.churchId, churchId), isNotNull(persons.userId)),
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
