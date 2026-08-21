import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { assertInOrder, sourceReader } from "./source-span";

// ============================================================================
// The anchor rule, and the test that makes it a property of the DIRECTORY.
//
// `source-span.ts` exists because a source-shaped test that stops matching its
// own subject passes silently — three times in the invitations domain, all
// invisible. Two shapes rot, and they rot independently:
//
//   1. SLICING. `slice(start, -1)` hands back almost the whole module and
//      `slice(-1, end)` hands back the empty string, so a `doesNotMatch` about
//      one function becomes a claim about all of them or about nothing.
//      Closed by `sourceReader`.
//   2. ORDERING. `assert.ok(a.indexOf(A) < a.indexOf(B))` needs no slice at
//      all: delete `A` and `-1 < N` is TRUE. Closed by `assertInOrder`.
//
// Sweep 3 closed (1) and recorded the closure as total, which left (2) open in
// nine places — the pass's own theme applied to the pass itself. So the rule is
// not written down and hoped for any more; the last test in this file reads
// every suite in the GUARDED directories and fails on a bare `.indexOf(` that is
// not on the allowlist below.
//
// The helper lives here, in the domain-neutral `src/lib/testing/`, because it is
// about slicing strings and not about invitations. The GUARD is narrower than
// the helper: it names the directories that have actually been converted, and
// the rest of the repo has not. Widen `GUARDED` when a directory is converted,
// never before — a guard that fails on unconverted code gets disabled, and a
// disabled guard checks nothing.
//
// A scope narrower than the CONCERN is how the rot got back in: the same track
// that wrote this guard then shipped `organization-invitation.test.ts` — the
// invitation EMAIL, one directory outside the scan — with an unbounded
// `html.slice(html.indexOf(inviteUrl))` claiming to be the CTA while actually
// covering the fallback link, the rule and the footer. `src/lib/email/templates/`
// is in the scan now.
//
// And it got back in a second time, the same way (#411): a sweep over the
// NOTIFICATIONS domain deleted one tautological span from `anchor.test.ts`,
// named it "exactly the rot source-span.ts exists to prevent" — and left five
// more standing in the same domain, one of them the guard that the
// recorded-relationship fallback cannot reach the consent gate. Its start
// anchor going missing sliced the EMPTY STRING, so both of its `doesNotMatch`
// calls asserted nothing, on a risk:high tenancy path. No suite went red,
// because no scan reached the directory. Both notifications directories are in
// the scan now — converting instances without widening `GUARDED` leaves the
// class exactly as live as it was.
// ============================================================================

/**
 * The directories the guard below scans — NOT the directory this file is in.
 *
 * Repo-relative and POSIX-shaped, because these strings are also the allowlist's
 * keys and the text a failure prints. Each is resolved against `process.cwd()`
 * (the repo root, where `pnpm test` runs) rather than against this file, so
 * moving the guard again does not silently move what it guards.
 *
 * `atLeast` is the floor that keeps a renamed or emptied directory from passing
 * forever by matching nothing. Raise it when a directory grows; it is a
 * tripwire, not a count.
 */
const GUARDED: readonly { readonly dir: string; readonly atLeast: number }[] = [
  { dir: "src/lib/invitations", atLeast: 10 },
  { dir: "src/lib/email/templates", atLeast: 2 },
  { dir: "src/lib/notifications", atLeast: 15 },
  { dir: "src/components/notifications", atLeast: 1 },
  { dir: "src/app/(dashboard)", atLeast: 2 },
];

/** Repo-relative POSIX path → absolute, for `readdirSync`/`readFileSync`. */
function absolute(relative: string): string {
  return path.join(process.cwd(), ...relative.split("/"));
}

// ----------------------------------------------------------------------------
// 1. The primitives fail the way the rule needs them to
// ----------------------------------------------------------------------------

const SOURCE = [
  "export async function createInvitationAs() {",
  "  const authority = resolveInvitationRequest();",
  "  await insertInvitation();",
  "  await emailInvitee();",
  "}",
].join("\n");

test("a missing anchor throws, naming the file and the needle", () => {
  const reader = sourceReader(SOURCE, "core.ts");

  assert.throws(
    () => reader.span("export async function gone", "}"),
    /core\.ts no longer contains: export async function gone/
  );
  assert.throws(() => reader.after("gone"), /core\.ts no longer contains/);
});

test("a needle that disappeared fails the ORDER instead of passing it", () => {
  // The whole point. `-1 < N` is true, so the bare form goes green on a subject
  // that no longer exists; the helper resolves both needles first.
  assert.ok(SOURCE.indexOf("await deleted()") < SOURCE.indexOf("emailInvitee"));

  assert.throws(
    () =>
      assertInOrder(
        SOURCE,
        "core.ts",
        ["await deleted()", "emailInvitee"],
        "the row must be committed before anything is sent"
      ),
    /core\.ts no longer contains: await deleted\(\) — the row must be committed before anything is sent/
  );
});

