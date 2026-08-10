// ============================================================================
// The `?invitation=<id>` contract — ONE spelling, reachable from every surface.
//
// The register link is a shared contract between three places that have nothing
// else in common: the email that carries it (`./email.ts`), the create action
// that returns it as the admin's copyable fallback, and the "Copy link" button
// on the pending list, which is a `"use client"` component.
//
// NO IMPORTS, DELIBERATELY — the same rule `./create-notice.ts` follows, and for
// the same reason. These two functions used to live in `./email.ts`, which
// imports `@/lib/email/client`; that module evaluates `new Resend(...)` at
// module scope, so it is server-only by construction. A client component that
// imported the helper dragged the whole Resend SDK into its browser chunk, so
// in practice the client could not use it and hand-built the URL instead —
// which is exactly the drift the helper was written to prevent. Three spellings
// of one query key is how a rename ships half-applied and the copy that missed
// the fix is the one in the invitee's inbox.
//
// So: keep this file a leaf. Anything needing `appBaseUrl()`, a database or a
// template belongs one layer up in `./email.ts`, which re-exports both names.
// `./register-path.test.ts` fails if an import appears here, and pins the
// literal spelling against all three call sites.
// ============================================================================

/**
 * The register route an invitation link points at. One spelling, shared by the
 * email and by anything else that has to build the same URL, so the query key
 * cannot drift from the one `register/page.tsx` reads.
 */
export const INVITATION_REGISTER_PATH = "/register";

/** `/register?invitation=<id>` — the path half, for a surface that already knows its own origin. */
export function invitationRegisterPath(invitationId: string): string {
  return `${INVITATION_REGISTER_PATH}?invitation=${encodeURIComponent(invitationId)}`;
}
