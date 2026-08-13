import type { AssociationOrgType, UserRole } from "@/db/schema";

/**
 * WHICH ROLE ADMINISTERS WHICH KIND OF OVERSIGHT ORG, AND WHICH `users` COLUMN
 * CARRIES THAT ORG — the ONE definition of that pairing, as data.
 *
 * THE STORY IS TOLD HERE AND NOWHERE ELSE. Every reader below points at this
 * file rather than repeating it: a decision written per site is what drifted in
 * the first place, and prose has no compiler to catch the copy that goes stale.
 *
 * Both oversight FKs live on one `users` row and neither implies the other
 * (`memory/invariants.md` → Multi-Tenancy), so an unpaired
 * `or(fk, fk) AND role in (…)` admits a `network_admin` carrying a stray
 * `sending_church_id` into that SENDING CHURCH's audience — the hierarchy walk
 * this repo forbids, arriving through the role instead of through the FK. A SQL
 * audience builder and a per-recipient TypeScript gate cannot share a
 * predicate, but they encode ONE decision; while it was written out twice in
 * two languages they drifted, and the drift starved a plant of its digest.
 *
 * THE ROW CARRIES THE COLUMN NAME TOO, AND `OversightOrgIds` BELOW IS KEYED ON
 * IT. A table holding the ROLE alone still left every reader writing its own
 * `kind === "sending_church" ? … : …`, which is half a pairing spelled per
 * site. Every reader now INDEXES this table and none of them names a column:
 * the SQL audience `oversightAudienceCondition` and its `invitingOrgForInvitation`
 * / `orgAudienceOfKind` inputs (`./oversight.ts`), the per-recipient gate
 * `recipientAdministersOrg` (`./enqueue.ts`), and the recorded-relationship
 * probe's `recipientOrgOf`, `invitationRelationship` and `auditRelationship`
 * (`./oversight-relationship.ts`).
 *
 * WHAT A THIRD KIND OF OVERSIGHT ORG COSTS — what `pnpm typecheck` was OBSERVED
 * to print, not what would be nice. The probe: add a third member to
 * `associationOrgTypes` (`@/db/schema/association-event`) and change nothing
 * else. It fails in THIRTEEN places, and only these:
 *
 *   * here — the `satisfies` (TS1360), the `OversightAdminPairing` lookup
 *     (TS2339), and `oversightOrgOfKind`'s `OVERSIGHT_ADMIN[kind]` (TS7053);
 *   * `recipientAdministersOrg`'s index (TS7053, `./enqueue.ts`);
 *   * `anchorType()` and `toAnchorColumns()` (`./anchor.ts`) — the STORED
 *     discriminator, which is a fact this table does not hold;
 *   * the two builders that index a TABLE by the row's `fk` and so need a
 *     column for the new kind: `invitationRelationship`
 *     (`./oversight-relationship.ts`) and `oversightAudienceCondition`
 *     (`./oversight.ts`);
 *   * the FOUR `Record<AssociationOrgType, string>` label maps —
 *     `src/app/(dashboard)/settings/association/leave-org-dialog.tsx`,
 *     `src/components/oversight/remove-plant-dialog.tsx`,
 *     `src/lib/invitations/audit.ts`, `./plant-association.ts`.
 *
 * Add the row and every reader that merely ENUMERATES the table compiles
 * unchanged — `recipientOrgOf`, `auditRelationship`, `noOversightOrg`,
 * `namesAnOversightOrg` — because no per-kind branch is left in them to forget.
 *
 * TWO THINGS DELIBERATELY DO NOT FAIL, and an earlier version of this comment
 * claimed both did. `orgAnchor()`'s return cannot: its discriminator IS
 * `AssociationOrgType`, so it widens by construction. `enqueueNotificationSchema`'s
 * `anchorOrg` cannot either, now that it reads `z.enum(associationOrgTypes)`
 * instead of two literals — the parse FOLLOWS the union, which is the point; it
 * was the hand-written list that made a widened union a runtime rejection with
 * the compile-time bill unpaid. Verify a claim like this by making the edit and
 * reading tsc's output before writing the sentence.
 *
 * TYPE IMPORTS ONLY, DELIBERATELY. This is a leaf: asking "which role
 * administers a network?" must not cost a database connection, which is what
 * would happen if the pairing sat beside `getAccessibleChurchIds` in
 * `@/lib/auth/access` (its first line is `import { db } from "@/db"`).
 * `oversight-admin.test.ts` §2 pins the leaf value-import-free.
 *
 * ITS ROLES ARE THE ROLES `OVERSIGHT_ROLES` NAMES, and that is asserted rather
 * than assumed: `@/lib/auth/access` owns the flat oversight-role list and is
 * another workstream's file, so the tie between the two is a test —
 * `oversight-admin.test.ts` §1 fails on any divergence in either direction.
 * Nothing in the notifications layer may hand-write an oversight role literal.
 *
 * Keyed on `AssociationOrgType`, the same two-valued union `orgAnchor()`
 * derives a notification's org anchor from, so the anchor kinds and the rows
 * here are the same set by construction.
 */
export const OVERSIGHT_ADMIN = {
  sending_church: { role: "sending_church_admin", fk: "sendingChurchId" },
  network: { role: "network_admin", fk: "sendingNetworkId" },
} as const satisfies Record<
  AssociationOrgType,
  { role: UserRole; fk: "sendingChurchId" | "sendingNetworkId" }
>;

/** One row of {@link OVERSIGHT_ADMIN} — a role paired with the FK it reaches through. */
export type OversightAdminPairing =
  (typeof OVERSIGHT_ADMIN)[AssociationOrgType];

/**
 * The rows of {@link OVERSIGHT_ADMIN} as an iterable of `[kind, pairing]`, so a
 * reader that needs the ORG KIND as well as the role and the FK — the audit
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
 * AT MOST ONE FIELD IS NON-NULL, by construction rather than by convention:
 * {@link noOversightOrg} and {@link oversightOrgOfKind} are the only ways to
 * make one from a kind, and `recipientOrgOf` pairs role to FK before it fills
 * one in. A `users` row is NOT one of these — both FKs live on one row and
 * nothing stops a user carrying both, which is the hierarchy walk the audience
 * must not admit.
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
