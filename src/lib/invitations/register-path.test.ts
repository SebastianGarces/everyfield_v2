import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

/**
 * Every SHIPPED `.ts`/`.tsx` under `src/<area>`, absolute and sorted.
 *
 * Suites are skipped: the rules below are about the module graph a bundler
 * follows, and nothing imports a `*.test.ts`. A suite also has to be able to
 * quote the export it forbids, which the door scan would otherwise read as a
 * door.
 */
function sourceFilesUnder(...segments: string[]): string[] {
  const found: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name)
      ) {
        found.push(full);
      }
    }
  }

  walk(path.join(ROOT, ...segments));

  return found.sort();
}

function rel(file: string): string {
  return path.relative(path.dirname(ROOT), file);
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

// A LEAF WHOSE CONTENTS ARE ALSO SERVED FROM THE TRUNK IS NOT A LEAF. The two
// tests below close the class the one above only closes an instance of.
//
// `email.ts` used to end its import block with
// `export { INVITATION_REGISTER_PATH, invitationRegisterPath };`, justified as
// "so the send path's own callers keep one import". There were no such callers
// — and the cost was never dead code, it was a SECOND DOOR into a module that
// must never reach a client. `email.ts` imports `@/lib/email/client`, which
// constructs a Resend instance at module scope, so
// `import { invitationRegisterPath } from "@/lib/invitations/email"`
// type-checks, works, and ships ~687 KB of SDK into whatever chunk does it.
// The guard below `invitations-list.tsx` only forbade that ONE file.

const SPELLING = String.raw`(?:invitationRegisterPath|INVITATION_REGISTER_PATH)`;

/** `export const/function X`, `export { X }`, `export * from "./register-path"`. */
const EXPORTS_THE_SPELLING = new RegExp(
  [
    String.raw`export\s+(?:async\s+)?(?:const|let|function)\s+${SPELLING}\b`,
    String.raw`export\s*\{[^}]*\b${SPELLING}\b[^}]*\}`,
    String.raw`export\s*\*(?:\s+as\s+\w+)?\s+from\s*["'][^"']*register-path["']`,
  ].join("|")
);

/** Any named import of either symbol, capturing the module it came from. */
const IMPORTS_THE_SPELLING = new RegExp(
  String.raw`import\s+(?:type\s+)?\{[^}]*\b${SPELLING}\b[^}]*\}\s*from\s*["']([^"']+)["']`,
  "g"
);

const THE_ONE_DOOR = path.join(ROOT, "lib", "invitations", "register-path.ts");

test("register-path.ts is the ONLY module that exports the spelling", () => {
  // Not "no module that transitively imports the Resend SDK", which is a
  // property nobody can grep: ONE definition, ONE export, everywhere in src.
  // Any alias is a door, and a door through a module with imports of its own is
  // the bundling bug wearing a re-export.
  const doors = sourceFilesUnder()
    .filter((file) => file !== THE_ONE_DOOR)
    .filter((file) =>
      EXPORTS_THE_SPELLING.test(code(readFileSync(file, "utf8")))
    )
    .map(rel);

  assert.deepEqual(
    doors,
    [],
    "the invite-link spelling is exported from somewhere other than the leaf — re-exporting it from a module with imports (`email.ts` pulls `@/lib/email/client`) puts the Resend SDK one import away from a client chunk"
  );

  // …and the leaf really does still export both, so the check above is not
  // vacuously true of a spelling that has been renamed out from under it.
  const leaf = code(readFileSync(THE_ONE_DOOR, "utf8"));
  assert.match(leaf, /export const INVITATION_REGISTER_PATH\b/);
  assert.match(leaf, /export function invitationRegisterPath\b/);
});

test("no page or component reaches the spelling through anything but the leaf", () => {
  const offenders: string[] = [];

  for (const file of [
    ...sourceFilesUnder("app"),
    ...sourceFilesUnder("components"),
  ]) {
    const source = code(readFileSync(file, "utf8"));

    for (const match of source.matchAll(IMPORTS_THE_SPELLING)) {
      if (match[1] === "@/lib/invitations/register-path") continue;

      offenders.push(`${rel(file)} imports it from "${match[1]}"`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a page or component must reach the invite-link spelling at "@/lib/invitations/register-path" and nowhere else — every other path drags an import graph with it:\n${offenders.join("\n")}`
  );
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

// ----------------------------------------------------------------------------
// 4. …and the PROSE does not describe the stopgap either
// ----------------------------------------------------------------------------

// THE RULE REACHES THE COPY, COMMENTS INCLUDED (`memory/invariants.md`, the
// 2026-08-12 #293 × #304 reconciliation). The first sweep read components, so a
// refusal MESSAGE that said "copy the link and send it yourself" survived it;
// the second sweep read messages, so three DOCBLOCKS survived that — `email.ts`
// rule 1 and two in `service.ts`, each still calling the email "best-effort
// delivery of a link the admin can also copy" and naming the link as the
// fallback for a failed send. Nothing was wrong at runtime. What was wrong is
// that the three documents a next implementer reads first described a retired
// stopgap as the design, on a page where reintroducing it has been ruled out
// twice.
//
// So this guard runs over the WHOLE FILE, comments and all — `code()` is
// deliberately NOT applied — and over every module that has ever carried the
// sentence. Patching the instances is not the fix; closing the class is.
//
// `resend.ts` is deliberately NOT in the list. Its `INVITATION_SEND_FAILED_MESSAGE`
// docblock QUOTES the retired sentence to record that it was removed and must
// not come back, which is the opposite of describing it as the design — the
// same thing `memory/` does. A module that quotes it to forbid it has to be
// able to name it.
const NO_ADMIN_LINK_PROSE = [
  ["lib", "invitations", "email.ts"],
  ["lib", "invitations", "service.ts"],
  ["lib", "invitations", "core.ts"],
  ["lib", "invitations", "create-notice.ts"],
] as const;

const RETIRED_STOPGAP =
  /copy the link|the link as (the )?fallback|admin can also copy|hands the admin the link/i;

test("no module still documents the admin's copy of the link as the recovery", () => {
  for (const segments of NO_ADMIN_LINK_PROSE) {
    const source = read(...segments);
    const where = segments.join("/");

    assert.doesNotMatch(
      source,
      RETIRED_STOPGAP,
      `${where} still names the admin's copy of the invite link — the recovery is "Resend email" on the row (#304 ruling 4 item 5, #293)`
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
