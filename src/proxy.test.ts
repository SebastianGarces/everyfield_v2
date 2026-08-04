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

// ============================================================================
// The crawler allowance (#240).
//
// An unauthenticated GET of a protected route is bounced to /login unless the
// request's `user-agent` names a link previewer, which needs the page for its
// OpenGraph tags. The decision is the User-Agent and nothing else: the proxy no
// longer emits `x-is-crawler`, because that header went on the RESPONSE, where
// the layout downstream never saw it — the layout's copy of this branch used to
// read `x-is-crawler` off the REQUEST, so the only thing that could ever set it
// was the client. Both sides now call `isCrawlerUserAgent` on the same input.
// ============================================================================

const GOOGLEBOT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function get(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new Request(`${BASE}${path}`, { headers }));
}

/** The redirect the proxy issues for an unauthenticated, non-crawler GET. */
function loginRedirect(response: Response): string | null {
  return response.status >= 300 && response.status < 400
    ? response.headers.get("location")
    : null;
}

test("an unauthenticated crawler is let through to a protected route", () => {
  for (const path of ["/dashboard", "/wiki/getting-started", "/oversight"]) {
    const response = proxy(get(path, { "user-agent": GOOGLEBOT }));
    assert.equal(
      loginRedirect(response),
      null,
      `${path} bounced a crawler that needs it for metadata`
    );
  }
});

test("an unauthenticated browser is still sent to /login", () => {
  const response = proxy(get("/dashboard", { "user-agent": CHROME }));
  assert.equal(
    loginRedirect(response),
    `${BASE}/login?redirect=%2Fdashboard`,
    "a session-less browser reached the dashboard"
  );
});

test("forging x-is-crawler buys nothing — with it or without it, same result", () => {
  // The acceptance criterion, stated directly. A client that sends the header
  // the layout used to trust must be treated exactly like one that does not.
  for (const path of ["/dashboard", "/wiki/getting-started"]) {
    const forged = proxy(
      get(path, { "user-agent": CHROME, "x-is-crawler": "true" })
    );
    const plain = proxy(get(path, { "user-agent": CHROME }));

    assert.equal(forged.status, plain.status, path);
    assert.equal(
      loginRedirect(forged),
      loginRedirect(plain),
      `a forged x-is-crawler header changed the outcome for ${path}`
    );
    assert.notEqual(
      loginRedirect(forged),
      null,
      `a forged x-is-crawler header got past the login redirect for ${path}`
    );
  }
});

test("the proxy never emits an x-is-crawler header", () => {
  // It only ever went on the response, which is why the layout could not read
  // it. Nothing writes it now, so any occurrence downstream is client input.
  const responses = [
    proxy(get("/dashboard", { "user-agent": GOOGLEBOT })),
    proxy(get("/wiki/getting-started", { "user-agent": GOOGLEBOT })),
    proxy(get("/dashboard", { "user-agent": CHROME })),
    proxy(get("/login")),
  ];
  for (const response of responses) {
    assert.equal(response.headers.get("x-is-crawler"), null);
  }
});
