import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  sendingChurches,
  sendingNetworks,
  type OrganizationInvitation,
} from "@/db/schema";
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
 * EVERY INVITATION THIS TYPE DESCRIBES IS OPEN (#304 round 10, ruled
 * 2026-08-11). A targeted invitation — one whose invitee already had an account
 * when it was issued — is answered from `/settings/association` and is now
 * `null` here, so there is no `redeemable` flag left to carry: a value that is
 * constant true is not a field, it is a sentence in a comment.
 *
 * `accountType` SURVIVES, and only because of that null-return. It is read off
 * `invitation.type`, and `type` is target-derived in general
 * (`resolveInvitationRequest` picks the kind from the RESOLVED target and falls
 * back to the admin's `inviteAs` only when there is no target) — which is why
 * the round-10 ruling offered to delete it. On a row with NO target the
 * fallback is the only branch that can have run, so what this field carries is
 * the inviting admin's own form selection and nothing about the invitee. The
 * two alternatives the ruling named both break a live path: an open
 * `sending_church_to_network` invitation registers a SENDING CHURCH, and a
 * constant `"planter"` (or no field at all) would ask that invitee to name a
 * church plant and leave `redeemRegistrationInvitation` with nothing to bind.
 * See `memory/invariants.md` → Multi-Tenancy for the rule this rests on: if a
 * targeted invitation ever becomes describable again, this field goes with it.
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
};

/**
 * The two reads `describeInvitationForRegistration` performs, as a seam.
 *
 * Not a testing convenience: the rule below is a NULL-RETURN, and the two
 * previous attempts at rules of this shape were both guarded by regexes over
 * the page that passed while the property was false (`memory/invariants.md` →
 * Multi-Tenancy). A regex cannot follow a derivation; only calling the function
 * can. The function reads the database, so the only way a unit test calls the
 * real one is to hand it the two reads.
 */
export type RegistrationInvitationReader = {
  loadInvitation: (id: string) => Promise<InvitationForRegistration | null>;
  lookupInvitingOrgName: (
    invitation: InvitationForRegistration
  ) => Promise<string | null>;
};

/** The columns this screen's decision is made from — a subset, so a test can build one. */
export type InvitationForRegistration = Pick<
  OrganizationInvitation,
  | "id"
  | "type"
  | "status"
  | "expiresAt"
  | "inviteeEmail"
  | "targetChurchId"
  | "targetSendingChurchId"
  | "sendingChurchId"
  | "sendingNetworkId"
>;

/** The real reads. The default, and the only one any shipped caller uses. */
export const registrationInvitationReader: RegistrationInvitationReader = {
  loadInvitation: getInvitation,
  lookupInvitingOrgName,
};

/**
 * Describe an invitation for the register screen. Returns `null` for anything
 * a visitor should not be told about — unknown, answered, revoked, expired —
 * so a guessed uuid learns nothing beyond "no invitation here", the same
 * silence `hasValidInvitationBypass` gives it.
 *
 * Runs with NO session, by construction: there is no account yet.
 *
 * ----------------------------------------------------------------------------
 * A TARGETED INVITATION IS INDESCRIBABLE HERE (#304 round 10, RULED 2026-08-11)
 * ----------------------------------------------------------------------------
 *
 * Ruling 4 item 5 closed the account-existence oracle on `/oversight/invitations`
 * — no branching notice, no `isOpen`, no caption, no register link. It left the
 * same question answerable one route over, and this diff is what armed it:
 * #304 revives targeting, so `redeemable` and `accountType` stopped being
 * constants and started varying with `target_church_id` /
 * `target_sending_church_id`. The attack needs no session and no error. An
 * oversight admin types any address, reads the deliberately neutral success
 * notice, takes the new row's id — which is in their own DOM by design, because
 * Revoke needs it — and opens `/register?invitation=<id>` in a private window.
 * A redeeming form means the address has no EveryField account; anything else
 * means it has one.
 *
 * So the boundary is not "no admin surface renders the link". It is this
 * function's own answer: a row with either target column set is `null`, beside
 * the unknown/answered/expired/addressless nulls, and a targeted token, an
 * answered one and a guessed uuid all render the identical page.
 *
 * NOTHING IS LOST. A targeted invitee already has an account, cannot register
 * again, and answers from `/settings/association`. The beta bypass is untouched:
 * `hasValidInvitationBypass` reads `getInvitation` itself and independently
 * requires `registrationEmailMatchesInvitation`. The email-mismatch guard in
 * `register/actions.ts` stops firing for targeted rows, which is correct — such
 * a registration already dies on "user already exists".
 *
 * PINNED BY CALLING THIS FUNCTION, never by a regex over the page — see
 * `RegistrationInvitationReader` above and `invitations-ui.test.ts` §9c.
 */
export async function describeInvitationForRegistration(
  invitationId: string | null,
  reader: RegistrationInvitationReader = registrationInvitationReader
): Promise<RegistrationInvitation | null> {
  if (!invitationId) return null;

  try {
    const invitation = await reader.loadInvitation(invitationId);
    if (!invitation) return null;
    if (invitation.status !== "pending") return null;
    if (invitation.expiresAt && invitation.expiresAt < new Date()) return null;
    // No recorded address, no invitation to describe: the 2026-08-04 ruling
    // binds this screen's email field to the invited one, and there is nothing
    // here to bind it to. Falls back to an ordinary sign-up, beta gate included.
    if (!invitation.inviteeEmail) return null;
    // THE TARGET NULL-RETURN. Both columns, checked here rather than at the
    // return, so no field computed below can ever see a targeted row.
    if (
      invitation.targetChurchId !== null ||
      invitation.targetSendingChurchId !== null
    ) {
      return null;
    }

    const invitingOrgName = await reader.lookupInvitingOrgName(invitation);
    if (!invitingOrgName) return null;

    return {
      id: invitation.id,
      inviteeEmail: invitation.inviteeEmail,
      invitingOrgName,
      accountType:
        invitation.type === "sending_church_to_network"
          ? "sending_church"
          : "planter",
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
