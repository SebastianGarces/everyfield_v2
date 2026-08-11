/**
 * The post-login redirect target, sanitised — the ONE predicate deciding
 * whether a `?redirect=` value may be followed after authentication.
 *
 * `startsWith("/")` alone is not the check it looks like: `//evil.com` starts
 * with `/` and is a PROTOCOL-RELATIVE URL, so `redirect("//evil.com")` sends a
 * freshly authenticated user off-site — the classic login-page phishing chain
 * (`https://<app>/login?redirect=//evil.com`). Browsers also normalise
 * backslashes, so `/\evil.com` is the same hole spelled differently. Both are
 * refused here, and every consumer of the param — `login`, `devLoginAs`, and
 * the login page that threads it into the form — calls this instead of
 * hand-rolling the ternary, so the fix cannot drift out of one copy.
 */
export function safeRedirectPath(
  value: unknown,
  fallback = "/dashboard"
): string {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
