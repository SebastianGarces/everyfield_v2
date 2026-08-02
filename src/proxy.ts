import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "session";
const SESSION_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

// Routes that authenticated users should be redirected away from
const AUTH_ROUTES = ["/login", "/register"];

// Routes that require authentication
const PROTECTED_ROUTE_PREFIXES = ["/dashboard", "/wiki", "/oversight"];

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

// Social media and search engine crawler user agents
// These need access to pages for metadata/OG tag scraping
const CRAWLER_USER_AGENTS = [
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "telegrambot",
  "whatsapp",
  "applebot", // iMessage link previews
  "googlebot",
  "bingbot",
  "discordbot",
];

function isCrawler(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return CRAWLER_USER_AGENTS.some((crawler) => ua.includes(crawler));
}

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
    // Exception: Allow crawlers through for metadata/OG tag scraping
    if (!hasSessionCookie && isProtectedRoute(pathname)) {
      const userAgent = request.headers.get("user-agent") || "";
      if (!isCrawler(userAgent)) {
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("redirect", pathname);
        return NextResponse.redirect(loginUrl);
      }
      // Crawler detected - allow through and set header for layout to check
      const response = NextResponse.next();
      response.headers.set("x-is-crawler", "true");
      return response;
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
    const response = NextResponse.next();
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

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files and images
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
