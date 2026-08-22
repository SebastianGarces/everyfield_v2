import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { stripComments } from "@/lib/testing/source-span";

// ----------------------------------------------------------------------------
// `users.avatar_key` DOES NOT CROSS TO THE BROWSER (CS-004, #617).
//
// The column holds a PRIVATE-BUCKET KEY, and the whole design rests on nothing
// outside this server holding one: the avatar route trusts the key it reads
// precisely because no client-supplied value can reach it, and no signed URL is
// ever minted because a signed URL is a bearer token anybody who copied it out
// of the markup could use.
//
// In the App Router a prop handed to a `"use client"` component rides to the
// browser in the RSC payload whether it is rendered or not. So the rule is not
// "don't render the key", it is "don't send it" — the same rule, and the same
// failure mode, that `people/client-boundary.test.ts` guards for
// `persons.user_id`.
//
// TWO CLIENT SURFACES DRAW A PICTURE, and both take a RESOLVED ROUTE:
// `settings/avatar-field.tsx` and `nav-user.tsx`. `userAvatarSrc` turns a key
// into that route, and it runs on the server — in the Account section and in
// the dashboard layout — so the key stops at the boundary both times.
//
// TWO CHANNELS, because a prop is not the only way a value reaches the browser.
// A Server Action's RETURN VALUE is serialized into the response the caller
// reads, and that is how this leaked in #617's first draft: `AvatarOutcome`
// carried the key, nothing read it, and a scan for the identifier in client
// modules saw nothing at all. So there is a test per channel below.
//
// `avatar_key` ONLY, and that is deliberate rather than lazy. `persons.photo_url`
// crosses to the browser today — `person-header.tsx` and `person-photo-field.tsx`
// are client components taking a `PersonForClient` that carries it — so widening
// these scans to that column would fail immediately, on code this issue did not
// write and should not rewrite. The gap is recorded in `memory/invariants.md`
// rather than hidden behind a scan that quietly excludes it.
//
// THIS IS A RATCHET, not a proof of today's payload. It fails the moment a new
// client module names the key, which is the shape this mistake would have: a
// prop added "just to know whether a picture is set", when `avatarSrc`
// undefined already answers that.
// ----------------------------------------------------------------------------

const ROOT = process.cwd();

/**
 * The key written as an IDENTIFIER, in either spelling.
 *
 * `avatarSrc` is the value that MAY cross, so the pattern must not match it —
 * hence the word boundary and the exact names rather than a bare /avatar/.
 */
const AVATAR_KEY = /\b(avatarKey|avatar_key)\b/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }

  return out;
}

/**
 * Every `"use client"` module, paired with its comment-free source.
 *
 * Comments go first for the reason `cursor-pointer.test.ts` strips them: a
 * source-shaped test that matches raw text accepts PROSE as its subject, and
 * `avatar-field.tsx` explains this very rule in a docblock that names the key.
 * Reading the comments would make documenting the rule break the test that
 * enforces it.
 */
