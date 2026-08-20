import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { ADMIN_PLUS, OWNER_ONLY, SESSIONLESS_EXPORTS } from "./seats";
import {
  SEAT_GUARD,
  SRC,
  TS_FILES,
  codeOf,
  functionBodies,
  guardedServerActionExports,
  isUseServerModule,
  reachingNames,
  rel,
} from "./server-action-surface";

// ============================================================================
// THE SEAT GUARD, ASSERTED OVER THE WHOLE EXPORT SURFACE (#498, AS-019).
//
// The invariant underneath: every export of a `"use server"` module is a
// POSTable endpoint reachable with no session and no UI, so THE EXPORT LIST IS
// THE AUTH SURFACE. Before this suite, that list was 157 endpoints of which two
// asked who was calling — a plant Member had byte-identical CRUD to the Owner
// across the people directory, Meetings, Task Management and Ministry Teams.
//
// Ruling 185 (8) rejected a per-module permission matrix and named the shape
// that ships instead: the two seat sets as DATA in one module, one `requireSeat`
// guard, and a test keyed to the export list. This is that test.
//
// FOUR ASSERTIONS, and the shape of each is chosen against a way the first one
// can be quietly true:
//
//   1. GUARD BEFORE PARSE, for every export. Not "somewhere in the body" —
//      ahead of `safeParse`, because parsing first answers a sessionless caller
//      differently for a malformed argument than for a well-formed one.
//   2. THE EXEMPT SET, EXACTLY. An export that reaches no guard is either
//      sessionless by design or a hole, and the absence of a call cannot tell
//      you which. `SESSIONLESS_EXPORTS` says which, with the reason, and is
//      asserted with `deepEqual` so a new one fails here.
//   3. ONE DECLARATION SITE for each set, and no hand-rolled seat comparison
//      anywhere else — the drift the rejected matrix would have been made of.
//   4. THE WALK ITSELF, against synthetic fixtures: red on an unguarded export,
//      red on a guard that follows the parse, green on a guard reached through
//      a session envelope. Assertion 1 is only worth what its scanner is.
// ============================================================================

/**
 * The domains that had no seat check at all before this suite. A scan that
 * matched nothing would pass silently, which is how a guardrail becomes
 * decoration; these must be among what it saw.
 */
const PREVIOUSLY_UNGUARDED = [
  "people/actions.ts → createPersonAction",
  "meetings/actions.ts → createMeetingAction",
  "tasks/actions.ts → createTaskAction",
  "teams/actions.ts → createTeamAction",
  "communication/actions.ts → sendMessageAction",
];

test('every "use server" export reaches the seat guard before it parses', () => {
  const serverModules = TS_FILES.filter(isUseServerModule);

  assert.ok(
    serverModules.length > 5,
    `only ${serverModules.length} "use server" modules found — the walk is broken`
  );

  const checked: string[] = [];
  const unguarded: string[] = [];

  for (const action of guardedServerActionExports()) {
    if (action.guard < 0) {
      unguarded.push(action.label);
      continue;
    }

    assert.ok(
      action.parse < 0 || action.guard < action.parse,
      `${action.label} parses its argument before it checks the caller's seat — move the requireSeat call above the safeParse`
    );

    checked.push(action.label);
  }

  assert.deepEqual(
    unguarded.toSorted(),
    Object.keys(SESSIONLESS_EXPORTS).toSorted(),
    'a `"use server"` export reaches its work without calling `requireSeat`. Every export of such a module is a POSTable endpoint (memory/invariants.md → Authentication), so it must state who may call it — pick the capability from `src/lib/auth/seats.ts`, or, if the endpoint is sessionless BY DESIGN, add it to SESSIONLESS_EXPORTS there with the reason'
  );

  for (const expected of PREVIOUSLY_UNGUARDED) {
    assert.ok(
      checked.some((seen) => seen.endsWith(expected)),
      `the scan never reached ${expected}`
    );
  }
});

test("every exempt export still exists, and says why it is exempt", () => {
  // A stale entry is not harmless: the set above is asserted with `deepEqual`,
  // so an exemption naming a deleted export fails the suite until someone
  // removes it — and an exemption naming an export that has since GAINED a
  // guard is a licence nobody is using, which is worse.
  const live = new Set(guardedServerActionExports().map((e) => e.label));

  for (const [label, reason] of Object.entries(SESSIONLESS_EXPORTS)) {
    assert.ok(live.has(label), `${label} is exempt but no longer exists`);
    assert.ok(
      reason.length > 20,
      `${label} is exempt without a reason anybody can act on`
    );
  }
});

