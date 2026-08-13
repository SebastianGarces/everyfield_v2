import type { AssociationOrgType, NotificationAnchorType } from "@/db/schema";

// ============================================================================
// WHAT A NOTIFICATION IS FILED UNDER (N-010; #304 WS3, ruling #351).
//
// One value type for the whole notifications layer, so "which tenant is this
// row's?" is asked in one vocabulary by the enqueue gate, the writer, the
// dedupe key and the reads.
//
// It exists because the answer stopped being one column. Until migration 0036
// every notification was about a plant and `church_id` was NOT NULL; #304 WS3
// produced the first events that name no plant at all — a sending church
// accepting, declining or leaving a network's invitation — and #351 ruled for a
// generalized anchor on the one table rather than a parallel org table.
//
// A DISCRIMINATED UNION, NOT THREE NULLABLE FIELDS. The database has a
// discriminator and a CHECK; this is that shape in TypeScript, so a caller
// cannot compose "a church notification with an org id" or "a notification with
// no tenant at all" and have it type-check. `toAnchorColumns` is the ONE place
// the union becomes columns, which is what keeps the CHECK from being something
// a writer has to remember.
// ============================================================================

/**
 * The tenant a notification row belongs to.
 *
 * `church` is every notification the product had before 0036 and almost every
 * one it writes now. The two org arms are reachable only from the three
 * own-relationship milestones about a SENDING CHURCH's own network membership.
 */
export type NotificationAnchor = ChurchAnchor | OrgAnchor;

/** The plant arm, named so a signature can require it. */
export type ChurchAnchor = { type: "church"; churchId: string };

/**
 * The ORG arm, named for the same reason: `recipientAdministersOrg` and the org
 * reads are about this and only this, and a signature that took the whole union
 * would have to re-check the discriminator inside.
 *
 * ITS DISCRIMINATOR IS `AssociationOrgType` ITSELF, not two literals written out
 * again. Spelled by hand it was a union that merely HAPPENED to hold the same
 * two strings, so a third oversight org kind widened `AssociationOrgType` and
 * left this type — and everything that switches on it — quietly unchanged.
 * Derived, a new kind reaches `OVERSIGHT_ADMIN` (`./oversight-admin.ts`, whose
 * header carries the whole rationale) and every reader that indexes that table
 * by `anchor.type` follows it with no edit.
 */
export type OrgAnchor = { type: AssociationOrgType; orgId: string };

/** The plant anchor — the overwhelmingly common case, named so it reads. */
export function churchAnchor(churchId: string): ChurchAnchor {
  return { type: "church", churchId };
}

/**
 * The ORG anchor, from the same two-valued org kind `association_events` and
 * both sever paths already speak (`AssociationOrgType`). Deriving it from that
 * union rather than from a fresh string is what stops the notification side and
 * the audit side from disagreeing about which org an event names.
 */
export function orgAnchor(
  orgType: AssociationOrgType,
  orgId: string
): OrgAnchor {
  return { type: orgType, orgId };
}

/**
 * The anchor's id — the plant's, or the org's.
 *
 * Used for the dedupe key and for logging, never for a WHERE clause: a read
 * scopes on the DISCRIMINATED column (`church_id` or `anchor_org_id`), because
 * a bare id compared against "whichever column" is how a plant's feed would
 * come to contain an org's row.
 */
export function anchorId(anchor: NotificationAnchor): string {
  return anchor.type === "church" ? anchor.churchId : anchor.orgId;
}

/** The anchor's discriminator, as stored. */
export function anchorType(anchor: NotificationAnchor): NotificationAnchorType {
  return anchor.type;
}

/**
 * The union as the three columns `notifications` stores it in — the ONE place
 * that mapping happens.
 *
 * Every arm sets all three, including the nulls, so the CHECK constraint
 * (`notifications_anchor_check`: exactly one anchor) is satisfied by
 * construction rather than by a writer remembering to clear the other column.
 */
export function toAnchorColumns(anchor: NotificationAnchor): {
  anchorType: NotificationAnchorType;
  churchId: string | null;
  anchorOrgId: string | null;
} {
  return anchor.type === "church"
    ? {
        anchorType: "church",
        churchId: anchor.churchId,
        anchorOrgId: null,
      }
    : {
        anchorType: anchor.type,
        churchId: null,
        anchorOrgId: anchor.orgId,
      };
}

/**
 * Read an anchor back off a stored row — the inverse of `toAnchorColumns`, and
 * total: a row that satisfies the CHECK always produces one.
 *
 * `null` only for a row that does not, which the database will not accept and
 * which therefore means the row was written before 0036 by something that
 * bypassed both. Callers treat that as "cannot be re-anchored" rather than
 * guessing a tenant.
 */
export function anchorOfRow(row: {
  anchorType: NotificationAnchorType;
  churchId: string | null;
  anchorOrgId: string | null;
}): NotificationAnchor | null {
  if (row.anchorType === "church") {
    return row.churchId ? churchAnchor(row.churchId) : null;
  }
  return row.anchorOrgId
    ? { type: row.anchorType, orgId: row.anchorOrgId }
    : null;
}
