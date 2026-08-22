import assert from "node:assert/strict";
import { test } from "node:test";

import { storedImageResponse } from "@/lib/stored-image-response";

// ============================================================================
// WHAT A STORED PICTURE ANSWERS WITH — shared by both photo routes (P-024).
//
// `storedImageResponse` is each route's body with its own checks lifted off, so
// a fake reader is all it takes to assert what a stored key, an absent key and a
// missing object each answer with. The checks themselves — who may read — are
// what the routes still own, and each route's test asserts its own.
//
// These assertions used to live only in the account route's test, which is why
// the person route (identical response, retyped) had none. One module now, one
// set of assertions, both routes covered.
// ============================================================================

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const KEY = "avatars/44444444-4444-4444-4444-444444444444/abc-123.png";

function reader(
  stored: Record<string, { body: Uint8Array; contentType: string }>
) {
  const asked: string[] = [];
  return {
    asked,
    read: async (key: string) => {
      asked.push(key);
      return stored[key] ?? null;
    },
  };
}

// ----------------------------------------------------------------------------
// AC: the picture serves from the private bucket, through this route
// ----------------------------------------------------------------------------

test("a stored key answers with the object's own bytes and content type", async () => {
  const bucket = reader({
    [KEY]: { body: PNG_BYTES, contentType: "image/png" },
  });

  const response = await storedImageResponse(KEY, bucket.read);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    PNG_BYTES,
    "the route streams the object, it does not redirect to one"
  );
  assert.deepEqual(
    bucket.asked,
    [KEY],
    "the stored key is what is read, verbatim — nothing rewrites or derives it"
  );
});

test("the picture is cached PRIVATE, and revalidated every time", async () => {
  const bucket = reader({
    [KEY]: { body: PNG_BYTES, contentType: "image/png" },
  });

  const response = await storedImageResponse(KEY, bucket.read);
  const cacheControl = response.headers.get("Cache-Control") ?? "";

  assert.match(
    cacheControl,
    /\bprivate\b/,
    "a shared cache holding this would serve one account's face from another account's request"
  );
  assert.match(cacheControl, /\bno-cache\b/);
  assert.match(cacheControl, /\bmust-revalidate\b/);
  assert.doesNotMatch(
    cacheControl,
    /\bpublic\b/,
    "public here would put a face on a CDN edge that never sees the session check"
  );
});

test("the bytes are never sniffed past the type they were stored with", async () => {
  const bucket = reader({
    [KEY]: { body: PNG_BYTES, contentType: "image/png" },
  });

  const response = await storedImageResponse(KEY, bucket.read);

  // Nothing in this product inspects an uploaded image's BYTES: the gate reads
  // the type the client declared and the bucket records that type. So a file
  // whose content is HTML or SVG, declared `image/png`, is served from this
  // app's own origin — `nosniff` is what stops a browser deciding for itself
  // that it looks like markup.
  assert.equal(
    response.headers.get("X-Content-Type-Options"),
    "nosniff",
    "without this the declared content type is a suggestion the browser may overrule"
  );
});

test("no signed URL and no bucket path reaches the caller", async () => {
  const bucket = reader({
    [KEY]: { body: PNG_BYTES, contentType: "image/png" },
  });

  const response = await storedImageResponse(KEY, bucket.read);

  // A redirect to a presigned URL is the shape this route exists to avoid: the
  // URL is a bearer token, and a browser that follows one can hand it on.
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Location"), null);
  assert.equal(
    [...response.headers.keys()].some((name) =>
      (response.headers.get(name) ?? "").includes("avatars/")
    ),
    false,
    "the key must not ride back out in a header"
  );
});

// ----------------------------------------------------------------------------
// AC: remove falls back to initials — which starts with a 404 here
// ----------------------------------------------------------------------------

test("an account with no picture is a 404, and the bucket is never asked", async () => {
  const bucket = reader({});

  for (const empty of [null, undefined, ""]) {
    const response = await storedImageResponse(empty, bucket.read);
    assert.equal(response.status, 404, `for ${JSON.stringify(empty)}`);
  }

  assert.deepEqual(
    bucket.asked,
    [],
    "there is no key to read — asking the bucket for one would be a round trip per initials render"
  );
});

test("a row naming an object the bucket no longer has is a 404, not a 500", async () => {
  const bucket = reader({});

  const response = await storedImageResponse(KEY, bucket.read);

  // The half-failed replacement P-024 tolerates. A throw here would be a broken
  // image and a logged error on every render; a 404 is the initials fallback.
  assert.equal(response.status, 404);
  assert.deepEqual(bucket.asked, [KEY]);
});
