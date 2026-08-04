import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sendingChurches, sendingNetworks } from "@/db/schema";
import { getInvitation } from "@/lib/invitations/core";

/**
 * Private-beta gate helpers (server-side only).
 *
 * When `BETA_INVITE_CODE` is set (non-empty), cold sign-ups must supply a
 * matching code. When it is unset/empty, registration is fully open
 * (dev-friendly). The code value is NEVER sent to the client — the register
 * page only learns a boolean (`isBetaGateEnabled`) telling it whether to
 * render the input. This module is imported exclusively by the server-side
 * register action and the server-component register page; the client form
 * receives only the boolean flag.
 */

export const BETA_GATE_ERROR =
  "EveryField is in private beta - ask your sending church or network for an invite code.";

export const BETA_GATE_INVALID_ERROR =
  "That invite code isn't valid - double-check it with your sending church or network.";

function getBetaInviteCode(): string {
  return (process.env.BETA_INVITE_CODE ?? "").trim();
}

/** True when the private-beta gate is active. */
export function isBetaGateEnabled(): boolean {
  return getBetaInviteCode().length > 0;
}

/**
 * Validate a submitted beta code against `BETA_INVITE_CODE`
 * (case-insensitive, trimmed). Always false when gating is disabled callers
 * should gate on `isBetaGateEnabled()` first.
 */
export function isBetaCodeValid(submitted: string | null | undefined): boolean {
  const expected = getBetaInviteCode();
  if (expected.length === 0) return true;
  return (submitted ?? "").trim().toLowerCase() === expected.toLowerCase();
}

/**
 * An org invitation IS an invite — invited planters/admins bypass the beta
 * code. Returns true when a non-empty, still-pending, unexpired org invitation
 * id is supplied. Any invalid/expired/used/unknown id falls through to the
 * beta gate rather than granting access.
 */
export async function hasValidInvitationBypass(
  invitationId: string | null
): Promise<boolean> {
  if (!invitationId) return false;

  try {
    const invitation = await getInvitation(invitationId);
    if (!invitation) return false;
    if (invitation.status !== "pending") return false;
    if (invitation.expiresAt && invitation.expiresAt < new Date()) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * What the register page needs to know about an invitation token (#23).
 *
 * `redeemable` is the important field. Only an OPEN invitation — one with no
 * target row, because the invitee had no account when it was issued — can be
 * turned into an association BY REGISTERING: the organization is created here
 * and bound to the inviter's org in the same request. A TARGETED invitation
 * belongs to somebody who already has an account and is answered from it, so
 * the link still bypasses the beta gate but creates nothing on its own.
 */
export type RegistrationInvitation = {
  id: string;
  inviteeEmail: string | null;
  invitingOrgName: string;
  /** The account type this invitation creates when redeemed. */
  accountType: "planter" | "sending_church";
  redeemable: boolean;
};

/**
 * Describe an invitation for the register screen. Returns `null` for anything
 * a visitor should not be told about — unknown, answered, revoked, expired —
 * so a guessed uuid learns nothing beyond "no invitation here", the same
 * silence `hasValidInvitationBypass` gives it.
 *
 * Runs with NO session, by construction: there is no account yet.
 */
export async function describeInvitationForRegistration(
  invitationId: string | null
): Promise<RegistrationInvitation | null> {
  if (!invitationId) return null;

  try {
    const invitation = await getInvitation(invitationId);
    if (!invitation) return null;
    if (invitation.status !== "pending") return null;
    if (invitation.expiresAt && invitation.expiresAt < new Date()) return null;

    const invitingOrgName = await lookupInvitingOrgName(invitation);
    if (!invitingOrgName) return null;

    return {
      id: invitation.id,
      inviteeEmail: invitation.inviteeEmail,
      invitingOrgName,
      accountType:
        invitation.type === "sending_church_to_network"
          ? "sending_church"
          : "planter",
      redeemable:
        invitation.targetChurchId === null &&
        invitation.targetSendingChurchId === null,
    };
  } catch {
    return null;
  }
}

/**
 * The inviting org's name, derived from `type` rather than from whichever FK
 * column happens to be set — the same rule `announceInvitationAcceptedForChurch`
 * follows, and for the same reason: `insertInvitation` performs no type↔id
 * consistency check, so a row can carry a stray id and naming the wrong org
 * would tell the invitee they were invited by somebody who never invited them.
 */
async function lookupInvitingOrgName(invitation: {
  type: string;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
}): Promise<string | null> {
  if (invitation.type === "church_to_sending_church") {
    if (!invitation.sendingChurchId) return null;
    const [org] = await db
      .select({ name: sendingChurches.name })
      .from(sendingChurches)
      .where(eq(sendingChurches.id, invitation.sendingChurchId))
      .limit(1);
    return org?.name ?? null;
  }

  if (
    invitation.type === "church_to_network" ||
    invitation.type === "sending_church_to_network"
  ) {
    if (!invitation.sendingNetworkId) return null;
    const [org] = await db
      .select({ name: sendingNetworks.name })
      .from(sendingNetworks)
      .where(eq(sendingNetworks.id, invitation.sendingNetworkId))
      .limit(1);
    return org?.name ?? null;
  }

  return null;
}
