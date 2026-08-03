// ============================================================================
// Organization invitations — the logic layer (issue #265).
//
// This module has NO "use server" directive, and that absence is the fix.
// `service.ts` used to be a `"use server"` module with eleven exports, and in a
// `"use server"` module every export is a POSTable endpoint whether or not any
// UI calls it: an anonymous request could accept an invitation on a stranger's
// behalf (`respondingUser` was an ARGUMENT), or sever any church's oversight
// association by guessing a uuid. Moving the logic here makes none of it
// reachable from a browser; `service.ts` now holds only actions that mint their
// actor from `verifySession()` and is the sole way in from the client.
//
// So: nothing in this file may be exported from a `"use server"` module without
// re-reading the authority rules below. `service.test.ts` pins both halves —
// that this file is not an endpoint surface, and that the action layer never
// takes an actor as an argument.
//
// Every mutation that has an actor takes an `InvitationActor`, which can only
// be minted from a session (`invitationActorFromSession`). A bare `User` — the
// shape a forged payload could carry — is not assignable to it, so "trust the
// caller's user" cannot be written by accident. Same technique as
// `preferenceOwnerFromSession` in `@/lib/notifications/preferences`.
// ============================================================================

import { and, desc, eq, exists, lt, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  organizationInvitations,
  sendingChurches,
  type NewOrganizationInvitation,
  type OrganizationInvitation,
  type User,
  type UserRole,
} from "@/db/schema";
import type {
  OrganizationInvitationStatus,
  OrganizationInvitationType,
} from "@/db/schema/organization-invitation";
import { announceInvitationAccepted } from "@/lib/notifications/oversight";

// ============================================================================
// Constants
// ============================================================================

/** Default invitation expiry: 30 days */
export const INVITATION_EXPIRY_DAYS = 30;

/** Bounds on a caller-supplied expiry, in days. */
export const MIN_EXPIRY_DAYS = 1;
export const MAX_EXPIRY_DAYS = 90;

// ============================================================================
// Errors
// ============================================================================

/**
 * A failure the user is allowed to read: not found, not pending, expired, or
 * not yours. The action layer surfaces `message` verbatim and turns everything
 * else into a generic error, so an internal failure can never leak.
 */
export class InvitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvitationError";
  }
}

export const NOT_AUTHORIZED_MESSAGE =
  "You are not authorized to respond to this invitation";

// ============================================================================
// The actor
// ============================================================================

declare const invitationActorBrand: unique symbol;

/**
 * Who is acting. Structurally identical to the fields of a `User` we care
 * about, but branded: the ONLY way to obtain one is
 * `invitationActorFromSession`, so an authorization check can never be handed a
 * user object that arrived from a client.
 */
export type InvitationActor = {
  readonly id: string;
  readonly role: UserRole;
  readonly churchId: string | null;
  readonly sendingChurchId: string | null;
  readonly sendingNetworkId: string | null;
  readonly [invitationActorBrand]: true;
};

/**
 * Mint an actor from a validated session. Takes the whole session result — the
 * shape `verifySession()` returns — so the call site reads as "the actor is
 * whoever this request is authenticated as" and there is no id parameter for a
 * client value to slot into.
 */
export function invitationActorFromSession(session: {
  user: Pick<
    User,
    "id" | "role" | "churchId" | "sendingChurchId" | "sendingNetworkId"
  >;
}): InvitationActor {
  const { user } = session;
  return {
    id: user.id,
    role: user.role,
    churchId: user.churchId,
    sendingChurchId: user.sendingChurchId,
    sendingNetworkId: user.sendingNetworkId,
  } as InvitationActor;
}

// ============================================================================
// Create
// ============================================================================

/**
 * What a client may say when issuing an invitation: WHO is being invited, and
 * for how long. Never which org is inviting, and never the invitation `type` —
 * both are derived from the actor by `resolveInvitationRequest`, because they
 * are the fields that decide who ends up associated with whom (and who gets
 * notified about it without consent — see `announceInvitationAcceptedForChurch`).
 */
export interface InvitationRequest {
  targetChurchId?: string;
  targetSendingChurchId?: string;
  expiresInDays?: number;
}

