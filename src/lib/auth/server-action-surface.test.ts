import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  SEAT_GUARD,
  SRC,
  TS_FILES,
  UNAUTHORIZED_RETHROW,
  catchBlocks,
  codeOf,
  declaresDirective,
  functionBodies,
  isPublicRouteGroup,
  isUseClientModule,
  isUseServerModule,
  mintingNames,
  parsingServerActionExports,
  reachingNames,
  rel,
  staticValueSpecifiers,
  valueExportStatements,
  valueSpecifiers,
} from "./server-action-surface";

// ============================================================================
// SESSION FIRST, THEN THE PARSE — asserted over the WHOLE repository (#304).
//
// The rule (`memory/invariants.md` → Authentication & Session): every export of
// a `"use server"` module is a POSTable endpoint reachable with no session, so
// the actor is minted from `verifySession()` BEFORE the argument is parsed.
// Parsing first is not usually exploitable, but it answers a sessionless caller
// differently for a malformed argument (`{ success: false }`) than for a
// well-formed one (a throw) — a free shape-oracle — and it makes "does this
// endpoint check anybody?" a question about reading order instead of about
// line one.
//
// WHY THIS FILE EXISTS AT ALL, rather than the walk living inside whichever
// domain first needed it: the claim is about every action module in the
// product, and it was written down as universal TWICE while only a file list
// enforced it. Both times the unlisted modules were the ones parsing first —
// five of them at round 7. A rule about sessions belongs next to the module
// that owns sessions, and the walker (`./server-action-surface.ts`) is an
// importable module rather than a test so the next caller does not copy it.
//
// Three assertions, and the second and third exist because the first one has
// two ways to be quietly true:
//
//   1. ORDER — for every export that parses, the mint precedes the parse.
//   2. THE EXEMPT SET, EXACTLY — the `(auth)`/`(marketing)` endpoints are named
//      one by one, so moving an authenticated action into a public group fails
//      the test instead of silently leaving the claim.
//   3. THE PARSER'S BLIND SPOT — `functionBodies` reads `function`
//      DECLARATIONS. `export const fooAction = async (input) => …` is just as
//      POSTable and would be invisible, so that form (and `export default`, and
//      re-exports) is banned outright in `"use server"` modules and the
//      failure message says which matcher cannot see it.
//
// And one NAMED RESIDUAL, pinned the same way as the exempt set — see
// `TRY_WRAPPED_MINTS` below.
// ============================================================================

/**
 * The five endpoints round 7 found parsing first, outside the invitations
 * domain. A scan that matched nothing would pass silently, which is how a
 * guardrail becomes decoration; these must be among what it saw.
 */
const ROUND_7_ENDPOINTS = [
  "settings/actions.ts → setNotificationPreferenceAction",
  "settings/actions.ts → setDigestCadenceAction",
  "settings/sharing/actions.ts → setOversightSharingAction",
  "notifications/actions.ts → markNotificationReadAction",
  "notifications/actions.ts → loadMoreNotificationsAction",
];

