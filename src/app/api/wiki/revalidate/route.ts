// ============================================================================
// On-demand wiki cache revalidation.
//
// Security: a shared `REVALIDATION_SECRET`, presented in the request BODY (this
// endpoint is driven by content tooling, not by a browser session). The
// comparison is CONSTANT-TIME (#310): `!==` returns at the first differing byte,
// which is the same timing oracle #266 removed from the two cron routes, and the
// fix is the same shared helper rather than a second copy of the reasoning —
// see `src/lib/security/constant-time.ts` for why a plain length guard in front
// of `timingSafeEqual` is an oracle too.
//
// The guard lives in ONE exported function that both handlers call, so POST and
// DELETE cannot drift apart the way two inline copies of the check could.
// ============================================================================

import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { constantTimeEquals } from "@/lib/security/constant-time";
import { wikiHref } from "@/lib/wiki/href";

/**
 * True when the request body carries the configured `REVALIDATION_SECRET`.
 *
 * Fails closed on an unset secret, exactly as the inline check did: an
 * unconfigured deployment authorises nobody rather than everybody. A missing or
 * empty `secret` field is refused before any comparison — the absence of a field
 * is a fact about the REQUEST, so returning early on it leaks nothing about the
 * secret. Everything past that point is compared in constant time.
 */
export function isAuthorized(presented: string | undefined): boolean {
  const secret = process.env.REVALIDATION_SECRET;
  if (!secret) return false;
  if (!presented) return false;

  return constantTimeEquals(presented, secret);
}

/**
 * The only effect these handlers have, injectable so the route's own behaviour
 * can be asserted without a request scope.
 *
 * `revalidatePath` reads Next's static generation store and throws outside a
 * real request, so a bare unit test calling a handler would land in the catch
 * below and prove a 500 instead of the success path. Production always gets
 * `NEXT_REVALIDATION`: the exported HTTP handlers take one argument, so the seam
 * is unreachable from outside (Next passes a route context as the second
 * argument, which must never be mistaken for deps).
 */
export interface RevalidationDeps {
  revalidatePath: (path: string, type?: "layout" | "page") => void;
}

const NEXT_REVALIDATION: RevalidationDeps = { revalidatePath };

/**
 * On-demand revalidation endpoint for wiki articles
 *
 * Usage:
 * POST /api/wiki/revalidate
 * Body: { "slug": "discovery/defining-your-church-values", "secret": "your-secret" }
 *
 * This will revalidate the specific article page and the wiki index.
 */
export async function revalidateArticle(
  request: NextRequest,
  deps: RevalidationDeps = NEXT_REVALIDATION
) {
  try {
    const body = await request.json();
    const { slug, secret } = body as { slug?: string; secret?: string };

    // Verify secret token for security — constant-time (#310).
    if (!isAuthorized(secret)) {
      return NextResponse.json(
        { error: "Invalid or missing secret" },
        { status: 401 }
      );
    }

    if (!slug) {
      return NextResponse.json(
        { error: "Missing slug parameter" },
        { status: 400 }
      );
    }

    // Revalidate the specific article path
    deps.revalidatePath(wikiHref(slug));

    // Also revalidate the wiki index page (navigation might have changed)
    deps.revalidatePath("/wiki");

    return NextResponse.json({
      revalidated: true,
      slug,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Revalidation error:", error);
    return NextResponse.json(
      { error: "Failed to revalidate" },
      { status: 500 }
    );
  }
}

/**
 * Revalidate all wiki pages (use sparingly)
 *
 * Usage:
 * DELETE /api/wiki/revalidate
 * Body: { "secret": "your-secret" }
 */
export async function revalidateAll(
  request: NextRequest,
  deps: RevalidationDeps = NEXT_REVALIDATION
) {
  try {
    const body = await request.json();
    const { secret } = body as { secret?: string };

    // Verify secret token for security — constant-time (#310).
    if (!isAuthorized(secret)) {
      return NextResponse.json(
        { error: "Invalid or missing secret" },
        { status: 401 }
      );
    }

    // Revalidate all wiki pages via the layout
    deps.revalidatePath("/wiki", "layout");

    return NextResponse.json({
      revalidated: true,
      scope: "all",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Revalidation error:", error);
    return NextResponse.json(
      { error: "Failed to revalidate" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return revalidateArticle(request);
}

export async function DELETE(request: NextRequest) {
  return revalidateAll(request);
}