/** The row to insert, fully resolved. */
export interface ResolvedInvitation {
  type: OrganizationInvitationType;
  inviterUserId: string;
  targetChurchId: string | null;
  targetSendingChurchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  expiresInDays: number;
}

export type ResolveResult =
  | { ok: true; values: ResolvedInvitation }
  | { ok: false; error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a well-formed uuid. Anything else is a client that guessed. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function clampExpiry(days: number | undefined): number | null {
  if (days === undefined) return INVITATION_EXPIRY_DAYS;
  if (!Number.isInteger(days)) return null;
  if (days < MIN_EXPIRY_DAYS || days > MAX_EXPIRY_DAYS) return null;
  return days;
}

/**
 * Decide what invitation the actor is allowed to issue. Pure — no database —
 * so the authority rules are unit-testable.
 *
 * Only oversight roles invite, and only ON BEHALF OF THEIR OWN ORG:
 * - `sending_church_admin` → invites a church plant into THEIR sending church
 * - `network_admin`        → invites a church plant, or a sending church, into
 *                            THEIR network
 *
 * The inviting org therefore comes from the session and the `type` follows from
 * the role plus which target was named. Exactly one target may be named.
 */
export function resolveInvitationRequest(
  actor: InvitationActor,
  request: InvitationRequest
): ResolveResult {
  const targetChurchId = request.targetChurchId ?? null;
  const targetSendingChurchId = request.targetSendingChurchId ?? null;

  if (targetChurchId && targetSendingChurchId) {
    return { ok: false, error: "Invite one organization at a time" };
  }
  if (!targetChurchId && !targetSendingChurchId) {
    return { ok: false, error: "Choose who to invite" };
  }
  if (targetChurchId && !isUuid(targetChurchId)) {
    return { ok: false, error: "That is not a church we can invite" };
  }
  if (targetSendingChurchId && !isUuid(targetSendingChurchId)) {
    return { ok: false, error: "That is not a sending church we can invite" };
  }

  const expiresInDays = clampExpiry(request.expiresInDays);
  if (expiresInDays === null) {
    return {
      ok: false,
      error: `An invitation can stay open for ${MIN_EXPIRY_DAYS}–${MAX_EXPIRY_DAYS} days`,
    };
  }

  const base = {
    inviterUserId: actor.id,
    targetChurchId,
    targetSendingChurchId,
    expiresInDays,
  };

  if (actor.role === "sending_church_admin") {
    if (!actor.sendingChurchId) {
      return { ok: false, error: "Set up your sending church first" };
    }
    if (targetSendingChurchId) {
      return {
        ok: false,
        error: "A sending church can only invite church plants",
      };
    }
    return {
      ok: true,
      values: {
        ...base,
        type: "church_to_sending_church",
        sendingChurchId: actor.sendingChurchId,
        sendingNetworkId: null,
      },
    };
  }

  if (actor.role === "network_admin") {
    if (!actor.sendingNetworkId) {
      return { ok: false, error: "Set up your network first" };
    }
    return {
      ok: true,
      values: {
        ...base,
        type: targetSendingChurchId
          ? "sending_church_to_network"
          : "church_to_network",
        sendingChurchId: null,
        sendingNetworkId: actor.sendingNetworkId,
      },
    };
  }

  return {
    ok: false,
    error: "Only a sending church or network admin can invite an organization",
  };
}

/**
 * Insert a resolved invitation. No authority check of its own — it writes
 * exactly what it is given, so every caller must have gone through
 * `resolveInvitationRequest` (the action layer) or be deliberately building an
 * odd row for a test harness.
 */
export async function insertInvitation(
  values: ResolvedInvitation
): Promise<OrganizationInvitation> {
  const expiresAt = new Date(
    Date.now() + values.expiresInDays * 24 * 60 * 60 * 1000
  );

  const row: NewOrganizationInvitation = {
    type: values.type,
    inviterUserId: values.inviterUserId,
    targetChurchId: values.targetChurchId,
    targetSendingChurchId: values.targetSendingChurchId,
    sendingChurchId: values.sendingChurchId,
    sendingNetworkId: values.sendingNetworkId,
    status: "pending",
    expiresAt,
  };

  const [invitation] = await db
    .insert(organizationInvitations)
    .values(row)
    .returning();

  return invitation;
}

/** Resolve + insert. The path the action layer takes. */
export async function createInvitationAs(
  actor: InvitationActor,
  request: InvitationRequest
): Promise<OrganizationInvitation> {
  const resolved = resolveInvitationRequest(actor, request);
  if (!resolved.ok) {
    throw new InvitationError(resolved.error);
  }
  return insertInvitation(resolved.values);
}

// ============================================================================
// Respond
// ============================================================================

/**
 * Accept an invitation: CLAIM the invitation, then bind the association — both
 * statements in ONE `db.batch`, in that order.
 *
 * ORDER AND ATOMICITY — memory/invariants.md → Transactions / Atomicity. Both
 * writes are known up front, so they belong in one Neon batched transaction.
 * The claim (`respondToInvitationQuery`, a compare-and-set on
 * `status = 'pending'`) is statement ONE, and the association's own WHERE
 * additionally requires the invitation to read `accepted` — a value only that
 * claim can have written, and one statement TWO can see because it runs inside
 * the same transaction. So:
 *
 *   * the claim wins → the EXISTS holds → both writes commit together;
 *   * the claim loses, because a revoke or a decline committed first → the row
 *     is not `accepted`, the EXISTS fails, the association writes NOTHING, and
 *     the empty `returning()` becomes the error below.
 *
 * The read in `loadRespondableInvitation` is NOT the guard — two concurrent
 * accepts both pass it (invariants.md: a SELECT-then-write guard is not a
 * concurrency guard). And `db.batch` alone would not have been the guard
 * either: an empty `returning()` is not a driver error and does not roll a
 * batch back, so with the association written FIRST a lost claim still left the
 * plant bound to an oversight org — inside `getAccessibleChurchIds`, listed by
 * `getOversightPlantHealth` — with no accepted invitation anywhere to explain
 * it and no product path to undo it. Statement order is what closes that.
 *
 * Residual, accepted: a crash between the committed batch and the milestone
 * notification loses the notification, not the acceptance — the notification is
 * best-effort by construction. And a replay that lost the claim to a CONCURRENT
 * accept re-writes the association to the value the winner already wrote (the
 * EXISTS sees the winner's `accepted`), which is an idempotent no-op: same FK,
 * same value, and the milestone is still gated on our own `returning()` row, so
 * there is no second announcement.
 */
export async function acceptInvitationAs(
  actor: InvitationActor,
  invitationId: string
): Promise<OrganizationInvitation> {
  // Authority first, then status: see `loadRespondableInvitation`.
  const invitation = await loadRespondableInvitation(actor, invitationId);

  // Built BEFORE anything is written, so an invitation whose FKs contradict its
  // `type` throws instead of half-applying.
  const association = associationStatement(invitation, invitationId);

  const [claimed] = await db.batch([
    respondToInvitationQuery(actor, invitationId, "accepted"),
    association,
  ]);

  const [updated] = claimed;

  if (!updated) {
    throw new InvitationError("This invitation is no longer pending");
  }

  // F11 N-025 — milestone #1, announced at its source.
  //
  // Last, and after the committed batch, so it fires only on a genuine FIRST
  // acceptance (`updated` is the claim's own returned row) and a notification
  // failure cannot leave an invitation half-accepted (memory/invariants.md →
  // Atomicity). `announceInvitationAccepted` never throws and never decides
  // whether the plant is sharing — `enqueue` does, per recipient, and writes
  // nothing when it is not.
  //
  // Only a PLANT-side acceptance is a milestone: `target_church_id` is set when
  // a sending church or a network invited a church plant, which is the "planter
  // accepted invitation" the ruling names. A sending church joining a network
  // is a different event with no plant to report on.
  if (updated.targetChurchId) {
    await announceInvitationAcceptedForChurch(updated);
  }

  return updated;
}

/**
 * Look up the plant's name and announce the milestone. Best-effort by
 * construction: `announceInvitationAccepted` swallows its own failures, and the
 * name lookup is guarded so a missing church cannot throw into an acceptance
 * that has already been recorded.
 *
 * The whole INVITATION is passed, not just the church id, because the audience
 * of this one milestone is the org that issued it, and `invitation.type` is
 * what names that org (`invitingOrgForInvitation`). It is the only oversight
 * notification `enqueue` writes without consent, so it has to be addressed
 * exactly, and there are two ways to get it wrong — both of them reachable:
 *
 *   * from the PLANT: `associationStatement` below sets one of the plant's two
 *     oversight FKs without clearing the other, so a plant can belong to a
 *     sending church AND a network at once, and the uninvolved one would have
 *     been notified without consent;
 *   * from the invitation's two FK COLUMNS: a row can carry a stray
 *     `sending_network_id` — `insertInvitation` performs no type↔id consistency
 *     check and there is no CHECK constraint — so a `church_to_sending_church`
 *     row would have reached the network too.
 *
 * Deriving from `type` closes both: it is the same field `applyAssociation`
 * switches on, so the notification goes to precisely the org whose association
 * was just made.
 */
async function announceInvitationAcceptedForChurch(
  invitation: OrganizationInvitation
): Promise<void> {
  const churchId = invitation.targetChurchId;
  if (!churchId) return;

  try {
    const [plant] = await db
      .select({ name: churches.name })
      .from(churches)
      .where(eq(churches.id, churchId))
      .limit(1);

    if (!plant) return;

    await announceInvitationAccepted({
      churchId,
      plantName: plant.name,
      invitationId: invitation.id,
      invitation: {
        type: invitation.type,
        sendingChurchId: invitation.sendingChurchId,
        sendingNetworkId: invitation.sendingNetworkId,
      },
    });
  } catch (error) {
    console.error("oversight invitation milestone failed", {
      churchId,
      invitationId: invitation.id,
      error,
    });
  }
}

/**
 * Decline an invitation. The actor must have authority over the target entity.
 */
export async function declineInvitationAs(
  actor: InvitationActor,
  invitationId: string
): Promise<OrganizationInvitation> {
  // Authority first, then status: see `loadRespondableInvitation`.
  await loadRespondableInvitation(actor, invitationId);

  const [updated] = await respondToInvitationQuery(
    actor,
    invitationId,
    "declined"
  );

  if (!updated) {
    throw new InvitationError("This invitation is no longer pending");
  }

  return updated;
}

/**
 * The statement that records a response. Exported so a test can read the bound
 * parameters: `responded_by` is the SESSION's user and the WHERE clause is a
 * compare-and-set on `pending`.
 *
 * The compare-and-set matters twice. Two concurrent accepts both pass the read
 * in `loadPendingInvitation` (memory/invariants.md — a SELECT-then-write guard
 * is not a concurrency guard), so without it the loser would write a second
 * "accepted" and emit a second milestone notification; and a response can never
 * overwrite an answer that is already recorded.
 */
export function respondToInvitationQuery(
  actor: InvitationActor,
  invitationId: string,
  status: Extract<OrganizationInvitationStatus, "accepted" | "declined">
) {
  return db
    .update(organizationInvitations)
    .set({
      status,
      respondedBy: actor.id,
      respondedAt: new Date(),
    })
    .where(pendingInvitation(invitationId))
    .returning();
}

/**
 * The statement that revokes an invitation. Exported so a test can read the
 * bound parameters: the inviter in the WHERE clause is the SESSION's user, and
 * nothing a client sent can put another id there.
 */
export function revokeInvitationQuery(
  actor: InvitationActor,
  invitationId: string
) {
  return db
    .update(organizationInvitations)
    .set({ status: "revoked" })
    .where(
      and(
        pendingInvitation(invitationId),
        eq(organizationInvitations.inviterUserId, actor.id)
      )
    )
    .returning();
}

/**
 * Revoke a pending invitation. Only the original inviter can revoke, and the
 * inviter is the actor — the check is part of the UPDATE, so a non-inviter
 * matches no row and writes nothing.
 */
export async function revokeInvitationAs(
  actor: InvitationActor,
  invitationId: string
): Promise<OrganizationInvitation> {
  if (!isUuid(invitationId)) {
    throw new InvitationError("Invitation not found");
  }

  const [updated] = await revokeInvitationQuery(actor, invitationId);

  if (!updated) {
    throw new InvitationError(
      "Invitation not found, not pending, or you are not the inviter"
    );
  }

  return updated;
}

// ============================================================================
// Disassociation
// ============================================================================
//
// These three sever an association that an invitation created. They are
// primitives with no authority check of their own and NO action wrapper: the
// question "who may sever an association — the plant, the org, or either?" has
// not been ruled, and until it is, the safe answer is that no browser request
// can reach them at all. They used to be `"use server"` exports taking a bare
// id, which meant an anonymous POST could detach any church from its oversight
// by guessing a uuid.
//
// Wiring one up later means adding an action to `service.ts` that derives the
// entity from the session (as `setOversightSharingAction` does: whose plant it
// is must not be an argument), never re-exporting these.
//
// This is a KNOWN GAP awaiting a ruling, not a decision taken here:
// `memory/entrypoints.md` listed Disassociate as a user action, and with no
// wrapper a plant cannot leave an oversight org at all. It is also the repair
// path for a wrongly-created association — which is why `acceptInvitationAs`
// above must never be able to create one that was not accepted. Tracked
// in #274, alongside the other open question this unit raised: whether
// responding to an invitation is the planter's alone (see
// `verifyInvitationAuthority`).
// ============================================================================

/**
 * Remove a church plant's association with its sending church.
 * Sets `churches.sending_church_id` back to null.
 */
export async function disassociateChurchFromSendingChurch(
  churchId: string
): Promise<void> {
  await db
    .update(churches)
    .set({
      sendingChurchId: null,
      updatedAt: new Date(),
    })
    .where(eq(churches.id, churchId));
}

/**
 * Remove a church plant's direct association with a network.
 * Sets `churches.sending_network_id` back to null.
 */
export async function disassociateChurchFromNetwork(
  churchId: string
): Promise<void> {
  await db
    .update(churches)
    .set({
      sendingNetworkId: null,
      updatedAt: new Date(),
    })
    .where(eq(churches.id, churchId));
}

/**
 * Remove a sending church's association with a network.
 * Sets `sending_churches.sending_network_id` back to null.
 */
export async function disassociateSendingChurchFromNetwork(
  sendingChurchId: string
): Promise<void> {
  await db
    .update(sendingChurches)
    .set({
      sendingNetworkId: null,
      updatedAt: new Date(),
    })
    .where(eq(sendingChurches.id, sendingChurchId));
}

// ============================================================================
// Query Invitations
// ============================================================================
//
// Reads. They are here rather than in the action layer because a reader is
// never a mutation and one of them has to work with NO session at all:
// `hasValidInvitationBypass` (register/beta-gate.ts) checks an invitation id
// before an account exists. Callers that render invitations to a user are
// responsible for their own access check.
// ============================================================================

/**
 * Get a single invitation by ID.
 */
export async function getInvitation(
  id: string
): Promise<OrganizationInvitation | null> {
  if (!isUuid(id)) return null;

  const [invitation] = await db
    .select()
    .from(organizationInvitations)
    .where(eq(organizationInvitations.id, id))
    .limit(1);

  return invitation ?? null;
}

/**
 * Get pending invitations for a church plant (as target).
 */
export async function getPendingInvitationsForChurch(
  churchId: string
): Promise<OrganizationInvitation[]> {
  return db
    .select()
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.targetChurchId, churchId),
        eq(organizationInvitations.status, "pending")
      )
    )
    .orderBy(desc(organizationInvitations.createdAt));
}

