import { and, getTableColumns, isNull, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  churchPrivacySettings,
  organizationInvitations,
} from "@/db/schema";
import type { ChurchPrivacySettings } from "@/db/schema";

// ============================================================================
// CS-013 (#620) — the invite-origin sharing defaults.
//
// A plant that joins a sending church or network through an invitation starts
// out sharing everything; a self-started plant starts out sharing nothing; the
// DB column defaults stay FALSE either way (ruled 2026-08-15, §187). The
// rationale is #193 — the sending org pays per plant, and paying while seeing
// nothing is the failure mode.
//
// THE WHOLE RULE IS IN THIS FILE: which columns, what value, and under what
// predicate. `@/lib/invitations/core` imports one builder and knows nothing
// about `church_privacy_settings`, the same division `assignCoachOnAcceptStatement`
// keeps with `coach_assignments` — the other accept-time grant batched into an
// invitation claim.
// ============================================================================

/**
 * The names of the boolean toggle columns on `church_privacy_settings` — the
 * mapped type rejects `id`, `churchId`, `updatedAt` etc. at compile time, so a
 * mapped column is a boolean by construction and needs no runtime cast.
 */
export type PrivacyColumn = {
  [K in keyof ChurchPrivacySettings]: ChurchPrivacySettings[K] extends boolean
    ? K
    : never;
}[keyof ChurchPrivacySettings];

/**
 * EVERY SHARING TOGGLE THE SCHEMA HAS, READ OFF THE TABLE.
 *
 * The default writes all of them on, and "all of them" has to mean the column
 * list at BUILD time rather than a list somebody typed: #62's wiki toggle is one
 * column away from existing, and a hand-kept array would ship an invited plant
 * sharing six things out of seven with no screen able to say which. The mapped
 * type above already refuses a non-boolean key, and this is its runtime twin —
 * `getTableColumns` reads the same declaration `drizzle-kit` generates the
 * migration from, so the two cannot disagree and a new toggle joins the default
 * by being declared.
 *
 * `id`, `churchId`, `updatedAt` and `updatedBy` are not booleans and drop out on
 * their own. Nothing here denylists a column by name, which is what keeps the
 * rule true of columns nobody has written yet.
 */
export const SHARING_TOGGLE_COLUMNS: readonly PrivacyColumn[] = Object.entries(
  getTableColumns(churchPrivacySettings)
)
  .filter(([, column]) => column.dataType === "boolean")
  .map(([name]) => name as PrivacyColumn);

/**
 * `{ sharePeople: true, … }` over every toggle above — the value the acceptance
 * writes.
 *
 * Built fresh per call rather than frozen at module scope: it is spread into a
 * Drizzle `.set()` beside `updatedAt`, and a shared object handed to a query
 * builder is one careless mutation away from a partial default no test would
 * see.
 */
export function allSharingOn(): Record<PrivacyColumn, true> {
  return Object.fromEntries(
    SHARING_TOGGLE_COLUMNS.map((column) => [column, true])
  ) as Record<PrivacyColumn, true>;
}

