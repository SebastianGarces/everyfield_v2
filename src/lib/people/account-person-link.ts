// ============================================================================
// MATCH-OR-CREATE: the person record an invited account gets (AS-013, #495).
//
// The directory owns "what a person row for an account looks like"
// (`accountPersonValues`, `./account-person.ts`) and "how a person is resolved
// to a login" (`./person-user.ts`). This file owns the third question, which
// AS-013 asks and neither of those answers: an invited seat holder may ALREADY
// BE in the plant's people list — invited at a vision meeting, added by the
// planter months ago — and their record must be linked rather than duplicated.
//
// ONE IMPLEMENTATION, and it lives here rather than in the register action for
// the same reason `churchCreationStatements` holds the church-gain tuple: the
// org-side seat invitation and the coach invitation are the next two callers,
// and a per-caller copy is how the second one silently stops matching.
//
// TWO STEPS, AND THE READ IS DELIBERATELY OUTSIDE THE BATCH.
// `findLinkablePersonId` decides WHICH row (if any) this account is, and
// `accountPersonLinkStatements` then produces exactly one statement for the
// caller's `db.batch` — an UPDATE that claims that row, or an INSERT that mints
// a new one. A conditional `INSERT … SELECT … WHERE NOT EXISTS` would fold the
// two into one statement and buy nothing: the race it would close needs two
// concurrent registrations of ONE address, which `users_email_unique` already
// makes impossible.
//
// BOTH STATEMENTS ARE GUARDED ANYWAY, because a guard that costs nothing is
// worth having:
//
//   * the UPDATE re-asserts `user_id IS NULL` and `deleted_at IS NULL`, so it
//     can never steal a row another account already claims;
//   * the INSERT carries `ON CONFLICT DO NOTHING` against
//     `persons_church_user_unique_idx`, so a retry racing its own predecessor
//     cannot dead-end on the index.
//
// *** REPEAT THE INDEX PREDICATE VERBATIM *** in the `ON CONFLICT` — the same
// discipline `churchCreationStatements` records, and for the same reason:
// Postgres proves the index covers the statement by reasoning about the two
// predicates, and a predicate that "should be equivalent" is a bet on the
// planner.
// ============================================================================

import { and, eq, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { db } from "@/db";
import { persons } from "@/db/schema";

import { accountPersonValues } from "./account-person";

/**
 * The person in this plant this address already belongs to, if any.
 *
 * Case-insensitively, because `users.email` is stored lowercased while
 * `persons.email` is typed by hand — the same comparison `personIsUserInChurch`
 * makes, for the same reason.
 *
 * Unlinked and not soft-deleted, both load-bearing: a row another account
 * already claims is not this person, and a deleted contact must not be revived
 * by somebody signing up.
 *
 * `ORDER BY created_at` so two contacts sharing an address resolve to the older
 * one — deterministic beats arbitrary, and the older row is the one with the
 * history on it.
 */
export async function findLinkablePersonId(
  churchId: string,
  email: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: persons.id })
    .from(persons)
    .where(
      and(
        eq(persons.churchId, churchId),
        isNull(persons.userId),
        isNull(persons.deletedAt),
        sql`lower(${persons.email}) = ${email.trim().toLowerCase()}`
      )
    )
    .orderBy(persons.createdAt)
    .limit(1);

  return row?.id ?? null;
}

/**
 * The statements that link this account to a person record — matched or minted
 * — for the caller's batch.
 *
 * Returned as an array so a caller spreads it, exactly as the church-creation
 * tuple is spread: this contract can grow a statement without an edit at either
 * call site.
 *
 * A MATCH ISSUES BOTH, AND THE PAIR IS WHAT MAKES AS-013 TOTAL (#495, review
 * round 1). The UPDATE is guarded on `user_id IS NULL`, so it matches nothing if
 * the row it chose was claimed between `findLinkablePersonId` and this batch —
 * and the batch would then commit an account with NO person record at all,
 * which is the one outcome AS-013 forbids. The competing writer is not a second
 * registration (`users_email_unique` serialises those); it is anything else
 * that links a person to a login (#378).
 *
 * The INSERT behind it converges either way, and costs nothing when it is not
 * needed: the two statements share one transaction, so the UPDATE is already
 * visible, and `persons_church_user_unique_idx` turns the INSERT into a no-op
 * exactly when the claim worked.
 */
export function accountPersonLinkStatements(account: {
  userId: string;
  churchId: string;
  name: string | null;
  email: string;
  /** From `findLinkablePersonId`. `null` mints a new record. */
  matchedPersonId: string | null;
}): BatchItem<"pg">[] {
  const duplicateMutationLock = db.execute(
    sql`select id from churches where id = ${account.churchId}::uuid for update`
  );
  const mint = db
    .insert(persons)
    .values(
      accountPersonValues({
        userId: account.userId,
        churchId: account.churchId,
        name: account.name,
        email: account.email,
      })
    )
    .onConflictDoNothing({
      target: [persons.churchId, persons.userId],
      where: sql`${persons.userId} is not null`,
    })
    .returning({ id: persons.id });

  if (!account.matchedPersonId) return [duplicateMutationLock, mint];

  return [
    duplicateMutationLock,
    db
      .update(persons)
      .set({ userId: account.userId, updatedAt: new Date() })
      .where(
        and(
          eq(persons.id, account.matchedPersonId),
          isNull(persons.userId),
          isNull(persons.deletedAt)
        )
      )
      .returning({ id: persons.id }),
    mint,
  ];
}
