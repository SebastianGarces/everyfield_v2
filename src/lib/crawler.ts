/**
 * Crawler detection — the ONE place the app decides "this request is a link
 * previewer / search bot" AND "this is a route where that buys anything",
 * shared by `src/proxy.ts` and the dashboard layout.
 *
 * It lives here because the two of them have to agree, and because of how they
 * used to disagree (#240). The proxy let an unauthenticated crawler past the
 * login redirect and then did `response.headers.set("x-is-crawler", "true")` —
 * a header on the RESPONSE, which the layout downstream never sees. The layout
 * read `x-is-crawler` off the REQUEST, so the only way that branch ever fired
 * was a client sending the header itself. Trusting a request header no part of
 * the app writes is a trap even when it is unexploitable, so the signal is now
 * derived where each side stands: both call this predicate on the request's own
 * `user-agent`, and nothing reads or writes `x-is-crawler` at all.
 *
 * The User-Agent is client-controlled too — that is unchanged and inherent:
 * the proxy's crawler allowance has always been a User-Agent allowance, and
 * the layout matching it adds no trust the proxy did not already extend. What
 * a forged UA buys is the unauthenticated shell around pages that already
 * render without a session (wiki articles, for their OpenGraph tags); it is
 * not a session and it grants no per-user data. Anything that must not leak
 * belongs behind `getCurrentSession()` in the page, not behind this check.
 */

/** Social-media and search-engine crawlers that need pages for metadata/OG scraping. */
export const CRAWLER_USER_AGENTS = [
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
] as const;

/**
 * True when the request's own `user-agent` names a known crawler.
 *
 * Takes the raw header value — `null`/`undefined`/empty (no UA sent) is not a
 * crawler — so callers can hand it straight from `headers().get("user-agent")`
 * or `request.headers.get("user-agent")` without normalising first.
 */
export function isCrawlerUserAgent(
  userAgent: string | null | undefined
): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return CRAWLER_USER_AGENTS.some((crawler) => ua.includes(crawler));
}

/**
 * The ONLY routes a session-less crawler may see — the routes `src/proxy.ts`
 * admits it to, listed once so the proxy and the `(dashboard)` layout cannot
 * disagree about them (ruled 2026-08-04).
 *
 * Being on this list is a claim about the PAGE: that it renders without a
 * session, because that is what a link previewer needs and all it may have.
 * Every other route under `(dashboard)` calls `verifySession()` (or equivalent)
 * and would throw with no session — a 500 where a human gets a clean redirect
 * to /login. So a route that is not listed here bounces crawlers exactly like
 * it bounces anyone else, and adding one is a deliberate act that says "this
 * page is safe and sane to render with no user".
 *
 * Keep this a SUBSET of the proxy's `PROTECTED_ROUTE_PREFIXES`: the proxy's
 * crawler branch is the only door into these routes without a session, and
 * `proxy.test.ts` pins that both halves — pass a crawler, bounce a browser —
 * still hold for every prefix here.
 */
export const CRAWLER_PREVIEWABLE_ROUTE_PREFIXES = [
  "/dashboard",
  "/wiki",
  "/oversight",
] as const;

/**
 * The header the proxy stamps on the REQUEST with the pathname it routed, so a
 * Server Component can scope a decision by route.
 *
 * A Server Component has no other way to learn the pathname — hence the one
 * documented channel from proxy to app: `NextResponse.next({ request: { headers } })`.
 * This is not the trap #240 removed. The distinction is who writes it: the
 * proxy sets this on EVERY continuation, so a client-supplied `x-pathname` is
 * always overwritten with the real path before the app sees it, and its absence
 * means the proxy did not run — which every reader must treat as "not
 * previewable" rather than guessing. It also carries a fact (which path), never
 * a verdict (whether to trust this request); the verdict is re-derived on both
 * sides from the same inputs by `isCrawlerPreviewRequest` below.
 */
export const PATHNAME_HEADER = "x-pathname";

/** True when `pathname` is one the proxy admits session-less crawlers to. */
export function isCrawlerPreviewableRoute(
  pathname: string | null | undefined
): boolean {
  if (!pathname) return false;
  return CRAWLER_PREVIEWABLE_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * The whole crawler allowance, in one predicate both sides call: a known
 * crawler, on a route we admit session-less crawlers to.
 *
 * The proxy calls it with `request.nextUrl.pathname`; the layout calls it with
 * the `PATHNAME_HEADER` the proxy stamped. Both are the same fact from the same
 * authority, so the two cannot drift — and both fail CLOSED, because an unknown
 * UA or an unknown path is simply not a preview.
 */
export function isCrawlerPreviewRequest(
  userAgent: string | null | undefined,
  pathname: string | null | undefined
): boolean {
  return isCrawlerUserAgent(userAgent) && isCrawlerPreviewableRoute(pathname);
}
