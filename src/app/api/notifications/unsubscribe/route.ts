import { NextResponse, type NextRequest } from "next/server";

import { UNSUBSCRIBE_CONFIRMATION_PATH } from "@/lib/notifications/channels/email";
import { applyEmailOptOut } from "@/lib/notifications/channels/unsubscribe";

// ============================================================================
// The unauthenticated opt-out endpoint (N-007). One URL, two methods.
//
// ----------------------------------------------------------------------------
// GET NEVER MUTATES (ruled 2026-08-01)
// ----------------------------------------------------------------------------
//
// The first cut of this route wrote on GET, on the theory that a mail client
// follows links and a form is friction on a flow where friction is a compliance
// smell. The theory ignored who else follows links: corporate mail security
// scanners — Defender Safe Links, Proofpoint, Barracuda — fetch every URL in a
// delivered message. A recipient behind one of those was opted out without ever
// seeing the page, which also meant the one-click undo that bounds the damage
// never reached them. What they experienced was "the product silently stopped
// emailing me".
//
// So GET does one thing: 303 to the confirmation page. It is deliberately
// SYNCHRONOUS and touches no module that can write — there is no `await` in it
// at all, which is a stronger statement than a comment about intent, and the
// test asserts exactly that. Everything a prefetch, a HEAD (Next derives it from
// GET), a scanner or a retry can do to this endpoint is render a page.
//
// ----------------------------------------------------------------------------
// POST is the mutation, and RFC 8058 is why it is on this URL
// ----------------------------------------------------------------------------
//
// Moving the write off GET would normally cost real mail clients their native
// one-click control. RFC 8058 is the standard answer: `List-Unsubscribe` names
// this URL, `List-Unsubscribe-Post: List-Unsubscribe=One-Click` promises that
// POSTing to it opts out, and Gmail and Apple Mail then do exactly that. A
// scanner does not, because scanners fetch — they do not submit.
//
// That POST is cross-origin with no `Origin` header, so `src/proxy.ts` exempts
// this path from its CSRF check. The exemption is safe because the request
// carries no ambient authority to abuse: there is no session and no cookie
// involved, and the ONLY thing that authorises the write is the sealed token,
// which an attacker who could forge a cross-site POST still does not have.
//
// The route deliberately does almost nothing else. It reads one query
// parameter, hands it to `applyEmailOptOut` — which owns verification, scope
// and the write — and answers. In particular it NEVER reads a user id, a
// category, a channel or a DIRECTION from the request; all four come from the
// token, and the token can only ever disable.
// ============================================================================

export const dynamic = "force-dynamic";

function confirmationUrl(request: NextRequest, token: string | null): URL {
  const destination = new URL(UNSUBSCRIBE_CONFIRMATION_PATH, request.nextUrl);
  if (token) destination.searchParams.set("token", token);
  return destination;
}

/**
 * Render, never write.
 *
 * Not `async`, and that is load-bearing rather than stylistic: a handler that
 * cannot await cannot have performed a database round trip, so "GET changes
 * nothing" is checkable by reading the signature.
 *
 * The token is passed straight through unverified — the page verifies it and
 * renders the same refusal card for every bad token. Verifying here would only
 * move the decision, and a refusal that travelled in the URL would be an
 * account oracle.
 */
export function GET(request: NextRequest): NextResponse {
  const token = request.nextUrl.searchParams.get("token");
  return NextResponse.redirect(confirmationUrl(request, token), 303);
}

/**
 * RFC 8058 one-click.
 *
 * The body a compliant client sends is exactly `List-Unsubscribe=One-Click`.
 * It is read for the log and NOT used as a gate: the token is what authorises
 * the write, and refusing a client whose body is a byte off would turn a
 * working opt-out into a spam complaint. Reading it also drains the request,
 * which some runtimes prefer.
 *
 * The answer is a bare 200 with no redirect: the caller is a mail client, not a
 * browser, and RFC 8058 asks only that the request succeed.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token") ?? "";

  let oneClick = false;
  try {
    const body = await request.text();
    oneClick =
      new URLSearchParams(body).get("List-Unsubscribe") === "One-Click";
  } catch {
    // A body that cannot be read is not a reason to refuse a valid token.
  }

  const result = await applyEmailOptOut(token);

  if (result.status !== "ok") {
    console.warn(
      `[notifications/unsubscribe] refused a token on POST: ${result.reason}`
    );
    // Still 200. A mail client that gets a 4xx may retry, may surface an error
    // to the reader, or may stop offering the control — and none of those help
    // someone holding a token we were never going to honour. The refusal is a
    // log line, not a status code.
    return new NextResponse(null, { status: 200 });
  }

  console.info(
    `[notifications/unsubscribe] opted out via ${oneClick ? "RFC 8058 one-click" : "POST"}`
  );
  return new NextResponse(null, { status: 200 });
}
