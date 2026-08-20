import {
  and,
  eq,
  isNull,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import type { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { churches, users } from "@/db/schema";

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
// (`./oversight-admin.ts`, which says which `users` column carries which kind
// of oversight org) and the emitters (`./oversight.ts`,
// which say WHAT an oversight partner is told). Both leaves this file imports
// are read-only: nothing here composes a notification and nothing here writes.
//
// THE DECISION IS ENCODED TWICE AND THAT IS UNAVOIDABLE — a `WHERE` clause
// cannot call a TypeScript predicate, and a TypeScript predicate cannot run
// inside the digest sweep's correlated subquery. So both encodings live HERE,
// side by side, and both read their arms off `OVERSIGHT_ADMIN_ROWS`:
//
//   * `oversightAudienceCondition` — the SQL half: this org's FK AND the rest
//     of the exactly-one-tenancy rule, the audience proper.
//     `./oversight-digest.ts` clause 4 correlates it with the outer `churches`
//     row to decide who is still owed a digest.
//   * `classifyOversightCandidate` — the TypeScript half: the same rule read
//     through `oversightOrgOf`, asked of a row that a WIDER query already
//     returned, so a row the rule rejects can be COUNTED instead of vanishing
//     inside a `WHERE`.
//
// They must be kept in step, and prose has no compiler: the tie is a test
// (`oversight-audience.test.ts`), which walks the pairing table and fails if
// either half is edited alone. That is the same idiom `oversight-admin.test.ts`
// §1 uses to tie the table to `oversightOrgOf`.
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
 * BOTH ARMS ARE CONCRETE, deliberately. A structural `{ churchId: AnyColumn; … }`
 * also accepts both, and reads as the more permissive, more honest type — but
 * `AnyColumn` is drizzle's `any`-shaped column, so every `eq()` in the builders
 * below loses its operand checks: `eq(ref.sendingChurchId, 12345)` compiles
 * clean, on the one predicate in this domain that decides a multi-tenant
 * audience. The union keeps drizzle's own typing, so an org id is checked
 * against a uuid column by the compiler rather than by a `satisfies` someone
 * has to remember to write.
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
 * The two builders differ by exactly one thing (the audience ANDs the
 * exactly-one-tenancy rule onto the FK; the probe does not), so the loop, the
 * skip-a-null-org rule and the empty case are written here once. Written per
 * builder, they were the same eight lines twice, and "the probe is the audience
 * minus the tenancy rule" was a claim a docblock made rather than a shape the
 * code had.
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
 * table's order, with the FK read off the row; why the pairing is a table, and
 * why an arm may not be widened to the FK alone, are in that header and in
 * `memory/invariants/multi-tenancy.md`.
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
    ({ fk }, orgId) =>
      and(eq(table[fk], orgId), everyTenancyNullExcept(table, fk))!
  );
}

/**
 * EVERY TENANCY COLUMN EXCEPT THE NAMED ONE IS NULL — the one builder both
 * halves of the tenancy rule are.
 *
 * It is what the role used to be. `sending_church_admin` said "this row speaks
 * for its sending church and nothing else"; with the role gone, the only thing
 * that can say it is the ABSENCE of the other tenancy columns. So an audience
 * arm reads "your `sending_church_id` is ours, and every other tenancy column
 * is null" — the SQL spelling of `oversightOrgOf` (`@/lib/auth/tenancy`), which
 * answers only when exactly one FK is named.
 *
 * ONE FUNCTION, TWO CALLERS, because they differ only in WHICH column is
 * exempt, and that is an argument rather than a second implementation. Written
 * out twice they were the same `and(...map(isNull))` with one name moved.
 *
 * THE COLUMN LIST COMES OFF THE PAIRING TABLE, not from a literal here, so a
 * third kind of oversight org adds a row there and every caller tightens with
 * it. `churchId` is appended directly because it is not an oversight FK and has
 * no row — it is the plant tenancy.
 */
function everyTenancyNullExcept(table: UsersRef, except: TenancyColumn): SQL {
  const columns: TenancyColumn[] = [
    ...OVERSIGHT_ADMIN_ROWS.map(([, { fk }]) => fk),
    "churchId",
  ];

  return and(
    ...columns
      .filter((column) => column !== except)
      .map((column) => isNull(table[column]))
  )!;
}

/**
 * The SQL half of `isChurchLevelUser` (`@/lib/auth/tenancy`): this row names no
 * oversight tenancy.
 *
 * It is the floor the planter digest sweep reads with, and it lives here beside
 * the audience it is the complement of, so the two halves of one tenancy rule
 * are never edited apart. `church_id` is the exempt column, because every
 * caller has already named a church.
 */
export function churchLevelCondition(table: UsersRef): SQL {
  return everyTenancyNullExcept(table, "churchId");
}

