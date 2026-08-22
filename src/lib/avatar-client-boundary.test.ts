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

/**
 * Every line of `avatar.ts` that names the storage key OUTSIDE the one place
 * allowed to — the offending lines, so a failure says which.
 *
 * A FENCE, NOT A SCAN OF SHAPES, and that is the second rewrite of this guard.
 * The first looked for the key inside `AvatarOutcome`'s declaration and inside
 * `return { ok: true … }` literals. Both were escapable, and the escape is the
 * shape somebody would actually write by accident:
 *
 *     const result = { ok: true, avatarKey: key };
 *     return result;
 *
 * That names no union member and returns no literal, so both scans missed it —
 * and TypeScript misses it too, because excess-property checking applies only to
 * a fresh object literal assigned or returned directly. Neither the type nor the
 * test stopped the realistic mistake.
 *
 * So this asserts where the key may APPEAR instead of what shape it may take.
 * `LIVE_AVATAR_EFFECTS` is the one construct with any business naming it — there
 * it is the Drizzle column mapping, on the server, talking to Postgres. Anywhere
 * else in this module the key is heading somewhere it should not, whether it goes
 * through a type, a literal, a variable or a nested object. One rule, nothing to
 * slice, and no shape to enumerate.
 */
export function avatarKeyLeaksIn(source: string): string[] {
  const code = stripComments(source);

  const start = code.indexOf("const LIVE_AVATAR_EFFECTS");
  const end = code.indexOf("\n};", start);
  if (start < 0 || end < 0) {
    // Fail loudly rather than fence nothing and pass. A rename here must be a
    // decision somebody makes, not a guard that quietly stops guarding.
    return ["LIVE_AVATAR_EFFECTS is not where this fence expects it"];
  }

  const outside = code.slice(0, start) + code.slice(end + 3);

  return outside
    .split("\n")
    .filter((line) => AVATAR_KEY.test(line))
    .map((line) => line.trim());
}

test("the storage key is named ONLY where it talks to Postgres", () => {
  // THE OTHER CHANNEL, and the one the client-module scan cannot see. A prop is
  // not the only way a value reaches the browser: a Server Action's RETURN VALUE
  // is serialized into the response the caller reads, so a key anywhere on the
  // way out of this module is a key in the network payload. That is exactly how
  // #617 shipped its first draft — `AvatarOutcome` carried `avatarKey`, nothing
  // read it, and the module scan saw nothing because the leak was a VALUE and
  // that scan matches IDENTIFIERS in OTHER files.
  const leaks = avatarKeyLeaksIn(
    readFileSync(path.join(ROOT, "src/lib/auth/avatar.ts"), "utf8")
  );

  assert.deepEqual(
    leaks,
    [],
    `avatar.ts names the storage key outside LIVE_AVATAR_EFFECTS. Everything here is returned to a "use client" caller, so a key on any of these lines is a key in the browser:\n  ${leaks.join("\n  ")}`
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

/**
 * A module shaped like `avatar.ts`: the effects object, then whatever `tail`
 * puts below it. The fence must ignore the first and read the second.
 */
function moduleWithTail(tail: string): string {
  return [
    "const LIVE_AVATAR_EFFECTS: UserAvatarEffects = {",
    "  load: async (userId) => {",
    "    const [row] = await db.select({ avatarKey: users.avatarKey });",
    "    return row?.avatarKey;",
    "  },",
    "  write: async (userId, key) => {",
    "    await db.update(users).set({ avatarKey: key });",
    "  },",
    "};",
    "",
    tail,
  ].join("\n");
}

test("the fence sees every shape the key can leave in", () => {
  // THE FIXTURE CALLS THE REAL FUNCTION. An earlier draft of this file
  // re-implemented the slicing and matching inline, which proved a COPY of the
  // guard could see a leak — edit the shipped one and this stayed green, the
  // same failure one level up from the one it exists to prevent.
  assert.deepEqual(
    avatarKeyLeaksIn(
      moduleWithTail("export async function f() { return { ok: true }; }")
    ),
    [],
    "the Drizzle column mapping inside the effects object is not a leak — it is the one place the key belongs"
  );

  // The shape the first two drafts of this guard both missed, and the one
  // TypeScript misses too: excess-property checking applies only to a fresh
  // literal returned directly, so a key parked in a variable first typechecks
  // against `{ ok: true }` and ships.
  assert.deepEqual(
    avatarKeyLeaksIn(
      moduleWithTail(
        "export async function f() {\n  const result = { ok: true, avatarKey: key };\n  return result;\n}"
      )
    ),
    ["const result = { ok: true, avatarKey: key };"]
  );

  // The original leak: a union member.
  assert.deepEqual(
    avatarKeyLeaksIn(
      moduleWithTail(
        "export type AvatarOutcome =\n  | { ok: true; avatarKey: string | null }\n  | { ok: false; message: string };"
      )
    ),
    ["| { ok: true; avatarKey: string | null }"]
  );

  // And a return literal, the shape the replaced scan did catch.
  assert.deepEqual(
    avatarKeyLeaksIn(
      moduleWithTail(
        "export async function f() { return { ok: true, avatarKey: key }; }"
      )
    ),
    ["export async function f() { return { ok: true, avatarKey: key }; }"]
  );

  // A renamed or deleted fence must FAIL, never silently fence nothing.
  assert.deepEqual(
    avatarKeyLeaksIn(
      "export type AvatarOutcome = { ok: true; avatarKey: string };"
    ),
    ["LIVE_AVATAR_EFFECTS is not where this fence expects it"]
  );
});

test("the client-module scan can actually see a violation", () => {
  // That scan passes trivially if the pattern never matches anything. This is
  // the shape it exists to catch, pinned so a future edit to the pattern that
  // quietly stops matching fails HERE rather than passing there.
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
