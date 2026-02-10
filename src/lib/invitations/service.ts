"use server";

import { db } from "@/db";
import {
  churches,
  organizationInvitations,
  sendingChurches,
  type NewOrganizationInvitation,
  type OrganizationInvitation,
  type User,
} from "@/db/schema";
import type {
  OrganizationInvitationStatus,
  OrganizationInvitationType,
} from "@/db/schema/organization-invitation";
import { and, desc, eq } from "drizzle-orm";

// ============================================================================
// Constants
// ============================================================================

/** Default invitation expiry: 30 days */
const INVITATION_EXPIRY_DAYS = 30;

// ============================================================================
// Create Invitations
// ============================================================================

export interface CreateInvitationInput {
  type: OrganizationInvitationType;
  inviterUserId: string;
  targetChurchId?: string;
  targetSendingChurchId?: string;
  sendingChurchId?: string;
  sendingNetworkId?: string;
  expiresInDays?: number;
}

/**
 * Create a new organization invitation.
 *
 * Types:
 * - `church_to_sending_church`: Sending church invites a church plant
 * - `sending_church_to_network`: Network invites a sending church
 * - `church_to_network`: Network invites a church plant directly
 */
export async function createInvitation(
  input: CreateInvitationInput
): Promise<OrganizationInvitation> {
  const expiresAt = new Date(
    Date.now() +
      (input.expiresInDays ?? INVITATION_EXPIRY_DAYS) * 24 * 60 * 60 * 1000
  );

  const values: NewOrganizationInvitation = {
    type: input.type,
    inviterUserId: input.inviterUserId,
    targetChurchId: input.targetChurchId ?? null,
    targetSendingChurchId: input.targetSendingChurchId ?? null,
    sendingChurchId: input.sendingChurchId ?? null,
    sendingNetworkId: input.sendingNetworkId ?? null,
    status: "pending",
    expiresAt,
  };

  const [invitation] = await db
    .insert(organizationInvitations)
    .values(values)
    .returning();

  return invitation;
}

// ============================================================================
// Respond to Invitations
// ============================================================================

/**
 * Accept an invitation. Updates the target entity's FK to create the association.
 * The responding user must be an admin of the target entity.
 */
export async function acceptInvitation(
  invitationId: string,
  respondingUser: User
): Promise<OrganizationInvitation> {
  const invitation = await getInvitation(invitationId);

  if (!invitation) {
    throw new Error("Invitation not found");
  }

  if (invitation.status !== "pending") {
    throw new Error(`Invitation is already ${invitation.status}`);
  }

  if (invitation.expiresAt && invitation.expiresAt < new Date()) {
    // Auto-expire
    await updateInvitationStatus(invitationId, "expired");
    throw new Error("Invitation has expired");
  }

  // Authorization: verify the responding user has authority over the target entity
  verifyInvitationAuthority(invitation, respondingUser);

  // Create the association based on invitation type
  await applyAssociation(invitation);

  // Mark invitation as accepted
  const [updated] = await db
    .update(organizationInvitations)
    .set({
      status: "accepted",
      respondedBy: respondingUser.id,
      respondedAt: new Date(),
    })
    .where(eq(organizationInvitations.id, invitationId))
    .returning();

  return updated;
}

/**
 * Decline an invitation.
 * The responding user must be an admin of the target entity.
 */
export async function declineInvitation(
  invitationId: string,
  respondingUser: User
): Promise<OrganizationInvitation> {
  const invitation = await getInvitation(invitationId);

  if (!invitation) {
    throw new Error("Invitation not found");
  }

  if (invitation.status !== "pending") {
    throw new Error(`Invitation is already ${invitation.status}`);
  }

  // Authorization: verify the responding user has authority over the target entity
  verifyInvitationAuthority(invitation, respondingUser);

  const [updated] = await db
    .update(organizationInvitations)
    .set({
      status: "declined",
      respondedBy: respondingUser.id,
      respondedAt: new Date(),
    })
    .where(eq(organizationInvitations.id, invitationId))
    .returning();

  return updated;
}

/**
 * Revoke a pending invitation (by the inviter).
 * Only the original inviter can revoke.
 */
export async function revokeInvitation(
  invitationId: string,
  revokingUserId: string
): Promise<OrganizationInvitation> {
  const [updated] = await db
    .update(organizationInvitations)
    .set({ status: "revoked" })
    .where(
      and(
        eq(organizationInvitations.id, invitationId),
        eq(organizationInvitations.status, "pending"),
        eq(organizationInvitations.inviterUserId, revokingUserId)
      )
    )
    .returning();

  if (!updated) {
    throw new Error(
      "Invitation not found, not pending, or you are not the inviter"
    );
  }

  return updated;
}

// ============================================================================
// Disassociation
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

/**
 * Get a single invitation by ID.
 */
export async function getInvitation(
  id: string
): Promise<OrganizationInvitation | null> {
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

/**
 * Apply the association by updating the target entity's FK.
 */
async function applyAssociation(
  invitation: OrganizationInvitation
): Promise<void> {
  switch (invitation.type) {
    case "church_to_sending_church": {
      if (!invitation.targetChurchId || !invitation.sendingChurchId) {
        throw new Error("Invalid invitation: missing church or sending church");
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
        throw new Error("Invalid invitation: missing church or network");
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
        throw new Error(
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
 * Verify the responding user has authority over the invitation's target entity.
 * - church_to_sending_church → user must be planter for that church
 * - sending_church_to_network → user must be admin of the target sending church
 * - church_to_network → user must be planter for that church
 */
function verifyInvitationAuthority(
  invitation: OrganizationInvitation,
  user: User
): void {
  switch (invitation.type) {
    case "church_to_sending_church":
    case "church_to_network": {
      // The target is a church — user must be the planter for that church
      if (
        !user.churchId ||
        user.churchId !== invitation.targetChurchId
      ) {
        throw new Error("You are not authorized to respond to this invitation");
      }
      break;
    }
    case "sending_church_to_network": {
      // The target is a sending church — user must be admin of that sending church
      if (
        user.role !== "sending_church_admin" ||
        !user.sendingChurchId ||
        user.sendingChurchId !== invitation.targetSendingChurchId
      ) {
        throw new Error("You are not authorized to respond to this invitation");
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
