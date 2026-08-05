import assert from "node:assert/strict";
import { test } from "node:test";

import { NextRequest } from "next/server";

import { isCrawlerPreviewRequest, PATHNAME_HEADER } from "./lib/crawler";
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
// The crawler allowance (#240, scoped 2026-08-04).
//
// An unauthenticated GET of a protected route is bounced to /login unless the
// request's `user-agent` names a link previewer AND the route is one that
// renders without a session. The proxy no longer emits `x-is-crawler`, because
// that header went on the RESPONSE, where the layout downstream never saw it —
// the layout's copy of this branch used to read `x-is-crawler` off the REQUEST,
// so the only thing that could ever set it was the client. Both sides now call
// `isCrawlerPreviewRequest` on the same two inputs: the `user-agent`, and the
// pathname this proxy stamps on the request headers.
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

/**
 * The pathname the app will actually see, i.e. what the proxy stamped on the
 * REQUEST headers. `NextResponse.next({ request: { headers } })` encodes an
 * override as `x-middleware-request-<name>` plus a name list; reading it back is
 * the only way to assert from outside what a Server Component downstream reads.
 */
function stampedPathname(response: Response): string | null {
  return response.headers.get(`x-middleware-request-${PATHNAME_HEADER}`);
}

test("the proxy stamps the routed pathname on every request it lets through", () => {
  // The layout has no other way to know which route it is rendering, and the
  // whole route scope hangs off that.
  const cases: Array<[string, Record<string, string>]> = [
    ["/wiki/getting-started", { "user-agent": GOOGLEBOT }], // crawler pass-through
    ["/people", { "user-agent": CHROME }], // unprotected-by-proxy pass-through
    ["/login", {}], // no session, no protection
  ];
  for (const [path, headers] of cases) {
    assert.equal(stampedPathname(proxy(get(path, headers))), path, path);
  }

  // Non-GET continuations too: a Server Action re-renders the same layout.
  assert.equal(
    stampedPathname(
      proxy(post("/settings", { Origin: BASE, Host: "app.everyfield.test" }))
    ),
    "/settings"
  );
});

test("a forged x-pathname is overwritten with the real path, everywhere", () => {
  // The stamp is only trustworthy because it is unconditional. A client that
  // claims to be on /wiki while asking for /people must not be believed — that
  // claim is the one thing that could talk the layout into the session-less
  // shell on a route whose page then throws.
  const forged = { [PATHNAME_HEADER]: "/wiki/getting-started" };

  for (const [path, headers] of [
    ["/people", { "user-agent": GOOGLEBOT, ...forged }],
    ["/settings", { "user-agent": CHROME, ...forged }],
    ["/notifications", { "user-agent": GOOGLEBOT, ...forged }],
    ["/dashboard", { "user-agent": GOOGLEBOT, ...forged }],
  ] as Array<[string, Record<string, string>]>) {
    const stamped = stampedPathname(proxy(get(path, headers)));
    assert.equal(stamped, path, `a forged x-pathname survived on ${path}`);
    assert.equal(
      isCrawlerPreviewRequest(headers["user-agent"], stamped),
      path === "/dashboard",
      `the forged x-pathname changed the layout's verdict for ${path}`
    );
  }
});

test("a crawler on a route the proxy does not admit gets no preview downstream", () => {
  // These six are in the `(dashboard)` group but not in the proxy's protected
  // list, so the proxy passes them through untouched and the LAYOUT is what
  // bounces them. The pass-through is only safe because the pathname it stamps
  // makes the layout's verdict false — which is the whole fix: `redirect(/login)`
  // instead of a bare shell around a page that throws (a 500) for anything with
  // a crawler token in its UA, WhatsApp's in-app browser included.
  for (const path of [
    "/people",
    "/settings",
    "/tasks",
    "/teams",
    "/meetings",
    "/notifications",
  ]) {
    const response = proxy(get(path, { "user-agent": GOOGLEBOT }));
    assert.equal(
      isCrawlerPreviewRequest(GOOGLEBOT, stampedPathname(response)),
      false,
      `${path} would still render the session-less crawler shell`
    );
  }
});

test("every previewable route is protected — a browser on one still gets /login", () => {
  // The other half of the invariant in `crawler.ts`: the crawler branch is the
  // ONLY door into a previewable route without a session. If a prefix ever
  // dropped out of the proxy's protected list, this is what would catch it.
  for (const path of ["/dashboard", "/wiki/getting-started", "/oversight"]) {
    assert.equal(
      loginRedirect(proxy(get(path, { "user-agent": CHROME }))),
      `${BASE}/login?redirect=${encodeURIComponent(path)}`,
      `${path} let a session-less browser through`
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
