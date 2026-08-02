import assert from "node:assert/strict";
import { test } from "node:test";

import { NextRequest } from "next/server";

import { proxy } from "./proxy";

// ============================================================================
// The CSRF exemption list.
//
// `proxy` refuses every non-GET request that is not same-origin, which is the
// blanket protection every Server Action in the app relies on. Two paths are
// exempt, and an exemption is a security decision — so it gets a test rather
// than a comment. What makes each one safe is that the request carries NO
// ambient authority: no session, no cookie is read, and the handler's whole
// authority comes from something in the request an attacker cannot forge.
//
// The unsubscribe entry is what makes RFC 8058 one-click possible at all: mail
// clients POST with no `Origin` header by spec (ruled 2026-08-01).
// ============================================================================

const BASE = "https://app.everyfield.test";

function post(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    new Request(`${BASE}${path}`, { method: "POST", headers })
  );
}

test("an originless POST to the unsubscribe endpoint is allowed through", () => {
  // Exactly the request Gmail and Apple Mail make: no Origin, no cookie.
  const response = proxy(post("/api/notifications/unsubscribe"));
  assert.notEqual(
    response.status,
    403,
    "RFC 8058 one-click is being rejected as CSRF"
  );
});

test("the resend webhook keeps its exemption", () => {
  assert.notEqual(proxy(post("/api/webhooks/resend")).status, 403);
});

test("every other originless POST is still refused", () => {
  for (const path of [
    "/settings",
    "/api/notifications/dispatch",
    // Neither a prefix nor a suffix of an exempt path opens the door — the
    // check is an exact match, and these prove it.
    "/api/notifications/unsubscribe/extra",
    "/api/notifications",
  ]) {
    assert.equal(
      proxy(post(path)).status,
      403,
      `${path} is not CSRF-protected`
    );
  }
});

test("a cross-origin POST to a protected path is refused", () => {
  const response = proxy(
    post("/settings", {
      Origin: "https://evil.test",
      Host: "app.everyfield.test",
    })
  );
  assert.equal(response.status, 403);
});

test("a same-origin POST to a protected path is allowed", () => {
  const response = proxy(
    post("/settings", {
      Origin: BASE,
      Host: "app.everyfield.test",
    })
  );
  assert.notEqual(response.status, 403);
});
