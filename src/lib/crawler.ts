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

import { routedPathname } from "@/lib/routed-url";

/**
 * Social-media and search-engine crawlers that need pages for metadata/OG
 * scraping. A plain string is a substring test against the lowercased UA; a
 * RegExp is tested against it instead, for the one token a substring gets wrong.
 *
 * **WhatsApp sends two different User-Agents and only one of them is a crawler**
 * (tightened 2026-08-04, #297):
 *
 * - The **link-preview fetcher** — the thing that renders the card in a chat —
 *   sends the token AS the whole UA: `WhatsApp/2.23.20.0`, `WhatsApp/2.24.15.78 A`,
 *   `WhatsApp/2.18.61 i` (the trailing letter is A|I|N for Android/iOS/native).
 *   That is a bot, and it is the one this list wants.
 * - The **in-app browser** — a WebView with a HUMAN looking at it, opened by
 *   tapping a shared link inside WhatsApp — sends an ordinary browser UA that
 *   merely *mentions* WhatsApp somewhere after the `Mozilla/5.0` prefix, e.g.
 *   `Mozilla/5.0 (Linux; Android 14; …) … Mobile Safari/537.36 … WhatsApp/2.24…`.
 *   That is a person, and a bare `whatsapp` substring classified them as a bot.
 *
 * So the token is anchored at the START of the UA (`^whatsapp/<digit>`): the
 * fetcher's UA begins with it, the in-app browser's begins with `Mozilla/5.0`.
 * The anchor is what separates them — the version-slash alone appears in both.
 * An unrecognised WhatsApp variant therefore fails CLOSED and is treated as a
 * human: it gets the same `/login` redirect anyone else gets, which costs a
 * preview card at worst and never breaks a page for a real person.
 */
export const CRAWLER_USER_AGENTS = [
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "telegrambot",
  /^whatsapp\/\d/, // the link-preview fetcher ONLY — see above
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
  // Trimmed as well as lowercased: the anchored tokens above are anchored to the
  // first character of the UA, and a stray leading space is not a different client.
  const ua = userAgent.trim().toLowerCase();
  return CRAWLER_USER_AGENTS.some((crawler) =>
    typeof crawler === "string" ? ua.includes(crawler) : crawler.test(ua)
  );
}

/**
 * The ONLY routes a session-less crawler may see — the routes `src/proxy.ts`
 * admits it to, listed once so the proxy and the `(dashboard)` layout cannot
 * disagree about them (ruled 2026-08-04).
 *
 * Being on this list means: **this route produces a session-less render worth
 * previewing** (ruled 2026-08-09 on PR #354). That is two claims at once, and a
 * prefix earns its place only by making both. The page must render with no
 * session — a link previewer has nothing else to offer it — and that render must
 * be the page, not a redirect: admitting a crawler to a route that bounces it
 * anyway buys nothing, so listing such a route only widens the unauthenticated
 * surface for a card that never gets produced.
 *
 * Two prefixes have been removed for failing one claim each, and the pair is the
 * whole contract in worked form:
 *
 * - `/dashboard` failed the first (#297, ruled 2026-08-04). The page calls
 *   `verifySession()`, which THROWS with no session, so the listing made the
 *   exact promise the page could not keep and every crawler-UA request 500'd.
 * - `/oversight` failed the second (ruled 2026-08-09, PR #354). Every page under
 *   it reads the session and `redirect("/login")`s without one — graceful, not a
 *   500, but the crawler still ends at the login page. The allowance produced no
 *   card, so the prefix bought only exposure.
 *
 * Both remain PROTECTED by the proxy, named explicitly there rather than through
 * the spread of this list. Off this list they get the same 307 to /login a
 * session-less browser gets.
 *
 * Keep this a SUBSET of the proxy's `PROTECTED_ROUTE_PREFIXES` — a strict one:
 * the proxy's crawler branch is the only door into these routes without a
 * session, and `proxy.test.ts` pins that both halves — pass a crawler, bounce a
 * browser — still hold for every prefix here.
 */
export const CRAWLER_PREVIEWABLE_ROUTE_PREFIXES = ["/wiki"] as const;

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
 * Both sides hand it the URL the proxy routed — the proxy its own
 * `request.nextUrl`, the layout the `ROUTED_URL_HEADER` it stamped — and
 * `routedPathname` takes the route off the front, so neither caller has to know
 * that the value carries a query. Same fact from the same authority, so the two
 * cannot drift, and both fail CLOSED: an unknown UA, an absent header or an
 * unknown path is simply not a preview.
 */
export function isCrawlerPreviewRequest(
  userAgent: string | null | undefined,
  routedUrl: string | null | undefined
): boolean {
  return (
    isCrawlerUserAgent(userAgent) &&
    isCrawlerPreviewableRoute(routedPathname(routedUrl))
  );
}
