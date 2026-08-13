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

// A LEAF WHOSE CONTENTS ARE ALSO SERVED FROM THE TRUNK IS NOT A LEAF. The tests
// below close the class the one above only closes an instance of.
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
//
// AND IT WAS STILL HALF-APPLIED (swept 2026-08-13, #411). This domain has TWO
// import-free leaves, both of them for the same bundling reason, and `email.ts`
// imported and re-exported the second one — `RESEND_DEDUPE_WINDOW_MS`,
// `resendDedupeWindowAt`, `ResendDedupeWindow` — eighty lines below the comment
// explaining why it must never do that to the first. Same justification ("every
// existing importer"), same zero importers, same open door, for four months. A
// rule enforced against one symbol is a rule that will be broken by the next
// one, so the guard is now a WALK OVER A TABLE OF LEAVES: add the leaf, get the
// property. `sourceFilesUnder()` already skips suites, which is what lets a
// suite name the export it forbids.

/**
 * Every import-free module in this domain, with the symbols it alone may export.
 *
 * `file` locates the one door; `symbols` is its WHOLE public surface, which is
 * both what a second door would be spelled with and what the leaf itself is
 * asserted to still declare; `barrelPath` is the specifier fragment an
 * `export * from` would carry. A leaf's whole value is that a `"use client"`
 * module can hold it, so every entry here is also covered by rule 1 (no imports
 * at all), which runs off this same table.
 *
 * ONE LIST, not a list plus a list of declarations to match it: the pair drifts,
 * and a `declarations` array that had lost a symbol is precisely how a renamed
 * export would make the door scan vacuously true. `declaresEverySymbol` derives
 * what to look for from `symbols` itself.
 */
const DOMAIN_LEAVES = [
  {
    file: ["lib", "invitations", "register-path.ts"] as const,
    specifier: "@/lib/invitations/register-path",
    barrelPath: "register-path",
    symbols: ["INVITATION_REGISTER_PATH", "invitationRegisterPath"],
  },
  {
    file: ["lib", "invitations", "resend-window.ts"] as const,
    specifier: "@/lib/invitations/resend-window",
    barrelPath: "resend-window",
    symbols: [
      "RESEND_DEDUPE_WINDOW_MS",
      "ResendDedupeWindow",
      "resendDedupeWindowAt",
      "ResendCooldownCount",
      "resendCooldownRemainingMs",
      "resendCooldownSecondsLeft",
      "resendCooldownLabel",
    ],
  },
] as const;

function spellingOf(symbols: readonly string[]): string {
  return `(?:${symbols.join("|")})`;
}

/** `export const|let|function|interface|type X` — a DECLARED export of one name. */
function declares(symbol: string): RegExp {
  return new RegExp(
    String.raw`export\s+(?:async\s+)?(?:const|let|function|interface|type)\s+${symbol}\b`
  );
}

/** `export const/function/interface X`, `export { X }`, `export * from "./<leaf>"`. */
function exportsTheSpelling(leaf: (typeof DOMAIN_LEAVES)[number]): RegExp {
  const spelling = spellingOf(leaf.symbols);

  return new RegExp(
    [
      declares(spelling).source,
      String.raw`export\s*\{[^}]*\b${spelling}\b[^}]*\}`,
      String.raw`export\s*\*(?:\s+as\s+\w+)?\s+from\s*["'][^"']*${leaf.barrelPath}["']`,
    ].join("|")
  );
}

/** Any named import of one of the leaf's symbols, capturing the module it came from. */
function importsTheSpelling(leaf: (typeof DOMAIN_LEAVES)[number]): RegExp {
  return new RegExp(
    String.raw`import\s+(?:type\s+)?\{[^}]*\b${spellingOf(leaf.symbols)}\b[^}]*\}\s*from\s*["']([^"']+)["']`,
    "g"
  );
}

