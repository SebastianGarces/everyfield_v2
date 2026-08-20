import type { AssociationOrgType } from "@/db/schema";

/**
 * WHICH `users` COLUMN CARRIES WHICH KIND OF OVERSIGHT ORG — the ONE definition
 * of that pairing, as data.
 *
 * IT USED TO CARRY A ROLE TOO, and that half is gone with the role column
 * itself (#494, ruling 185): `sending_church_admin` and `network_admin` were the two names
 * that said which org a row spoke for, and the FK now says it alone. What
 * replaces the role is not another column on this table but a PREDICATE —
 * `oversightOrgOf` (`@/lib/auth/tenancy`) — which reads all three tenancy FKs
 * and answers only when EXACTLY ONE is named. The readers below index this
 * table for the column; they ask that function what the column means.
 *
 * THE STORY IS TOLD HERE AND NOWHERE ELSE. Every reader below points at this
 * file rather than repeating it: a decision written per site is what drifted in
 * the first place, and prose has no compiler to catch the copy that goes stale.
 *
 * Both oversight FKs live on one `users` row and neither implies the other
 * (`memory/invariants.md` → Multi-Tenancy), so a bare `or(fk, fk)` admits a row
 * carrying a stray `sending_church_id` into that SENDING CHURCH's audience —
 * the hierarchy walk this repo forbids, arriving through a column nobody paired
 * with anything. A SQL audience builder and a per-recipient TypeScript gate
 * cannot share a predicate, but they encode ONE decision; while it was written
 * out twice in two languages they drifted, and the drift starved a plant of its
 * digest. What each arm ANDs onto its FK today is the rest of the
 * exactly-one-tenancy rule, derived from the other rows of this table rather
 * than written per site.
 *
 * `OversightOrgIds` BELOW IS KEYED ON THE COLUMN NAME. Every reader INDEXES
 * this table and none of them names a column: the SQL audience
 * `oversightAudienceCondition` and the per-row classifier
 * `classifyOversightCandidate` (`./oversight-audience.ts`), their
 * `invitingOrgForInvitation` / `orgAudienceOfKind` inputs (`./oversight.ts`),
 * the per-recipient gate `recipientAdministersOrg` (`./enqueue.ts`), and the
 * recorded-relationship probe's `recipientOrgOf`, `invitationRelationship` and
 * `auditRelationship` (`./oversight-relationship.ts`).
 *
 * WHAT A THIRD KIND OF OVERSIGHT ORG COSTS: the probe and its observed tsc
 * output are recorded once, in memory/invariants/multi-tenancy.md.
 *
 * The rule that keeps that list short is here, though, because it is about this
 * table: a reader that merely ENUMERATES the rows compiles unchanged, and only
 * a reader that INDEXES them by kind pays. The parse FOLLOWS the union for the
 * same reason — `enqueueNotificationSchema.anchorOrg` reads
 * `z.enum(associationOrgTypes)` and `orgAnchor()`'s discriminator IS
 * `AssociationOrgType`, so neither restates the kinds and neither can turn a
 * widened union into a runtime rejection with the compile-time bill unpaid
 * (`enqueue.test.ts`).
 *
 * TYPE IMPORTS ONLY, DELIBERATELY. This is a leaf: asking "which column carries
 * a network?" must not cost a database connection, which is what would happen
 * if the pairing sat beside `getAccessibleChurchIds` in `@/lib/auth/access`
 * (its first line is `import { db } from "@/db"`).
 * `oversight-admin.test.ts` §2 pins the leaf value-import-free.
 *
 * ITS COLUMNS ARE THE COLUMNS `oversightOrgOf` READS, and that is asserted
 * rather than assumed: `@/lib/auth/tenancy` owns the question "which org does
 * this row's tenancy name" and is another workstream's file, so the tie between
 * the two is a test — `oversight-admin.test.ts` §1 fails on any divergence in
 * either direction. Nothing in the notifications layer may hand-write an
 * oversight tenancy column.
 *
 * Keyed on `AssociationOrgType`, the same two-valued union `orgAnchor()`
 * derives a notification's org anchor from, so the anchor kinds and the rows
 * here are the same set by construction.
 */