/**
 * The statement that turns every toggle on, batched INSIDE the acceptance.
 *
 * THE WRITE IS THE ACCEPTANCE'S, AND THAT IS THE WHOLE DESIGN. Both acceptance
 * paths run through `acceptInvitationAs` — a planter answering on
 * `/settings/association`, and an INVITED planter registering, whose
 * registration hands off to `redeemRegistrationInvitation`
 * (`(auth)/register/actions.ts`) the moment their church exists. So one
 * statement in one batch serves both, and the toggles flip exactly when the
 * association commits: never before it, never without it.
 *
 * Writing it at REGISTRATION instead was considered and rejected (#620). That
 * redemption is best-effort by construction — it never throws, because an
 * invitation that cannot be redeemed must not cost somebody their account — so
 * a plant whose redemption failed would have been left sharing everything with
 * an org it had not joined, holding an invitation it could still DECLINE.
 * Consent stated on an acceptance screen has to be bought by the acceptance.
 *
 * *** IT IS TOTAL, NOT CONDITIONAL, AND THAT IS WHY IT NAMES NO TYPE. *** Only
 * two of the three invitation types have a plant to share: a sending church
 * joining a network has no `church_privacy_settings` row in the question at all.
 * Rather than branch — which would give `acceptInvitationAs` a second batch
 * shape, the thing the OV-008 audit rule spent a round removing — the JOIN does
 * it: `target_church_id` is NULL for `sending_church_to_network`, and a NULL
 * joins no row, so the SELECT is empty and the insert writes nothing. There is
 * no ternary for a later edit to make reachable.
 *
 * *** IT RE-ASSERTS THE CLAIM, for the reason every batched write here does. ***
 * `db.batch` is all-or-nothing on FAILURE only — a zero-row write is a success —
 * so a LOST claim rolls nothing back: the association matches nothing,
 * `acceptInvitationAs` throws, and the batch has already committed. Without
 * `status = 'accepted'` a planter whose accept was refused would be told so
 * while their plant quietly started sharing.
 *
 * *** AND IT ONLY FIRES FOR A PLANT THAT IS ACTUALLY STARTING OUT. *** Both
 * oversight FKs must be NULL, which is why this is batched BEFORE the
 * association write rather than after it — at that point the plant's own row
 * still says who it belonged to when the planter pressed Accept.
 *
 * The gate is not a nicety, it is the difference between a default and an
 * override. An accepted association does not block a later invitation
 * (`assertNoDuplicatePending` refuses only a second PENDING one) and
 * `unboundTargetSlot` deliberately lets an accept re-bind the org it already
 * holds. So without it: a plant joins sending church A, the planter turns
 * sharing off, A invites them again, they press Accept — and all seven toggles
 * come back on, silently reversing an explicit withdrawal. Before CS-013 that
 * press changed nothing.
 *
 * BOTH FKs, not the one this invitation names, because the toggles are ONE
 * per-plant setting and not a per-org one — `church_privacy_settings` has a
 * single row per church and governs every org that reaches it. A plant that
 * already has an overseer has already made this decision; a second org arriving
 * is not it starting out.
 *
 * `INSERT … SELECT … ON CONFLICT DO UPDATE`, the shape
 * `assignCoachOnAcceptStatement` uses, because the row is not guaranteed. It is
 * written at church creation, but a plant created before that was true — or by a
 * path that skipped it, as `scripts/seed-dev-db.ts` does — would match no rows
 * for a plain UPDATE, and the ruling would go silently unapplied. The same
 * reasoning made `ensureSharingRow` an upsert
 * (`@/lib/notifications/oversight-sharing`); `church_privacy_settings_church_id_unique`
 * is the arbiter and already exists, so no migration.
 *
 * NO `returning()`, deliberately. Zero rows is an EXPECTED outcome here — the
 * plant already had an overseer — so a rowcount carries no signal a caller could
 * act on, and a `returning` nobody reads reads as a check that exists.
 */
export function sharingDefaultsStatement(
  actorId: string,
  invitationId: string
) {
  const toggles = Object.fromEntries(
    SHARING_TOGGLE_COLUMNS.map((column) => [
      column,
      sql<boolean>`true`.as(churchPrivacySettings[column].name),
    ])
  );

  return db
    .insert(churchPrivacySettings)
    .select(
      db
        .select({
          id: sql<string>`gen_random_uuid()`.as("id"),
          // The plant is READ OUT OF the invitation row, never passed in, so
          // this cannot name a church the invitation did not target.
          churchId: churches.id,
          ...toggles,
          // `updated_at` BEFORE `updated_by`, because Drizzle requires an
          // insert-select's fields to mirror the table's own column order and
          // throws otherwise. That is a useful constraint rather than a
          // nuisance: the spread above is in `getTableColumns` order, which IS
          // the table's, so the whole selection stays keyed to the schema.
          updatedAt: sql<Date>`now()`.as("updated_at"),
          updatedBy: sql<string>`${actorId}::uuid`.as("updated_by"),
        })
        .from(organizationInvitations)
        // A NULL `target_church_id` joins nothing — this is the totality
        // mechanism, and the reason no arm of this builder names a type.
        .innerJoin(
          churches,
          eq(churches.id, organizationInvitations.targetChurchId)
        )
        .where(
          and(
            eq(organizationInvitations.id, invitationId),
            eq(organizationInvitations.status, "accepted"),
            isNull(churches.sendingChurchId),
            isNull(churches.sendingNetworkId)
          )
        )
    )
    .onConflictDoUpdate({
      target: churchPrivacySettings.churchId,
      set: {
        ...allSharingOn(),
        updatedBy: actorId,
        updatedAt: new Date(),
      },
    });
}
