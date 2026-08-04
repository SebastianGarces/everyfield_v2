"use server";

import { db } from "@/db";
import type { UserRole } from "@/db/schema";
import {
  churchPrivacySettings,
  churches,
  sendingChurches,
  sendingNetworks,
  users,
} from "@/db/schema";
import {
  createSession,
  generateSessionToken,
  hashPassword,
  setSessionCookie,
} from "@/lib/auth";
import {
  checkRateLimit,
  getRequestIp,
  recordAttempt,
} from "@/lib/auth/rate-limit";
import {
  acceptInvitationAs,
  bindOpenInvitationTarget,
  invitationActorFromSession,
} from "@/lib/invitations/core";
import { extractFieldErrors, registerSchema } from "@/lib/validations";
import type { AccountType } from "@/lib/validations/auth";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  BETA_GATE_ERROR,
  BETA_GATE_INVALID_ERROR,
  describeInvitationForRegistration,
  hasValidInvitationBypass,
  isBetaCodeValid,
  isBetaGateEnabled,
  type RegistrationInvitation,
} from "./beta-gate";

export type RegisterState = {
  error?: string;
  fieldErrors?: {
    email?: string;
    password?: string;
    name?: string;
    organizationName?: string;
  };
};

export async function register(
  _prevState: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const result = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name"),
    accountType: formData.get("accountType") || "planter",
    organizationName: formData.get("organizationName") || undefined,
  });

  if (!result.success) {
    return {
      fieldErrors: extractFieldErrors<
        NonNullable<RegisterState["fieldErrors"]>
      >(result.error),
    };
  }

  const { email, password, name, accountType, organizationName } = result.data;
  const identifier = email.toLowerCase();
  const ip = await getRequestIp();

  // Rate-limit check BEFORE any account lookup/creation. Limited by IP.
  // Generic message avoids leaking whether the account exists.
  const { limited } = await checkRateLimit(identifier, ip, "register");
  if (limited) {
    return { error: "Too many attempts. Please try again later." };
  }

  // The invitation token, read from the field the form now renders (#23). It
  // was already read here before that — the form simply never sent it, so
  // invite-at-registration was unreachable and an invited planter arrived
  // unassociated. It is re-validated server-side, never trusted from the URL,
  // and looked up AFTER the rate limit so a guessed uuid cannot be probed for
  // free (an invitation id doubles as the beta-gate bypass token).
  const invitationId = (formData.get("invitationId") as string | null) || null;
  const invitation = await describeInvitationForRegistration(invitationId);

  // Private-beta gate (server-side enforced). Skipped entirely when the env
  // var is unset/empty. Org-invitation signups (the invitation IS the invite)
  // bypass the code. Validated regardless of client-side visibility.
  if (isBetaGateEnabled()) {
    const bypassed = await hasValidInvitationBypass(invitationId);

    if (!bypassed) {
      const submittedCode = formData.get("inviteCode") as string | null;
      if (!isBetaCodeValid(submittedCode)) {
        // Distinguish a wrong code from a missing one so the user knows whether
        // to fix what they typed or go ask for a code.
        const hasSubmittedCode = (submittedCode ?? "").trim().length > 0;
        return {
          error: hasSubmittedCode ? BETA_GATE_INVALID_ERROR : BETA_GATE_ERROR,
        };
      }
    }
  }

  // Check if user already exists
  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, identifier))
    .limit(1);

  if (existingUser.length > 0) {
    await recordAttempt(identifier, ip, "register", false);
    return { error: "An account with this email already exists" };
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // An invited planter is the ONE case where a planter's church is created at
  // signup: the invitation is what the church gets associated with, and there
  // is nothing to associate until the church exists. So the name is required
  // here even though it is optional for a cold planter signup.
  const redeeming = invitation?.redeemable ? invitation : null;
  const invitedPlanter =
    redeeming?.accountType === "planter" && accountType === "planter";

  if (invitedPlanter && !organizationName) {
    return {
      fieldErrors: {
        organizationName: "Please name your church plant",
      },
    };
  }

  // Create entity + user based on account type
  // Planters sign up without a church — they create one later from the dashboard
  const { role, churchId, sendingChurchId, sendingNetworkId } =
    await createAccountEntities(
      accountType,
      organizationName ?? null,
      invitedPlanter
    );

  const [user] = await db
    .insert(users)
    .values({
      email: email.toLowerCase(),
      passwordHash,
      name,
      role,
      churchId,
      sendingChurchId,
      sendingNetworkId,
    })
    .returning();

  // Create default privacy settings for church plants
  if (churchId) {
    await db.insert(churchPrivacySettings).values({
      churchId,
      updatedBy: user.id,
    });
  }

  // Redeem the invitation now that the organization it associates exists.
  // Best-effort: a failure here leaves an account that registered fine and an
  // invitation still pending, which the planter can answer later — the one
  // thing it must never leave behind is an association without an accepted
  // invitation (memory/invariants.md → Multi-Tenancy).
  if (redeeming) {
    await redeemRegistrationInvitation(redeeming, {
      id: user.id,
      role,
      churchId,
      sendingChurchId,
      sendingNetworkId,
    });
  }

  // Create session
  const token = generateSessionToken();
  const session = await createSession(token, user.id);

  // Set session cookie
  await setSessionCookie(token, session.expiresAt);

  // Record the successful attempt (recorded before redirect, which throws).
  await recordAttempt(identifier, ip, "register", true);

  redirect("/dashboard");
}