test("the two seat sets have one declaration site, and nothing else compares a seat", () => {
  // WHAT THE REJECTED MATRIX WAS MADE OF. Two modules each spelling "an owner
  // or an admin" is one refactor away from disagreeing, and the disagreement is
  // silent — both files compile, both look right, and one of them is now the
  // permission rule nobody reads.
  const SETS = path.join(SRC, "lib", "auth", "seats.ts");

  // `tenancy.ts` is the leaf that owns the (tenancy, seat) predicates
  // `holdsSeatFor` is written against; it declares neither set.
  //
  // The other two read a seat for something that is NOT an authority rule, and
  // are named here rather than caught by a narrower pattern — a pattern that
  // let these through would let a real one through too:
  //
  //   * `leadership.ts` is the OB-010 claim, the one place outside
  //     registration where a seat is GRANTED. Its `{owner, member}` pair is
  //     the ruled role pair migrated (`memory/invariants.md` → Seats &
  //     Tenancy) and deliberately excludes `admin`; it decides who may claim
  //     an ownerless plant, not what a seat may do.
  //   * `dev-accounts.ts` sorts the development sign-in list into headings.
  const SEAT_READS_THAT_ARE_NOT_RULES = new Set(
    [
      ["lib", "auth", "tenancy.ts"],
      ["lib", "onboarding", "leadership.ts"],
      ["app", "(auth)", "login", "dev-accounts.ts"],
    ].map((segments) => path.join(SRC, ...segments))
  );

  const declarations: string[] = [];
  const comparisons: string[] = [];

  for (const file of TS_FILES) {
    if (file === SETS || file.endsWith(".test.ts")) continue;

    const code = codeOf(file);

    for (const match of code.matchAll(
      /\b(?:const|let|var|type|enum)\s+(OWNER_ONLY|ADMIN_PLUS)\b/g
    )) {
      declarations.push(`${rel(file)} → ${match[1]}`);
    }

    if (SEAT_READS_THAT_ARE_NOT_RULES.has(file)) continue;

    for (const match of code.matchAll(
      /\bseat\s*(?:===|!==)\s*["'](?:owner|admin|member)["']/g
    )) {
      comparisons.push(`${rel(file)} → ${match[0]}`);
    }
  }

  assert.deepEqual(
    declarations,
    [],
    "OWNER_ONLY and ADMIN_PLUS are declared in src/lib/auth/seats.ts and imported everywhere else — a second declaration is the per-module matrix ruling 185 (8) rejected"
  );

  assert.deepEqual(
    comparisons,
    [],
    "a seat is compared by hand outside the permissions module. Ask `holdsSeatFor(user, capability)` (or `requireSeat` in an action) so the rule has one spelling"
  );
});

// ----------------------------------------------------------------------------
// The scanner, asserted against fixtures rather than against the tree
// ----------------------------------------------------------------------------

/** The offsets `guardedServerActionExports` computes, over synthetic code. */
function scan(code: string): { guard: number; parse: number }[] {
  const guards = reachingNames(path.join(SRC, "fixture.ts"), code, SEAT_GUARD);
  const pattern = new RegExp(`\\b(?:${[...guards].join("|")})\\s*\\(`);

  return functionBodies(code)
    .filter((fn) => fn.exported)
    .map((fn) => ({
      guard: fn.body.search(pattern),
      parse: fn.body.indexOf(".safeParse("),
    }));
}

test("the walk is red on an unguarded export and on a late guard", () => {
  // THE FIXTURE THE REPO-WIDE ASSERTION IS ONLY AS GOOD AS. Both shapes below
  // are what a new action looks like when somebody forgets, and both must be
  // visible to the scanner — the second especially, because it LOOKS guarded.
  const unguarded = [
    '"use server";',
    "export async function probeAction(input) {",
    "  const parsed = schema.safeParse(input);",
    "  const { user } = await verifySession();",
    "  return write(parsed.data, user);",
    "}",
  ].join("\n");

  const [noGuard] = scan(unguarded);
  assert.equal(noGuard.guard, -1, "an unguarded export must scan as unguarded");

  const lateGuard = [
    '"use server";',
    'import { requireSeat } from "@/lib/auth/seats";',
    "export async function probeAction(input) {",
    "  const parsed = schema.safeParse(input);",
    '  const { user } = await requireSeat("people.write");',
    "  return write(parsed.data, user);",
    "}",
  ].join("\n");

  const [late] = scan(lateGuard);
  assert.ok(late.guard > late.parse, "the fixture is meant to be a violation");
});

test("a guard reached through a session envelope counts as the guard", () => {
  // `people/actions.ts` guards through `withChurchSession`, `teams/actions.ts`
  // through `withChurch`, `launch/actions.ts` through its own
  // `requireChurchSession`. Deriving the guarding names the way the mint walk
  // derives minting names is what lets those sixty endpoints need no exemption
  // — and an exemption list is exactly what a later reader would have widened.
  const code = [
    '"use server";',
    "async function withChurch(capability, run) {",
    "  const { user } = await requireSeat(capability);",
    "  return run(user);",
    "}",
    "export async function probeAction(input) {",
    '  return withChurch("people.write", async (user) => {',
    "    const parsed = schema.safeParse(input);",
    "    return write(parsed.data, user);",
    "  });",
    "}",
  ].join("\n");

  const scanned = scan(code);
  const probe = scanned.at(-1)!;

  assert.ok(probe.guard >= 0, "the envelope call was not read as the guard");
  assert.ok(
    probe.guard < probe.parse,
    "the envelope call must precede the parse"
  );
});

test("the two sets are the seats they say they are", () => {
  // Cheap, and it pins the halves of ruling 185 (1) that prose keeps restating:
  // Owner-only means the Owner ALONE, and Admin-and-above includes the Owner.
  assert.deepEqual([...OWNER_ONLY], ["owner"]);
  assert.deepEqual([...ADMIN_PLUS], ["owner", "admin"]);
});