export const OVERSIGHT_ADMIN = {
  sending_church: { fk: "sendingChurchId" },
  network: { fk: "sendingNetworkId" },
} as const satisfies Record<
  AssociationOrgType,
  { fk: "sendingChurchId" | "sendingNetworkId" }
>;

/** One row of {@link OVERSIGHT_ADMIN} — the FK an org kind is reached through. */
export type OversightAdminPairing =
  (typeof OVERSIGHT_ADMIN)[AssociationOrgType];

/**
 * The rows of {@link OVERSIGHT_ADMIN} as an iterable of `[kind, pairing]`, so a
 * reader that needs the ORG KIND as well as the FK — the audit
 * probe's `association_events.org_type` predicate — reads it off the key rather
 * than writing `"sending_church"` / `"network"` out again.
 *
 * The assertion is the one place the `Object.entries` widening is undone, and
 * it is sound by the `satisfies Record<AssociationOrgType, …>` above.
 */
export const OVERSIGHT_ADMIN_ROWS = Object.entries(OVERSIGHT_ADMIN) as [
  AssociationOrgType,
  OversightAdminPairing,
][];

/**
 * ONE oversight org, addressed by the `users` FK that reaches it — the shape the
 * SQL audience, the fan-out audiences and the recorded-relationship probe all
 * pass around.
 *
 * KEYED ON THE PAIRING TABLE, NOT ON TWO HAND-WRITTEN FIELDS. Three separate
 * interfaces used to spell `{ sendingChurchId, sendingNetworkId }` out — the
 * same half-pairing per site the table exists to remove — and a third org kind
 * left all three quietly unchanged. Derived, a new row in the table adds a key
 * here and every builder below fails until it is filled in.
 *
 * AT MOST ONE FIELD IS NON-NULL, and INSIDE `src/lib/notifications/` that is by
 * construction rather than by convention: {@link noOversightOrg} and
 * {@link oversightOrgOfKind} are the only ways to make one from a kind, and
 * `recipientOrgOf` resolves the row's tenancy before it fills one in. A `users`
 * row is NOT one of these — all three tenancy FKs live on one row and nothing
 * stops an account carrying two, which is the hierarchy walk the audience must
 * not admit.
 *
 * OUTSIDE THIS DIRECTORY IT IS BY CONVENTION, and there is exactly one such site
 * today: `announceAssociationEndedFor` in `src/lib/invitations/core.ts` builds
 * the `org` argument of `announceAssociationEnded` by hand, as
 * `{ sendingChurchId: kind === "sending_church" ? id : null, sendingNetworkId:
 * kind === "network" ? id : null }` — the half-pairing per site this table
 * exists to delete, written at the one call site the table cannot reach. It is
 * not fail-open: a third row here widens this type's keys and that literal stops
 * compiling (TS2741, a missing property). But nothing stops it filing an id
 * under the wrong FK, so the guarantee this paragraph makes stops at the
 * directory boundary. `oversightOrgOfKind(orgType, orgId)` is the one-line
 * replacement; `src/lib/invitations/` belongs to another workstream, so it is
 * recorded here rather than edited from this one.
 */
export type OversightOrgIds = Record<
  OversightAdminPairing["fk"],
  string | null
>;

/** No org named — every FK null, enumerated from the table. Matches nobody. */
export function noOversightOrg(): OversightOrgIds {
  return Object.fromEntries(
    OVERSIGHT_ADMIN_ROWS.map(([, { fk }]) => [fk, null])
  ) as OversightOrgIds;
}

/**
 * Exactly one org named, BY KIND — the other FKs stay null.
 *
 * The kind picks the column, so no caller writes `{ sendingChurchId: null, … }`
 * and no caller can file a network's id under the sending-church FK. A null id
 * is allowed and yields the empty audience, because the callers that read an
 * `organization_invitations` row are reading nullable columns.
 */
export function oversightOrgOfKind(
  kind: AssociationOrgType,
  orgId: string | null
): OversightOrgIds {
  return { ...noOversightOrg(), [OVERSIGHT_ADMIN[kind].fk]: orgId };
}

/** Does this org name anything at all? False means "nobody", never "everybody". */
export function namesAnOversightOrg(org: OversightOrgIds): boolean {
  return Object.values(org).some((orgId) => orgId !== null);
}
