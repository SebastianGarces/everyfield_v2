import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { stripComments } from "@/lib/testing/source-span";

// ----------------------------------------------------------------------------
// NEITHER PICTURE'S STORAGE KEY CROSSES TO THE BROWSER (CS-004, #617, #654).
//
// Two columns hold a PRIVATE-BUCKET KEY: `users.avatar_key` and
// `persons.photo_url` (whose name says otherwise, which is the reason every
// reader of it needs a docblock). The whole design rests on nothing outside
// this server holding one: each serving route trusts the key it reads precisely
// because no client-supplied value can reach it, and no signed URL is ever
// minted, because a signed URL is a bearer token anybody who copied it out of
// the markup could use.
//
// TWO CHANNELS, because a prop is not the only way a value reaches the browser.
// In the App Router a prop handed to a `"use client"` component rides in the RSC
// payload whether it is rendered or not — and so does a Server Action's RETURN
// VALUE, serialized into the response the caller reads. That second one is how
// the avatar key leaked in #617's first draft: `AvatarOutcome` carried it,
// nothing read it, and a scan for the identifier in client modules saw nothing
// at all, because a leaked VALUE is not a leaked IDENTIFIER.
//
// ONE FENCE COVERS BOTH CHANNELS, which is why this file no longer has a test
// per channel. Instead of asking "does a client module name the key" and then
// "does the action module return it", it asks the only question that has a
// single answer: WHERE MAY THIS KEY BE NAMED AT ALL? Everywhere else under
// `src/` — client component, server action, helper, fixture — naming it fails.
// A prop leak and a return-value leak are then the same failure, and so is the
// shape both earlier scans missed:
//
//     const result = { ok: true, avatarKey: key };
//     return result;
//
// That names no union member and returns no literal, so a shape-matching scan
// walks past it — and TypeScript does too, because excess-property checking
// applies only to a fresh object literal assigned or returned directly. A fence
// on WHERE, not on WHAT SHAPE, has nothing to enumerate and nothing to escape.
//
// #654 IS WHY IT COVERS BOTH KEYS. Until then this file scanned `avatar_key`
// alone and said so: `persons.photo_url` crossed to the browser on every person
// row, so widening the scan would have failed on code that issue did not write.
// `toPersonForClient` now trades that key for the route it resolves to, at the
// one boundary the people domain already had, so there is no longer an
// asymmetry to record — and `memory/invariants.md` says that instead.
//
// THIS IS A RATCHET, not a proof of today's payload. It fails the moment a new
// module names a key, which is the shape this mistake has every time: a prop
// added "just to know whether a picture is set", when an undefined `src`
// already answers that.
// ----------------------------------------------------------------------------

const ROOT = process.cwd();

/**
 * One key, and the complete list of places it may be written.
 *
 * `onlyInside` narrows a file to a single construct. Exactly one file needs it:
 * `auth/avatar.ts` both talks to Postgres about the key AND returns values to a
 * `"use client"` caller, so "this file may name it" is too coarse — the Drizzle
 * column mapping inside its effects object is the one place the key belongs,
 * and anywhere else in that module it is heading somewhere it should not.
 */
type KeyFence = {
  /** For the failure message: what the reader is looking at. */
  subject: string;
  /**
   * The key written as an IDENTIFIER, in every spelling.
   *
   * `avatarSrc` and `photoSrc` are the values that MAY cross, so the patterns
   * must not match them — hence the word boundaries and the exact names rather
   * than a bare /avatar/ or /photo/.
   */
  key: RegExp;
  allowed: { file: string; onlyInside?: string }[];
  /** What to do instead, said in the failure. */
  guidance: string;
};

