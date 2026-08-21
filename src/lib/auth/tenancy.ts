// ============================================================================
// WHICH TENANCY AN ACCOUNT BELONGS TO — the one place the three FKs on a
// `users` row are turned into an answer, in an import-free leaf.
//
// THE SEAT DOES NOT ANSWER THIS AND CANNOT (#494, ruling 185 of 2026-08-20).
// `seat = 'owner'` says nothing about WHOSE owner: the same three words mean the
// same three things in a plant, a sending church and a sending network, and the
// tenancy FK is what names which one. Every reader that used to switch on
// `user.role` now reads the pair — the tenancy from here, the seat from the
// column — and the two halves are useless apart.
//
// WHY A LEAF AND NOT `./access.ts`. `access.ts` opens with `import { db } from
// "@/db"`, whose module scope calls `neon(process.env.DATABASE_URL!)`. So any
// module that only wants to know WHICH TENANCY a row names — the `/oversight`
// route guard (`@/lib/oversight/session`), a test with no database — paid a
// database connection for it, and the oversight domain's no-DATABASE_URL seam
// (`src/lib/oversight/read-imports.test.ts`) could not reach through
// `access.ts` at all. That is what produced a SECOND declaration of the
// oversight pair in `session.ts`, reconciled by a regex over this file's source
// text: a drift guard coupled to one literal declaration form.
//
// `import type` only — nothing here may gain a value import, or the seam that
// makes this file useful is gone (the same rule
// `src/lib/invitations/register-path.ts` lives by, and `tenancy.test.ts`
// enforces it).
// ============================================================================

import type { AssociationOrgType, User } from "@/db/schema";

/**
 * The three columns any tenancy question is answered from — and the only ones
 * this module reads.
 *
 * A `Pick` rather than `User` so a projection can be asked the same question as
 * a session row: the SQL audiences select three columns, not fourteen, and
 * widening the argument to `User` would have forced them to select the rest.
 */
export type TenancyFields = Pick<
  User,
  "churchId" | "sendingChurchId" | "sendingNetworkId"
>;

/**
 * The three kinds of tenancy a seat can be held in.
 *
 * DERIVED FROM `AssociationOrgType`, NOT RESTATED BESIDE IT. The two oversight
 * kinds are the same two words `associationEvents.org_type` and the
 * notification anchor already use, so writing them out again here would be a
 * second vocabulary that drifts the day a third org kind is added. Stating it
 * as "the association org types, plus the plant" makes `oversightOrgOf` below a
 * narrowing that holds by construction rather than by a cast.
 *
 * A bare union rather than the `as const` tuple this file's neighbours use,
 * because nothing needs the values at runtime: the exhaustiveness that matters
 * is carried by `satisfies Record<SeatTenancyType, …>` at each lookup table and
 * by the switch in `tenancyDisplayName`.
 */
export type SeatTenancyType = AssociationOrgType | "church";

/**
 * WHICH TENANCY A ROW NAMES — the kind and the id together, and the shape every
 * seat-scoped query, invitation and roster reads.
 *
 * ONE VALUE RATHER THAN THREE NULLABLE FKs THREADED SEPARATELY. `users` and
 * `user_invitations` both carry the same three columns under the same
 * exactly-one rule, so "which tenancy" is one question with one answer, and a
 * caller holding this pair cannot forget which column it came out of or write
 * to a second one. #500 is what made that load-bearing: the seat invitation
 * flow was written with `churchId: string` threaded through fifteen call sites,
 * and widening it to an org would otherwise have been fifteen nullable fields
 * and a switch at each.
 */
export type SeatTenancy = {
  readonly type: SeatTenancyType;
  readonly id: string;
};

/**
 * The oversight org an account administers — its KIND and its id together.
 *
 * Keyed on `AssociationOrgType`, the same two-valued union
 * `associationEvents.org_type` and the notification anchor already use, so the
 * kinds here and there are the same set by construction. `OversightOrgType`
 * (`@/lib/oversight/types`) is that union under another name; the two are
 * reconciled by `tenancy.test.ts` rather than by one importing the other,
 * because this file may not gain an import edge into the oversight domain.
 */