function clientModules(): { file: string; code: string }[] {
  return sourceFiles(path.join(ROOT, "src"))
    .map((file) => ({ file, source: readFileSync(file, "utf8") }))
    .filter(({ source }) => /^\s*["']use client["']/m.test(source))
    .map(({ file, source }) => ({ file, code: stripComments(source) }));
}

test("no client module names the avatar storage key", () => {
  const offenders = clientModules()
    .filter(({ code }) => AVATAR_KEY.test(code))
    .map(({ file }) => path.relative(ROOT, file));

  assert.deepEqual(
    offenders,
    [],
    `these "use client" modules name users.avatar_key, which puts a private-bucket key in the RSC payload. Resolve it to a route with userAvatarSrc() on the server and pass that instead — \`avatarSrc\` being undefined already says "no picture"`
  );
});

test("what an avatar action ANSWERS with carries no key either", () => {
  // THE OTHER CHANNEL, and the one the scan above cannot see. A prop is not the
  // only way a value reaches the browser: a Server Action's RETURN VALUE is
  // serialized into the response the caller reads, so a key in the outcome is a
  // key in the network payload of every successful upload. That is exactly how
  // this shipped in #617's first draft — `AvatarOutcome` carried `avatarKey`,
  // nothing read it, and the module scan saw nothing because the leak was a
  // VALUE and the scan matches IDENTIFIERS.
  const code = stripComments(
    readFileSync(path.join(ROOT, "src/lib/auth/avatar.ts"), "utf8")
  );

  // TO THE NEXT DECLARATION, not to the next `;`. A union's own members are
  // separated by semicolons — `{ ok: true; avatarKey: string | null }` — so
  // stopping at the first one reads `| { ok: true` and finds nothing wrong with
  // it. That was this test's first draft, and it passed against the very leak it
  // was written to catch; the fixture at the bottom of this file is what caught
  // the guard.
  const start = code.indexOf("export type AvatarOutcome");
  assert.ok(start >= 0, "AvatarOutcome must still be declared here");
  const rest = code.slice(start);
  const next = rest.search(/\n(export|const|function|\/\*\*)/);
  const outcome = next === -1 ? rest : rest.slice(0, next);
  assert.equal(
    AVATAR_KEY.test(outcome),
    false,
    `AvatarOutcome names the storage key: ${outcome.trim()} — the actions return this straight to a "use client" caller, so a key in it is a key in the browser`
  );

  // And no return statement smuggles one past the type either. `[returned]` is
  // the WHOLE match: the pattern has no capture group, so destructuring index 1
  // (the other first draft) binds undefined and asserts nothing forever.
  for (const [returned] of code.matchAll(/return \{ ok: true[^}]*\}/g)) {
    assert.equal(
      AVATAR_KEY.test(returned),
      false,
      `a success outcome carries the key: ${returned}`
    );
  }
});

test("that guard can see the leak it was written for", () => {
  // BOTH HALVES ABOVE SHIPPED BROKEN and passed against the real leak, which is
  // why this fixture exists: it is the code as #617 first wrote it, and each
  // assertion here is the one the guard failed to make.
  const leaked = [
    "export type AvatarOutcome =",
    "  | { ok: true; avatarKey: string | null }",
    "  | { ok: false; message: string };",
    "",
    "export async function uploadUserAvatar() {",
    "  return { ok: true, avatarKey: key };",
    "}",
  ].join("\n");

  const start = leaked.indexOf("export type AvatarOutcome");
  const rest = leaked.slice(start);
  const next = rest.search(/\n(export|const|function|\/\*\*)/);
  const declaration = next === -1 ? rest : rest.slice(0, next);

  assert.equal(
    AVATAR_KEY.test(declaration),
    true,
    "the declaration slice must reach past the union's own semicolons"
  );

  const returns = [...leaked.matchAll(/return \{ ok: true[^}]*\}/g)].map(
    ([whole]) => whole
  );
  assert.equal(returns.length, 1);
  assert.equal(
    AVATAR_KEY.test(returns[0]),
    true,
    "the return scan must read the whole match, not a capture group that does not exist"
  );
});

test("the two surfaces that draw a picture take a route, and it is not a key", () => {
  for (const relative of [
    "src/components/settings/avatar-field.tsx",
    "src/components/nav-user.tsx",
  ]) {
    const code = stripComments(readFileSync(path.join(ROOT, relative), "utf8"));

    assert.match(
      code,
      /avatarSrc/,
      `${relative} must take the resolved route — it is the only thing about the picture a client component may hold`
    );
  }
});

test("the scan can actually see a violation", () => {
  // The ratchet above passes trivially if the pattern never matches anything.
  // This is the shape it exists to catch, pinned so a future edit to the
  // pattern that quietly stops matching fails HERE rather than passing there.
  const violation = stripComments(
    ['"use client";', "", "type Props = { avatarKey: string | null };"].join(
      "\n"
    )
  );

  assert.equal(AVATAR_KEY.test(violation), true);
  assert.equal(
    AVATAR_KEY.test('"use client";\ntype Props = { avatarSrc?: string };'),
    false,
    "the route is the value that MAY cross — a pattern matching it would refuse the correct code"
  );
});
