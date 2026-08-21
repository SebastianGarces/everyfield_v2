import { describeUserInvitationForRegistration } from "@/lib/invitations/seat";

import { RegisterForm } from "./register-form";
import {
  describeInvitationForRegistration,
  isBetaGateEnabled,
} from "./beta-gate";

/**
 * Register page (server component).
 *
 * Resolves the private-beta gate flag server-side and hands ONLY a boolean to
 * the client form — the `BETA_INVITE_CODE` value never leaves the server.
 *
 * It also picks the invitation token out of the URL (#23). `register/actions.ts`
 * has always read an `invitationId` field, but nothing rendered one, so
 * invite-at-registration was unreachable: the beta-gate bypass never fired and
 * an invited planter arrived unassociated. The token travels
 * `?invitation=<id>` → this page → a hidden field → the action, and the page
 * looks it up so the form can say WHO invited them instead of asking them to
 * trust an opaque link.
 *
 * TWO KINDS OF TOKEN SHARE THAT ONE PARAMETER since #495: an ORGANIZATION
 * invitation's uuid, and a SEAT invitation's random token. One spelling on
 * purpose — `invitationRegisterPath` is the single definition of the link, so
 * the two emails, the guard test and this page cannot drift onto three query
 * keys. They cannot collide either: the seat lookup is a point read on a sha256
 * of the parameter, which a uuid never matches, and the org lookup takes only a
 * uuid. Whichever resolves, the other is null.
 *
 * `searchParams` is async — App Router dynamic API (`.next-docs` →
 * async-patterns).
 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string | string[] }>;
}) {
  const { invitation } = await searchParams;
  // A repeated query parameter arrives as an array; take the first and let the
  // lookup reject anything malformed.
  const token = Array.isArray(invitation) ? invitation[0] : invitation;

  const seatInvite = await describeUserInvitationForRegistration(token ?? null);
  const invite = seatInvite
    ? null
    : await describeInvitationForRegistration(token ?? null);

  return (
    <RegisterForm
      betaGateEnabled={isBetaGateEnabled()}
      invitation={invite}
      seatInvitation={
        seatInvite
          ? {
              // The raw parameter, which the browser already holds in its own
              // URL — never re-derived, and the row's own token is not stored
              // anywhere it could be read from.
              token: token ?? "",
              inviteeEmail: seatInvite.inviteeEmail,
              orgName: seatInvite.tenancyName,
              orgType: seatInvite.tenancy.type,
              invitedAs: seatInvite.invitedAs,
            }
          : null
      }
    />
  );
}
