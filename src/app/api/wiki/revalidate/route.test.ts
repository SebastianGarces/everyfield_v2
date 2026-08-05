import assert from "node:assert/strict";
import { test } from "node:test";

import { wikiHref } from "@/lib/wiki/href";

import {
  isAuthorized,
  POST,
  DELETE,
  revalidateAll,
  revalidateArticle,
  type RevalidationDeps,
} from "./route";

// ============================================================================
// The wiki revalidation endpoint (#310).
//
// Two things are under test here and they are not the same thing:
//
// 1. The GUARD is constant-time. That the comparison uses `timingSafeEqual`
//    rather than `!==` is invisible to every assertion in this file — both
//    answer every input identically, which is the whole reason the bug survived
//    review — so the mechanism is pinned on the SOURCE, once, in
//    `src/lib/security/constant-time.test.ts`, whose scan now covers this route
//    as well as the two CRON_SECRET ones.
// 2. The BEHAVIOUR is unchanged by that swap: same statuses, same bodies, same
//    revalidated paths for a valid secret, an invalid one and a missing one.
//    That is what the rest of this file is for.
//
// Nothing here touches Next's cache: `revalidatePath` needs a request scope and
// throws without one, so the handlers take an injectable `RevalidationDeps` and
// the tests record what would have been revalidated.
// ============================================================================

const SECRET = "s3cret";

/** A request whose JSON body is `body`. The handlers only call `.json()`. */
function requestWithBody(body: unknown): import("next/server").NextRequest {
  return {
    json: async () => body,
  } as unknown as import("next/server").NextRequest;
}

/** A request whose body is not JSON — `.json()` rejects, as it does in prod. */
function malformedRequest(): import("next/server").NextRequest {
  return {
    json: async () => {
      throw new SyntaxError("Unexpected end of JSON input");
    },
  } as unknown as import("next/server").NextRequest;
}

interface RevalidationCall {
  path: string;
  type?: "layout" | "page";
}

function recorder(): { calls: RevalidationCall[]; deps: RevalidationDeps } {
  const calls: RevalidationCall[] = [];
  const deps: RevalidationDeps = {
    revalidatePath: (path, type) => {
      calls.push({ path, type });
    },
  };
  return { calls, deps };
}

/** Silences the handler's `console.error` for the deliberate failure cases. */
async function withSilencedErrors<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

// ----------------------------------------------------------------------------
// AC: no non-constant-time comparison remains — the guard's own contract.
//
// Behaviourally identical to the `!==` it replaced, including the two ways it
// refuses without comparing anything: an unset secret (fail closed) and an
// absent field (a fact about the request, not about the secret).
// ----------------------------------------------------------------------------

test("accepts the configured secret", () => {
  process.env.REVALIDATION_SECRET = SECRET;
  assert.equal(isAuthorized(SECRET), true);
});

test("rejects a wrong secret", () => {
  process.env.REVALIDATION_SECRET = SECRET;
  assert.equal(isAuthorized("wrong"), false);
});

test("rejects a secret differing only in its last byte", () => {
  // Same length, so nothing but the comparison itself can decide this.
  process.env.REVALIDATION_SECRET = SECRET;
  assert.equal(isAuthorized("s3creT"), false);
});

test("rejects a wrong-length secret in both directions, without throwing", () => {
  // `timingSafeEqual` throws a RangeError on unequal-length buffers, so these
  // are the proof the lengths are reconciled BEFORE the call rather than after
  // a 500 — the failure mode a naive port of the helper would have shipped.
  process.env.REVALIDATION_SECRET = SECRET;
  assert.equal(isAuthorized("s3cre"), false);
  assert.equal(isAuthorized("s3cretX"), false);
  assert.equal(isAuthorized(SECRET.repeat(2000)), false);
});

test("rejects a missing or empty secret", () => {
  process.env.REVALIDATION_SECRET = SECRET;
  assert.equal(isAuthorized(undefined), false);
  assert.equal(isAuthorized(""), false);
});

test("fails closed when REVALIDATION_SECRET is not configured", () => {
  // An unset secret authorises nobody — never everybody, and never the empty
  // string that an unset env var would otherwise match.
  delete process.env.REVALIDATION_SECRET;
  assert.equal(isAuthorized("anything"), false);
  assert.equal(isAuthorized(""), false);
  assert.equal(isAuthorized(undefined), false);
});

// ----------------------------------------------------------------------------
// AC: POST behaviour unchanged for valid / invalid / missing secrets
// ----------------------------------------------------------------------------

test("POST with a valid secret revalidates the article and the wiki index", async () => {
  process.env.REVALIDATION_SECRET = SECRET;
  const { calls, deps } = recorder();

  const response = await revalidateArticle(
    requestWithBody({ slug: "discovery/values", secret: SECRET }),
    deps
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.revalidated, true);
  assert.equal(body.slug, "discovery/values");
  assert.equal(typeof body.timestamp, "string");
  assert.deepEqual(calls, [
    { path: "/wiki/discovery/values", type: undefined },
    { path: "/wiki", type: undefined },
  ]);
});

