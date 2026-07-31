import { NextResponse, type NextRequest } from "next/server";

import { UNSUBSCRIBE_CONFIRMATION_PATH } from "@/lib/notifications/channels/email";
import { applyEmailUnsubscribe } from "@/lib/notifications/channels/unsubscribe";

// ============================================================================
// The unauthenticated opt-out (N-007).
//
// A GET that mutates, which is normally a smell — here it is the requirement.
// An unsubscribe link has to work from a mail client, and a mail client
// follows links; a form the reader has to submit is exactly the friction that
// turns an opt-out into a spam complaint. What makes it safe is that the
// capability is sealed in the token and nothing else: there is no ambient
// authority to abuse (no session, no cookie), so a prefetched or scanned link
// does no more than the reader asked for, and the confirmation page it lands on
// undoes it in one click.
//
// The route deliberately does almost nothing. It reads one query parameter,
// hands it to `applyEmailUnsubscribe` — which owns verification, scope and the
// write — and redirects. In particular it NEVER reads a user id, a category or
// a channel from the request; all three come out of the token.
//
// The redirect is 303 See Other: the browser lands on the confirmation page
// with a GET, so a refresh re-reads state instead of re-applying the mutation.
// ============================================================================

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const result = await applyEmailUnsubscribe(token, false);

  const destination = new URL(UNSUBSCRIBE_CONFIRMATION_PATH, request.nextUrl);

  if (result.status === "ok") {
    // The confirmation page needs the token to name the category and address
    // and to offer the undo. It is the same capability the reader already
    // holds, so passing it on grants nothing new.
    destination.searchParams.set("token", token);
  } else {
    // Nothing about the refusal travels in the URL. The page says the same
    // thing for a forged token as for an expired one — see
    // `UnsubscribeTokenRejection`.
    console.warn(
      `[notifications/unsubscribe] refused a token: ${result.reason}`
    );
  }

  return NextResponse.redirect(destination, 303);
}