/**
 * THE NAMED RESIDUAL (round 8, 2026-08-10).
 *
 * These exports mint the actor before they parse — assertion 1 holds for every
 * one of them — but they mint it INSIDE a `try` whose `catch` turns the
 * `Unauthorized` throw into a handled `{ success: false, error: "You must be
 * logged in …" }`. So a sessionless call gets a RESULT rather than a throw.
 *
 * Why that is a residual and not a hole: the mint still precedes the parse, so
 * an anonymous caller gets the identical answer for a well-formed argument and
 * for a malformed one. There is no shape-oracle, nothing is read, and nothing
 * is written — which is the property the rule exists to protect. What is lost
 * is only the crispness of "a sessionless call throws", and lifting the
 * remaining mints above their `try` blocks is a refactor of action modules that
 * #304 does not own.
 *
 * IT IS SHRINKING, WHICH IS THE POINT. It opened at 44 entries across nine
 * modules; the 2026-08-12 debt sweep took `people/actions.ts` (PR #410) and
 * `teams/actions.ts` (PR #409) off it — not by exempting them but by giving
 * each domain ONE session envelope (`people/action-context.ts` →
 * `withChurchSession`, `teams/action-shell.ts` → `withChurch`). The envelope
 * owns the `try`; the endpoint's own body has none, so its mint is the
 * envelope call on line one and it is simply not a residual any more. That is
 * the shape the rest of this list retires into.
 *
 * A DELETION shrinks it too, and has to be reflected here for the same reason:
 * #312 removed the dead VM-017 invitation subtree, so
 * `meetings/actions.ts → createInvitationAction` and
 * `→ updateInvitationStatusAction` came off the list. An entry naming an export
 * that no longer exists is not harmless — this list is asserted with
 * `deepEqual`, so a stale name fails the suite until someone removes it.
 *
 * Why it is written down HERE rather than left to prose: the invariant file
 * said "above the `try`" as a universal rule for a whole round while nothing
 * tested it, which is the third repetition of exactly that failure mode. This
 * list is asserted EXACTLY, so the next try-wrapped action fails this test and
 * has to be added on purpose (or, better, written the new way).
 *
 * It retires when the remaining modules mint above the `try` — at which point
 * this constant is emptied and `assert.ok(action.try < 0 || action.mint <
 * action.try)` becomes the universal form of assertion 1.
 */
const TRY_WRAPPED_MINTS = [
  "src/app/(dashboard)/feedback/actions.ts → submitFeedbackAction",
  "src/app/(dashboard)/launch/actions.ts → scheduleLaunchAction",
  "src/app/(dashboard)/meetings/actions.ts → addAttendeeAction",
  "src/app/(dashboard)/meetings/actions.ts → createEvaluationAction",
  "src/app/(dashboard)/meetings/actions.ts → createLocationAction",
  "src/app/(dashboard)/meetings/actions.ts → createMeetingAction",
  "src/app/(dashboard)/meetings/actions.ts → quickAddAttendeeAction",
  "src/app/(dashboard)/meetings/actions.ts → recordAttendanceBatchAction",
  "src/app/(dashboard)/meetings/actions.ts → updateChecklistItemAction",
  "src/app/(dashboard)/meetings/actions.ts → updateLocationAction",
  "src/app/(dashboard)/meetings/actions.ts → updateMeetingAction",
  "src/app/(dashboard)/meetings/actions.ts → updateMeetingStatusAction",
  "src/app/(dashboard)/phase/actions.ts → transitionPhaseAction",
  "src/app/(dashboard)/phase/feedback-actions.ts → submitInsightFeedbackAction",
  "src/app/(dashboard)/phase/signals-actions.ts → setManualSignalAction",
];

test('the session mint precedes the parse in EVERY "use server" module in the repository', () => {
  // The universal claim, asserted universally. No file list: every `"use
  // server"` module under `src/` is walked, so an endpoint written next month
  // is inside the claim without anybody remembering to add it.
  const serverModules = TS_FILES.filter(isUseServerModule);

  assert.ok(
    serverModules.length > 5,
    `only ${serverModules.length} "use server" modules found — the walk is broken`
  );

  const checked: string[] = [];
  const unauthenticated: string[] = [];

  for (const action of parsingServerActionExports()) {
    if (isPublicRouteGroup(action.file)) {
      unauthenticated.push(action.label);
      continue;
    }

    assert.ok(
      action.mint >= 0,
      `${action.label} parses an argument and never mints an actor`
    );
    assert.ok(
      action.mint < action.parse,
      `${action.label} parses its argument before checking the session`
    );

    checked.push(action.label);
  }

  for (const expected of ROUND_7_ENDPOINTS) {
    assert.ok(
      checked.some((seen) => seen.endsWith(expected)),
      `the scan never reached ${expected} — it saw ${checked.join(", ")}`
    );
  }

  // The exemption stays three endpoints wide. A fourth arrival here is either a
  // new unauthenticated way into the product — which is a security review, not
  // a test edit — or an authenticated action that has been moved somewhere the
  // rule does not reach.
  assert.deepEqual(unauthenticated.toSorted(), [
    "src/app/(auth)/login/actions.ts → login",
    "src/app/(auth)/register/actions.ts → register",
    "src/app/(marketing)/actions.ts → requestInviteAction",
  ]);
});