export type OversightOrg = {
  readonly type: AssociationOrgType;
  readonly id: string;
};

/**
 * How many of the three tenancy FKs this row names.
 *
 * EXACTLY ONE IS THE RULE (AS-001), so this is the number both predicates below
 * are written against. It is not always one: nothing in the schema holds it —
 * a CHECK would have refused the twelve rows migration 0050 §1 had to repair
 * before it could build an index — so a row naming two tenancies remains
 * REPRESENTABLE and both predicates have to decide what it is.
 */
function tenanciesNamed(user: TenancyFields): number {
  return [user.churchId, user.sendingChurchId, user.sendingNetworkId].filter(
    (fk) => fk !== null
  ).length;
}

/**
 * The oversight org this account's tenancy names, or null.
 *
 * NULL FOR THREE DIFFERENT ROWS, and that is deliberate: a seat in a plant, an
 * account with no tenancy at all, and a row naming MORE THAN ONE tenancy. The
 * last is the interesting one. Before this change `role` was the disambiguator
 * — a row carrying `church_id` and `sending_network_id` was a planter because
 * its role said so — and with the role gone there is nothing to break the tie
 * with. A precedence order would break it, and would break it wrongly: whichever
 * FK won, the other tenancy's reach would be handed to an account that has a
 * competing claim on it, which is the hierarchy walk `memory/invariants.md` →
 * Multi-Tenancy forbids.
 *
 * So a row naming two tenancies resolves to NO org and reaches nothing. It is a
 * data defect, and the notifications audience is built to SEE it rather than
 * swallow it: `oversightReachCondition` reaches such a row on the FK alone and
 * `classifyOversightCandidate` counts it as misprovisioned, so the defect is
 * logged instead of silently dropped inside a `WHERE`.
 */
export function oversightOrgOf(user: TenancyFields): OversightOrg | null {
  const tenancy = tenancyOf(user);
  if (!tenancy || tenancy.type === "church") return null;
  return { type: tenancy.type, id: tenancy.id };
}

/**
 * THE TENANCY THIS ROW NAMES, all three kinds — the one resolution
 * {@link oversightOrgOf} narrows and every seat-scoped writer reads.
 *
 * Same rule, stated once: EXACTLY ONE FK, or nothing. A row naming two
 * tenancies resolves to `null` here for the reason it resolves to no org above
 * — there is nothing left to break the tie with, and a precedence order would
 * hand one tenancy's reach to an account with a live claim on another.
 *
 * IT TAKES `TenancyFields`, SO IT ANSWERS FOR AN INVITATION ROW TOO.
 * `user_invitations` carries the same three columns under the same
 * exactly-one CHECK, so its projection is structurally this argument and
 * `describeUserInvitationForRegistration` resolves the invited tenancy with the
 * same function that resolves the caller's own.
 */
export function tenancyOf(user: TenancyFields): SeatTenancy | null {
  if (tenanciesNamed(user) !== 1) return null;
  if (user.sendingNetworkId)
    return { type: "network", id: user.sendingNetworkId };
  if (user.sendingChurchId)
    return { type: "sending_church", id: user.sendingChurchId };
  if (user.churchId) return { type: "church", id: user.churchId };
  return null;
}

/**
 * The three FK columns a tenancy sets — the inverse of {@link tenancyOf}, and
 * the ONE place a tenancy becomes columns again.
 *
 * Every writer that stores a tenancy (the seat-invitation insert, the users
 * insert at registration) spreads this rather than naming a column, so the
 * exactly-one CHECK is satisfied by construction and the other two are
 * explicitly NULL rather than merely omitted.
 */
