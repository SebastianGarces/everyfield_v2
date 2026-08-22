import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { readAvatar } from "@/lib/auth/avatar";
import { sourceReader } from "@/lib/testing/source-span";

// ============================================================================
// GET /api/account/avatar — the only read path for an account's picture
// (CS-004, #617).
//
// TWO HALVES, TESTED TWO WAYS, because they fail differently.
//
// The RESPONSE half is behaviour and is run: `readAvatar` is the route's body
// with the session check lifted off, so a fake reader is all it takes to assert
// what a stored key, an absent key and a missing object each answer with.
//
// The GUARD half is structural. A test that "proves" a 401 by importing the
// handler would have to stand up a session to get any other answer out of it,
// and the property that matters is not the status code — it is that the check
// comes FIRST and that no id from the request can steer which row is read. Both
// are properties of the source, and both are the kind of thing a later edit
// breaks silently, so they are read out of the file the way
// `settings/account/actions.test.ts` reads its own.
// ============================================================================

const ROUTE_PATH = path.join(
  process.cwd(),
  "src/app/api/account/avatar/route.ts"
);
const SOURCE = readFileSync(ROUTE_PATH, "utf8");
const READER = sourceReader(SOURCE, "api/account/avatar/route.ts");

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

  const response = await readAvatar(KEY, bucket.read);

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

  const response = await readAvatar(KEY, bucket.read);
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

test("no signed URL and no bucket path reaches the caller", async () => {
  const bucket = reader({
    [KEY]: { body: PNG_BYTES, contentType: "image/png" },
  });

  const response = await readAvatar(KEY, bucket.read);

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
    const response = await readAvatar(empty, bucket.read);
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

  const response = await readAvatar(KEY, bucket.read);

  // The half-failed replacement P-024 tolerates. A throw here would be a broken
  // image and a logged error on every render; a 404 is the initials fallback.
  assert.equal(response.status, 404);
  assert.deepEqual(bucket.asked, [KEY]);
});

// ----------------------------------------------------------------------------
// The guard, and what the route refuses to take as input
// ----------------------------------------------------------------------------

test("the session is read before anything else, and a sessionless GET is 401", () => {
  const body = READER.after("export async function GET");
  const session = body.indexOf("await getCurrentSession()");
  const refusal = body.indexOf("status: 401");
  const read = body.indexOf("readAvatar(");

  assert.ok(session >= 0, "the route never reads the session");
  assert.ok(
    session < refusal && refusal < read,
    "the 401 must sit between the session read and the bucket read — an anonymous fetch of a face must end before a byte is read"
  );
});

test("GET takes no argument, so no request value can choose whose picture is read", () => {
  assert.match(
    SOURCE,
    /export async function GET\(\)/,
    "a params or request argument here would be the beginning of an id somebody could forge; the session names the row"
  );

  for (const forbidden of ["userId", "user_id", "params", "searchParams"]) {
    assert.equal(
      SOURCE.includes(forbidden),
      false,
      `\`${forbidden}\` appears in the route — whose picture this is is not a parameter (memory/invariants.md → Authentication)`
    );
  }
});

test("the key comes off the session row and is never rebuilt from parts", () => {
  const body = READER.after("export async function GET");

  assert.match(
    body,
    /readAvatar\(user\.avatarKey\)/,
    "the stored key is trusted precisely because nothing client-supplied can reach it — a key assembled here would undo that"
  );
});

test("the route runs on Node, or the S3 client it reaches is not there", () => {
  assert.match(SOURCE, /export const runtime = "nodejs"/);
});
