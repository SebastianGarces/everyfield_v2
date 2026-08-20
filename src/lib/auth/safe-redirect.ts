/**
 * The post-login redirect target, sanitised — the ONE predicate deciding
 * whether a `?redirect=` value may be followed after authentication.
 *
 * `startsWith("/")` alone is not the check it looks like: `//evil.com` starts
 * with `/` and is a PROTOCOL-RELATIVE URL, so `redirect("//evil.com")` sends a
 * freshly authenticated user off-site — the classic login-page phishing chain
 * (`https://<app>/login?redirect=//evil.com`). Browsers also normalise
 * backslashes, so `/\evil.com` is the same hole spelled differently. And
 * browsers STRIP ASCII tab/newline before parsing, so `/<TAB>/evil.com` is
 * protocol-relative by the time it is resolved — reachable as
 * `?redirect=/%09/evil.com`, which `searchParams` decodes to a literal tab —
 * so any control character is refused outright rather than enumerated. All
 * three spellings are refused here, and every consumer of the param — `login`,
 * `devLoginAs`, the login page that threads it into the form, and the proxy's
 * authenticated-on-/login bounce (`src/proxy.ts`) — calls this instead of
 * hand-rolling the ternary, so the fix cannot drift out of one copy.
 *
 * This is the READ half of the `?redirect=` round trip; `loginPathFor` below is
 * the WRITE half, and both live here so the param has one name and one gate.
 */
export function safeRedirectPath(
  value: unknown,
  fallback = "/dashboard"
): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;
  // eslint-disable-next-line no-control-regex -- the control characters ARE the attack
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}

/**
 * Where to send a signed-out request: `/login`, carrying the URL it asked for
 * so signing in lands the reader THERE and not on the default dashboard (#503).
 *
 * The two places that bounce a signed-out reader — the proxy's protected-route
 * branch and the `(dashboard)` layout, which catches the routes the proxy does
 * not protect and any session that fails to verify — both call this. That is
 * the point of it existing: one function writes the param, one function
 * (`safeRedirectPath`) reads it, and the param has ONE name at both ends. A
 * second name for the same round trip is how a destination gets dropped.
 *
 * `returnTo` is sanitised HERE as well as on the way back, so a hostile value
 * never even appears in the URL bar of the login page. An unsafe or missing one
 * collapses to the default destination rather than refusing the bounce; the
 * reader still reaches login, just without a detour.
 *
 * `returnTo` is a RELATIVE URL — path and query. A fragment is not in it and
 * cannot be: browsers never send one to the server, so `/settings#preferences`
 * arrives here as `/settings`. Preserving a fragment is a client-side job.
 */
export function loginPathFor(returnTo: unknown): string {
  return `/login?redirect=${encodeURIComponent(safeRedirectPath(returnTo))}`;
}