const FENCES: KeyFence[] = [
  {
    subject: "users.avatar_key",
    key: /\b(avatarKey|avatar_key)\b/,
    allowed: [
      // The column itself.
      { file: "src/db/schema/user.ts" },
      // The writer — but only where it talks to Postgres. See `onlyInside`.
      { file: "src/lib/auth/avatar.ts", onlyInside: "LIVE_AVATAR_EFFECTS" },
      // The resolver that turns a key into a route. Import-free leaf, and the
      // key is its PARAMETER — what it returns is the route.
      { file: "src/lib/profile-photo.ts" },
      // The serving route, reading the key off the session row.
      { file: "src/app/api/account/avatar/route.ts" },
      // The two SERVER readers that resolve the key before handing a route
      // down: the dashboard layout (for the sidebar) and the settings modal's
      // read (for the Account section).
      //
      // The Account SECTION is no longer one of them (#657). It became a
      // `"use client"` component fed by a view model, so the key stops in
      // `readAccount` — which is the boundary this file is about, drawn one step
      // earlier than before rather than moved.
      { file: "src/app/(dashboard)/layout.tsx" },
      { file: "src/lib/settings/section-data.ts" },
    ],
    guidance:
      'resolve it to a route with userAvatarSrc() on the server and pass that instead — `avatarSrc` being undefined already says "no picture"',
  },
  {
    subject: "persons.photo_url",
    // `photoKey` is the same value under the name the server-side reads give
    // it, and it is fenced too: renaming a variable is the cheapest way to walk
    // past a scan that only knows the column's spelling.
    key: /\b(photoUrl|photo_url|photoKey)\b/,
    allowed: [
      // The column itself.
      { file: "src/db/schema/people.ts" },
      // The one read, the one writer, and the effects seam between them — all
      // in one small module, so this entry is as narrow as the avatar's.
      { file: "src/lib/people/person-photo.ts" },
      // The boundary: where the key stops and the route starts.
      { file: "src/lib/people/types.ts" },
      // The resolver, as above — the key is its parameter.
      { file: "src/lib/profile-photo.ts" },
      // The serving route.
      { file: "src/app/api/people/[personId]/photo/route.ts" },
    ],
    guidance:
      'a person row reaches the browser through toPersonForClient(), which trades this key for `photoSrc` — read that instead, and `undefined` already says "no photo"',
  },
];

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
 * The lines of `source` that name `key`, with comments gone first.
 *
 * Comments go first for the reason `cursor-pointer.test.ts` strips them: a
 * source-shaped test that matches raw text accepts PROSE as its subject, and
 * nearly every file in the allowlist explains this very rule in a docblock that
 * names the key. Reading the comments would make documenting the rule break the
 * test that enforces it.
 *
 * With `onlyInside`, the named construct is cut out before the scan — so the
 * Drizzle column mapping inside it is not a leak, and everything after it is.
 */
export function keyLinesIn(
  source: string,
  key: RegExp,
  onlyInside?: string
): string[] {
  const code = stripComments(source);

  let scanned = code;

  if (onlyInside) {
    const start = code.indexOf(`const ${onlyInside}`);
    const end = code.indexOf("\n};", start);

    if (start < 0 || end < 0) {
      // Fail loudly rather than fence nothing and pass. A rename here must be a
      // decision somebody makes, not a guard that quietly stops guarding.
      return [`${onlyInside} is not where this fence expects it`];
    }

    scanned = code.slice(0, start) + code.slice(end + 3);
  }

  return scanned
    .split("\n")
    .filter((line) => key.test(line))
    .map((line) => line.trim());
}

/** Every place under `src/` that names the fenced key and may not. */
function keyLeaks(fence: KeyFence): string[] {
  const allowance = new Map(
    fence.allowed.map(({ file, onlyInside }) => [file, onlyInside])
  );

  return sourceFiles(path.join(ROOT, "src")).flatMap((file) => {
    const relative = path.relative(ROOT, file);

    // Allowed outright: the column, the resolver, the serving route. Nothing to
    // scan — the key is this file's business.
    if (allowance.has(relative) && !allowance.get(relative)) return [];

    const lines = keyLinesIn(
      readFileSync(file, "utf8"),
      fence.key,
      allowance.get(relative)
    );

    return lines.map((line) => `${relative}: ${line}`);
  });
}

for (const fence of FENCES) {
  test(`${fence.subject} is named ONLY where it is allowed to be`, () => {
    const leaks = keyLeaks(fence);

    assert.deepEqual(
      leaks,
      [],
      `these modules name ${fence.subject}, a private-bucket key. A prop on a "use client" component and a Server Action's return value both ride to the browser, so either one is the key in the network payload — ${fence.guidance}:\n  ${leaks.join("\n  ")}`
    );
  });

  test(`the allowlist for ${fence.subject} has no dead entries`, () => {
    // An allowlist that outlives its reason is permission nobody asked for. If a
    // file stops naming the key, the entry goes — otherwise the next edit to
    // that file inherits an exemption granted for something else entirely.
    const dead = fence.allowed
      .map(({ file }) => file)
      .filter(
        (file) =>
          !fence.key.test(
            stripComments(readFileSync(path.join(ROOT, file), "utf8"))
          )
      );

    assert.deepEqual(
      dead,
      [],
      `these files are allowed to name ${fence.subject} but no longer do — delete the entry:\n  ${dead.join("\n  ")}`
    );
  });
}