/**
 * Get pending invitations for a sending church (as target).
 */
export async function getPendingInvitationsForSendingChurch(
  sendingChurchId: string
): Promise<OrganizationInvitation[]> {
  return db
    .select()
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.targetSendingChurchId, sendingChurchId),
        eq(organizationInvitations.status, "pending")
      )
    )
    .orderBy(desc(organizationInvitations.createdAt));
}

/**
 * Get all invitations sent by a user (for tracking sent invitations).
 */
export async function getInvitationsSentByUser(
  userId: string
): Promise<OrganizationInvitation[]> {
  return db
    .select()
    .from(organizationInvitations)
    .where(eq(organizationInvitations.inviterUserId, userId))
    .orderBy(desc(organizationInvitations.createdAt));
}

// ============================================================================
// Internal Helpers
// ============================================================================

/** `id = ? AND status = 'pending'` — the compare-and-set every write uses. */
function pendingInvitation(invitationId: string): SQL | undefined {
  return and(
    eq(organizationInvitations.id, invitationId),
    eq(organizationInvitations.status, "pending")
  );
}

/**
 * `EXISTS (SELECT 1 FROM organization_invitations WHERE id = ? AND status =
 * 'accepted')` — the predicate that ties the association write to the claim it
 * is batched with. Parameterized; nothing is interpolated.
 */
