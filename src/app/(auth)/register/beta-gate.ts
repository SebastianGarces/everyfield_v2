import { getInvitation } from "@/lib/invitations/service";

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