test("POST builds the article path with wikiHref, not by interpolation", async () => {
  // Slugs are authored content; the encoding invariant survives the guard swap.
  process.env.REVALIDATION_SECRET = SECRET;
  const { calls, deps } = recorder();
  const slug = "discovery/what now?";

  await revalidateArticle(requestWithBody({ slug, secret: SECRET }), deps);

  assert.equal(calls[0].path, wikiHref(slug));
  assert.notEqual(calls[0].path, `/wiki/${slug}`);
});

test("POST with a wrong secret is a 401 and revalidates nothing", async () => {
  process.env.REVALIDATION_SECRET = SECRET;
  const { calls, deps } = recorder();

  const response = await revalidateArticle(
    requestWithBody({ slug: "discovery/values", secret: "wrong" }),
    deps
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "Invalid or missing secret",
  });
  assert.deepEqual(calls, []);
});

test("POST with no secret field is a 401 and revalidates nothing", async () => {
  process.env.REVALIDATION_SECRET = SECRET;
  const { calls, deps } = recorder();

  const response = await revalidateArticle(
    requestWithBody({ slug: "discovery/values" }),
    deps
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "Invalid or missing secret",
  });
  assert.deepEqual(calls, []);
});

test("POST is a 401 when REVALIDATION_SECRET is unset", async () => {
  delete process.env.REVALIDATION_SECRET;
  const { calls, deps } = recorder();

  const response = await revalidateArticle(
    requestWithBody({ slug: "discovery/values", secret: "anything" }),
    deps
  );

  assert.equal(response.status, 401);
  assert.deepEqual(calls, []);
});

test("POST with a valid secret but no slug is a 400, after the guard", async () => {
  process.env.REVALIDATION_SECRET = SECRET;
  const { calls, deps } = recorder();

  const response = await revalidateArticle(
    requestWithBody({ secret: SECRET }),
    deps
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Missing slug parameter" });
  assert.deepEqual(calls, []);
});

test("POST with an unparseable body is a 500", async () => {
  process.env.REVALIDATION_SECRET = SECRET;
  const { calls, deps } = recorder();

  const response = await withSilencedErrors(() =>
    revalidateArticle(malformedRequest(), deps)
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Failed to revalidate" });
  assert.deepEqual(calls, []);
});

// ----------------------------------------------------------------------------
// AC: DELETE behaviour unchanged for valid / invalid / missing secrets
// ----------------------------------------------------------------------------

test("DELETE with a valid secret revalidates the whole wiki layout", async () => {
  process.env.REVALIDATION_SECRET = SECRET;
  const { calls, deps } = recorder();

  const response = await revalidateAll(
    requestWithBody({ secret: SECRET }),
    deps
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.revalidated, true);
  assert.equal(body.scope, "all");
  assert.deepEqual(calls, [{ path: "/wiki", type: "layout" }]);
});

test("DELETE with a wrong secret is a 401 and revalidates nothing", async () => {
  process.env.REVALIDATION_SECRET = SECRET;
  const { calls, deps } = recorder();

  const response = await revalidateAll(
    requestWithBody({ secret: "wrong" }),
    deps
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "Invalid or missing secret",
  });
  assert.deepEqual(calls, []);
});

test("DELETE with no secret field is a 401 and revalidates nothing", async () => {
  process.env.REVALIDATION_SECRET = SECRET;
  const { calls, deps } = recorder();

  const response = await revalidateAll(requestWithBody({}), deps);

  assert.equal(response.status, 401);
  assert.deepEqual(calls, []);
});

test("DELETE is a 401 when REVALIDATION_SECRET is unset", async () => {
  delete process.env.REVALIDATION_SECRET;
  const { calls, deps } = recorder();

  const response = await revalidateAll(
    requestWithBody({ secret: "anything" }),
    deps
  );

  assert.equal(response.status, 401);
  assert.deepEqual(calls, []);
});

// ----------------------------------------------------------------------------
// The HTTP handlers themselves: the deps seam must not be reachable over HTTP.
//
// Next invokes a route handler as `(request, context)`. If POST/DELETE took the
// deps object as their second parameter, that route context would be passed as
// deps and every real revalidation would call `context.revalidatePath` — i.e.
// crash. One parameter each, so the default is always the real Next binding.
// ----------------------------------------------------------------------------

test("the exported handlers take exactly one argument", () => {
  assert.equal(POST.length, 1);
  assert.equal(DELETE.length, 1);
});

test("the exported handlers apply the same guard", async () => {
  // Reached through the real handler, so this covers the wiring, not just the
  // injectable inner function. A 401 returns before `revalidatePath` is called,
  // which is what makes it safe to run without a request scope.
  process.env.REVALIDATION_SECRET = SECRET;

  const postResponse = await POST(
    requestWithBody({ slug: "discovery/values", secret: "wrong" })
  );
  assert.equal(postResponse.status, 401);

  const deleteResponse = await DELETE(requestWithBody({ secret: "wrong" }));
  assert.equal(deleteResponse.status, 401);
});
