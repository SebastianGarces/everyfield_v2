// ============================================================================
// The `?invitation=<id>` contract — ONE spelling, and now exactly ONE caller.
//
// The register link used to be a shared contract between three places that had
// nothing else in common: the email that carries it (`./email.ts`), the create
// action that returned it as the admin's copyable fallback, and a "Copy link"
// button on the pending list, which was a `"use client"` component.
//
// TWO OF THE THREE ARE GONE, and that is a ruling rather than a refactor. #304
// ruling 4 item 5 (2026-08-09, reinforced 2026-08-11, reconciled 2026-08-12)
// forbids ANY admin-facing surface rendering a `/register?invitation=` link:
// both target columns decide whether an invitation is open, so a link shown on
// the open rows only is an oracle for "does this address already hold an
// EveryField account". The admin's copy of the URL was called a stopgap for the
// email delivery that had not shipped, and #293 IS that delivery — so the
// stopgap was retired, not restored. `./email.ts` is the ONLY caller left, and
// the recovery for a refused send is **Resend email** on the row.
//
// NO IMPORTS, DELIBERATELY — the same rule `./create-notice.ts` follows, and for
// the same reason. These two functions used to live in `./email.ts`, which
// imports `@/lib/email/client`; that module evaluates `new Resend(...)` at
// module scope, so it is server-only by construction. A client component that
// imported the helper dragged the whole Resend SDK into its browser chunk, so
// in practice the client could not use it and hand-built the URL instead —
// which is exactly the drift the helper was written to prevent. Three spellings
// of one query key is how a rename ships half-applied and the copy that missed
// the fix is the one in the invitee's inbox. The leaf shape is kept even with
// one caller: it costs nothing, and it is what would let a future SERVER-side
// surface use the spelling without dragging the SDK along.
//
// So: keep this file a leaf. Anything needing `appBaseUrl()`, a database or a
// template belongs one layer up in `./email.ts`, which re-exports both names.
// `./register-path.test.ts` fails if an import appears here, pins the literal
// spelling against the one remaining call site, and — the item-5 half — fails
// if the create action, the create form or the pending list composes the URL
// again, by this helper or by hand.
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
