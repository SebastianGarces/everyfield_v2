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
//
// RECONCILED 2026-08-12 with #304 ruling 4 item 5. Two of the three call sites
// this file was written for are GONE, not moved: no admin surface may render a
// `/register?invitation=` link, so the create action and the pending list build
// nothing. The helper's remaining caller is the EMAIL — which is what the
// ruling said would replace the admin's hand-forwarded copy. Rule 1 still
// matters, because `invitations-list.tsx` holds the other import-free leaf
// (`resend-window`) for the same bundling reason.
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

// THE ONE BUILDER, and it is now the only one. The create action and the
// pending list used to build this link too; #304 ruling 4 item 5 (2026-08-09,
// reinforced 2026-08-11) removed both, because a `/register?invitation=` URL on
// an admin surface is an account-existence oracle one click later. The ruling
// called the admin's copy of it "a stopgap for the email delivery that has not
// shipped" — and this issue IS that delivery, so the stopgap does not return.
const CALL_SITES = [
  // The email — absolute, via `invitationRegisterUrl`.
  ["lib", "invitations", "email.ts"],
] as const;

// Where the link must NOT be built, whatever else changes on those surfaces.
const FORBIDDEN_SITES = [
  ["app", "(dashboard)", "oversight", "invitations", "actions.ts"],
  ["components", "oversight", "invitations-list.tsx"],
  ["components", "oversight", "invitation-create-form.tsx"],
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

test("no admin surface builds the invite link at all", () => {
  // Item 5, from this module's side. The helper is not the escape hatch: a
  // surface that must not show the link must not compose it either, by the
  // helper or by hand.
  for (const segments of FORBIDDEN_SITES) {
    const source = code(read(...segments));
    const where = segments.join("/");

    assert.doesNotMatch(
      source,
      /invitationRegisterPath\(|invitationRegisterUrl\(|\?invitation=/,
      `${where} renders a register link — #304 ruling 4 item 5 forbids it`
    );
  }
});

test("the client surface reaches leaves only, never the send path", () => {
  // The specific import that put 687 KB of Resend SDK in the browser chunk.
  // `@/lib/invitations/email` pulls `@/lib/email/client`, which constructs a
  // Resend instance at module scope. The list no longer needs `register-path`
  // (item 5 took its Copy-link button) but it does need `resend-window`, the
  // other import-free leaf, for the cooldown countdown — so the rule is about
  // leaves generally, not about one file.
  const list = code(read("components", "oversight", "invitations-list.tsx"));

  assert.match(list, /from "@\/lib\/invitations\/resend-window"/);
  assert.doesNotMatch(
    list,
    /from "@\/lib\/(invitations\/email|email\/client)"/,
    "a client component must not import the send path — import the leaf"
  );
});
