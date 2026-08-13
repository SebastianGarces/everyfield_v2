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
 * THE ROW CARRIES THE COLUMN NAME TOO. A table holding the ROLE alone still
 * left every reader writing its own `kind === "sending_church" ? … : …`, which
 * is half a pairing spelled per site. With the FK in the row all three readers
 * INDEX this table by org kind and none of them names a column:
 * `oversightAudienceCondition` (`./oversight.ts`) builds one `or` arm per row,
 * `recipientAdministersOrg` (`./enqueue.ts`) reads one row, and
 * `recipientOrgOf` (`./oversight-relationship.ts`) scans the rows for the
 * recipient's role.
 *
 * WHAT A THIRD KIND OF OVERSIGHT ORG COSTS, stated as what tsc was OBSERVED to
 * do rather than as a promise. Widen `AssociationOrgType` without touching this
 * table and tsc fails at the `satisfies` here, at `recipientAdministersOrg`'s
 * lookup (TS7053), at `orgAnchor`'s return, at the enqueue input schema's
 * `anchorOrg` and at the three `Record<AssociationOrgType, string>` label maps.
 * Add the row and the three readers compile UNCHANGED — no per-kind branch is
 * left in them to forget — while the anchor enum, the Zod schema and the label
 * maps still fail until each is given the new kind, which is the correct bill.
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
