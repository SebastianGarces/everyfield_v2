import assert from "node:assert/strict";
import { test } from "node:test";

import { safeRedirectPath } from "./safe-redirect";

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
