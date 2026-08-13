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
// AND IT WAS STILL HALF-APPLIED (swept 2026-08-13, #411). This domain has THREE
// import-free leaves, all of them for the same bundling reason, and `email.ts`
// imported and re-exported the second one — `RESEND_DEDUPE_WINDOW_MS`,
// `resendDedupeWindowAt`, `ResendDedupeWindow` — eighty lines below the comment
// explaining why it must never do that to the first. Same justification ("every
// existing importer"), same zero importers, same open door, for four months. A
// rule enforced against one symbol is a rule that will be broken by the next
// one, so the guard is now a WALK OVER A TABLE OF LEAVES: add the leaf, get the
// property. `sourceFilesUnder()` already skips suites, which is what lets a
// suite name the export it forbids.
//
// AND THE TABLE IS DERIVED, NOT REMEMBERED (round 2, same day). The first cut of
// that table enumerated two of the three — `create-notice.ts`, import-free by
// its own header and held by the `"use client"` create form, had no row, so it
// received none of the four rules while `memory/invariants.md` recorded the
// guard at "every import-free leaf in `src/lib/invitations/`". That is this
// section's own thesis failing one level up: the list was as wide as somebody's
// memory of the domain. The completeness test below asks the DIRECTORY instead
// and fails naming any import-free module with no row, so the fourth leaf
// cannot be missed the way the third one was.

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
    // The create form's words. Import-free by its own header for the same
    // reason as the other two — `invitation-create-form.tsx` is `"use client"`
    // and holds it — and registered here 2026-08-13 (#411 round 2), which is
    // when the table stopped being a list somebody maintained and started
    // being one the completeness rule below derives from the directory. Nothing
    // re-exports it today; that is exactly the state `resend-window` was in
    // before somebody added the door this sweep closed.
    file: ["lib", "invitations", "create-notice.ts"] as const,
    specifier: "@/lib/invitations/create-notice",
    barrelPath: "create-notice",
    symbols: [
      "INVITATION_EMAIL_FAILED_HEADLINE",
      "InvitationNoticeState",
      "InvitationCreatedNotice",
      "invitationCreatedNotice",
    ],
  },
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

/**
 * The three spellings of "this module reaches another module", with the reason
 * each one is fatal to a leaf.
 *
 * ONE definition, because two consumers ask the same question for two different
 * purposes: rule 1 asserts that every REGISTERED leaf still matches none of
 * them, and the completeness rule below asks which UNREGISTERED modules match
 * none of them — i.e. which files are leaves that nobody wrote a row for. Two
 * hand-written copies of "is this import-free" is how the table and the
 * directory would disagree about what a leaf is, which is the drift this whole
 * section exists to prevent.
 */
const IMPORT_FORMS: readonly { pattern: RegExp; why: string }[] = [
  // Both spellings — a static `import` and a dynamic `import(...)` — because
  // either one is enough to drag `@/lib/email/client` back in behind it.
  { pattern: /^\s*import[\s{*]/m, why: "a client component holds this" },
  { pattern: /\bimport\s*\(/, why: "no dynamic import" },
  { pattern: /\brequire\s*\(/, why: "no require" },
];

function importsNothing(source: string): boolean {
  return IMPORT_FORMS.every(({ pattern }) => !pattern.test(source));
}

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

    for (const { pattern, why } of IMPORT_FORMS) {
      assert.doesNotMatch(
        source,
        pattern,
        `${where} must stay import-free — ${why}`
      );
    }

    // And it must not be re-marked server-only, which would be the same failure
    // wearing a different hat.
    assert.doesNotMatch(source, /"use server"|"server-only"/, where);
  }
});

