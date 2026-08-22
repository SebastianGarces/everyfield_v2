import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { sourceReader } from "@/lib/testing/source-span";

// ============================================================================
// GET /api/account/avatar — WHO MAY READ, and nothing else (CS-004, #617).
//
// What a stored key turns into is `storedImageResponse`, shared with the person
// photo route and asserted in `lib/stored-image-response.test.ts`. What is left
// here is this route's own half: the session check, and the fact that no value
// from the request can steer which row is read.
//
// STRUCTURAL, and deliberately. A test that "proves" the 401 by importing the
// handler would have to stand up a session to get any other answer out of it,
// and the property that matters is not the status code — it is that the check
// comes FIRST and that there is no id to forge. Both are properties of the
// source, both are the kind of thing a later edit breaks silently, and both are
// read out of the file the way `settings/account/actions.test.ts` reads its own.
// ============================================================================

const ROUTE_PATH = path.join(
  process.cwd(),
  "src/app/api/account/avatar/route.ts"
);
const SOURCE = readFileSync(ROUTE_PATH, "utf8");
const READER = sourceReader(SOURCE, "api/account/avatar/route.ts");

test("the session is read before anything else, and a sessionless GET is 401", () => {
  const body = READER.after("export async function GET");
  const session = body.indexOf("await getCurrentSession()");
  const refusal = body.indexOf("status: 401");
  const read = body.indexOf("storedImageResponse(");

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
    /storedImageResponse\(user\.avatarKey\)/,
    "the stored key is trusted precisely because nothing client-supplied can reach it — a key assembled here would undo that"
  );
});

test("the route runs on Node, or the S3 client it reaches is not there", () => {
  assert.match(SOURCE, /export const runtime = "nodejs"/);
});