function claimedInvitation(invitationId: string): SQL {
  return exists(
    db
      .select({ id: organizationInvitations.id })
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.id, invitationId),
          eq(organizationInvitations.status, "accepted")
        )
      )
  );
}

/**
 * The statement that auto-expires an invitation whose window has closed.
 *
 * Exported so a test can read the bound parameters: the WHERE is the same
 * compare-and-set the responses use, so an expiry can never overwrite an answer
 * a concurrent request already recorded — two requests straddling the expiry
 * instant (a double-clicked Accept is enough) used to be able to stamp
 * `expired` over a committed `accepted` and its association. `expires_at < now`
 * is belt and braces: a row whose window was extended between the read and this
 * write is not expired either.
 */
export function expireInvitationQuery(invitationId: string, now: Date) {
  return db
    .update(organizationInvitations)
    .set({ status: "expired" })
    .where(
      and(
        pendingInvitation(invitationId),
        lt(organizationInvitations.expiresAt, now)
      )
    );
}

/**
 * Load an invitation the actor may respond to, auto-expiring it if its window
 * has closed. Throws an `InvitationError` otherwise.
 *
 * AUTHORITY FIRST, then status. The order is the security property, not a
 * style choice: these messages reach the client verbatim, so checking status
 * first turned any authenticated user with an invitation id into a reader of
 * "no such row" vs "already accepted/declined/revoked" vs "expired" vs "not
 * yours" — and invitation ids are not secrets held by the invitee alone, they
 * double as unauthenticated beta-gate bearer tokens (`hasValidInvitationBypass`
 * in `(auth)/register/beta-gate.ts`) and travel in registration links. Checking
 * status first also let any such caller TRIGGER the auto-expire write below
 * against an arbitrary invitation.
 *
 * A missing invitation answers `NOT_AUTHORIZED_MESSAGE` too — with no row there
 * is nothing to have authority over, and "not found" and "not yours" must be
 * indistinguishable for the same reason.
 */