test("the try-wrapped mints are a closed, named set — an unlisted one fails here", () => {
  // The residual pinned. `TRY_WRAPPED_MINTS` documents why these are safe (the
  // mint still precedes the parse, so both argument shapes get the identical
  // answer); this asserts the set is exactly that and no larger, so a new
  // action that buries its mint inside a `try` — where the catch converts
  // `Unauthorized` into a handled result — fails `pnpm test` instead of joining
  // an unlisted group. Written the new way (mint above the `try`) it is not on
  // this list at all and nothing needs editing.
  const tryWrapped = parsingServerActionExports()
    .filter((action) => !isPublicRouteGroup(action.file))
    .filter((action) => action.try >= 0 && action.try < action.mint)
    .map((action) => action.label);

  assert.deepEqual(
    tryWrapped.toSorted(),
    TRY_WRAPPED_MINTS.toSorted(),
    'a `"use server"` export mints its actor INSIDE a `try`, so a sessionless call comes back as a handled result instead of throwing. Mint above the `try` (see settings/actions.ts for the shape) — or, if this is deliberate, add it to TRY_WRAPPED_MINTS with the reason'
  );

  // The residual is a residual, not a licence: everything on the list still
  // satisfies the rule the invariant actually enforces.
  for (const action of parsingServerActionExports()) {
    if (isPublicRouteGroup(action.file)) continue;
    assert.ok(action.mint < action.parse, action.label);
  }
});

// ----------------------------------------------------------------------------
// ONE ANSWER FOR A SESSIONLESS POST (#508)
// ----------------------------------------------------------------------------

/**
 * The modules a server-side `catch` can live in: everything under `src/app`
 * that is not a client entry and not a public route group.
 *
 * NOT just `"use server"` modules, and the two exclusions are why. A domain's
 * session envelope — `people/action-context.ts → withChurchSession`,
 * `teams/action-shell.ts → withChurch` — is deliberately NOT a `"use server"`
 * module (its exports are helpers, not endpoints), and it is exactly where the
 * `try` and the `catch` live for sixty actions. A scan restricted to the
 * directive would have walked every action that spells its own catch and
 * skipped the two that own one on everybody's behalf.
 *
 * `"use client"` modules are excluded for the opposite reason: a component
 * wrapping an action call in its own `try/catch` is the browser's side of the
 * boundary, where the refusal has already become a rejected promise and there
 * is nothing to rethrow to.
 */
function serverCatchModules(): string[] {
  const app = path.join(SRC, "app") + path.sep;
  return TS_FILES.filter(
    (file) =>
      file.startsWith(app) &&
      !isPublicRouteGroup(file) &&
      !/\.test\.tsx?$/.test(file) &&
      !isUseClientModule(file)
  );
}

/** The six modules #508 found; a scan that missed them proves nothing. */
const RETHROW_SITES = [
  "feedback/actions.ts",
  "launch/actions.ts",
  "meetings/actions.ts",
  "people/action-context.ts",
  "phase/actions.ts",
  "teams/action-shell.ts",
];

