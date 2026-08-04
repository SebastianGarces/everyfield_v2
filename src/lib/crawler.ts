/**
 * Crawler detection — the ONE place the app decides "this request is a link
 * previewer / search bot", shared by `src/proxy.ts` and the dashboard layout.
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
