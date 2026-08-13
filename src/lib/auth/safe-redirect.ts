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
