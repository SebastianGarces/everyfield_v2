import assert from "node:assert/strict";
import { test } from "node:test";

import { loginPathFor, safeRedirectPath } from "./safe-redirect";

// ----------------------------------------------------------------------------
// The open-redirect gate on the post-login `?redirect=` param.
//
// The server action is the only real gate — the hidden form field carries the
// raw URL param — so what this predicate refuses IS what the app refuses.
// ----------------------------------------------------------------------------

test("an in-app path is followed", () => {
  assert.equal(safeRedirectPath("/tasks"), "/tasks");
  assert.equal(
    safeRedirectPath("/dashboard?step=leadership"),
    "/dashboard?step=leadership"
  );
  assert.equal(safeRedirectPath("/"), "/");
});

test("a protocol-relative URL falls back — the classic phishing chain", () => {
  assert.equal(safeRedirectPath("//evil.com"), "/dashboard");
  assert.equal(safeRedirectPath("//evil.com/dashboard"), "/dashboard");
});

test("the backslash spelling browsers normalise to it falls back too", () => {
  assert.equal(safeRedirectPath("/\\evil.com"), "/dashboard");
});

test("the control-character spellings browsers strip before parsing fall back too", () => {
  // Browsers remove ASCII tab/newline BEFORE parsing, so `/\t/evil.com`
  // resolves protocol-relative: new URL("/\t/evil.com", base) is
  // https://evil.com/. Reachable as `?redirect=/%09/evil.com`.
  for (const control of ["\t", "\n", "\r"]) {
    assert.equal(
      safeRedirectPath(`/${control}/evil.com`),
      "/dashboard",
      JSON.stringify(control)
    );
  }
});

test("absolute URLs and garbage fall back", () => {
  for (const value of [
    "https://evil.com",
    "javascript:alert(1)",
    "evil.com",
    "",
    null,
    undefined,
    42,
    ["/tasks"],
  ]) {
    assert.equal(safeRedirectPath(value), "/dashboard", String(value));
  }
});

test("the fallback is a parameter, not a constant", () => {
  assert.equal(safeRedirectPath("//evil.com", "/wiki"), "/wiki");
  assert.equal(safeRedirectPath(undefined, "/wiki"), "/wiki");
});

// ----------------------------------------------------------------------------
// `loginPathFor` — the WRITE half of the same round trip (#503).
//
// The proxy and the `(dashboard)` layout both bounce signed-out readers, and
// before this they disagreed: the proxy wrote `?redirect=` with the pathname
// only, and the layout wrote nothing at all, so a deep link ended on the
// dashboard. One builder, one param name, sanitised at BOTH ends.
// ----------------------------------------------------------------------------

/** The destination a login URL will actually hand back to the login action. */
function returnPathOf(loginPath: string): string | null {
  return new URL(loginPath, "https://app.everyfield.test").searchParams.get(
    "redirect"
  );
}

test("the login URL carries the requested path AND its query", () => {
  assert.equal(
    loginPathFor("/settings?tab=billing"),
    "/login?redirect=%2Fsettings%3Ftab%3Dbilling"
  );
  // Encoded so the query belongs to the DESTINATION, not to /login: read back
  // through the same `searchParams` the login page uses, it is one value.
  assert.equal(
    returnPathOf(loginPathFor("/settings?tab=billing")),
    "/settings?tab=billing"
  );
  assert.equal(
    returnPathOf(loginPathFor("/wiki/a?q=b&c=d")),
    "/wiki/a?q=b&c=d"
  );
});

test("an off-site destination never even reaches the URL bar", () => {
  // The open-redirect guard, applied on the way OUT as well as on the way back.
  // A refused value collapses to the default destination — the reader still
  // reaches login, they just do not carry an attacker's URL through it.
  for (const attack of [
    "//evil.com",
    "//evil.com/settings",
    "/\\evil.com",
    "/\t/evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "evil.com",
  ]) {
    assert.equal(
      returnPathOf(loginPathFor(attack)),
      "/dashboard",
      `${JSON.stringify(attack)} survived into the login URL`
    );
  }
});

test("a missing return path is the default destination, not a broken URL", () => {
  // The layout's header is absent when the proxy did not run; `searchParams`
  // hands the page `undefined` when nothing set the param.
  for (const value of [null, undefined, ""]) {
    assert.equal(loginPathFor(value), "/login?redirect=%2Fdashboard");
  }
});

test("a fragment, if one ever arrived, is encoded into the param rather than truncating the login URL", () => {
  // Documented rather than fixed (#503 AC). A browser does not send the
  // fragment, so `/settings#notification-preferences` arrives at the proxy and
  // at the layout as `/settings` and there is nothing here to preserve. What
  // this asserts is only that a fragment, IF one were ever passed in, is
  // encoded into the param rather than truncating the login URL at `#`.
  assert.equal(
    returnPathOf(loginPathFor("/settings#notification-preferences")),
    "/settings#notification-preferences"
  );
});