/**
 * THE SAME ORGS, WITH THE TENANCY RULE LEFT OUT — every `users` row either
 * named org's FK reaches, whatever else it carries.
 *
 * THIS IS NOT AN AUDIENCE. `oversightAudienceCondition` requires the FK to be
 * the row's ONLY tenancy, which is correct and stays correct, but it made a
 * cross-tenanted row — one carrying a sending church's id alongside a
 * network's or a plant's — vanish inside a `WHERE` where no code could count
 * it. Widening the probe is the only way to see such a row at all; the
 * exclusion then happens in
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
 * The columns a reached row is judged by — its id, its plant FK, and the
 * pairing table's own FK columns. All three tenancy columns, because that is
 * what `oversightOrgOf` reads: it answers only when EXACTLY ONE is named, so a
 * projection missing one would resolve a defect as though it were clean. A projection, not `select()`, for the same reason as
 * everywhere else in this domain: answering "who" must not pull `password_hash`
 * into application memory.
 *
 * The FK half is spread from `OVERSIGHT_ADMIN_ROWS`, so no column name is
 * written here and a third org kind widens the projection with the row.
 */
const oversightCandidateColumns = {
  id: users.id,
  churchId: users.churchId,
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
 * A `users` row an org FK reached whose OWN TENANCY IS NOT THAT ORG — a
 * provisioning defect, and the log's whole payload.
 *
 * All three tenancy FKs live on one `users` row and nothing in the schema holds
 * an account to one (`memory/invariants.md` → Multi-Tenancy), so a row can
 * carry a sending church's id alongside a network's, or alongside a plant's.
 * `oversightOrgOf` answers for none of those, and the audience is right to
 * exclude them: acting on one FK while another names a competing tenancy is the
 * hierarchy walk this repo forbids. What was wrong was doing it SILENTLY,
 * inside a `WHERE` where no code could count it — a defect nothing in the
 * product could see.
 *
 * So such a row travels as far as the fan-out, which counts it, logs it, and
 * enqueues NOTHING for it (`fanOutTo` in `./oversight.ts`). The exclusion is
 * unchanged; only the silence is.
 */
/**
 * Every tenancy column a `users` row can name — the pairing table's own FKs,
 * plus the plant FK, which has no row there because a plant is not an org.
 */
export type TenancyColumn = OversightAdminPairing["fk"] | "churchId";

export interface OversightMisprovisionedRow {
  id: string;
  /**
   * EVERY tenancy FK this row names — the whole defect, in the log line.
   *
   * This field used to be `administers: OversightOrg | null`, and it was
   * PROVABLY ALWAYS NULL: a row only reaches this branch when its own tenancy
   * failed to match the org that reached it, and the sole way `oversightOrgOf`
   * fails to match an FK it carries is by naming more than one tenancy — for
   * which it returns null by construction. A log line that can only ever print
   * `null` is a count with extra steps, and the operator still could not act on
   * it. Naming the columns says WHICH tenancies are competing, which is the one
   * thing needed to repair the row.
   */
  names: TenancyColumn[];
  /** The org FK that reached them, which their own tenancy does not name. */
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
 * The tenancy columns this row actually populates, in the pairing table's order
 * with the plant FK last. Two or more of them IS the defect.
 */
function tenanciesNamedBy(candidate: OversightCandidate): TenancyColumn[] {
  const columns: TenancyColumn[] = [
    ...OVERSIGHT_ADMIN_ROWS.map(([, { fk }]) => fk),
    "churchId",
  ];

  return columns.filter((column) => candidate[column] !== null);
}

/**
 * Is this reached row a recipient, or the data defect the ruling asks us to
 * count? Pure, and exported so it can be tested over the whole tenancy × FK
 * grid without a database — which is also how it is tied to the SQL half.
 *
 * The question is asked in the ROW'S OWN DIRECTION: `recipientOrgOf`
 * (`./oversight-relationship.ts`) answers "which org does this row's tenancy
 * name", and the row is a recipient when that org is one of the orgs being
 * addressed. Reusing that function rather than re-deriving the rule is the
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

  // The row's tenancy IS one of the orgs addressed — an ordinary recipient, and
  // the only shape that is ever enqueued.
  if (named.some((fk) => administers[fk] === org[fk])) {
    return { kind: "recipient", id: candidate.id };
  }

  // Otherwise: which named org's FK did reach them? That FK, beside the tenancy
  // the row actually resolves to, IS the defect — it is what the log has to
  // say, because a count alone cannot be acted on.
  const reachedBy = named.find((fk) => candidate[fk] === org[fk]);
  if (!reachedBy) return null;

  return {
    kind: "misprovisioned",
    id: candidate.id,
    names: tenanciesNamedBy(candidate),
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
        names: classified.names,
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

  // Each returned row has its own tenancy resolved before it counts as a
  // recipient — see `classifyOversightCandidate`. A plant Member carrying a
  // `sending_church_id` is not oversight, and neither is a network account
  // carrying one: `enqueue` would refuse both anyway (an account with no access
  // to this plant fails `canAccessChurch`), but a fan-out that reports
  // "considered 40" when 38 of them were never candidates is lying to whoever
  // reads the report.
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
 * The tenancy rule is applied by `classifyOversightCandidate`, so the FK is
 * still checked against the row's own tenancy (#304 ruling 4, item 6) and this
 * function writes no column literal of its own. A row that fails it comes back
 * in the audience's `misprovisioned` half rather than missing, and is counted
 * by the fan-out, which enqueues nothing for it.
 *
 * `org` here is loaded ids, either of which may be null; naming none of them
 * returns nobody, which `listOversightAudience` guards.
 */
export async function listOversightAdminsOfOrg(
  org: OversightOrgIds
): Promise<OversightAudience> {
  return listOversightAudience(org);
}
