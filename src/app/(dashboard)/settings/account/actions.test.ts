import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { CAPABILITY_BY_EXPORT } from "@/lib/auth/capability-map";
import {
  assertInOrder,
  sourceReader,
  stripComments,
} from "@/lib/testing/source-span";

// ============================================================================
// The Account section's write surface — CS-002 / CS-003 (#616).
//
// WHY THIS IS A SOURCE-SHAPED TEST. The module carries `"use server"`, so
// importing it here would drag `next/cache` into a bare node:test process. Its
// BEHAVIOUR is unit-tested where the behaviour lives — `email-change.test.ts`
// and `password-change.test.ts` execute every refusal against a real argon2
// hash and the real rate-limit policy. What is left, and what this file holds,
// are the properties of the ENDPOINT: who may call it, what it will not accept
// as an argument, and that a sessionless POST throws rather than being answered.
//
// This is the same technique — and the same reason — as the sibling
// `settings/actions.test.ts`.
// ============================================================================

const ACTIONS_PATH = path.join(
  process.cwd(),
  "src/app/(dashboard)/settings/account/actions.ts"
);
const SOURCE = readFileSync(ACTIONS_PATH, "utf8");
const READER = sourceReader(SOURCE, "settings/account/actions.ts");

/**
 * The module with its comments removed.
 *
 * The absence assertions below are about CODE. The header explains the
 * ownership rule by NAMING the shapes it forbids, so counting over the raw
 * source would make documenting the rule break the test that enforces it.
 */
const CODE = stripComments(SOURCE);

const EXPORTS = [
  "requestEmailChangeAction",
  "confirmEmailChangeAction",
  "changePasswordAction",
] as const;

test("every export is mapped, and mapped to self.write", () => {
  for (const name of EXPORTS) {
    assert.equal(
      CAPABILITY_BY_EXPORT[
        `src/app/(dashboard)/settings/account/actions.ts → ${name}`
      ],
      "self.write",
      `${name} must be in the checked-in capability map — the export walk proves a guard was CALLED, only the map proves it was called with the right verb`
    );
  }
});

test("the module publishes exactly those three endpoints", () => {
  const published = [...CODE.matchAll(/export async function (\w+)/g)].map(
    (match) => match[1]
  );

  assert.deepEqual(
    published.toSorted(),
    [...EXPORTS].toSorted(),
    'every export of a `"use server"` module is a POSTable endpoint reachable with no UI — a helper or a read added here is published to the internet'
  );

  assert.equal(
    /export (const|let|var|type|interface|class)\b/.test(CODE),
    false,
    "a value export here would be an endpoint that is not a function; a type export would be registered in the action manifest by name and break the build"
  );
});

test("the guard is line one of every export, and ABOVE the try", () => {
  for (const name of EXPORTS) {
    const body = READER.after(`export async function ${name}`);
    const guard = body.indexOf('await requireSeat("self.write")');
    const tryBlock = body.indexOf("try {");

    assert.ok(guard > 0, `${name} never calls requireSeat`);
    assert.ok(
      guard < tryBlock,
      `${name}: the mint must sit ABOVE the try (#508) — inside it, the catch converts a sessionless POST into a well-formed { ok: false }, which is the one answer that endpoint must never give`
    );
  }
});

test("no export takes a user, an account or a hash as an argument", () => {
  for (const forbidden of [
    "userId",
    "user_id",
    "passwordHash",
    "currentEmail",
    "previousEmail",
  ]) {
    assert.equal(
      CODE.includes(forbidden),
      false,
      `\`${forbidden}\` appears in the action module — an actor, or an entity the actor implies, is never a parameter (memory/invariants.md → Authentication). The values come from requireSeat().`
    );
  }
});

test("the actor handed to the logic layer is the session's own row", () => {
  for (const name of EXPORTS) {
    // `after` and then up to the NEXT export, so each assertion reads its own
    // function rather than the first match anywhere below it.
    const rest = READER.after(`export async function ${name}`);
    const next = rest.indexOf("export async function", 1);
    const body = next === -1 ? rest : rest.slice(0, next);

    assert.match(
      body,
      /actor: user,/,
      `${name} must pass the minted user, not something assembled from its input`
    );
  }
});

test("the session id the password change keeps is the session's, not an argument", () => {
  const body = READER.after("export async function changePasswordAction");

  assert.match(
    body,
    /const \{ user, session \} = await requireSeat\("self\.write"\)/
  );
  assert.match(
    body,
    /currentSessionId: session\.id,/,
    "which session survives the revocation must come from the cookie — a caller-named id would let a borrowed session keep itself alive and sign the owner out"
  );
});

test("every catch defers to unstable_rethrow before it classifies", () => {
  for (const name of EXPORTS) {
    const body = READER.after(`export async function ${name}`);
    const caught = body.slice(body.indexOf("} catch (error)"));

    assertInOrder(
      caught.slice(0, caught.indexOf("\n}")),
      `settings/account/actions.ts → ${name}`,
      ["unstable_rethrow(error)", "console.error"],
      "redirect(), notFound() and the framework's dynamic bailouts are thrown as errors but MEAN something — swallowing one turns a working redirect into a false failure"
    );
  }
});

test("the two writes that change what the screen shows call refresh()", () => {
  // The address appears in the Account section AND in the chrome, so both email
  // actions reconcile the whole tree. The password change deliberately does not:
  // nothing on screen renders a password, so there is nothing to re-read.
  assert.match(
    READER.span(
      "export async function requestEmailChangeAction",
      "export async function confirmEmailChangeAction"
    ),
    /if \(outcome\.ok\) refresh\(\);/
  );
  assert.match(
    READER.span(
      "export async function confirmEmailChangeAction",
      "export async function changePasswordAction"
    ),
    /if \(outcome\.ok\) refresh\(\);/
  );
  assert.equal(
    READER.after("export async function changePasswordAction").includes(
      "refresh()"
    ),
    false,
    "a refresh with nothing to reconcile is dead work on every password change"
  );
});
