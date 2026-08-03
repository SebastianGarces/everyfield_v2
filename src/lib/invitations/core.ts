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

import { and, desc, eq, type SQL } from "drizzle-orm";

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
 * Accept an invitation. Updates the target entity's FK to create the
 * association. The actor must have authority over the target entity.
 */
export async function acceptInvitationAs(
  actor: InvitationActor,
  invitationId: string
): Promise<OrganizationInvitation> {
  const invitation = await loadPendingInvitation(invitationId);

  // Authorization: the actor must have authority over the target entity
  verifyInvitationAuthority(invitation, actor);

  // Create the association based on invitation type
  await applyAssociation(invitation);

  // Mark invitation as accepted.
  const [updated] = await respondToInvitationQuery(
    actor,
    invitationId,
    "accepted"
  );

  if (!updated) {
    throw new InvitationError("This invitation is no longer pending");
  }

  // F11 N-025 — milestone #1, announced at its source.
  //
  // Last, and after the durable "accepted" marker, so a notification failure
  // cannot leave an invitation half-accepted (memory/invariants.md →
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
 *   * from the PLANT: `applyAssociation` below sets one of the plant's two
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
  const invitation = await loadPendingInvitation(invitationId);

  // Authorization: the actor must have authority over the target entity
  verifyInvitationAuthority(invitation, actor);

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

/** `id = ? AND status = 'pending'` — the compare-and-set both responses use. */
function pendingInvitation(invitationId: string): SQL | undefined {
  return and(
    eq(organizationInvitations.id, invitationId),
    eq(organizationInvitations.status, "pending")
  );
}

/**
 * Load an invitation that can still be responded to, auto-expiring it if its
 * window has closed. Throws an `InvitationError` otherwise.
 */
async function loadPendingInvitation(
  invitationId: string
): Promise<OrganizationInvitation> {
  const invitation = await getInvitation(invitationId);

  if (!invitation) {
    throw new InvitationError("Invitation not found");
  }

  if (invitation.status !== "pending") {
    throw new InvitationError(`Invitation is already ${invitation.status}`);
  }

  if (invitation.expiresAt && invitation.expiresAt < new Date()) {
    // Auto-expire
    await updateInvitationStatus(invitationId, "expired");
    throw new InvitationError("Invitation has expired");
  }

  return invitation;
}

/**
 * Apply the association by updating the target entity's FK.
 */
async function applyAssociation(
  invitation: OrganizationInvitation
): Promise<void> {
  switch (invitation.type) {
    case "church_to_sending_church": {
      if (!invitation.targetChurchId || !invitation.sendingChurchId) {
        throw new InvitationError(
          "Invalid invitation: missing church or sending church"
        );
      }
      await db
        .update(churches)
        .set({
          sendingChurchId: invitation.sendingChurchId,
          updatedAt: new Date(),
        })
        .where(eq(churches.id, invitation.targetChurchId));
      break;
    }

    case "church_to_network": {
      if (!invitation.targetChurchId || !invitation.sendingNetworkId) {
        throw new InvitationError(
          "Invalid invitation: missing church or network"
        );
      }
      await db
        .update(churches)
        .set({
          sendingNetworkId: invitation.sendingNetworkId,
          updatedAt: new Date(),
        })
        .where(eq(churches.id, invitation.targetChurchId));
      break;
    }

    case "sending_church_to_network": {
      if (!invitation.targetSendingChurchId || !invitation.sendingNetworkId) {
        throw new InvitationError(
          "Invalid invitation: missing sending church or network"
        );
      }
      await db
        .update(sendingChurches)
        .set({
          sendingNetworkId: invitation.sendingNetworkId,
          updatedAt: new Date(),
        })
        .where(eq(sendingChurches.id, invitation.targetSendingChurchId));
      break;
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
      // plant then shares.
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
  }
}

async function updateInvitationStatus(
  invitationId: string,
  status: OrganizationInvitationStatus
): Promise<void> {
  await db
    .update(organizationInvitations)
    .set({ status })
    .where(eq(organizationInvitations.id, invitationId));
}
