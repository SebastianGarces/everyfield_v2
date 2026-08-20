import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { SRC, codeOf } from "@/lib/auth/server-action-surface";

// ============================================================================
// The already-signed-in bounce lives on the login PAGE, not in the proxy (#503).
//
// It moved because the proxy could only ask the session COOKIE, and a cookie
// that exists but no longer verifies is exactly the reader the `(dashboard)`
// layout sends to `/login`. Bouncing that reader back off the cookie closed a
// loop they could not escape: ERR_TOO_MANY_REDIRECTS, with the form that would
// have fixed it on the other side of it. `src/proxy.test.ts` pins the edge half
// — `/login` is a dead end for the redirect chain. This pins the half that
// replaced it, because deleting the page's check would restore the old
// behaviour for signed-in readers with nothing failing.
//
// It is a SOURCE assertion, and that is the honest description of its reach: a
// Server Component that awaits a database-backed session cannot be invoked from
// a unit test, so what is checkable here is that the page still asks the live
// session and still redirects through the sanitised value. `codeOf` strips
// comments first, so a paragraph promising this — including the one above —
// cannot satisfy it.
// ============================================================================

const LOGIN_PAGE = path.join(SRC, "app", "(auth)", "login", "page.tsx");

test("the login page asks the SESSION, not the cookie", () => {
  const code = codeOf(LOGIN_PAGE);

  assert.match(
    code,
    /getCurrentSession\s*\(\s*\)/,
    "the login page no longer reads the live session — a stale cookie is indistinguishable from a live one without it, which is the bug that put this check here"
  );
});

test("a signed-in reader is redirected to the SANITISED destination", () => {
  const code = codeOf(LOGIN_PAGE);

  // The gate runs on the way out as well as back: `redirectTo` is what
  // `safeRedirectPath` returned, never the raw param.
  assert.match(
    code,
    /redirectTo\s*=\s*safeRedirectPath\s*\(/,
    "the login page stopped sanitising the incoming param"
  );
  assert.match(
    code,
    /if\s*\(\s*user\s*\)\s*\{?\s*redirect\s*\(\s*redirectTo\s*\)/,
    "the signed-in bounce is gone from the login page — the proxy cannot take it back, because it only sees the cookie (#503)"
  );
});