test("every surface that draws a picture takes a route, and it is not a key", () => {
  // The positive half. The fences above say where a key may NOT appear; this
  // says what the drawing surfaces hold INSTEAD, so a component that stopped
  // drawing a picture altogether cannot pass by having nothing at all.
  // EACH PATTERN IS THE DECLARATION, not the word. The first row shipped as a
  // bare /src/ — satisfied by any `src=` attribute in the file, so deleting the
  // control's route prop outright left it green. A guard that cannot go red is
  // the failure mode this whole file exists to prevent, one level up.
  for (const [relative, declaration] of [
    ["src/components/picture-field.tsx", /src: string \| undefined;/],
    ["src/components/picture-field.tsx", /storedSrc: src,/],
    [
      "src/components/settings/avatar-field.tsx",
      /avatarSrc: string \| undefined;/,
    ],
    ["src/components/nav-user.tsx", /avatarSrc/],
    [
      "src/components/people/person-photo-field.tsx",
      /src=\{person\.photoSrc\}/,
    ],
    ["src/components/people/person-header.tsx", /src=\{person\.photoSrc\}/],
    ["src/components/people/person-card.tsx", /src=\{person\.photoSrc\}/],
  ] as [string, RegExp][]) {
    const code = stripComments(readFileSync(path.join(ROOT, relative), "utf8"));

    assert.match(
      code,
      declaration,
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

const AVATAR_KEY = FENCES[0].key;

test("the fence sees every shape the key can leave in", () => {
  // THE FIXTURE CALLS THE REAL FUNCTION. An earlier draft of this file
  // re-implemented the slicing and matching inline, which proved a COPY of the
  // guard could see a leak — edit the shipped one and this stayed green, the
  // same failure one level up from the one it exists to prevent.
  const leaksIn = (source: string) =>
    keyLinesIn(source, AVATAR_KEY, "LIVE_AVATAR_EFFECTS");

  assert.deepEqual(
    leaksIn(
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
    leaksIn(
      moduleWithTail(
        "export async function f() {\n  const result = { ok: true, avatarKey: key };\n  return result;\n}"
      )
    ),
    ["const result = { ok: true, avatarKey: key };"]
  );

  // The original leak: a union member.
  assert.deepEqual(
    leaksIn(
      moduleWithTail(
        "export type AvatarOutcome =\n  | { ok: true; avatarKey: string | null }\n  | { ok: false; message: string };"
      )
    ),
    ["| { ok: true; avatarKey: string | null }"]
  );

  // And a return literal, the shape the replaced scan did catch.
  assert.deepEqual(
    leaksIn(
      moduleWithTail(
        "export async function f() { return { ok: true, avatarKey: key }; }"
      )
    ),
    ["export async function f() { return { ok: true, avatarKey: key }; }"]
  );

  // A renamed or deleted fence must FAIL, never silently fence nothing.
  assert.deepEqual(
    leaksIn("export type AvatarOutcome = { ok: true; avatarKey: string };"),
    ["LIVE_AVATAR_EFFECTS is not where this fence expects it"]
  );
});

test("both patterns can actually see a violation, and neither bites the route", () => {
  // A scan passes trivially if its pattern never matches anything. These are the
  // shapes the fences exist to catch, pinned so a future edit to a pattern that
  // quietly stops matching fails HERE rather than passing there.
  const [avatar, photo] = FENCES;

  const cases: { fence: KeyFence; violation: string; permitted: string }[] = [
    {
      fence: avatar,
      violation: "type Props = { avatarKey: string | null };",
      permitted: "type Props = { avatarSrc?: string };",
    },
    {
      fence: photo,
      violation: "type Props = { photoUrl: string | null };",
      permitted: "type Props = { photoSrc?: string };",
    },
    // The rename escape: the same value under the name the server reads give it.
    {
      fence: photo,
      violation: "const photoKey = row.photo_url;",
      permitted: "const photoSrc = person.photoSrc;",
    },
  ];

  for (const { fence, violation, permitted } of cases) {
    assert.equal(
      fence.key.test(violation),
      true,
      `${fence.subject}'s pattern must match: ${violation}`
    );
    assert.equal(
      fence.key.test(permitted),
      false,
      `the route is the value that MAY cross — a pattern matching \`${permitted}\` would refuse the correct code`
    );
  }
});