test("two anchors in the wrong order fail, naming both and the reason", () => {
  assert.throws(
    () =>
      assertInOrder(
        SOURCE,
        "core.ts",
        ["await emailInvitee", "await insertInvitation"],
        "the row must be committed before anything is sent"
      ),
    /core\.ts: "await insertInvitation" must follow "await emailInvitee" — the row must be committed/
  );

  // Strictly increasing: the same needle twice is not "in order".
  assert.throws(
    () => assertInOrder(SOURCE, "core.ts", ["emailInvitee", "emailInvitee"]),
    /must follow/
  );
});

test("a chain of three is checked pairwise, and the happy path is silent", () => {
  assertInOrder(SOURCE, "core.ts", [
    "const authority = resolveInvitationRequest",
    "await insertInvitation",
    "await emailInvitee",
  ]);

  assert.throws(
    () =>
      assertInOrder(SOURCE, "core.ts", [
        "await insertInvitation",
        "const authority = resolveInvitationRequest",
        "await emailInvitee",
      ]),
    /must follow/
  );

  // A single needle asserts no order at all, so it is a mistake, not a pass.
  assert.throws(
    () => assertInOrder(SOURCE, "core.ts", ["await emailInvitee"]),
    /needs at least two needles/
  );
});

// ----------------------------------------------------------------------------
// 2. …and no suite in a GUARDED directory may reintroduce either shape
// ----------------------------------------------------------------------------

/**
 * The bare `indexOf` calls the GUARDED directories still allow, by exact source
 * line, with the reason each one is not the rot above.
 *
 * By LINE TEXT rather than by file: allowlisting `service.test.ts` would let
 * the next bare pair in that file through, which is how the recorded rule came
 * to overstate itself in the first place. Every entry here HANDLES -1 in a
 * branch right there — that, and only that, is what earns a place.
 *
 * Keyed by repo-relative path, not by basename: two guarded directories can
 * hold the same file name, and a basename key would silently lend one
 * directory's exemption to the other's.
 */
const HANDLES_MINUS_ONE: ReadonlyMap<string, readonly string[]> = new Map([
  [
    "src/lib/invitations/invite-rate-limit.test.ts",
    [
      // The post-sever floor is optional to this helper on purpose: with no
      // `not exists (…)` the outer predicate IS the whole statement, which is
      // what the ternary on the next line returns.
      'const floor = sql.indexOf("not exists (");',
    ],
  ],
  [
    "src/lib/invitations/service.test.ts",
    [
      // The repo-wide SESSION-FIRST walker. An action that takes no argument
      // has no `.safeParse(`, so -1 is a real answer — the `if (parse >= 0)`
      // below it is the branch, and `mint` gets its own `assert.ok(mint >= 0)`.
      'const mint = scoped.indexOf("requireSeat(");',
      'const parse = scoped.indexOf(".safeParse(");',
      // `returning()` is optional on an UPDATE; -1 means "no returning", and
      // the next line hands back the whole tail.
      'const end = from.indexOf(" returning ");',
    ],
  ],
]);

// THIS file is outside `GUARDED`, which is what lets it write down the shape it
// forbids — the reason `register-path.test.ts` §4 excludes `resend.ts` from the
// prose guard. §1 above demonstrates the vacuous comparison in order to prove
// `assertInOrder` refuses it, and the allowlist quotes four lines verbatim. A
// guard that could not name what it forbids would forbid itself.

test("no suite in a converted directory slices or orders with a bare indexOf", () => {
  const offenders: string[] = [];
  const scanned = new Set<string>();

  for (const { dir, atLeast } of GUARDED) {
    const suites = readdirSync(absolute(dir))
      .filter((name) => name.endsWith(".test.ts"))
      .sort();

    // A guard that found no files — a renamed or moved directory — would pass
    // forever.
    assert.ok(
      suites.length >= atLeast,
      `only ${suites.length} suites found in ${dir}, expected at least ${atLeast}`
    );

    for (const suite of suites) {
      const key = `${dir}/${suite}`;
      scanned.add(key);

      const allowed = HANDLES_MINUS_ONE.get(key) ?? [];
      const lines = readFileSync(absolute(key), "utf8").split("\n");

      lines.forEach((line, index) => {
        if (!line.includes(".indexOf(")) return;
        if (allowed.includes(line.trim())) return;

        offenders.push(`${key}:${index + 1}  ${line.trim()}`);
      });
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `bare indexOf in a source-shaped suite — use sourceReader().span()/.after() for a slice and assertInOrder() for an order (@/lib/testing/source-span), or add the line to HANDLES_MINUS_ONE with the branch that handles -1:\n${offenders.join("\n")}`
  );

  // The allowlist itself must stay honest, in both directions: an entry whose
  // line has been edited away is a rule nobody is checking any more, and an
  // entry for a file no scan reaches is an exemption from nothing.
  for (const [key, allowedLines] of HANDLES_MINUS_ONE) {
    assert.ok(
      scanned.has(key),
      `${key} is on HANDLES_MINUS_ONE but no GUARDED directory scans it — delete the entry or add its directory`
    );

    const source = readFileSync(absolute(key), "utf8");

    for (const allowed of allowedLines) {
      assert.ok(
        source.includes(allowed),
        `${key} no longer contains the allowlisted line "${allowed}" — delete it from HANDLES_MINUS_ONE`
      );
    }
  }
});