async function loadRespondableInvitation(
  actor: InvitationActor,
  invitationId: string
): Promise<OrganizationInvitation> {
  const invitation = await getInvitation(invitationId);

  if (!invitation) {
    throw new InvitationError(NOT_AUTHORIZED_MESSAGE);
  }

  verifyInvitationAuthority(invitation, actor);

  if (invitation.status !== "pending") {
    throw new InvitationError(`Invitation is already ${invitation.status}`);
  }

  const now = new Date();
  if (invitation.expiresAt && invitation.expiresAt < now) {
    await expireInvitationQuery(invitationId, now);
    throw new InvitationError("Invitation has expired");
  }

  return invitation;
}

/**
 * The statement that creates the association, by setting the target entity's
 * FK — guarded on the invitation already reading `accepted`.
 *
 * Exported so a test can read the bound parameters: the WHERE carries the
 * `EXISTS ... status = 'accepted'` that makes this write impossible unless the
 * claim it is batched with won (see `acceptInvitationAs`). It builds a
 * statement rather than executing one for the same reason — the caller batches
 * it, so neither write can apply without the other.
 *
 * A row whose FK columns contradict its `type` throws here, before anything is
 * written.
 */
export function associationStatement(
  invitation: Pick<
    OrganizationInvitation,
    | "type"
    | "targetChurchId"
    | "targetSendingChurchId"
    | "sendingChurchId"
    | "sendingNetworkId"
  >,
  invitationId: string
) {
  const claimed = claimedInvitation(invitationId);

  switch (invitation.type) {
    case "church_to_sending_church": {
      if (!invitation.targetChurchId || !invitation.sendingChurchId) {
        throw new InvitationError(
          "Invalid invitation: missing church or sending church"
        );
      }
      return db
        .update(churches)
        .set({
          sendingChurchId: invitation.sendingChurchId,
          updatedAt: new Date(),
        })
        .where(and(eq(churches.id, invitation.targetChurchId), claimed));
    }

    case "church_to_network": {
      if (!invitation.targetChurchId || !invitation.sendingNetworkId) {
        throw new InvitationError(
          "Invalid invitation: missing church or network"
        );
      }
      return db
        .update(churches)
        .set({
          sendingNetworkId: invitation.sendingNetworkId,
          updatedAt: new Date(),
        })
        .where(and(eq(churches.id, invitation.targetChurchId), claimed));
    }

    case "sending_church_to_network": {
      if (!invitation.targetSendingChurchId || !invitation.sendingNetworkId) {
        throw new InvitationError(
          "Invalid invitation: missing sending church or network"
        );
      }
      return db
        .update(sendingChurches)
        .set({
          sendingNetworkId: invitation.sendingNetworkId,
          updatedAt: new Date(),
        })
        .where(
          and(eq(sendingChurches.id, invitation.targetSendingChurchId), claimed)
        );
    }

    default: {
      // Fail CLOSED on a `type` this switch does not know. The old switch fell
      // through and wrote nothing, which reads as safe but was not: silence
      // here is why an unknown type could still be marked `accepted` and still
      // announce a milestone. The `never` makes a fourth
      // `OrganizationInvitationType` a compile error rather than a silent arm.
      const unknownType: never = invitation.type;
      console.error("invitation type has no association rule", {
        invitationId,
        type: unknownType,
      });
      throw new InvitationError(NOT_AUTHORIZED_MESSAGE);
    }
  }
}