test("DOMAIN_LEAVES names EVERY import-free module in this domain", () => {
  // THE TABLE IS DERIVED FROM THE DIRECTORY, not maintained beside it. Rules 1
  // and 2 are only as wide as this list, so a leaf with no row gets none of
  // them — which is not hypothetical: this table shipped enumerating TWO of the
  // domain's THREE import-free modules (`create-notice.ts` was missing, and
  // `register-path.ts`'s own header names it as following the same rule) while
  // `memory/invariants.md` recorded the guard as running at EVERY import-free
  // leaf. That is the same failure one level up: a rule enforced against the
  // instances somebody remembered.
  //
  // So the question is asked of the FILESYSTEM. Any `.ts`/`.tsx` under
  // `src/lib/invitations/` that imports nothing is a leaf by this section's own
  // definition — a `"use client"` module can hold it, so it needs the four
  // rules — and it must have a row. Adding the fourth leaf is adding the row;
  // forgetting is a failure here, naming the file.
  const registered = new Set(
    DOMAIN_LEAVES.map((leaf) => path.join(ROOT, ...leaf.file))
  );

  const unregistered = sourceFilesUnder("lib", "invitations")
    .filter((file) => importsNothing(code(readFileSync(file, "utf8"))))
    .filter((file) => !registered.has(file))
    .map(rel);

  assert.deepEqual(
    unregistered,
    [],
    `import-free module(s) in this domain with no row in DOMAIN_LEAVES — a leaf with no row gets none of the four rules:\n${unregistered.join("\n")}`
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
// deliberately NOT applied — and over EVERY module in the domain. Patching the
// instances is not the fix; closing the class is, and a hand-written list of the
// four modules that had carried the sentence was still the instances: sweep 3
// listed `email.ts`, `service.ts`, `core.ts` and `create-notice.ts` while
// `audit.ts`, `history.ts`, `list-row.ts` and `resend-window.ts` could say it
// freely. The directory is the list (round 2 of the 2026-08-13 sweep, #411) —
// the same move `DOMAIN_LEAVES`'s completeness rule makes one section up, and
// `sourceFilesUnder()` already skips suites.
//
// `resend.ts` is the ONE named exclusion. Its `INVITATION_SEND_FAILED_MESSAGE`
// docblock QUOTES the retired sentence to record that it was removed and must
// not come back, which is the opposite of describing it as the design — the
// same thing `memory/` does. A module that quotes it to forbid it has to be
// able to name it.
const QUOTES_THE_RETIRED_STOPGAP_TO_FORBID_IT = path.join(
  ROOT,
  "lib",
  "invitations",
  "resend.ts"
);

const NO_ADMIN_LINK_PROSE = sourceFilesUnder("lib", "invitations").filter(
  (file) => file !== QUOTES_THE_RETIRED_STOPGAP_TO_FORBID_IT
);

const RETIRED_STOPGAP =
  /copy the link|the link as (the )?fallback|admin can also copy|hands the admin the link/i;

test("no module still documents the admin's copy of the link as the recovery", () => {
  // The exclusion is asserted, not assumed: if `resend.ts` is renamed or moved,
  // this filter would silently stop excluding anything and the guard would fail
  // on a module that is allowed to quote the sentence.
  assert.ok(
    sourceFilesUnder("lib", "invitations").includes(
      QUOTES_THE_RETIRED_STOPGAP_TO_FORBID_IT
    ),
    "resend.ts is excluded by name — update the exclusion if the module moved"
  );

  for (const file of NO_ADMIN_LINK_PROSE) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      RETIRED_STOPGAP,
      `${rel(file)} still names the admin's copy of the invite link — the recovery is "Resend email" on the row (#304 ruling 4 item 5, #293)`
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
//
// THE VERB CARRIES EVERY TENSE, and that is the class rather than one of its
// instances (widened 2026-08-13, #411 review round 1). The founding sentence —
// `register-path.ts`'s old header, "belongs one layer up in `./email.ts`, which
// re-exports both names" — walked straight past a `re-exports?` needle the
// moment a next implementer wrote it as "which re-exported both names", because
// the literal alternatives cover only two other spellings. The OBJECT is what
// keeps this narrow: every historical narration in the domain today says
// "re-exported FROM", "re-export WAS/HERE", "re-exporting THESE",
// "re-exports ARE", "RE-EXPORTS NEITHER" — none of those objects is in the
// alternation, so describing a deleted door stays legal and claiming a live one
// does not.
const CLAIMS_A_SECOND_DOOR =
  /\bre-export(?:s|ed|ing)?\s+(?:both|it|them|the\s+(?:window|spelling|names))|re-exported so a reader|every existing importer/i;

// EVERY MODULE IN THE DOMAIN, which is what the rule actually claims — the same
// move `DOMAIN_LEAVES`'s completeness rule makes one section up, applied to this
// scan rather than restated beside it.
//
// It shipped as a hand-written half-list and that was the very drift it names:
// the leaf half derived itself from `DOMAIN_LEAVES` and then hand-listed three
// trunk modules (`email.ts`, `resend.ts`, `service.ts`), so `audit.ts`,
// `core.ts`, `history.ts` and `list-row.ts` — ten modules in the domain, four
// invisible to the guard — could describe a leaf as re-exported and pass.
// `core.ts` is the one a next implementer greps first. Any module can carry the
// claim, so every module is scanned; raw, comments included, because the claim
// lives in prose.
const LEAF_PROSE = sourceFilesUnder("lib", "invitations");

test("no module documents a leaf as reachable through the trunk", () => {
  for (const file of LEAF_PROSE) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      CLAIMS_A_SECOND_DOOR,
      `${rel(file)} describes an import-free leaf as re-exported from a module with imports — there is ONE door per leaf, and it is the leaf (see DOMAIN_LEAVES above)`
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