test("each import-free leaf is the ONLY module that exports its spelling", () => {
  // Not "no module that transitively imports the Resend SDK", which is a
  // property nobody can grep: ONE definition, ONE export, everywhere in src.
  // Any alias is a door, and a door through a module with imports of its own is
  // the bundling bug wearing a re-export.
  for (const leaf of DOMAIN_LEAVES) {
    const theOneDoor = path.join(ROOT, ...leaf.file);
    const pattern = exportsTheSpelling(leaf);

    const doors = sourceFilesUnder()
      .filter((file) => file !== theOneDoor)
      .filter((file) => pattern.test(code(readFileSync(file, "utf8"))))
      .map(rel);

    assert.deepEqual(
      doors,
      [],
      `${leaf.specifier} is exported from somewhere other than the leaf — re-exporting it from a module with imports (\`email.ts\` pulls \`@/lib/email/client\`) puts the Resend SDK one import away from a client chunk`
    );

    // …and the leaf really does still declare EVERY symbol the table names, so
    // the scan above is not vacuously true of a spelling that has been renamed
    // out from under it — and the table cannot quietly stop covering an export
    // the leaf still has.
    const source = code(readFileSync(theOneDoor, "utf8"));
    for (const symbol of leaf.symbols) {
      assert.match(
        source,
        declares(symbol),
        `${leaf.specifier} no longer declares ${symbol} — update DOMAIN_LEAVES`
      );
    }
  }
});

test("no page or component reaches a leaf through anything but the leaf", () => {
  const offenders: string[] = [];

  for (const file of [
    ...sourceFilesUnder("app"),
    ...sourceFilesUnder("components"),
  ]) {
    const source = code(readFileSync(file, "utf8"));

    for (const leaf of DOMAIN_LEAVES) {
      for (const match of source.matchAll(importsTheSpelling(leaf))) {
        if (match[1] === leaf.specifier) continue;

        offenders.push(
          `${rel(file)} imports ${leaf.specifier} from "${match[1]}"`
        );
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `a page or component must reach an import-free leaf at its own specifier and nowhere else — every other path drags an import graph with it:\n${offenders.join("\n")}`
  );
});

test("every import-free leaf really imports nothing", () => {
  // RULE 1, off the same table as rule 2 — one list, both properties, so a
  // third leaf gets both by being added once. It used to be two hand-written
  // tests in two files (`register-path.ts` here, `resend-window.ts` in
  // `resend.test.ts` §7), which is how the second leaf ended up with rule 1 and
  // without rule 2 for four months.
  for (const leaf of DOMAIN_LEAVES) {
    const where = leaf.file.join("/");
    const source = code(read(...leaf.file));

    // Both spellings — a static `import` and a dynamic `import(...)` — because
    // either one is enough to drag `@/lib/email/client` back in behind it.
    assert.doesNotMatch(
      source,
      /^\s*import[\s{*]/m,
      `${where} must stay import-free: a client component holds this`
    );
    assert.doesNotMatch(source, /\bimport\s*\(/, `${where}: no dynamic import`);
    assert.doesNotMatch(source, /\brequire\s*\(/, `${where}: no require`);

    // And it must not be re-marked server-only, which would be the same failure
    // wearing a different hat.
    assert.doesNotMatch(source, /"use server"|"server-only"/, where);
  }
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

// …AND NO MODULE DESCRIBES THE SECOND DOOR AS THE DESIGN (swept 2026-08-13,
// #411). The same failure shape, one rule over: `register-path.ts`'s own header
// read "belongs one layer up in `./email.ts`, which re-exports both names" for
// the three months AFTER that re-export was deleted and this suite started
// failing on it. Nothing was wrong at runtime — the document a next implementer
// reads first told them to make the change the guard rejects, and the
// `resend-window` re-export eighty lines below is what that reader would have
// found as precedent.
//
// The needle is the CLAIM, not the word: "re-exported so a reader", "which
// re-exports both names", "every existing importer" were the three sentences
// that justified the two doors. A module may still say it does NOT re-export —
// which is what every leaf-adjacent comment in this domain now says.
const CLAIMS_A_SECOND_DOOR =
  /\bre-exports?\s+(?:both|it|them|the\s+(?:window|spelling|names))|re-exported so a reader|every existing importer/i;

const LEAF_PROSE = [
  ["lib", "invitations", "register-path.ts"],
  ["lib", "invitations", "resend-window.ts"],
  ["lib", "invitations", "email.ts"],
  ["lib", "invitations", "resend.ts"],
  ["lib", "invitations", "service.ts"],
] as const;

test("no module documents a leaf as reachable through the trunk", () => {
  for (const segments of LEAF_PROSE) {
    const source = read(...segments);
    const where = segments.join("/");

    assert.doesNotMatch(
      source,
      CLAIMS_A_SECOND_DOOR,
      `${where} describes an import-free leaf as re-exported from a module with imports — there is ONE door per leaf, and it is the leaf (see DOMAIN_LEAVES above)`
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