/**
 * Create the appropriate organizational entity based on account type.
 * Returns the role and FK values to set on the user.
 *
 * Planters sign up without creating a church — they get free access to
 * Phase 0 content and the Wiki. They create their church from the dashboard
 * when they're ready.
 */
async function createAccountEntities(
  accountType: AccountType,
  organizationName: string | null,
  createChurchForPlanter = false
): Promise<{
  role: UserRole;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
}> {
  switch (accountType) {
    case "planter": {
      // An INVITED planter is the exception: the invitation exists to associate
      // a church plant, so the plant is created here and named by the planter.
      // Note what is NOT set — neither oversight FK. The association is written
      // by the accept path, guarded on the invitation reading `accepted`, so
      // the plant can never be bound to an org without an acceptance behind it.
      if (createChurchForPlanter && organizationName) {
        const [church] = await db
          .insert(churches)
          .values({ name: organizationName })
          .returning();

        return {
          role: "planter",
          churchId: church.id,
          sendingChurchId: null,
          sendingNetworkId: null,
        };
      }

      // No church created at signup — planter gets free Phase 0 / Wiki access
      // They'll create a church from the dashboard when ready
      return {
        role: "planter",
        churchId: null,
        sendingChurchId: null,
        sendingNetworkId: null,
      };
    }

    case "sending_church": {
      if (!organizationName) {
        throw new Error(
          "Organization name is required for sending church accounts"
        );
      }
      // Create a new sending church (independent, no network)
      const [sendingChurch] = await db
        .insert(sendingChurches)
        .values({ name: organizationName })
        .returning();

      return {
        role: "sending_church_admin",
        churchId: null,
        sendingChurchId: sendingChurch.id,
        sendingNetworkId: null,
      };
    }

    case "network": {
      if (!organizationName) {
        throw new Error("Organization name is required for network accounts");
      }
      // Create a new sending network
      const [network] = await db
        .insert(sendingNetworks)
        .values({ name: organizationName })
        .returning();

      return {
        role: "network_admin",
        churchId: null,
        sendingChurchId: null,
        sendingNetworkId: network.id,
      };
    }
  }
}

/**
 * Turn a redeemed invite link into a real association (#23 / OV-003).
 *
 * TWO WRITES, IN THIS ORDER, and the order is the whole design:
 *
 *   1. `bindOpenInvitationTarget` — point the invitation at the organization
 *      that was just created. It is a compare-and-set (`pending`, unexpired,
 *      NO target yet), which is what makes an invite link SINGLE USE: of two
 *      registrations racing one link, exactly one binds and the loser simply
 *      registers unassociated. It deliberately leaves `status` alone.
 *   2. `acceptInvitationAs` — the ordinary accept path, unchanged: it locks the
 *      target row, compare-and-sets the claim, and writes the association in
 *      one `db.batch`, gated on the invitation reading `accepted`.
 *
 * Splitting it this way is what keeps `memory/invariants.md` → Multi-Tenancy
 * true through a crash. After step 1 the row is `pending` with a target and
 * nothing is bound — a state the planter can finish answering later — rather
 * than an acceptance with no association behind it, which is the one state
 * nothing in the product can repair. Doing it the other way round (claim first,
 * then create the church) would produce exactly that.
 *
 * The actor is minted from the user row this request just INSERTed, which is
 * the same person the session cookie is about to be issued to — not a value
 * that arrived from a client. `verifyInvitationAuthority` then holds normally:
 * the actor is the planter of the church the invitation now targets.
 *
 * Never throws. An invitation that cannot be redeemed must not cost somebody
 * their account.
 */
async function redeemRegistrationInvitation(
  invitation: RegistrationInvitation,
  user: {
    id: string;
    role: UserRole;
    churchId: string | null;
    sendingChurchId: string | null;
    sendingNetworkId: string | null;
  }
): Promise<void> {
  const target =
    invitation.accountType === "planter"
      ? user.churchId
        ? { targetChurchId: user.churchId }
        : null
      : user.sendingChurchId
        ? { targetSendingChurchId: user.sendingChurchId }
        : null;

  // The account type they registered as does not match what the invitation
  // creates (they switched the radio group). Nothing to bind; the invitation
  // stays pending for whoever it was meant for.
  if (!target) return;

  try {
    const bound = await bindOpenInvitationTarget(
      invitation.id,
      target,
      user.id
    );
    if (!bound) return;

    await acceptInvitationAs(invitationActorFromSession({ user }), bound.id);
  } catch (error) {
    console.error("redeeming a registration invitation failed", {
      invitationId: invitation.id,
      error,
    });
  }
}
