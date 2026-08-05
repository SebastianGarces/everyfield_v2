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
  const invitationId = Array.isArray(invitation) ? invitation[0] : invitation;

  const invite = await describeInvitationForRegistration(invitationId ?? null);

  return (
    <RegisterForm betaGateEnabled={isBetaGateEnabled()} invitation={invite} />
  );
}
