// This suite exercises the real route handlers, and `POST` mints nothing but
// does OPEN a token, so the module needs a secret the way production has one.
// See the same note in `dispatch.test.ts` for why a module-scope write is safe
// here: `node --test` gives each file its own process, and
// `unsubscribeTokenSecret()` reads `process.env` at call time.
process.env.UNSUBSCRIBE_TOKEN_SECRET = "test-unsubscribe-secret-0123456789";

import assert from "node:assert/strict";
import { test } from "node:test";

import { NextRequest, NextResponse } from "next/server";

import { GET, POST } from "./route";

// ============================================================================
// The unauthenticated opt-out endpoint (N-007, ruled 2026-08-01).
//
// Two claims are under test, and the first is the ruling itself:
//
// 1. GET — and therefore HEAD, which Next derives from it — CANNOT mutate.
//    Asserted structurally rather than by counting rows: the handler is
//    synchronous, so it cannot have awaited a database round trip. A future
//    edit that adds a write has to make it `async` first, and that is the line
//    this test fails on.
//
// 2. POST is the mutation, and it accepts the RFC 8058 one-click body a mail
//    client sends. The DB-level assertions for what that write touches live in
//    `channels/unsubscribe.test.ts`, against a recording store; what is left
//    here is the HTTP shape.
// ============================================================================

const BASE = "https://app.everyfield.test";
const ENDPOINT = `${BASE}/api/notifications/unsubscribe`;

function request(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new Request(url, init));
}

// ----------------------------------------------------------------------------
// AC: GET (and HEAD) changes nothing
// ----------------------------------------------------------------------------

test("GET is synchronous, so it cannot have performed a database write", () => {
  // The structural half of "a mail scanner cannot unsubscribe anyone". A
  // handler that returns a Response rather than a Promise has awaited nothing;
  // every write on this surface is `await`ed.
  const response = GET(request(`${ENDPOINT}?token=abc`));

  assert.ok(response instanceof NextResponse);
  assert.ok(
    !(response as unknown as Promise<unknown>).then,
    "GET returned a thenable — it can now await, and so it can now write"
  );
});

test("GET renders the confirmation page instead of acting", () => {
  const response = GET(request(`${ENDPOINT}?token=abc`));

  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(location.pathname, "/unsubscribe");
  // The page needs the token to name the category and the address. It is the
  // same capability the reader already holds, so passing it on grants nothing.
  assert.equal(location.searchParams.get("token"), "abc");
});

test("GET with no token still renders the page, tokenless", () => {
  const response = GET(request(ENDPOINT));

  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(location.pathname, "/unsubscribe");
  assert.equal(location.searchParams.get("token"), null);
});

test("a token that is obvious garbage is not refused differently on GET", () => {
  // No account oracle: a forged token and a real one produce the identical
  // response here, and the page says the same thing for every refusal.
  const forged = GET(request(`${ENDPOINT}?token=not-a-token`));
  const shaped = GET(request(`${ENDPOINT}?token=abc`));

  assert.equal(forged.status, shaped.status);
  assert.equal(
    new URL(forged.headers.get("location") ?? "").pathname,
    new URL(shaped.headers.get("location") ?? "").pathname
  );
});

test("the route exports no other mutating method", async () => {
  // HEAD is derived from GET by Next, so it inherits "renders, never writes".
  // Anything else appearing here would be a second, unreviewed door.
  const route = await import("./route");
  const methods = Object.keys(route).filter((key) =>
    ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(key)
  );
  assert.deepEqual(methods.sort(), ["GET", "POST"]);
});

// ----------------------------------------------------------------------------
// AC: the RFC 8058 one-click POST is accepted
// ----------------------------------------------------------------------------

test("the one-click POST body a mail client sends is accepted", async () => {
  const response = await POST(
    request(`${ENDPOINT}?token=not-a-real-token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    })
  );

  // 200 even for a token we will not honour: a mail client that gets a 4xx may
  // retry, surface an error, or stop offering the control, and none of those
  // help anyone. The refusal is a log line.
  assert.equal(response.status, 200);
});

test("a POST with no body at all is still accepted", async () => {
  // Not every client is strict about the body, and the token — not the body —
  // is what authorises the write.
  const response = await POST(
    request(`${ENDPOINT}?token=not-a-real-token`, { method: "POST" })
  );

  assert.equal(response.status, 200);
});

test("a POST with no token is accepted and does nothing", async () => {
  const response = await POST(request(ENDPOINT, { method: "POST" }));
  assert.equal(response.status, 200);
});
