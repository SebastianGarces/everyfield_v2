import type { Metadata } from "next";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { VerifyEmailConfirm } from "@/components/settings/verify-email-confirm";
import { EMAIL_CHANGE_LINK_DEAD_MESSAGE } from "@/lib/auth/email-change";
import { verifySession } from "@/lib/auth/session";

// ============================================================================
// WHERE A CONFIRMATION LINK LANDS — CS-002 (#616).
//
// ----------------------------------------------------------------------------
// IT SITS UNDER `(dashboard)`, AND THAT IS THE WHOLE AUTH STORY
// ----------------------------------------------------------------------------
//
// Redeeming needs the token AND the session (`@/lib/auth/email-change`). The
// `(dashboard)` layout already bounces a signed-out reader to `/login` carrying
// the return path through `loginPathFor` — so a reader who opens the link in a
// mailbox on another device signs in and arrives back HERE with the token
// intact, and this page spells no redirect of its own. There are exactly two
// writers of that bounce and this is not a third (`memory/invariants.md` →
// Authentication).
//
// ----------------------------------------------------------------------------
// OPENING THE LINK DOES NOT COMPLETE THE CHANGE. PRESSING THE BUTTON DOES.
// ----------------------------------------------------------------------------
//
// The token is single-use, and a GET is not a promise that a human made it:
// mail clients, corporate link scanners and chat unfurlers all fetch URLs they
// find in a message. A page that redeemed on render would hand those scanners
// the account's only live confirmation link and leave the real reader looking
// at a dead one. So the page RENDERS the request and the redemption is a POST —
// the same reason the unsubscribe route confirms rather than acting on the GET.
//
// ----------------------------------------------------------------------------
// WHAT IT SHOWS BEFORE THE PRESS
// ----------------------------------------------------------------------------
//
// The address being confirmed, read from the session's own live request rather
// than from the token: this page is reached with a session, so it can name what
// the account asked for without the token telling it anything. A token that
// does not match is not diagnosed here at all — the action answers that, with
// the one sentence every dead link gets.
// ============================================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm your email address",
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  // The session, first — and the LAYOUT is what refuses a signed-out reader, so
  // this call is asking for the session already established rather than adding
  // a second gate (`session.test.ts` holds that property positively).
  const { user } = await verifySession();

  const { token } = await searchParams;
  // A repeated `?token=` arrives as an array. One value or nothing — a caller
  // who sent two is not holding one link.
  const candidate = typeof token === "string" ? token : "";

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Confirm your email address" }]} />
      <PageCanvas context="none" contentFocusTarget scrollLayout="flow">
        <WorkspacePanel className="mx-auto w-full max-w-xl p-4 sm:p-6">
          {candidate === "" ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md p-4 text-sm"
            >
              {EMAIL_CHANGE_LINK_DEAD_MESSAGE}
            </p>
          ) : (
            <VerifyEmailConfirm token={candidate} currentEmail={user.email} />
          )}
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
