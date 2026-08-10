import { getInvitation, lookupInvitingOrgName } from "@/lib/invitations/core";

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
 * An invitation is addressed to ONE person, and the link is not a bearer token.
 *
 * RULED 2026-08-04 (#23): registration with an invitation token must use the
 * invited address. The token travels by email and is a uuid in a URL — it gets
 * forwarded, pasted into a group chat, sits in a mail archive — and before this
 * anyone holding one could register under ANY address and walk off with the
 * association (and, when the beta gate is on, with a free bypass of it). The
 * address is now part of the credential: this comparison is what the register
 * action and the beta-gate bypass both go through, and a mismatch is refused
 * with `invitationEmailMismatchMessage`. Wrong address = the admin revokes and
 * re-invites; there is deliberately no way to re-aim a live invitation.
 *
 * Both sides are normalized the way `users.email` is stored (trim + lowercase),
 * so casing or a stray space is a match, not a refusal.
 *
 * An invitation with NO recorded address (rows predating #23, when
 * `invitee_email` was added) matches NOTHING — there is nothing to bind the
 * link to, which is exactly the bearer token this ruling closes. Such a link no
 * longer registers anybody; the org re-invites.
 */
export function registrationEmailMatchesInvitation(
  invitationEmail: string | null | undefined,
  registeringEmail: string | null | undefined
): boolean {
  const invited = (invitationEmail ?? "").trim().toLowerCase();
  const registering = (registeringEmail ?? "").trim().toLowerCase();
  if (invited.length === 0 || registering.length === 0) return false;
  return invited === registering;
}

/** What a mismatch is told. Names the invited address — the link holder can already see it on this page. */
export function invitationEmailMismatchMessage(
  invitationEmail: string | null | undefined
): string {
  const invited = (invitationEmail ?? "").trim();
  return invited.length > 0
    ? `This invitation was sent to ${invited}. Register with that address, or ask them to invite this one instead.`
    : "This invitation link cannot be used to create an account. Ask your sending church or network to send a new one.";
}

/**
 * An org invitation IS an invite — invited planters/admins bypass the beta
 * code. Returns true when a non-empty, still-pending, unexpired org invitation
 * id is supplied AND the account being registered is the one it was addressed
 * to. Any invalid/expired/used/unknown id — or the right id with the wrong
 * address — falls through to the beta gate rather than granting access.
 *
 * The address is a parameter and not an afterthought: this bypass is the OTHER
 * thing an invitation token buys, so binding only the redemption would have
 * left the link a free pass into a private beta for whoever it was forwarded to.
 */
export async function hasValidInvitationBypass(
  invitationId: string | null,
  registeringEmail: string
): Promise<boolean> {
  if (!invitationId) return false;

  try {
    const invitation = await getInvitation(invitationId);
    if (!invitation) return false;
    if (invitation.status !== "pending") return false;
    if (invitation.expiresAt && invitation.expiresAt < new Date()) return false;
    return registrationEmailMatchesInvitation(
      invitation.inviteeEmail,
      registeringEmail
    );
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
  /**
   * The address the invitation was issued to. NOT nullable: since the
   * 2026-08-04 ruling the registering email must equal this one, so an
   * invitation with no recorded address describes nothing this page can offer
   * (see `describeInvitationForRegistration`).
   */
  inviteeEmail: string;
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
    // No recorded address, no invitation to describe: the 2026-08-04 ruling
    // binds this screen's email field to the invited one, and there is nothing
    // here to bind it to. Falls back to an ordinary sign-up, beta gate included.
    if (!invitation.inviteeEmail) return null;

    // ONE implementation, in the invitations domain — this file used to run its
    // own SQL against `sendingChurches` / `sendingNetworks`, which was both a
    // duplicated decision and an app route reaching past another domain's
    // exports. The copy took `type: string` and fell through to `null`, so it
    // would have gone on returning `null` for a fourth invitation type while
    // the original refused to compile. See `lookupInvitingOrgName`.
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