export function tenancyColumns(tenancy: SeatTenancy): {
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
} {
  return {
    churchId: tenancy.type === "church" ? tenancy.id : null,
    sendingChurchId: tenancy.type === "sending_church" ? tenancy.id : null,
    sendingNetworkId: tenancy.type === "network" ? tenancy.id : null,
  };
}

/** Whether this account's tenancy is an oversight org. */
export function isOversightUser(user: TenancyFields): boolean {
  return oversightOrgOf(user) !== null;
}

/**
 * Whether this account operates at the church-plant level — a seat in a plant,
 * or no tenancy at all.
 *
 * NOT `!isOversightUser`, and the difference is the whole point. This is the
 * predicate the privacy toggles are read against (`canAccessFeatureData`
 * exempts church-level accounts) and the one the launch readiness ticks refuse
 * oversight with (`recordMilestone`), so a negation would exempt the
 * two-tenancy defect above from BOTH — it names no oversight org, so
 * `!isOversightUser` is true for it, and the toggles would stop applying to a
 * row that carries an oversight FK. Stated positively, the defect is neither
 * church-level nor oversight and fails closed on both sides.
 *
 * A coach with no tenancy IS church-level: their reach is their assignments,
 * gated by `coach_assignments` rather than by the toggles.
 */
export function isChurchLevelUser(user: TenancyFields): boolean {
  const named = tenanciesNamed(user);
  return named === 0 || (named === 1 && user.churchId !== null);
}

/** A tenancy row plus the seat held in it — the pair every authority rule reads. */
export type SeatFields = TenancyFields & Pick<User, "seat">;

/**
 * The Owner of a plant — the account the old model called `planter`.
 *
 * BOTH HALVES, ALWAYS. `seat === "owner"` alone admits the Owner of a sending
 * church, and `churchId !== null` alone admits every Member of the plant. This
 * is the predicate behind the Owner-only list (AS-003): sharing toggles,
 * association accept / leave / sever, launch scheduling. The seat-appointment
 * half of that list, and the `requireSeat` guard that will enforce all of it in
 * one place, are #495's — this function is the READERS' half, migrated here so
 * they stop spelling a role literal.
 *
 * The tenancy half goes through `isChurchLevelUser` rather than testing
 * `churchId` alone, so the two-tenancy defect is refused here for the same
 * reason it is refused there.
 */
export function isPlantOwner(user: SeatFields): boolean {
  return isChurchLevelOwner(user) && user.churchId !== null;
}

/**
 * The Owner of an oversight org — the account the old model called
 * `sending_church_admin` or `network_admin`.
 *
 * BOTH HALVES, AND THE SEAT HALF IS NOT NEW ENFORCEMENT. Those two role names
 * each meant "the Owner seat in this kind of org": no role mapped to a seatless
 * org row, or to an org Member, so the role allowlists this replaces already
 * refused them. Migrating the caller faithfully therefore means asking for the
 * seat as well as the tenancy — dropping it would WIDEN the four org-side
 * authority arms, which is the one thing a rename may not do.
 *
 * #498 gives an org real Admins and Members. The seat half is already here for
 * it: what that issue decides is whether `admin` joins `owner` in any given
 * arm, not whether the arms look at the seat at all.
 */
export function isOrgOwner(user: SeatFields): boolean {
  return user.seat === "owner" && isOversightUser(user);
}

/**
 * The Owner seat in a church-level tenancy — a plant Owner, INCLUDING one whose
 * plant does not exist yet.
 *
 * That last case is why this is separate from {@link isPlantOwner}. Registration
 * mints a plant Owner with `church_id` null and they create the plant from the
 * dashboard afterwards (`runCreateChurch`), so between those two moments the
 * account holds the Owner seat and names no tenancy. The church-level half is
 * still load-bearing there: an oversight org's Owner also holds `owner`, and
 * without it a sending church's Owner could create a plant and become a second
 * kind of thing.
 */
export function isChurchLevelOwner(user: SeatFields): boolean {
  return user.seat === "owner" && isChurchLevelUser(user);
}
