import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  INVITATION_REGISTER_PATH,
  invitationRegisterPath,
} from "./register-path";

// ============================================================================
// OV-003b (#293) — ONE spelling of `?invitation=`, reachable from every surface.
//
// The defect this file closes: the helper existed, was documented as the single
// spelling, and lived in `./email.ts` — which imports `@/lib/email/client` and
// therefore evaluates `new Resend(...)` at module scope. Proven by building the
// app with the "Copy link" button importing it from there: the invitations
// page's client chunk grew to 687 KB and contained `api.resend.com`,
// `resend-node` and `RESEND_API_KEY`. So the one surface that most needed the
// helper could not have it, and three hand-rolled spellings of one query key
// survived — the email's, the create action's, and the button's.
//
// Two rules, one test each below:
//
//   1. THE LEAF STAYS A LEAF. `register-path.ts` has no imports, so any surface
//      — server, client, test — can hold the contract. The moment an import
//      appears it may become server-only again and the client copy comes back.
//   2. NOBODY RE-SPELLS IT. No source file outside this module writes
//      `?invitation=` by hand; every builder calls the helper. Source-shaped
//      because the thing being pinned IS a call site: a client component and a
//      `"use server"` module cannot be executed in a unit test's process, and
//      it was exactly the un-executed call sites that drifted.
// ============================================================================

const ROOT = path.join(process.cwd(), "src");

function read(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

/** Source with comments stripped — the rules below are documented by naming what they forbid. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

// ----------------------------------------------------------------------------
// 1. The contract itself
// ----------------------------------------------------------------------------

test("the path is the shape register/page.tsx reads", () => {
  const id = "77777777-7777-4777-8777-777777777777";

  assert.equal(INVITATION_REGISTER_PATH, "/register");
  assert.equal(invitationRegisterPath(id), `/register?invitation=${id}`);

  // Relative on purpose: the caller supplies the origin it already knows
  // (`window.location.origin` in the browser, `appBaseUrl()` in the email).
  assert.ok(!invitationRegisterPath(id).includes("://"));

  // The id is escaped on the way into the query, so a value that is not a uuid
  // cannot close the parameter and append another one.
  assert.ok(
    !invitationRegisterPath("a&admin=1").includes("&admin=1"),
    "an id is interpolated into the query unescaped"
  );
});

// ----------------------------------------------------------------------------
// 2. The leaf stays importable from a client component
// ----------------------------------------------------------------------------

test("register-path.ts imports nothing", () => {
  const source = code(read("lib", "invitations", "register-path.ts"));

  // Both spellings — a static `import` and a dynamic `import(...)` — because
  // either one is enough to drag `@/lib/email/client` back in behind it.
  assert.doesNotMatch(
    source,
    /^\s*import[\s{*]/m,
    "register-path.ts must stay import-free: a client component holds this contract"
  );
  assert.doesNotMatch(source, /\bimport\s*\(/, "no dynamic import either");
  assert.doesNotMatch(source, /\brequire\s*\(/, "no require either");

  // And it must not be re-marked server-only, which would be the same failure
  // wearing a different hat.
  assert.doesNotMatch(source, /"use server"|"server-only"/);
});

// ----------------------------------------------------------------------------
// 3. Nobody re-spells the query key
// ----------------------------------------------------------------------------

const CALL_SITES = [
  // The email — absolute, via `invitationRegisterUrl`.
  ["lib", "invitations", "email.ts"],
  // The admin's copyable fallback, returned by the create action.
  ["app", "(dashboard)", "oversight", "invitations", "actions.ts"],
  // The "Copy link" button on the pending list — a `"use client"` component,
  // and the surface that could not import the helper before this file existed.
  ["components", "oversight", "invitations-list.tsx"],
] as const;

test("every builder of the invite link calls the helper", () => {
  for (const segments of CALL_SITES) {
    const source = code(read(...segments));
    const where = segments.join("/");

    assert.match(
      source,
      /invitationRegisterPath\(|invitationRegisterUrl\(/,
      `${where} must build the invite link with the helper`
    );
    assert.doesNotMatch(
      source,
      /\?invitation=/,
      `${where} hand-builds the invite link — one spelling only (./register-path.ts)`
    );
  }
});

test("the client surface reaches the leaf, never the send path", () => {
  // The specific import that put 687 KB of Resend SDK in the browser chunk.
  // `@/lib/invitations/email` pulls `@/lib/email/client`, which constructs a
  // Resend instance at module scope.
  const list = code(read("components", "oversight", "invitations-list.tsx"));

  assert.match(list, /from "@\/lib\/invitations\/register-path"/);
  assert.doesNotMatch(
    list,
    /from "@\/lib\/(invitations\/email|email\/client)"/,
    "a client component must not import the send path — import the leaf"
  );
});
