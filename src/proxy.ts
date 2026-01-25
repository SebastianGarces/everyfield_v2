import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "session";
const SESSION_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

export function proxy(request: NextRequest): NextResponse {
  // 1. CSRF protection for non-GET requests
  if (request.method !== "GET") {
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

  // 2. Extend session cookie on GET requests only
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
