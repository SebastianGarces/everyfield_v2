import { eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

import { persons } from "@/db/schema/people";
import { users } from "@/db/schema/user";

// ============================================================================
// The person↔user bridge — "does this person hold a login in this plant?"
//
// A `person` is a CRM record and a `user` is an account, and F11 addresses
// accounts ("a `person` with no login is not a recipient" — `enqueue.ts`). Most
// people in a plant are neither and never will be: a vision-meeting invitee is a
// contact, not an account. So any audience read that starts from PEOPLE and has
// to end at RECIPIENTS crosses this bridge, and the only thing the two records
// share is the ADDRESS.
//
// ONE OWNER, because it is a TENANCY decision and not a formatting one. The join
// carries `users.church_id` explicitly; a copy that later forgets it mails one
// plant's meeting to another plant's planter, and tenant isolation here is
// application-layer with no RLS behind it (`memory/invariants.md` →
// Multi-Tenancy). It shipped as two verbatim copies — `guestListUserIdsQuery`
// and `coreGroupUserIdsQuery`, in one PR — each with a `.toSQL()` test that
// would still have passed on its own file while the other drifted. There is now
// exactly one spelling in `src/`, and `person-user.test.ts` fails if a second
// appears.
//
// It is a BRIDGE, NOT AN IDENTITY CLAIM. `enqueue` re-asks the question: gate 1
// of `recipientMayBeNotified` resolves the recipient's own access to the church
// and skips anyone who fails it. These helpers decide who to OFFER; they never
// decide who is allowed.
//
// Addresses are compared case-insensitively because `users.email` is stored
// lowercased (`src/lib/invitations/core.ts`) while `persons.email` is typed by
// hand and is not. A NULL person address matches nothing, which is the correct
// answer rather than an accident — and `personHoldsLoginFilter` says so out
// loud rather than leaving it to the comparison.
// ============================================================================

/**
 * The `INNER JOIN users ON …` condition that resolves a person to their login.
 *
 * Both halves are load-bearing: the church id is what keeps the address match
 * inside one tenant, and it is passed in rather than read off the person row so
 * the caller's own scope is what decides it.
 *
 * Composed as one `sql` fragment rather than through `and(...)` so the return
 * type is `SQL` and not `SQL | undefined` — drizzle DROPS an undefined
 * condition, and a dropped JOIN condition is a cross product of two tenants'
 * tables (`memory/invariants.md` → Multi-Tenancy, `oversightAudienceCondition`).
 */
export function personIsUserInChurch(churchId: string): SQL {
  return sql`${eq(users.churchId, churchId)} and lower(${users.email}) = lower(${persons.email})`;
}

/**
 * The `persons`-side guards every bridged read needs: the right church, not
 * soft-deleted, and holding an address to match on at all.
 *
 * Returned as one `SQL` for the same reason as above, and kept beside the join
 * because the two are one decision — a read that crosses the bridge without
 * these guards resolves deleted people and (through a NULL address) nobody at
 * all, which is a silent empty audience rather than an error.
 */
export function personHoldsLoginFilter(churchId: string): SQL {
  return sql`${eq(persons.churchId, churchId)} and ${isNull(persons.deletedAt)} and ${isNotNull(persons.email)}`;
}