test("an action that mints inside its `try` rethrows the sessionless refusal from every catch", () => {
  // THE PROPERTY: an anonymous POST to any action gets ONE answer — a throw.
  //
  // #498 made `verifySession()`'s `Unauthorized` leave `withChurchSession` and
  // `withChurch` unhandled, which is what the Authentication invariant asks
  // for. Four other modules — launch, phase, meetings, feedback — caught the
  // same throw and returned `{ success: false, error: "You must be logged in
  // …" }`, so the same request got a well-formed answer from four modules and
  // a 500 from two. #508 unified them on `rethrowUnauthorized`.
  //
  // THE RULE IS CONDITIONAL, AND THE CONDITION IS THE POINT: it applies only
  // where the guard sits INSIDE the `try`, because that is the only shape with
  // a catch standing between the throw and the framework. `tasks/actions.ts`
  // and `settings/actions.ts` mint ABOVE their `try` — the stronger fix — and
  // are silently correct here rather than exempted, and any module that adopts
  // that shape drops out of this walk with nothing to edit.
  //
  // The rethrow is found through `reachingNames`, the same resolver the mint
  // and guard walks use, so `launch/actions.ts` passes by funnelling all six
  // catches through its own `toActionError` helper. A rule that demanded the
  // literal call in every catch body would have forced six copies of a line
  // that belongs in one place.
  const offenders: string[] = [];
  const converters: string[] = [];
  const checked: string[] = [];

  for (const file of serverCatchModules()) {
    const code = codeOf(file);
    // Cheap gate before the expensive one: `reachingNames` resolves an import
    // graph per file, and a module with no `catch (…)` in it has no claim to
    // check. Skipping those first is what keeps this walk seconds rather than
    // minutes over the whole of `src/app`.
    if (!/(?<![.\w])catch\s*\(/.test(code)) continue;

    const guards = reachingNames(file, code, SEAT_GUARD);
    const guardPattern = new RegExp(`\\b(?:${[...guards].join("|")})\\s*\\(`);
    const rethrows = reachingNames(file, code, UNAUTHORIZED_RETHROW);
    const rethrowPattern = new RegExp(
      `\\b(?:${[...rethrows].join("|")})\\s*\\(`
    );

    for (const fn of functionBodies(code)) {
      const guard = fn.body.search(guardPattern);
      const tryAt = fn.body.search(/\btry\s*\{/);
      if (guard < 0 || tryAt < 0 || tryAt > guard) continue;

      for (const block of catchBlocks(fn.body)) {
        const label = `${rel(file)} → ${fn.name}`;
        checked.push(label);

        if (!rethrowPattern.test(block.body)) offenders.push(label);
        // The catch-and-convert pattern itself, asserted absent. Comments are
        // already stripped by `codeOf`, so this is the classification in CODE:
        // once the refusal leaves through `rethrowUnauthorized`, nothing below
        // it may branch on the message again.
        if (block.body.includes('"Unauthorized"')) converters.push(label);
      }
    }
  }

  assert.deepEqual(
    offenders.toSorted(),
    [],
    "this action mints its actor inside the `try`, so its `catch` sees `verifySession()`'s `Unauthorized` and answers an anonymous POST with a handled result. Open the catch with `rethrowUnauthorized(error)` (`@/lib/auth/unauthorized`), or move the guard above the `try` as `tasks/actions.ts` does:\n  " +
      offenders.join("\n  ")
  );

  assert.deepEqual(
    converters.toSorted(),
    [],
    "a `catch` still classifies the sessionless refusal by its message. `rethrowUnauthorized` has already taken it out of the block:\n  " +
      converters.join("\n  ")
  );

  // The scan reached the sites, rather than matching nothing and passing.
  for (const module of RETHROW_SITES) {
    assert.ok(
      checked.some((label) => label.includes(module)),
      `the scan never reached ${module} — it saw ${[...new Set(checked)].join(", ")}`
    );
  }
});

test('no "use server" module publishes an endpoint the walk cannot read', () => {
  // The parser's blind spot, closed loudly. `functionBodies` matches `function`
  // DECLARATIONS, so `export const fooAction = async (input) => {…}` — equally
  // POSTable — would be invisible to the scan above, and so would `export
  // default async function …` (the `default` keyword sits where the matcher
  // expects the name) and `export { x } from "./core"` (somebody else's
  // function, republished as an endpoint; that is HOLE 2 of #265).
  //
  // Extending the matcher would be one more parser to get wrong. Banning the
  // forms is stronger and the product already writes none of them: every action
  // in the repository today is an `export async function`.
  const offenders: string[] = [];

  for (const full of TS_FILES) {
    if (!isUseServerModule(full)) continue;
    for (const statement of valueExportStatements(codeOf(full))) {
      offenders.push(`${rel(full)} → ${statement}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "`functionBodies` reads `export (async) function NAME(…)` and nothing else, so an endpoint published any other way is not covered by the SESSION-FIRST scan. Write it as an `export async function`:\n  " +
      offenders.join("\n  ")
  );
});

test("the brace matcher reads a whole function, not up to the first nested close", () => {
  // The scan above is only as good as this, and the version it replaces was
  // not: slicing at the first `\n}` stops at the end of a nested `try`, so a
  // mint moved BELOW one would sit outside the text being judged and the
  // assertion would pass on a body it never read. This is the fixture that
  // fails on that parser and passes on this one.
  const code = [
    "export async function act(input) {",
    "  try {",
    "    const x = 1;",
    "  } catch (error) {",
    "    return null;",
    "  }",
    "  const parsed = schema.safeParse(input);",
    "  const session = await verifySession();",
    "  return parsed;",
    "}",
  ].join("\n");

  const [fn] = functionBodies(code);

  assert.equal(fn.name, "act");
  assert.equal(fn.exported, true);
  assert.ok(
    fn.body.includes("verifySession()"),
    "the body was truncated early"
  );
  assert.ok(
    fn.body.indexOf(".safeParse(") < fn.body.indexOf("verifySession()"),
    "the fixture is meant to be a violation — it is what the scan must catch"
  );
});

test("an arrow-function export is not a function declaration", () => {
  // The blind spot, demonstrated rather than asserted about: this is the exact
  // module shape the ban above exists for. `functionBodies` returns nothing for
  // it, so without that ban the endpoint would parse first and the repo-wide
  // scan would still be green.
  const code = [
    '"use server";',
    "export const probeAction = async (input) => {",
    "  const parsed = schema.safeParse(input);",
    "  await verifySession();",
    "  return parsed;",
    "};",
  ].join("\n");

  assert.deepEqual(functionBodies(code), []);
  assert.deepEqual(valueExportStatements(code), [
    "export const probeAction = async (input) => {",
  ]);
});

test("a re-export statement is returned whole, however it is wrapped", () => {
  // The second caller reads the NAMES in the statement: `auth/roles.test.ts`
  // asks whether any module but the leaf exports the role policy, and the only
  // shape that can answer is the whole statement. A `.*$` pattern returns
  // `export {` for the wrapped form — no symbol, no specifier, and the guard
  // goes green on the exact re-export it exists to catch.
  assert.deepEqual(
    valueExportStatements("export { CHURCH_LEVEL_ROLES, OVERSIGHT_ROLES };"),
    ["export { CHURCH_LEVEL_ROLES, OVERSIGHT_ROLES };"]
  );

  const wrapped = [
    "export {",
    "  CHURCH_LEVEL_ROLES,",
    "  OVERSIGHT_ROLES,",
    '} from "@/lib/auth/roles";',
  ].join("\n");

  assert.deepEqual(valueExportStatements(wrapped), [wrapped]);
  assert.deepEqual(staticValueSpecifiers(wrapped), ["@/lib/auth/roles"]);

  assert.deepEqual(valueExportStatements('export * from "./roles";'), [
    'export * from "./roles";',
  ]);
});

test("a GENERIC declaration is still a function declaration", () => {
  // The blind spot that the 2026-08-12 debt sweep walked into. A domain's
  // shared session envelope is generic in its result type
  // (`withChurchSession<T>`, `withChurch<T>`), and a header pattern that
  // required `(` straight after the name did not see it — so the helper never
  // reached `mintingExportsOf` and twenty-two correctly-guarded endpoints were
  // reported as minting no actor at all. Pinned as a fixture because the
  // failure was silent in the helper and loud only two modules away.
  const code = [
    "export async function withChurchSession<T>(",
    "  label: string,",
    "  fn: () => Promise<T>",
    "): Promise<T> {",
    "  await verifySession();",
    "  return fn();",
    "}",
  ].join("\n");

  const [envelope] = functionBodies(code);
  assert.equal(envelope?.name, "withChurchSession");
  assert.equal(envelope?.exported, true);
  assert.match(envelope?.body ?? "", /await verifySession\(\);/);

  // …and the optional group must not wander into a NON-generic parameter list
  // that happens to contain angle brackets.
  const plain = functionBodies(
    "export async function act(input: Array<string>) {\n  return input;\n}"
  );
  assert.equal(plain.length, 1);
  assert.equal(plain[0]?.name, "act");
  assert.match(plain[0]?.body ?? "", /return input;/);
});

test("a module's own mint helper counts as the mint", () => {
  // `notifications/actions.ts` mints through `currentViewer()`. Deriving the
  // minting names from the module means that file needs no exemption, and an
  // exemption is exactly what a later reader would have widened.
  const code = [
    "async function currentViewer() {",
    "  const session = await verifySession();",
    "  return session;",
    "}",
    "export async function act(input) {",
    "  const viewer = await currentViewer();",
    "  const parsed = schema.safeParse(input);",
    "  return parsed;",
    "}",
  ].join("\n");

  const mints = mintingNames(path.join(SRC, "fixture.ts"), code);

  assert.ok(mints.has("currentViewer"));

  const [, act] = functionBodies(code);
  const pattern = new RegExp(`\\b(?:${[...mints].join("|")})\\s*\\(`);

  assert.ok(act.body.search(pattern) < act.body.indexOf(".safeParse("));
});

test("a directive is a directive without its semicolon", () => {
  // The guardrail on the guardrail (#265 r2, HOLE 4 — documented mutation 7 in
  // `src/lib/invitations/service.test.ts`). Every walk asks
  // `isUseServerModule`, and the previous detector required a trailing
  // semicolon: `"use server"` on its own is the same directive (ASI; Next.js
  // reads it), so a module written that way was invisible to both closure walks
  // and shipped a live unauthenticated endpoint through a green 37/37 suite.
  // Only `format:check` noticed, and a formatter is not a security control —
  // which is why the rule is pinned here, against synthetic code, and not only
  // exercised on whatever the repo's files happen to look like today.
  for (const code of [
    '"use server";\nexport const a = 1;',
    '"use server"\nexport const a = 1;',
    "'use server'\nexport const a = 1;",
    '"use server"    \n',
    '\n\n  "use server"\n',
    '"use strict";\n"use server"\n',
  ]) {
    assert.ok(declaresDirective(code, "use server"), JSON.stringify(code));
  }

  // And a directive is only one as the module's FIRST statement, so a mention
  // further down — a regex, an array entry, a template — is not one. Over-eager
  // detection is its own bug: the closure walks STOP at `"use server"`
  // boundaries, so a false positive silently prunes the subtree it should have
  // followed.
  for (const code of [
    'export const a = 1;\n"use server";',
    'const directives = ["use server"];',
    'if (x) { "use server"; }',
    "export const RE = /[\"']use server[\"']/;",
    "",
  ]) {
    assert.ok(!declaresDirective(code, "use server"), JSON.stringify(code));
  }

  // The client half of the boundary uses the same rule, and there is at least
  // one real file of each kind — otherwise the walks walk nothing.
  assert.ok(declaresDirective('"use client"\n', "use client"));
  assert.ok(TS_FILES.some(isUseClientModule), "no client entries found");
  assert.ok(TS_FILES.some(isUseServerModule), "no action modules found");
});

test("a slash-star inside a line comment does not swallow the file", () => {
  // THE HOLE #498 FELL INTO. `codeOf` used to strip block comments first and
  // line comments second, so a path written in a `//` line — `src/lib/launch/*`
  // in this module's own header — opened a block comment that ran to the next
  // star-slash below and deleted everything between. In `launch/actions.ts`
  // that was the entire import list plus a docblock, and NOTHING failed: the
  // mint walk was matching a literal `verifySession()` that happened to survive
  // lower down. Only a walk that has to RESOLVE an import saw it.
  //
  // Asserted against the real file rather than a fixture, because the shape
  // that triggers it is a comment somebody writes without thinking — so the
  // guard has to be a claim about the tree, not about a string in this test.
  const launch = TS_FILES.find((file) =>
    file.endsWith(path.join("launch", "actions.ts"))
  )!;
  const code = codeOf(launch);

  assert.match(readFileSync(launch, "utf8"), /\/\/.*launch\/\*/);
  assert.match(
    code,
    /import \{[^}]*requireSeat[^}]*\} from "@\/lib\/auth\/seats"/
  );
  assert.ok(
    !code.includes("EVERY EXPORT OF THIS FILE"),
    "the header comment survived the strip"
  );
});

// ----------------------------------------------------------------------------
// The import scan, asserted where it lives
// ----------------------------------------------------------------------------

test("the static scan sees every module-scope edge, and only those", () => {
  // THE ONE PLACE IN THE REPO THAT ENUMERATES THE IMPORT SHAPES.
  //
  // `staticValueSpecifiers` is the predicate four guards are written in terms
  // of — the oversight no-DATABASE_URL seam (`oversight/read-imports.test.ts`),
  // the two import-free-leaf guards (`auth/roles.test.ts`,
  // `oversight/session.test.ts`) and the "no data-layer import on the index
  // page" guard (`oversight/read.test.ts`). Each of those four had grown its
  // own copy of this table, which is the same duplication the shared function
  // was extracted to end: one property, four spellings, and three different
  // assertion strengths already drifting apart. A re-spelling of the pattern
  // breaks ONE function, so ONE suite catching it is both sufficient and the
  // point — the four call sites now assert only what is local to them (their
  // own module holds no value edge, or holds none reaching `@/db`).
  //
  // The four positives are the four holes the copies left open. The
  // `export … from` one is not hypothetical: `register-path.ts` broke its own
  // leaf rule with a re-export, not an import (`memory/invariants.md` →
  // Multi-Tenancy), and put a 687 KB SDK one import from a client component.
  for (const [shape, line] of [
    ["single-quoted specifier", "import { db } from '@/db';"],
    ["indented import", '  import { db } from "@/db";'],
    ["side-effect import", 'import "@/db";'],
    ["value re-export", 'export { db } from "@/db";'],
  ] as const) {
    assert.deepEqual(
      staticValueSpecifiers(line),
      ["@/db"],
      `the static scan cannot see a ${shape} — every guard built on it has that hole`
    );
  }

  // The two it must NOT see, each for its own reason.
  //
  // `import()` is excluded BY DESIGN: deferring `@/db` into the call is what
  // SATISFIES the seam rule, so a scan that counted the dynamic form would fail
  // the very code that obeys it. `valueSpecifiers` — the client-bundle scan,
  // which does want that edge because the module is still emitted — is the same
  // list plus it, and the contrast is asserted here so neither half can drift
  // into the other.
  assert.deepEqual(
    staticValueSpecifiers('const { db } = await import("@/db");'),
    []
  );
  assert.deepEqual(valueSpecifiers('const { db } = await import("@/db");'), [
    "@/db",
  ]);

  // A type-only import is erased at compile time: no connection, no bundle
  // edge. Flagging it would fail the leaves for the imports they legitimately
  // hold.
  assert.deepEqual(
    staticValueSpecifiers('import type { UserRole } from "@/db/schema";'),
    []
  );
  assert.deepEqual(
    valueSpecifiers('import type { UserRole } from "@/db/schema";'),
    []
  );
});
