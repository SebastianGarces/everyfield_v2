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
  "uploadAvatarAction",
  "removeAvatarAction",
  "requestEmailChangeAction",
  "confirmEmailChangeAction",
  "changePasswordAction",
] as const;

/**
 * One export's body, bounded by the next one.
 *
 * `READER.after` runs to the END OF THE FILE, so an assertion written with it
 * reads every export below its subject too. That is a trap with a delay on it:
 * the `refresh()` test below asserts an ABSENCE, and an absence assertion over
 * the rest of the file passes today and starts reading somebody else's function
 * the moment an endpoint is added under it. #617 added two, and put them at the
 * top for unrelated reasons — so this bound is what keeps that a choice rather
 * than a load-bearing accident.
 */
function bodyOf(name: string): string {
  const rest = READER.after(`export async function ${name}`);
  const next = rest.indexOf("export async function", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

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

test("the module publishes exactly those endpoints and no others", () => {
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

test("the only thing read out of the picture's FormData is the file (CS-004)", () => {
  const body = bodyOf("uploadAvatarAction");
  const reads = [...body.matchAll(/formData\.get\("([^"]+)"\)/g)].map(
    (match) => match[1]
  );

  assert.deepEqual(
    reads,
    ["avatar"],
    "a `FormData` is a bag whose keys a POST chooses, so every key read out of one is an input the caller controls — a storage key among them would aim this account's picture at another account's object, which the avatar route would then serve because it trusts the stored key"
  );

  assert.match(
    body,
    /file instanceof File/,
    "the bag's value is `FormDataEntryValue`, so a POST sending a plain string reaches the logic layer as one unless this narrows first"
  );
});

test("no export takes a user, an account or a hash as an argument", () => {
  for (const forbidden of [
    "userId",
    "user_id",
    "passwordHash",
    "currentEmail",
    "previousEmail",
    "avatarKey",
    "storageKey",
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
    assert.match(
      bodyOf(name),
      /actor: user,?/,
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

test("every write that changes what the screen shows calls refresh(), and only those", () => {
  // The address and the picture BOTH appear in the Account section and in the
  // chrome, so those three reconcile the whole tree. Two do not, for opposite
  // reasons: the password change has nothing on screen to re-read, and the
  // CONFIRMATION redirects, so the tree a refresh would patch is the tree the
  // redirect replaces (the test below owns that one).
  const RECONCILES = new Set([
    "uploadAvatarAction",
    "removeAvatarAction",
    "requestEmailChangeAction",
  ]);

  for (const name of EXPORTS) {
    const body = bodyOf(name);

    if (RECONCILES.has(name)) {
      assert.match(
        body,
        /if \(outcome\.ok\) refresh\(\);/,
        `${name} changes something the sidebar renders — without the refresh the chrome keeps showing what was true before the write`
      );
      continue;
    }

    // Comments off, for the reason the header gives: an endpoint that EXPLAINS
    // why it does not refresh must be able to write the word.
    assert.equal(
      stripComments(body).includes("refresh()"),
      false,
      `${name} has nothing on screen to reconcile — a refresh here is dead work on every call`
    );
  }
});

test("the confirmation ends in a redirect, and the redirect sits OUTSIDE the try (#658)", () => {
  const body = bodyOf("confirmEmailChangeAction");

  assert.match(
    body,
    /redirect\("\/verify-email\/confirmed"\);/,
    "a swap that committed must leave the spent `?token=` URL — the reader who reloads it is told the link is dead about a change that succeeded, and the pane that used to say otherwise waited on a transition that never committed (#658)"
  );

  assert.match(
    body,
    /revalidatePath\("\/", "layout"\);/,
    "the redirect is a CLIENT-SIDE navigation, which reuses the layout segments both routes share — without this the reader lands on `you now sign in as <new>` beside a sidebar still rendering the old address (measured on #658's preview)"
  );

  const code = stripComments(body);
  assert.ok(
    code.indexOf("redirect(") > code.indexOf("} catch (error)"),
    "redirect() reports itself by THROWING, so a redirect inside the try is caught by the classifier above it and returned as `We could not confirm that address` — about a change that already happened"
  );
});