/**
 * Verify the actor has authority over the invitation's target entity.
 * - church_to_sending_church → actor must be planter for that church
 * - sending_church_to_network → actor must be admin of the target sending church
 * - church_to_network → actor must be planter for that church
 *
 * Pure, exported, and unit-tested: this is the check that stood between an
 * anonymous POST and a stranger's association, and it can only ever be handed
 * an actor minted from a session.
 *
 * It FAILS CLOSED on an unrecognised `type`. That matters because the column is
 * a bare `varchar(40)` with a TypeScript-only `$type<>` cast
 * (`src/db/schema/organization-invitation.ts`) and `insertInvitation` validates
 * nothing, so "the type is one of three literals" is a compile-time belief, not
 * a database fact: a switch with no `default:` returned normally — authority
 * GRANTED — for `"CHURCH_TO_NETWORK"`, `"church_to_sending_church "` or
 * anything else. Making the column a pg enum or adding a CHECK constraint would
 * remove the premise, but that is DDL and a separate unit (this one has an empty
 * schema delta on purpose); noted here rather than smuggled in.
 */
export function verifyInvitationAuthority(
  invitation: Pick<
    OrganizationInvitation,
    "type" | "targetChurchId" | "targetSendingChurchId"
  >,
  actor: InvitationActor
): void {
  switch (invitation.type) {
    case "church_to_sending_church":
    case "church_to_network": {
      // The target is a church — the actor must be the planter for that church.
      // The role check is new (#265): "belongs to the church" used to be enough,
      // so any team member could bind the plant to a sending church or network.
      // Joining an oversight org is a plant-level decision and the planter's to
      // make, the same rule `setOversightSharingAction` applies to what the
      // plant then shares. Narrowing it is behaviour no AC asked for, so it is
      // out for a ruling in #274 — as is the missing disassociation entrypoint.
      if (
        actor.role !== "planter" ||
        !actor.churchId ||
        actor.churchId !== invitation.targetChurchId
      ) {
        throw new InvitationError(NOT_AUTHORIZED_MESSAGE);
      }
      break;
    }
    case "sending_church_to_network": {
      // The target is a sending church — the actor must be admin of that
      // sending church
      if (
        actor.role !== "sending_church_admin" ||
        !actor.sendingChurchId ||
        actor.sendingChurchId !== invitation.targetSendingChurchId
      ) {
        throw new InvitationError(NOT_AUTHORIZED_MESSAGE);
      }
      break;
    }
    default: {
      // Unknown type → nobody has authority over it. The `never` assignment
      // makes adding a fourth `OrganizationInvitationType` a compile error, so a
      // new type cannot silently reach the granting path.
      const unknownType: never = invitation.type;
      console.error("invitation type has no authority rule", {
        type: unknownType,
      });
      throw new InvitationError(NOT_AUTHORIZED_MESSAGE);
    }
  }
}
