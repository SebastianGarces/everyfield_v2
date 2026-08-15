import { and, eq, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { churches, users, type UserRole } from "@/db/schema";

import {
  namesAnOversightOrg,
  OVERSIGHT_ADMIN_ROWS,
  type OversightAdminPairing,
  type OversightOrgIds,
} from "./oversight-admin";
import {
  recipientOrgOf,
  type OversightRecipient as OversightAdminColumns,
} from "./oversight-relationship";

// ============================================================================
// WHO THE OVERSIGHT AUDIENCE IS — asked in SQL, answered in TypeScript.
//
// One concern, one module, sitting between the pairing table
// (`./oversight-admin.ts`, which says which role administers which kind of org
// and which `users` column carries it) and the emitters (`./oversight.ts`,
// which say WHAT an oversight partner is told). Both leaves this file imports
// are read-only: nothing here composes a notification and nothing here writes.
//
// THE DECISION IS ENCODED TWICE AND THAT IS UNAVOIDABLE — a `WHERE` clause
// cannot call a TypeScript predicate, and a TypeScript predicate cannot run
// inside the digest sweep's correlated subquery. So both encodings live HERE,
// side by side, and both read their arms off `OVERSIGHT_ADMIN_ROWS`:
//
//   * `oversightAudienceCondition` — the SQL half: the role AND its own FK,
//     the audience proper. `./oversight-digest.ts` clause 4 correlates it with
//     the outer `churches` row to decide who is still owed a digest.
//   * `classifyOversightCandidate` — the TypeScript half: the same pairing,
//     asked of a row that a WIDER query already returned, so a row the pairing
//     rejects can be COUNTED instead of vanishing inside a `WHERE`.
//
// They must be kept in step, and prose has no compiler: the tie is a test
// (`oversight-audience.test.ts`), which walks the pairing table and fails if
// either half is edited alone. That is the same idiom `oversight-admin.test.ts`
// §1 uses to tie the table to `OVERSIGHT_ROLES`.
//
// NOBODY, NEVER EVERYBODY. Every builder here has an empty case — an org that
// names no id at all — and getting it wrong is the one catastrophic failure in
// this module: drizzle DROPS an `undefined` arm from `and()`, so an audience
// that collapses to nothing makes the digest sweep's `exists (…)` match every
// row in `users` and every plant is owed a digest forever
// (`memory/invariants.md` → Multi-Tenancy). The empty case is therefore written
// ONCE, in `oversightOrArms`, and each public builder makes it unrepresentable
// at its own boundary rather than by asking the caller to remember.
// ============================================================================

/**
 * A `users` table reference — the base table, or an `alias()` of it, so a
 * correlated subquery can name its own candidate recipient.
 *
 * BOTH ARMS ARE CONCRETE, deliberately. A structural `{ role: AnyColumn; … }`
 * also accepts both, and reads as the more permissive, more honest type — but
 * `AnyColumn` is drizzle's `any`-shaped column, so every `eq()` in the builders
 * below loses BOTH of its operand checks: `eq(ref.role, "not_a_role")` and
 * `eq(ref.sendingChurchId, 12345)` compile clean, on the one predicate in this
 * domain that decides a multi-tenant audience. The union keeps drizzle's own
 * typing, so the role literal is checked against the `user_role` enum and the
 * org id against a uuid column, by the compiler rather than by a `satisfies`
 * someone has to remember to write.
 */
type UsersRef = typeof users | ReturnType<typeof alias<typeof users, string>>;

/**
 * An org id to match against: a literal loaded by an earlier query, or a COLUMN
 * to correlate with (the sweep's `churches.sending_*_id` of the outer row). The
 * same idiom `ChurchIdRef` uses in `./oversight-digest.ts`, and for the same
 * reason: one definition of the audience, asked two ways.
 *
 * `SQLWrapper` rather than `AnyColumn` for the correlated half — a column IS
 * one, and it leaves `eq()` free to reject a value that is not what a uuid
 * column compares against.
 */
type OrgIdRef = string | SQLWrapper;

/** The orgs a builder is addressing — the pairing table's keys, each nullable. */
type OrgIdRefs = Record<OversightAdminPairing["fk"], OrgIdRef | null>;

/**
 * ONE ARM PER ROW OF `OVERSIGHT_ADMIN`, AND ONE EMPTY CASE — the loop both
 * builders below are, with the term they differ by passed in.
 *
 * The two builders differ by exactly one thing (the audience ANDs the role onto
 * the FK; the probe does not), so the loop, the skip-a-null-org rule and the
 * empty case are written here once. Written per builder, they were the same
 * eight lines twice, and "the probe is the audience minus the role" was a claim
 * a docblock made rather than a shape the code had.
 *
 * `undefined` means NOBODY, never everybody — see the module header for what a
 * bare `and()` does with it. Nothing outside this file sees that `undefined`:
 * the audience turns it into its documented overloaded return, the probe into
 * `false`. That is why this helper is not exported.
 *
 * IT STOPS AT THIS MODULE, deliberately. `invitationRelationship` and
 * `auditRelationship` (`./oversight-relationship.ts`) have the same SHAPE over
 * different tables, and hoisting the loop to somewhere both files could import
 * would either make this module and that one import each other — this one reads
 * `recipientOrgOf` from there — or put drizzle VALUES in `./oversight-admin.ts`,
 * the type-import-only leaf its own test pins. What they must share is the
 * PAIRING, and they do: every arm in either file is read off
 * `OVERSIGHT_ADMIN_ROWS`.
 */
function oversightOrArms(
  org: OrgIdRefs,
  arm: (pairing: OversightAdminPairing, orgId: OrgIdRef) => SQL
): SQL | undefined {
  const reaches = OVERSIGHT_ADMIN_ROWS.map(([, pairing]) => {
    const orgId = org[pairing.fk];

    return orgId === null || orgId === undefined
      ? undefined
      : arm(pairing, orgId);
  }).filter((clause) => clause !== undefined);

  if (reaches.length === 0) return undefined;

  return or(...reaches);
}

/**
 * WHO ADMINISTERS THESE ORGS — the ONE definition of an oversight audience, in
 * SQL. One arm per row of `OVERSIGHT_ADMIN` (`./oversight-admin.ts`), in the
 * table's order, with the role and the FK both read off the row; why the
 * pairing is a table and why the arms carry no `OVERSIGHT_ROLES` floor are in
 * that header and in `memory/invariants/multi-tenancy.md`.
 *
 * NAMING NO ORG RETURNS `undefined` — "no recipients" — AND THE OVERLOADS, NOT
 * A COMMENT, MAKE THE CALLER FACE IT: drizzle's `and()` reads it as the
 * opposite (`memory/invariants.md` → Multi-Tenancy). Non-nullable refs in,
 * `SQL` out; nullable refs in, `SQL | undefined` out and the guard is not
 * optional. The arm loop tests `null` explicitly rather than truthiness so the
 * first overload's `SQL` promise is a property of the code, not of the values
 * passed.
 */
export function oversightAudienceCondition(
  table: UsersRef,
  org: Record<OversightAdminPairing["fk"], OrgIdRef>
): SQL;
export function oversightAudienceCondition(
  table: UsersRef,
  org: OrgIdRefs
): SQL | undefined;
export function oversightAudienceCondition(
  table: UsersRef,
  org: OrgIdRefs
): SQL | undefined {
  return oversightOrArms(
    org,
    ({ role, fk }, orgId) => and(eq(table.role, role), eq(table[fk], orgId))!
  );
}

/**
 * THE SAME ORGS, WITH THE ROLE HALF OF THE PAIRING LEFT OUT — every `users` row
 * either named org's FK reaches, whatever role it carries.
 *
 * THIS IS NOT AN AUDIENCE. `oversightAudienceCondition` pairs the role with the
 * FK, which is correct and stays correct, but it made a cross-paired row — a
 * `network_admin` carrying a sending church's id, a `planter` carrying either —
 * vanish inside a `WHERE` where no code could count it. Widening the probe is
 * the only way to see such a row at all; the exclusion then happens in
 * TypeScript, where it can be counted and logged (`classifyOversightCandidate`,
 * and `fanOutTo` in `./oversight.ts`).
 *
 * "NOT AN AUDIENCE" IS A TYPE, NOT A WARNING. Every row this returns still has
 * to pass `classifyOversightCandidate` before it is anything, and the only
 * caller is `listOversightAudience` below, which does exactly that. A docblock
 * asking the next reader to be careful is the protection the overloads on the
 * audience builder exist to replace, so this one returns `SQL` unconditionally
 * — `false` for the empty case, the same encoding `invitationRelationship`
 * (`./oversight-relationship.ts`) uses — and there is no `SQL | undefined` for
 * an `and()` to swallow.
 */
export function oversightReachCondition(table: UsersRef, org: OrgIdRefs): SQL {
  // No org named — nobody, never everybody, and `false` says so even inside an
  // `and()` that would have dropped an `undefined` arm.
  return (
    oversightOrArms(org, ({ fk }, orgId) => eq(table[fk], orgId)) ?? sql`false`
  );
}

/**
 * The columns a reached row is judged by — its id, its role, and the pairing
 * table's own FK columns. A projection, not `select()`, for the same reason as
 * everywhere else in this domain: answering "who" must not pull `password_hash`
 * into application memory.
 *
 * The FK half is spread from `OVERSIGHT_ADMIN_ROWS`, so no column name is
 * written here and a third org kind widens the projection with the row.
 */
const oversightCandidateColumns = {
  id: users.id,
  role: users.role,
  ...(Object.fromEntries(
    OVERSIGHT_ADMIN_ROWS.map(([, { fk }]) => [fk, users[fk]])
  ) as { [K in OversightAdminPairing["fk"]]: (typeof users)[K] }),
};

/** A row of {@link oversightCandidateColumns}: an id plus the paired columns. */
type OversightCandidate = OversightAdminColumns & { id: string };

/**
 * A `users` row the pairing ACCEPTED — an admin of one of the orgs addressed,
 * and the only shape that is ever enqueued.
 *
 * It carries an id and nothing else, deliberately. This type used to hold an
 * optional `misprovisioned` field, which made one type mean "a recipient, OR a
 * data defect" and left the difference to a field a consumer had to remember to
 * read. Forgetting it mails a cross-paired admin another tenant's milestone,
 * and it compiles. The two populations are separate arrays now
 * ({@link OversightAudience}), so the reminder is not needed.
 */
export interface OversightRecipient {
  id: string;
}

/**
 * A `users` row an org FK reached whose ROLE DOES NOT ADMINISTER that kind of
 * org — a provisioning defect, and the log's whole payload.
 *
 * Both oversight FKs live on one `users` row and neither implies the other
 * (`memory/invariants.md` → Multi-Tenancy), so a row can carry a sending
 * church's id while holding `network_admin` — or hold no oversight role at all.
 * The audience is right to exclude it: acting on the FK alone is the hierarchy
 * walk this repo forbids, arriving through the role instead of through the FK.
 * What was wrong was doing it SILENTLY, inside a `WHERE` where no code could
 * count it — a defect nothing in the product could see.
 *
 * So such a row travels as far as the fan-out, which counts it, logs it, and
 * enqueues NOTHING for it (`fanOutTo` in `./oversight.ts`). The exclusion is
 * unchanged; only the silence is.
 */
export interface OversightMisprovisionedRow {
  id: string;
  /** The role the `users` row actually carries. */
  role: UserRole;
  /** The org FK that reached them, which that role does not administer. */
  reachedBy: OversightAdminPairing["fk"];
}

/**
 * EVERYONE THE ORGS REACHED, SPLIT BY WHAT THEY TURNED OUT TO BE.
 *
 * A PARTITION, not one list carrying a flag, because "a cross-paired row is
 * never enqueued" has to be something the compiler holds. Behind a flag it was
 * a `continue` inside one loop, so every future consumer of an audience had to
 * write that branch again from memory — and the cost of forgetting is
 * cross-tenant: an admin of another org, mailed this plant's milestone. Split,
 * the defects are not in the array a fan-out iterates, so there is no branch to
 * forget and nothing to remember.
 *
 * Still ONE query. The split happens in TypeScript, over exactly the rows the
 * audience was resolved from (`listOversightAudience`).
 */
export interface OversightAudience {
  recipients: OversightRecipient[];
  misprovisioned: OversightMisprovisionedRow[];
}

/** What one reached row is — the two populations, told apart by `kind`. */
export type OversightCandidateClass =
  | ({ kind: "recipient" } & OversightRecipient)
  | ({ kind: "misprovisioned" } & OversightMisprovisionedRow);

/**
 * Is this reached row a recipient, or the data defect the ruling asks us to
 * count? Pure, and exported so it can be tested over the whole role × FK grid
 * without a database — which is also how it is tied to the SQL half.
 *
 * The question is asked in the ROLE'S OWN DIRECTION: `recipientOrgOf`
 * (`./oversight-relationship.ts`) answers "which org does this row's role speak
 * through", and the row is a recipient when that org is one of the orgs being
 * addressed. Reusing that function rather than re-deriving the pairing is the
 * point — the same decision written twice is what drifted before
 * `OVERSIGHT_ADMIN` existed.
 *
 * `null` means "not in this audience at all", which no row from
 * `oversightReachCondition` can be; it exists so this function is total and can
 * be called on any row.
 */
export function classifyOversightCandidate(
  candidate: OversightCandidate,
  org: OversightOrgIds
): OversightCandidateClass | null {
  const administers = recipientOrgOf(candidate);

  const named = OVERSIGHT_ADMIN_ROWS.map(([, { fk }]) => fk).filter(
    (fk) => org[fk] !== null
  );

  // The role administers one of the orgs addressed — an ordinary recipient, and
  // the only shape that is ever enqueued.
  if (named.some((fk) => administers[fk] === org[fk])) {
    return { kind: "recipient", id: candidate.id };
  }

  // Otherwise: which named org's FK did reach them? That FK, paired with the
  // role the row actually carries, IS the defect — it is what the log has to
  // say, because a count alone cannot be acted on.
  const reachedBy = named.find((fk) => candidate[fk] === org[fk]);
  if (!reachedBy) return null;

  return {
    kind: "misprovisioned",
    id: candidate.id,
    role: candidate.role,
    reachedBy,
  };
}

/**
 * Everyone the named orgs' FKs reach, each row judged against the pairing.
 *
 * ONE QUERY, not two: the recipients and the cross-paired rows come back
 * together and are separated in TypeScript, so the count of defects is taken
 * over exactly the rows the audience was resolved from and cannot drift from it
 * by a race or by a second `WHERE` someone edits alone.
 *
 * The empty org is answered by `namesAnOversightOrg` (`./oversight-admin.ts`),
 * the canonical spelling of that question, so no database round trip is spent
 * on a `false` predicate and the skip does not depend on what a builder happens
 * to return for it.
 */
async function listOversightAudience(
  org: OversightOrgIds
): Promise<OversightAudience> {
  const audience: OversightAudience = { recipients: [], misprovisioned: [] };

  // No org named — nobody, never everybody.
  if (!namesAnOversightOrg(org)) return audience;

  const rows = await db
    .select(oversightCandidateColumns)
    .from(users)
    .where(oversightReachCondition(users, org));

  for (const row of rows) {
    const classified = classifyOversightCandidate(row, org);
    if (classified === null) continue;

    // Each side is REBUILT field by field rather than spread: the classifier's
    // `kind` is how this loop decides, and it has no business travelling on into
    // an audience nobody else discriminates.
    if (classified.kind === "recipient") {
      audience.recipients.push({ id: classified.id });
    } else {
      audience.misprovisioned.push({
        id: classified.id,
        role: classified.role,
        reachedBy: classified.reachedBy,
      });
    }
  }

  return audience;
}

/**
 * The oversight recipients of a plant: the admins of the sending church it
 * belongs to, and the admins of the network it belongs to.
 *
 * Derived from the plant's own FKs rather than from a stored recipient list, so
 * a plant that leaves a network stops being reported on immediately. Both FKs
 * are nullable (memory/invariants.md → Multi-Tenancy) and a plant with neither
 * simply has no oversight — the fan-out considers nobody and writes nothing.
 *
 * A projection, not `select()`: this answers "who", so it must not pull
 * `password_hash` into application memory (same reasoning as `accessColumns`
 * in `enqueue.ts`).
 */
export async function listOversightRecipientsForChurch(
  churchId: string
): Promise<OversightAudience> {
  const [plant] = await db
    .select({
      sendingChurchId: churches.sendingChurchId,
      sendingNetworkId: churches.sendingNetworkId,
    })
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);

  if (!plant) return { recipients: [], misprovisioned: [] };

  // Each returned row is paired role-to-FK before it counts as a recipient — see
  // `classifyOversightCandidate`. A `team_member` carrying a `sending_church_id`
  // is not oversight, and neither is a `network_admin` carrying one: `enqueue`
  // would refuse both anyway (a role with no access to this plant fails
  // `canAccessChurch`), but a fan-out that reports "considered 40" when 38 of
  // them were never candidates is lying to whoever reads the report.
  //
  // What the cross-paired rows now do is come back in their OWN array rather
  // than not at all: still no notification, but a count and a log line.
  return listOversightAudience(plant);
}

/**
 * The oversight admins of ONE named organisation.
 *
 * Deliberately does NOT touch `churches`: the audience of the consent-exempt
 * invitation milestone is defined by the invitation, and reading the plant's
 * FKs is exactly the step that let a second, uninvolved org in. Nothing here
 * can widen — a caller has to name the org, and only the org's own admins come
 * back.
 *
 * A projection, not `select()`, for the same reason as
 * `listOversightRecipientsForChurch`: this answers "who", so `password_hash`
 * must not enter application memory.
 *
 * The pairing is applied by `classifyOversightCandidate`, so the FK is still
 * paired with its own role (#304 ruling 4, item 6) and this function writes no
 * role literal of its own. A row that fails the pairing comes back in the
 * audience's `misprovisioned` half rather than missing, and is counted by the
 * fan-out, which enqueues nothing for it.
 *
 * `org` here is loaded ids, either of which may be null; naming none of them
 * returns nobody, which `listOversightAudience` guards.
 */
export async function listOversightAdminsOfOrg(
  org: OversightOrgIds
): Promise<OversightAudience> {
  return listOversightAudience(org);
}
