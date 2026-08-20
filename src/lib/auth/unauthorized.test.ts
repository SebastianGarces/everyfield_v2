import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  SESSION_EXPIRED_DIGEST,
  UNAUTHORIZED_MESSAGE,
  UnauthorizedError,
  isSessionExpiry,
  isUnauthorized,
  rethrowUnauthorized,
} from "./unauthorized";

// ============================================================================
// THE MARKER, BOTH ENDS (#508).
//
// The server end: `verifySession()` throws `UnauthorizedError`, every action
// catch that can see it rethrows, and the throw leaves the request unhandled.
// The client end: `(dashboard)/error.tsx` is handed `{ message, digest }` and
// nothing else — in production Next.js replaces the message with a generic
// sentence, so the DIGEST is the only thing a boundary can classify on.
//
// The bug this closes is a sentence, not a crash: the boundary told a reader
// "your sign-in may have expired" about a database schema drift during #498's
// validation, and offered a Sign in button that could not have helped.
// ============================================================================

test("the refusal carries a digest that a client boundary can read", () => {
  const error = new UnauthorizedError();

  assert.equal(error.message, UNAUTHORIZED_MESSAGE);
  assert.equal(error.digest, SESSION_EXPIRED_DIGEST);
  assert.ok(error instanceof Error);

  // An OWN property, not a getter on the prototype: Next.js reads `err.digest`
  // off the thrown value and keeps it ("If the error already has a digest,
  // respect the original digest" — create-error-handler.js). A prototype
  // accessor would survive locally and vanish across the boundary.
  assert.ok(Object.hasOwn(error, "digest"));
});

test("the discriminator says yes ONLY to the sessionless refusal", () => {
  assert.equal(isSessionExpiry(new UnauthorizedError()), true);

  // The shape the boundary actually gets in production: a bare Error whose
  // message has been replaced and whose digest is the one the server set.
  assert.equal(
    isSessionExpiry({ digest: SESSION_EXPIRED_DIGEST }),
    true,
    "the marker has to survive as a plain digest string — the class does not cross the boundary"
  );

  // THE CASE THAT MADE #508 A BUG. A 500 from anywhere else carries Next's own
  // hash digest, and the old boundary told the reader their session had
  // expired. It must not.
  assert.equal(isSessionExpiry({ digest: "1234567890" }), false);
  assert.equal(isSessionExpiry(new Error("relation does not exist")), false);
  assert.equal(isSessionExpiry({}), false);
  assert.equal(isSessionExpiry(undefined), false);
  assert.equal(isSessionExpiry(null), false);
});

test("the rethrow is a statement that throws, and it throws the SAME error", () => {
  const refusal = new UnauthorizedError();

  assert.throws(
    () => rethrowUnauthorized(refusal),
    (thrown: unknown) => thrown === refusal,
    "the original object has to leave — a re-wrapped copy loses the digest"
  );

  // A plain `new Error("Unauthorized")` written anywhere in the product means
  // the same thing to a caller, so it leaves the same way. The message is the
  // test and not `instanceof`, because the throw crosses bundle boundaries
  // where class identity does not survive.
  assert.throws(() => rethrowUnauthorized(new Error(UNAUTHORIZED_MESSAGE)));
  assert.equal(isUnauthorized(new Error(UNAUTHORIZED_MESSAGE)), true);

  // Everything else falls through, so the catch below it keeps classifying.
  assert.equal(rethrowUnauthorized(new Error("Meeting not found")), undefined);
  assert.equal(rethrowUnauthorized("Unauthorized"), undefined);
  assert.equal(isUnauthorized("Unauthorized"), false);
});

test("the module is an import-free leaf, because the client bundle holds it", () => {
  // `(dashboard)/error.tsx` is a `"use client"` component and imports
  // `isSessionExpiry`. Anything this module imported would be dragged into that
  // bundle behind it — which is how `@/lib/auth/roles` and
  // `@/lib/oversight/org-label` earned the same rule
  // (`memory/invariants.md` → Multi-Tenancy).
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/auth/unauthorized.ts"),
    "utf8"
  );

  assert.deepEqual(
    source.match(/^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\b/gm) ?? [],
    []
  );
});

test("verifySession throws the marked error, not a bare one", () => {
  // The wiring, read off the source: this test cannot open a session cookie,
  // and the value of the class is entirely in `verifySession` being the thing
  // that throws it. A `new Error("Unauthorized")` there compiles, passes every
  // message-based check in the product, and silently un-marks the boundary.
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/auth/session.ts"),
    "utf8"
  );

  assert.match(source, /throw new UnauthorizedError\(\);/);
  assert.doesNotMatch(source, /throw new Error\("Unauthorized"\)/);
});
