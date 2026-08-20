/**
 * What the proxy tells the app about the URL it routed — the header, and the
 * one way to read a route out of it.
 *
 * This is the whole channel from `src/proxy.ts` to any Server Component:
 * `NextResponse.next({ request: { headers } })`. It lives in its own module
 * because two unrelated readers depend on it — the crawler scope in
 * `@/lib/crawler` and the signed-out bounce in the `(dashboard)` layout — and
 * neither is about the other. Owning the header inside `crawler.ts` made the
 * bounce import "crawler" to learn where it was.
 *
 * The value is the RELATIVE URL, path AND query. Both halves are needed and
 * neither is available any other way: a layout is never handed `searchParams`,
 * and `/settings?tab=billing` without its query is a different destination to
 * come back to. A reader that wants the route asks `routedPathname` rather than
 * taking a second header.
 *
 * The stamp is UNCONDITIONAL, which is the only reason it may be trusted: the
 * proxy sets it on every continuation, so a client-supplied value is always
 * overwritten with the real URL before the app sees it (#240). Absence means
 * the proxy did not run, and every reader must fail closed on that rather than
 * guess.
 */
export const ROUTED_URL_HEADER = "x-routed-url";

/**
 * The route half of a routed URL: everything before the query or fragment.
 *
 * Returns `null` for an absent value so the caller fails closed on a header
 * that is not there, rather than treating "no proxy ran" as a path.
 */
export function routedPathname(
  routedUrl: string | null | undefined
): string | null {
  if (!routedUrl) return null;
  return routedUrl.split(/[?#]/, 1)[0];
}
