import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  CRAWLER_PREVIEWABLE_ROUTE_PREFIXES,
  isCrawlerPreviewRequest,
  PATHNAME_HEADER,
} from "@/lib/crawler";

const SESSION_COOKIE_NAME = "session";
const SESSION_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

// Routes that authenticated users should be redirected away from
const AUTH_ROUTES = ["/login", "/register"];

// Routes that require authentication.
//
// Spread rather than retyped: every crawler-previewable route MUST be protected,
// because the crawler branch below is the only door into one without a session.
// A protected route that is not crawler-previewable is fine — append it here and
// crawlers get bounced to /login on it like everybody else.
//
// `/dashboard` and `/oversight` are exactly that case, and both are named here
// EXPLICITLY so that leaving the previewable list never means leaving the
// protected one. `/dashboard` calls `verifySession()`, which throws with no
// session (#297); every `/oversight` page reads the session and redirects to
// /login without one (ruled 2026-08-09, PR #354). Neither produces a preview, so
// neither is previewable — but both are still protected, and a crawler on them
// gets the same 307 to /login a session-less browser gets.
const PROTECTED_ROUTE_PREFIXES: string[] = [
  "/dashboard",
  "/oversight",
  ...CRAWLER_PREVIEWABLE_ROUTE_PREFIXES,
];

// Routes that bypass the same-origin CSRF check because the request
// authenticates ITSELF and carries no ambient authority to abuse. Adding a path
// here is a security decision: it is only safe when the handler's authority
// comes entirely from something in the request that an attacker cannot forge.
const CSRF_EXEMPT_ROUTES = [
  // Resend verifies its own Svix signature.
  "/api/webhooks/resend",
  // RFC 8058 one-click unsubscribe. Mail clients POST here with no `Origin`
  // header BY SPEC, so the same-origin check below would 403 every one of them.
  // Safe because the handler reads no session and no cookie: the only thing
  // that authorises the write is the sealed, disable-only capability token in
  // the query string, which a cross-site attacker does not have — and the worst
  // a holder of one can do is stop one category of email for themselves.
  "/api/notifications/unsubscribe",
];

function isAuthRoute(pathname: string): boolean {
  return pathname === "/" || AUTH_ROUTES.includes(pathname);
}

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);

  /**
   * Continue to the app, stamping the routed pathname on the REQUEST headers.
   *
   * Every `NextResponse.next()` in this file goes through here, and that is the
   * point: the stamp is unconditional, so whatever `x-pathname` a client sent is
   * overwritten with the real path before any Server Component can read it. The
   * `(dashboard)` layout needs it to scope the crawler shell to the same routes
   * this proxy admits crawlers to (`isCrawlerPreviewRequest`), and a layout has
   * no other way to learn the pathname.
   */
  function proceed(): NextResponse {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(PATHNAME_HEADER, pathname);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // 1. Auth routing for GET requests
  if (request.method === "GET") {
    // Authenticated user on auth routes → redirect to dashboard (or redirect param)
    if (hasSessionCookie && isAuthRoute(pathname)) {
      const redirectTo =
        request.nextUrl.searchParams.get("redirect") || "/dashboard";
      // Prevent open redirect by ensuring redirectTo starts with /
      const safeRedirect = redirectTo.startsWith("/")
        ? redirectTo
        : "/dashboard";
      return NextResponse.redirect(new URL(safeRedirect, request.url));
    }

    // Unauthenticated user on protected routes → redirect to login
    // Exception: Allow crawlers through for metadata/OG tag scraping, but ONLY
    // on the routes that render without a session (ruled 2026-08-04). The
    // allowance is one predicate over `user-agent` + pathname, defined in
    // `src/lib/crawler.ts` and called by the dashboard layout too, so what this
    // proxy admits and what that layout renders a bare shell for cannot drift.
    if (!hasSessionCookie && isProtectedRoute(pathname)) {
      if (
        !isCrawlerPreviewRequest(request.headers.get("user-agent"), pathname)
      ) {
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("redirect", pathname);
        return NextResponse.redirect(loginUrl);
      }
      // Crawler detected on a previewable route — let it through for the
      // metadata. The verdict is deliberately NOT handed downstream: the old
      // `x-is-crawler` went on the RESPONSE, which a Server Component never
      // reads, so the layout's copy of it could only ever have been forged by a
      // client (#240). The layout re-derives the same answer from the same two
      // inputs instead — the request's `user-agent`, and the pathname this
      // proxy stamps on the request in `proceed()`.
      return proceed();
    }
  }

  // 2. CSRF protection for non-GET requests (skip for self-authenticating ones)
  if (request.method !== "GET" && !CSRF_EXEMPT_ROUTES.includes(pathname)) {
    const originHeader = request.headers.get("Origin");
    const hostHeader = request.headers.get("Host");

    if (!originHeader || !hostHeader) {
      return new NextResponse(null, { status: 403 });
    }

    try {
      const origin = new URL(originHeader);
      if (origin.host !== hostHeader) {
        return new NextResponse(null, { status: 403 });
      }
    } catch {
      return new NextResponse(null, { status: 403 });
    }
  }

  // 3. Extend session cookie on GET requests only
  // We only extend on GET because we can't detect if a server action set a new cookie
  if (request.method === "GET") {
    const response = proceed();
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;

    if (token !== null) {
      response.cookies.set(SESSION_COOKIE_NAME, token, {
        path: "/",
        maxAge: SESSION_EXPIRY_SECONDS,
        sameSite: "lax",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
      });
    }

    return response;
  }

  return proceed();
}

export const config = {
  matcher: [
    // Match all paths except static files and images
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
