import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { OrganizationInvitationType } from "@/db/schema/organization-invitation";

import {
  INVITATION_EXPIRY_DAYS,
  InvitationError,
  MAX_EXPIRY_DAYS,
  NOT_AUTHORIZED_MESSAGE,
  associationStatement,
  expireInvitationQuery,
  invitationActorFromSession,
  getInvitation,
  isUuid,
  resolveInvitationRequest,
  respondToInvitationQuery,
  revokeInvitationQuery,
  verifyInvitationAuthority,
  type InvitationActor,
} from "./core";

// ============================================================================
// Invitations — the auth surface (#265).
//
// The AC: "no unauthenticated state-changing invitation action remains
// reachable: every action derives its actor from verifySession(); helpers not
// meant to be endpoints move out of the 'use server' module — verify: grep + a
// forged POST with a foreign respondingUser changes nothing".
//
// Three halves, and this file covers all three.
//
// 1. STRUCTURAL — in a `"use server"` module every export is a POSTable
//    endpoint, so the export surface IS the auth surface. The AUTHORITATIVE
//    assertion (§1a) is not a grep: this file IMPORTS `service.ts` and reads
//    `Object.keys()` off the real module namespace, so it sees what the module
//    system actually publishes — `export default` (as the key `default`),
//    `export const f = async …`, `export { x } from "./core"`, a second
//    declarator on one `export const` line — rather than what a pattern
//    remembered to look for. The source-shaped assertions in §1c are belt and
//    braces on top of it, and they now CLASSIFY every `export` statement in the
//    file and fail on a form they do not recognise instead of skipping it.
//
//    (An earlier version of this file claimed `service.ts` "cannot be imported
//    into a bare node:test process (it would drag `next/headers` in through
//    `verifySession`)" and asserted its shape from source only. That claim was
//    false: nothing runs `cookies()` at module scope, so the import is fine and
//    only a CALL outside a request throws — which §1b then puts to work. The
//    holes below are what a source-only guardrail cost.)
//
// 2. FORGERY — §1b calls every real exported action with no session at all and
//    with a forged foreign user pushed onto the argument list. All four reject
//    from their first statement: there is no parameter for the forged user to
//    land in and `verifySession()` runs before anything is read or written. The
//    create path additionally derives the INVITING ORG from the session, so ids
//    smuggled onto the payload are absent from the row that gets written (§4).
//    The compile-time half is the `@ts-expect-error`s below: a bare user object
//    is not an `InvitationActor`, and `pnpm typecheck` enforces that.
//
// 3. AUTHORITY — the check that stood between an anonymous request and a
//    stranger's association, now unit-tested per invitation type.
//
// GUARDRAIL MUTATIONS — the shapes this file has been WATCHED to reject. A
// guardrail nobody has seen fail has not been tested, so each of these was
// appended to the tree, run, and watched go red. 3 and 4 are the two holes HR4
// found in the first version of this file (#265, evidence comment 2026-08-03),
// where each of them left the suite green:
//
//   1. `export const detachPlantFromNetwork = async (churchId: string) => {
//        await disassociateChurchFromNetwork(churchId);
//      };`
//      → fails "the runtime export surface is exactly the four lifecycle
//        mutations", "nothing but the four lifecycle mutations is an endpoint",
//        "every exported invitation action mints its actor from the session".
//
//   2. `export { disassociateChurchFromSendingChurch } from "./core";`
//      → fails "the runtime export surface …", "the action layer publishes
//        nothing it did not declare", "no 'use server' module republishes the
//        invitation logic layer".
//
//   3. `export default async function detachPlantFromNetwork(churchId: string) {
//        await disassociateChurchFromNetwork(churchId);
//      }`
//      → HOLE 1. The old allowlist matched `export (async) function|const|let|
//        var|class` and therefore never `export default`, so this — a real,
//        POSTable, unauthenticated "detach any church from its network by
//        guessing a uuid" endpoint — passed every test. Now fails "the runtime
//        export surface …" (the namespace grows the key `default`) and "the
//        action layer publishes nothing it did not declare", which bans a
//        default export of a `"use server"` module OUTRIGHT: the client names
//        the reference, so there is no allowlist entry it could ever match.
//
//   4. Two files, with no direct edge between them:
//        `src/lib/invitations/index.ts`
//          → `export * from "./core";`
//        `src/app/(dashboard)/oversight/detach-actions.ts`
//          → `"use server";`
//            `export { disassociateChurchFromNetwork } from "@/lib/invitations";`
//      → HOLE 2. That republishes the entire logic layer — all three
//        disassociation writes, four unguarded reads, `insertInvitation` — as
//        unauthenticated endpoints. The old walk resolved ONE hop, saw
//        `@/lib/invitations` was `index.ts` and not `core.ts`, and passed. The
//        walk is now a CLOSURE over re-export edges (the same shape as the
//        client-bundle walk in §1d), so `detach-actions.ts → index.ts →
//        core.ts` fails "no 'use server' module republishes the invitation
//        logic layer" with the chain in the message.
//
// The compare-and-set is covered from both sides: §5 reads it off the generated
// SQL (the claim's `status = 'pending'`, the association's
// `EXISTS ... status = 'accepted'`, the expiry's `status = 'pending'`), and the
// G3 harness (`scripts/g3-oversight-model.ts` §3d) races a real accept against a
// real revoke on a real database and asserts a lost accept writes nothing. The
// SQL assertions are what make the harness's result attributable to the guard.
// ============================================================================

const SRC = path.join(process.cwd(), "src");
const INVITATIONS_DIR = path.join(SRC, "lib/invitations");
const SERVICE_PATH = path.join(INVITATIONS_DIR, "service.ts");
const CORE_PATH = path.join(INVITATIONS_DIR, "core.ts");

/**
 * A module with its comments removed. The absence assertions below are about
 * CODE: both modules explain the rule by naming the shapes it forbids
 * (`respondingUser`, `db.`), so documenting the fix would otherwise break the
 * test that enforces it.
 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const SERVICE_CODE = codeOf(SERVICE_PATH);
const CORE_CODE = codeOf(CORE_PATH);

/**
 * Every top-level `export` statement of the action layer, CLASSIFIED — not
 * pattern-matched for the forms somebody happened to think of.
 *
 * The distinction is the whole of HOLE 1. The old version of this collected
 * names with one regex (`export (async) function|const|let|var|class NAME`) and
 * had no branch for a statement that did not match, so `export default async
 * function …` contributed no name, tripped no assertion, and shipped an
 * unauthenticated endpoint through a green suite. Here every statement lands in
 * exactly one bucket and the leftovers bucket is asserted empty, so a form
 * nobody anticipated fails LOUDLY instead of being ignored:
 *
 *   * `erased`       — `export type` / `export interface`: no runtime value, so
 *                      not an endpoint.
 *   * `republished`  — `export default`, `export {…}`, `export *`: forbidden
 *                      outright in a `"use server"` module (see §1c).
 *   * `EXPORTED`     — a named declaration; the endpoint allowlist and the
 *                      one-`verifySession()`-per-action count are built on it.
 *   * `UNCLASSIFIED` — anything else. Asserted empty.
 *
 * A source scan can still be out-thought (`export const a = f, b = g` declares
 * two bindings on one line), which is exactly why the surface assertion that
 * DECIDES is §1a's real import: the module namespace cannot be out-thought.
 */
const EXPORT_STATEMENTS = [...SERVICE_CODE.matchAll(/^export\b.*/gm)].map(
  (match) => match[0].trim()
);

const ERASED_EXPORT = /^export\s+(?:type|interface)\b/;
const DEFAULT_EXPORT = /^export\s+default\b/;
const REPUBLISHING_EXPORT = /^export\s*[*{]/;
const NAMED_DECLARATION =
  /^export\s+(?:async\s+)?(?:function\s*\*?|class|abstract\s+class)\s+(\w+)\s*[(<]|^export\s+(?:const|let|var)\s+(\w+)\s*[:=]/;

const EXPORTED: string[] = [];
const REPUBLISHED: string[] = [];
const UNCLASSIFIED: string[] = [];

for (const statement of EXPORT_STATEMENTS) {
  if (ERASED_EXPORT.test(statement)) continue;

  if (DEFAULT_EXPORT.test(statement) || REPUBLISHING_EXPORT.test(statement)) {
    REPUBLISHED.push(statement);
    continue;
  }

  const declared = NAMED_DECLARATION.exec(statement);
  if (declared) {
    EXPORTED.push(declared[1] ?? declared[2]);
    continue;
  }

  UNCLASSIFIED.push(statement);
}

/** The four endpoints this module is allowed to have. */
const LIFECYCLE_ACTIONS = [
  "acceptInvitation",
  "createInvitation",
  "declineInvitation",
  "revokeInvitation",
];

/**
 * The action layer itself, imported. Node caches the module, so every test
 * below shares one load, and the load is safe: `service.ts` reads no cookie at
 * module scope.
 */
async function actionModule(): Promise<Record<string, unknown>> {
  return (await import("./service")) as unknown as Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Module graph helpers. The two walks below are about which files can REACH
// `./core`, so they have to resolve specifiers rather than grep for a substring:
// `from "./core"` and `from "@/lib/invitations/core"` are the same module, and
// only the second one contains the string "invitations/core".
// ----------------------------------------------------------------------------

const TS_FILES: string[] = (function collect(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collect(full));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
})(SRC);

/** `export * from "x"` / `export { a } from "x"` — a published endpoint. */
const REEXPORT_FROM =
  /^export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/gm;

/** Any module specifier at all, type-only imports included. */
const ANY_FROM = /\bfrom\s*["']([^"']+)["']/g;

/** Specifiers whose module is actually emitted: value imports and `import()`. */
function valueSpecifiers(code: string): string[] {
  const statement =
    /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*["']([^"']+)["']/gm;
  const sideEffect = /^\s*import\s*["']([^"']+)["']/gm;
  const dynamic = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

  return [statement, sideEffect, dynamic].flatMap((pattern) =>
    [...code.matchAll(pattern)].map(([, specifier]) => specifier)
  );
}

/** The file a specifier names, or `null` for a bare package. */
function resolveModule(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (base === null) return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function resolvesToCore(from: string, specifier: string): boolean {
  return resolveModule(from, specifier) === CORE_PATH;
}

const isUseServerModule = (full: string) =>
  /^["']use server["'];/m.test(readFileSync(full, "utf8"));

/**
 * The specifiers a module PUBLISHES through — its re-export edges, which are not
 * the same set as its imports. Importing `./core` is allowed (`service.ts` does
 * it, and #277/#278 will); RE-exporting from it turns somebody else's function
 * into an endpoint.
 *
 * `export {…} from "x"` and `export * from "x"` are the obvious edges. The one
 * that needs saying: the same thing written in two statements —
 * `import { x } from "./core"; export { x };` — names no source on the export
 * line at all. So a bare `export {…}` / `export *` with no `from` makes EVERY
 * value import of that module an edge. Deliberately over-approximate: a missed
 * edge here is a published endpoint, while a spurious one is a failing test that
 * prints the chain it objected to.
 */
function republishEdges(code: string): string[] {
  const sourced = [...code.matchAll(REEXPORT_FROM)].map(
    ([, specifier]) => specifier
  );

  // Anything still shaped like a republish once the sourced ones are removed is
  // the two-statement form.
  if (/^export\s*[*{]/m.test(code.replace(REEXPORT_FROM, ""))) {
    return [...sourced, ...valueSpecifiers(code)];
  }

  return sourced;
}

/**
 * The re-export chain from `entry` to `core.ts`, or `null` when there is none.
 *
 * TRANSITIVE, and that is HOLE 2. One hop was not enough: a barrel in between
 * (`src/lib/invitations/index.ts` → `export * from "./core"`) let a `"use
 * server"` module re-export from `@/lib/invitations`, which resolves to the
 * barrel, not to `core.ts` — republishing the entire logic layer past a green
 * suite. This is a closure over the edges above, the same shape as the
 * client-bundle walk in §1d, and it returns the chain so a failure says which
 * files did it.
 */
function republishChainToCore(entry: string): string[] | null {
  const seen = new Set<string>([entry]);
  const queue: Array<{ file: string; chain: string[] }> = [
    { file: entry, chain: [path.relative(process.cwd(), entry)] },
  ];

  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;

    for (const specifier of republishEdges(codeOf(file))) {
      const resolved = resolveModule(file, specifier);
      if (resolved === null) continue;

      const next = [...chain, path.relative(process.cwd(), resolved)];
      if (resolved === CORE_PATH) return next;
      if (seen.has(resolved)) continue;

      seen.add(resolved);
      queue.push({ file: resolved, chain: next });
    }
  }

  return null;
}

// ----------------------------------------------------------------------------
// 1a. Structural — the endpoint surface, read off the real module
// ----------------------------------------------------------------------------

test("the runtime export surface is exactly the four lifecycle mutations", async () => {
  // THE assertion of this file. Next.js publishes one POST endpoint per export
  // of a `"use server"` module, so the module namespace IS the auth surface —
  // and unlike a regex it cannot be out-thought. `export default` shows up here
  // as the key `default`; `export { x } from "./core"` shows up as `x`; a second
  // declarator smuggled onto an `export const` line shows up as itself.
  //
  // The four are the invitation-lifecycle mutations a user performs on their own
  // behalf. The eleven exports this module used to have were the finding: reads
  // exported from a `"use server"` module are an unauthenticated data leak, and
  // `disassociateChurchFromSendingChurch(churchId)` was a state change any
  // anonymous POST could aim at any church.
  const mod = await actionModule();

  assert.deepEqual(Object.keys(mod).sort(), LIFECYCLE_ACTIONS);
});

// ----------------------------------------------------------------------------
// 1b. Forgery — the actions themselves, called with no session
// ----------------------------------------------------------------------------

test("every action refuses a call with no session, whatever else it is sent", async () => {
  // The forged POST, executed. Each action is invoked with an invitation id AND
  // a foreign user object shoved onto the argument list — the `respondingUser`
  // that used to be parameter two and was trusted. Every one rejects from its
  // FIRST statement, `invitationActorFromSession(await verifySession())`, so the
  // extra argument is never read by anything: there is no parameter for it, and
  // no code path that looks past the ones declared.
  //
  // The message differs by context and both spellings are the same refusal: in a
  // real request with no session cookie `verifySession()` throws `Unauthorized`;
  // in this bare process `cookies()` itself refuses, because there is no request
  // to read one from. Either way it is a throw and not a `{ success: false }`,
  // so nothing downstream can mistake it for a handled outcome.
  const mod = await actionModule();
  const forged = {
    id: "55555555-5555-4555-8555-555555555555",
    role: "planter" as const,
    churchId: "11111111-1111-4111-8111-111111111111",
  };

  for (const name of LIFECYCLE_ACTIONS) {
    const action = mod[name];
    assert.equal(typeof action, "function", name);

    await assert.rejects(
      async () =>
        (action as (...args: unknown[]) => Promise<unknown>)(
          "77777777-7777-4777-8777-777777777777",
          forged
        ),
      (error: unknown) =>
        error instanceof Error &&
        /Unauthorized|outside a request scope/.test(error.message),
      name
    );
  }
});

// ----------------------------------------------------------------------------
// 1c. Structural — the same surface, asserted from source
// ----------------------------------------------------------------------------

test("no export statement in the action layer goes unclassified", () => {
  // The meta-guardrail. Every assertion below is built on `EXPORTED`, so a
  // statement the classifier cannot place would weaken all of them silently —
  // which is precisely how `export default` got through. There is no
  // "no match, no problem" branch any more: an unrecognised form fails here.
  assert.deepEqual(UNCLASSIFIED, [], EXPORT_STATEMENTS.join(" ⏎ "));
  assert.ok(EXPORT_STATEMENTS.length > 0, "no exports found — check the path");
});

test("every exported invitation action mints its actor from the session", () => {
  // Not "most of them". An action added later that resolved its user any other
  // way would be the one loose write path, and that is exactly the shape of bug
  // this counts. Counted against `EXPORTED`, so an arrow-function action is
  // counted too.
  const minted =
    SERVICE_CODE.match(
      /invitationActorFromSession\(await verifySession\(\)\)/g
    ) ?? [];

  assert.ok(EXPORTED.length > 0, "no exported actions found — check the path");
  assert.equal(minted.length, EXPORTED.length, EXPORTED.join(", "));
});

test("the action layer publishes nothing it did not declare", () => {
  // Two endpoint shapes whose BODY no assertion in this file can see, so neither
  // is allowed at all rather than allowed-and-checked.
  //
  // A re-export: `export { disassociateChurchFromNetwork } from "./core"` adds a
  // POSTable, unauthenticated, state-changing endpoint out of a file this test
  // deliberately treats as non-public. If the action layer needs something from
  // `./core` it imports it and wraps it in an action that mints an actor.
  //
  // A DEFAULT export (HOLE 1): banned outright, because the reference is what
  // the client holds and the NAME is ours — so there is no allowlist entry it
  // could match and nothing about `export default async function
  // detachPlantFromNetwork(churchId)` distinguishes it from an action, except
  // that it takes its target as an argument and checks nobody.
  assert.doesNotMatch(SERVICE_CODE, /^export\s+default\b/m, "export default");
  assert.doesNotMatch(SERVICE_CODE, /^export\s*[*{]/m, "export {…} / export *");
  assert.deepEqual(REPUBLISHED, []);
});

test("no invitation action accepts an actor, anywhere", () => {
  // The forged-POST assertion, structurally: a user id in this module could
  // only have come from the client. `respondingUser` and `revokingUserId` were
  // the two parameters that made an anonymous POST able to act as somebody
  // else; their absence is the fix.
  for (const forbidden of [
    /respondingUser/,
    /revokingUserId/,
    /inviterUserId/,
    /userId/,
    /user_id/,
    /formData/,
    /searchParams/,
    /\bparams\b/,
  ]) {
    assert.doesNotMatch(SERVICE_CODE, forbidden, String(forbidden));
  }
});

test("the invitation actions do not reach the database directly", () => {
  // Every write goes through `./core`, which is where the authority checks and
  // the actor brand are. A raw `db.update(organizationInvitations)` here would
  // bypass both while still type-checking.
  assert.doesNotMatch(SERVICE_CODE, /from "@\/db"(?!;\s*$)/);
  assert.doesNotMatch(SERVICE_CODE, /\bdb\./);
  assert.match(SERVICE_CODE, /from "\.\/core"/);
});

test("nothing but the four lifecycle mutations is an endpoint", () => {
  // The eleven exports are the finding. Reads, the association primitives and
  // the row builders are not endpoints and must not reappear here: a read
  // exported from a `"use server"` module is an unauthenticated data leak, and
  // `disassociateChurchFromSendingChurch(churchId)` was a state change any
  // anonymous POST could aim at any church.
  //
  // The source-side twin of §1a. Both are kept: the namespace says WHAT is
  // published, this says the source agrees, and a disagreement between them is
  // itself the bug report.
  assert.deepEqual([...EXPORTED].sort(), LIFECYCLE_ACTIONS);
});

test("the logic layer is not a 'use server' module", () => {
  // `./core` holds every read, the association writes, and the actor-explicit
  // mutations. The absence of the directive is what makes them unreachable from
  // a browser — with it, all of them would be endpoints again. What that absence
  // GIVES UP is the client-bundle guarantee, replaced two tests down.
  assert.doesNotMatch(CORE_CODE, /"use server"/);
  assert.doesNotMatch(CORE_CODE, /'use server'/);
  assert.match(SERVICE_CODE, /^"use server";/);
});

test("no 'use server' module republishes the invitation logic layer", () => {
  // Two loopholes, and this covers both.
  //
  // (b) REPUBLICATION, transitively — HOLE 2. Any action module, `service.ts`
  // included, whose re-export edges REACH `./core`, however many barrels are in
  // between. `service.ts` is allowed to import `./core` — that is the whole
  // reason it exists — but `export { disassociateChurchFromNetwork } from
  // "./core"` would restore the endpoint this ticket removed, in the file whose
  // shape everybody believes is pinned. The first version of this test skipped
  // `service.ts` outright, so exactly that line passed; the second resolved ONE
  // hop, so a barrel (`index.ts` → `export * from "./core"`) plus a one-line
  // action module republished the whole logic layer and stayed green. Closure,
  // not one hop, and the chain is in the failure message.
  //
  // (a) Any OTHER action file that so much as TOUCHES `@/lib/invitations/core` —
  // importing a primitive there is one keystroke from exporting it, so the ban is
  // on the import. When #277/#278 add the authenticated disassociation wrappers,
  // they belong behind this rule, not around it: an action module derives the
  // entity from the session and calls into a logic layer it does not re-export.
  const offenders: string[] = [];

  for (const full of TS_FILES) {
    if (!isUseServerModule(full)) continue;
    const rel = path.relative(process.cwd(), full);
    const code = codeOf(full);

    // (b) Republication — checked in every action module, `service.ts` included.
    const chain = republishChainToCore(full);
    if (chain) {
      offenders.push(`republishes: ${chain.join(" → ")}`);
    }

    if (full === SERVICE_PATH) continue;

    // (a) Any other reference at all, import or re-export.
    if (
      /invitations\/core/.test(code) ||
      [...code.matchAll(ANY_FROM)].some(([, specifier]) =>
        resolvesToCore(full, specifier)
      )
    ) {
      offenders.push(rel);
    }
  }

  assert.deepEqual(offenders, []);
});

// ----------------------------------------------------------------------------
// 1d. The client-bundle rail the missing directive gave up
// ----------------------------------------------------------------------------

test("no client component can pull the logic layer into the browser", () => {
  // The rail that `"use server"` used to provide for free. `./core` imports
  // `@/db` and `@neondatabase/serverless`; before the split, the directive made
  // it structurally impossible to emit into a client bundle. It has no directive
  // now — that absence is the endpoint fix — so the guarantee has to be
  // re-established here.
  //
  // `import "server-only"` is the usual rail (`src/lib/auth/admin.ts:1`) and is
  // NOT usable on `./core`: the package's default entry is a bare `throw`
  // (`next/dist/compiled/server-only/index.js`) and resolves to the empty file
  // only under the `react-server` condition, so importing it would make every
  // test in this file — which imports `./core` directly, in a bare node process
  // — fail at load. This walk is the replacement: it is transitive, it runs on
  // every commit, and it fails in `pnpm test` rather than at runtime in a
  // browser.
  const clientEntries = TS_FILES.filter((full) =>
    /^["']use client["'];/m.test(readFileSync(full, "utf8"))
  );

  assert.ok(clientEntries.length > 0, "no client components found — check SRC");

  const seen = new Set<string>();
  const queue = [...clientEntries];
  const parents = new Map<string, string>();

  while (queue.length > 0) {
    const full = queue.pop()!;
    if (seen.has(full)) continue;
    seen.add(full);

    // A `"use server"` module is a boundary, not an import: the client gets a
    // reference and the body stays on the server. So client → `service.ts` →
    // `./core` is not a bundle path, and traversing it would make this test
    // fail the moment the invitation UI lands.
    if (isUseServerModule(full)) continue;

    for (const specifier of valueSpecifiers(codeOf(full))) {
      const resolved = resolveModule(full, specifier);
      if (resolved === null || seen.has(resolved)) continue;
      parents.set(resolved, full);
      queue.push(resolved);
    }
  }

  const chain = (file: string): string => {
    const hops = [path.relative(process.cwd(), file)];
    for (let at = parents.get(file); at; at = parents.get(at)) {
      hops.push(path.relative(process.cwd(), at));
    }
    return hops.reverse().join(" → ");
  };

  assert.ok(!seen.has(CORE_PATH), seen.has(CORE_PATH) ? chain(CORE_PATH) : "");
});

// ----------------------------------------------------------------------------
// 2. The actor — minted from a session, and from nothing else
// ----------------------------------------------------------------------------

const PLANT = "11111111-1111-4111-8111-111111111111";
const OTHER_PLANT = "aaaaaaaa-1111-4111-8111-111111111111";
const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const OTHER_SENDING_CHURCH = "bbbbbbbb-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const PLANTER_ID = "44444444-4444-4444-8444-444444444444";
const FOREIGN_ID = "55555555-5555-4555-8555-555555555555";
const INVITATION_ID = "77777777-7777-4777-8777-777777777777";

function actor(overrides: {
  id?: string;
  role: InvitationActor["role"];
  churchId?: string | null;
  sendingChurchId?: string | null;
  sendingNetworkId?: string | null;
}): InvitationActor {
  return invitationActorFromSession({
    user: {
      id: overrides.id ?? PLANTER_ID,
      role: overrides.role,
      churchId: overrides.churchId ?? null,
      sendingChurchId: overrides.sendingChurchId ?? null,
      sendingNetworkId: overrides.sendingNetworkId ?? null,
    },
  });
}

const PLANTER = actor({ role: "planter", churchId: PLANT });
const FOREIGN_PLANTER = actor({
  id: FOREIGN_ID,
  role: "planter",
  churchId: OTHER_PLANT,
});
const TEAM_MEMBER = actor({ role: "team_member", churchId: PLANT });
const SC_ADMIN = actor({
  role: "sending_church_admin",
  sendingChurchId: SENDING_CHURCH,
});
const NETWORK_ADMIN = actor({
  role: "network_admin",
  sendingNetworkId: NETWORK,
});

test("an actor carries the session's identity and nothing else", () => {
  // Derived, not passed through: a whole user row goes in and only the five
  // fields authority is decided on come out, so a password hash can never ride
  // along into a check or a log line.
  const minted = invitationActorFromSession({
    user: {
      id: PLANTER_ID,
      role: "planter",
      churchId: PLANT,
      sendingChurchId: null,
      sendingNetworkId: null,
      // @ts-expect-error extra fields on a real `User` must not survive the mint
      passwordHash: "argon2id$secret",
      email: "planter@example.test",
    },
  });

  assert.deepEqual(Object.keys(minted).sort(), [
    "churchId",
    "id",
    "role",
    "sendingChurchId",
    "sendingNetworkId",
  ]);
  assert.equal(minted.id, PLANTER_ID);
});

test("a user object off the wire is not an actor", () => {
  // The compile-time half of the AC. `respondingUser` used to be an argument,
  // so a forged POST could name anyone; now the only way to obtain an
  // `InvitationActor` is to mint one from a session, and an unused
  // `@ts-expect-error` is itself an error, so this cannot rot.
  const forged = {
    id: FOREIGN_ID,
    role: "planter" as const,
    churchId: PLANT,
    sendingChurchId: null,
    sendingNetworkId: null,
  };

  const call = () =>
    verifyInvitationAuthority(
      {
        type: "church_to_network",
        targetChurchId: PLANT,
        targetSendingChurchId: null,
      },
      // @ts-expect-error a plain object is not proof of a session
      forged
    );

  assert.equal(typeof call, "function");
});

// ----------------------------------------------------------------------------
// 3. Authority — per invitation type
// ----------------------------------------------------------------------------

const CHURCH_INVITATION = {
  type: "church_to_sending_church" as const,
  targetChurchId: PLANT,
  targetSendingChurchId: null,
};

const NETWORK_INVITATION = {
  type: "church_to_network" as const,
  targetChurchId: PLANT,
  targetSendingChurchId: null,
};

const SENDING_CHURCH_INVITATION = {
  type: "sending_church_to_network" as const,
  targetChurchId: null,
  targetSendingChurchId: SENDING_CHURCH,
};

test("the target plant's own planter may respond", () => {
  verifyInvitationAuthority(CHURCH_INVITATION, PLANTER);
  verifyInvitationAuthority(NETWORK_INVITATION, PLANTER);
});

test("a planter of a different plant may not respond", () => {
  // The forged-actor case with a real session behind it: being *a* planter is
  // not being *this* plant's planter.
  for (const invitation of [CHURCH_INVITATION, NETWORK_INVITATION]) {
    assert.throws(
      () => verifyInvitationAuthority(invitation, FOREIGN_PLANTER),
      (error: unknown) =>
        error instanceof InvitationError &&
        error.message === NOT_AUTHORIZED_MESSAGE
    );
  }
});

test("a team member of the target plant may not bind it to an org", () => {
  // Tightened in #265: "belongs to the church" used to be enough, so any team
  // member could enrol the plant under oversight.
  assert.throws(
    () => verifyInvitationAuthority(CHURCH_INVITATION, TEAM_MEMBER),
    InvitationError
  );
});

test("a churchless actor may not respond for a church", () => {
  assert.throws(
    () =>
      verifyInvitationAuthority(CHURCH_INVITATION, actor({ role: "planter" })),
    InvitationError
  );
});

test("only the target sending church's admin may join a network", () => {
  verifyInvitationAuthority(SENDING_CHURCH_INVITATION, SC_ADMIN);

  for (const wrong of [
    PLANTER,
    NETWORK_ADMIN,
    actor({
      role: "sending_church_admin",
      sendingChurchId: OTHER_SENDING_CHURCH,
    }),
    actor({ role: "planter", sendingChurchId: SENDING_CHURCH }),
  ]) {
    assert.throws(
      () => verifyInvitationAuthority(SENDING_CHURCH_INVITATION, wrong),
      InvitationError
    );
  }
});

// ----------------------------------------------------------------------------
// 3b. Authority fails CLOSED on a type nobody wrote a rule for
// ----------------------------------------------------------------------------

/**
 * Types the database can hold but the switch does not know. `type` is a bare
 * `varchar(40)` with a TypeScript-only `$type<>` cast and `insertInvitation`
 * validates nothing, so this is not a hypothetical shape — it is any row a
 * future writer, a migration or a fixture puts there.
 */
const UNKNOWN_TYPES = [
  "CHURCH_TO_NETWORK",
  "church_to_sending_church ",
  "anything_else",
  "",
] as unknown as OrganizationInvitationType[];

test("an unrecognised invitation type grants nobody authority", () => {
  // The failure this pins: a switch with no `default:` RETURNS NORMALLY, and
  // returning normally is how this function says "authorized". A team member of
  // an unrelated church was granted authority over a foreign church's
  // invitation for every one of these.
  const stranger = actor({ role: "team_member", churchId: OTHER_PLANT });

  for (const type of UNKNOWN_TYPES) {
    assert.throws(
      () =>
        verifyInvitationAuthority(
          {
            type,
            targetChurchId: PLANT,
            targetSendingChurchId: SENDING_CHURCH,
          },
          stranger
        ),
      (error: unknown) =>
        error instanceof InvitationError &&
        error.message === NOT_AUTHORIZED_MESSAGE,
      type
    );
  }
});

test("an unrecognised invitation type has no association to write either", () => {
  // Belt and braces on the same premise: the old switch fell through silently,
  // so an unknown type wrote no association but was still marked `accepted` and
  // still announced a milestone. Now it cannot get that far.
  for (const type of UNKNOWN_TYPES) {
    assert.throws(
      () =>
        associationStatement(
          {
            type,
            targetChurchId: PLANT,
            targetSendingChurchId: SENDING_CHURCH,
            sendingChurchId: SENDING_CHURCH,
            sendingNetworkId: NETWORK,
          },
          INVITATION_ID
        ),
      InvitationError,
      type
    );
  }
});

test("an invitation whose ids contradict its type writes nothing", () => {
  // Thrown while BUILDING the statement, so it happens before the claim runs —
  // an inconsistent row can never be marked accepted and left unassociated.
  const cases = [
    { type: "church_to_sending_church" as const, sendingChurchId: null },
    { type: "church_to_network" as const, sendingNetworkId: null },
    {
      type: "sending_church_to_network" as const,
      targetSendingChurchId: null,
      sendingNetworkId: NETWORK,
    },
  ];

  for (const override of cases) {
    assert.throws(
      () =>
        associationStatement(
          {
            targetChurchId: PLANT,
            targetSendingChurchId: SENDING_CHURCH,
            sendingChurchId: SENDING_CHURCH,
            sendingNetworkId: NETWORK,
            ...override,
          },
          INVITATION_ID
        ),
      InvitationError,
      override.type
    );
  }
});

// ----------------------------------------------------------------------------
// 4. Create — the inviting org comes from the session
// ----------------------------------------------------------------------------

test("a sending church admin invites plants into their OWN sending church", () => {
  const resolved = resolveInvitationRequest(SC_ADMIN, {
    targetChurchId: PLANT,
  });

  assert.ok(resolved.ok);
  assert.deepEqual(resolved.values, {
    type: "church_to_sending_church",
    inviterUserId: PLANTER_ID,
    targetChurchId: PLANT,
    targetSendingChurchId: null,
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: null,
    expiresInDays: INVITATION_EXPIRY_DAYS,
  });
});

test("org ids smuggled onto the payload are discarded, not written", () => {
  // The write-path half of "a forged POST changes nothing". The inviting org
  // decides who ends up associated with whom — and who receives the one
  // oversight notification that bypasses consent — so it is derived from the
  // session and a client value for it is dropped on the floor.
  const resolved = resolveInvitationRequest(SC_ADMIN, {
    targetChurchId: PLANT,
    // @ts-expect-error the point of the test: a client cannot name the inviter
    sendingChurchId: OTHER_SENDING_CHURCH,
    sendingNetworkId: NETWORK,
    inviterUserId: FOREIGN_ID,
    type: "sending_church_to_network",
  });

  assert.ok(resolved.ok);
  assert.equal(resolved.values.sendingChurchId, SENDING_CHURCH);
  assert.equal(resolved.values.sendingNetworkId, null);
  assert.equal(resolved.values.inviterUserId, PLANTER_ID);
  assert.equal(resolved.values.type, "church_to_sending_church");
  assert.ok(!JSON.stringify(resolved.values).includes(OTHER_SENDING_CHURCH));
  assert.ok(!JSON.stringify(resolved.values).includes(FOREIGN_ID));
});

test("a network admin invites into their OWN network, either kind of target", () => {
  const plant = resolveInvitationRequest(NETWORK_ADMIN, {
    targetChurchId: PLANT,
  });
  assert.ok(plant.ok);
  assert.equal(plant.values.type, "church_to_network");
  assert.equal(plant.values.sendingNetworkId, NETWORK);

  const sendingChurch = resolveInvitationRequest(NETWORK_ADMIN, {
    targetSendingChurchId: SENDING_CHURCH,
  });
  assert.ok(sendingChurch.ok);
  assert.equal(sendingChurch.values.type, "sending_church_to_network");
  assert.equal(sendingChurch.values.sendingNetworkId, NETWORK);
  assert.equal(sendingChurch.values.targetChurchId, null);
});

test("a sending church cannot invite another sending church", () => {
  const resolved = resolveInvitationRequest(SC_ADMIN, {
    targetSendingChurchId: OTHER_SENDING_CHURCH,
  });

  assert.ok(!resolved.ok);
});

test("nobody without an oversight role may invite", () => {
  for (const role of ["planter", "coach", "team_member"] as const) {
    const resolved = resolveInvitationRequest(
      actor({ role, churchId: PLANT }),
      { targetChurchId: OTHER_PLANT }
    );
    assert.ok(!resolved.ok, role);
  }
});

test("an oversight admin with no org of their own may not invite", () => {
  assert.ok(
    !resolveInvitationRequest(actor({ role: "sending_church_admin" }), {
      targetChurchId: PLANT,
    }).ok
  );
  assert.ok(
    !resolveInvitationRequest(actor({ role: "network_admin" }), {
      targetChurchId: PLANT,
    }).ok
  );
});

test("the target must be exactly one well-formed id", () => {
  const cases = [
    {},
    { targetChurchId: PLANT, targetSendingChurchId: SENDING_CHURCH },
    { targetChurchId: "not-a-uuid" },
    { targetChurchId: "' or 1=1 --" },
    { targetSendingChurchId: "42" },
  ];

  for (const request of cases) {
    assert.ok(
      !resolveInvitationRequest(NETWORK_ADMIN, request).ok,
      JSON.stringify(request)
    );
  }
});

test("the expiry window is bounded", () => {
  for (const expiresInDays of [0, -1, 1.5, MAX_EXPIRY_DAYS + 1, 36500]) {
    assert.ok(
      !resolveInvitationRequest(NETWORK_ADMIN, {
        targetChurchId: PLANT,
        expiresInDays,
      }).ok,
      String(expiresInDays)
    );
  }

  const ok = resolveInvitationRequest(NETWORK_ADMIN, {
    targetChurchId: PLANT,
    expiresInDays: MAX_EXPIRY_DAYS,
  });
  assert.ok(ok.ok);
  assert.equal(ok.values.expiresInDays, MAX_EXPIRY_DAYS);
});

// ----------------------------------------------------------------------------
// 5. The statements — the user recorded is the session's user
// ----------------------------------------------------------------------------

test("a response records the session's user, and only a pending row", () => {
  // The forged-`respondingUser` case read off the SQL. `responded_by` is bound
  // to the actor's id — the value that used to arrive as an argument — and the
  // WHERE clause is a compare-and-set on `pending`, so a second response
  // matches no row (no second association, no second milestone notification).
  const invitationId = INVITATION_ID;

  for (const status of ["accepted", "declined"] as const) {
    const { sql, params } = respondToInvitationQuery(
      PLANTER,
      invitationId,
      status
    ).toSQL();

    assert.ok(params.includes(PLANTER_ID), status);
    assert.ok(params.includes(status));
    assert.ok(params.includes("pending"));
    assert.ok(!params.includes(FOREIGN_ID));
    assert.match(sql, /responded_by/);
    assert.match(sql, /"status" = \$\d+/);
  }
});

test("the revoke statement is scoped to the session's own user", () => {
  // The authority check lives in the UPDATE, so this is where it has to be
  // read: the bound parameters carry the actor's id and the invitation id, and
  // a foreign id appears nowhere. Also `status = 'pending'`, so a revoke can
  // never resurrect an answered invitation.
  const invitationId = "66666666-6666-4666-8666-666666666666";
  const { sql, params } = revokeInvitationQuery(
    actor({ role: "network_admin", sendingNetworkId: NETWORK }),
    invitationId
  ).toSQL();

  assert.ok(params.includes(PLANTER_ID));
  assert.ok(params.includes(invitationId));
  assert.ok(params.includes("pending"));
  assert.ok(!params.includes(FOREIGN_ID));
  assert.match(sql, /inviter_user_id/);
});

test("the association cannot be written unless the claim was won", () => {
  // The half-applied accept, read off the SQL. `acceptInvitationAs` batches the
  // claim (statement 1, `status = 'pending' → 'accepted'`) with this statement,
  // whose WHERE requires the invitation to ALREADY read `accepted` — a value
  // only that claim can have written, visible here because both run in one Neon
  // batched transaction. So an accept that loses to a revoke or a decline
  // matches no row and the plant is not bound to anything.
  //
  // An empty `returning()` is not a driver error and does not roll a batch back,
  // which is why this predicate — and not `db.batch` alone — is the guard.
  const cases = [
    {
      invitation: {
        type: "church_to_sending_church" as const,
        targetChurchId: PLANT,
        targetSendingChurchId: null,
        sendingChurchId: SENDING_CHURCH,
        sendingNetworkId: null,
      },
      table: /update "churches"/,
      column: /"sending_church_id" = \$\d+/,
      bound: SENDING_CHURCH,
    },
    {
      invitation: {
        type: "church_to_network" as const,
        targetChurchId: PLANT,
        targetSendingChurchId: null,
        sendingChurchId: null,
        sendingNetworkId: NETWORK,
      },
      table: /update "churches"/,
      column: /"sending_network_id" = \$\d+/,
      bound: NETWORK,
    },
    {
      invitation: {
        type: "sending_church_to_network" as const,
        targetChurchId: null,
        targetSendingChurchId: SENDING_CHURCH,
        sendingChurchId: null,
        sendingNetworkId: NETWORK,
      },
      table: /update "sending_churches"/,
      column: /"sending_network_id" = \$\d+/,
      bound: NETWORK,
    },
  ];

  for (const { invitation, table, column, bound } of cases) {
    const { sql, params } = associationStatement(
      invitation,
      INVITATION_ID
    ).toSQL();

    assert.match(sql, table, invitation.type);
    assert.match(sql, column, invitation.type);
    assert.match(
      sql,
      /exists \(select .* from "organization_invitations"/,
      invitation.type
    );
    assert.ok(params.includes(INVITATION_ID), invitation.type);
    assert.ok(params.includes("accepted"), invitation.type);
    assert.ok(params.includes(bound), invitation.type);
    // Not `pending`: inside the batch the claim has already flipped the row, so
    // a `pending` predicate here would never match and no association would
    // EVER be written.
    assert.ok(!params.includes("pending"), invitation.type);
  }
});

test("the auto-expire write is a compare-and-set too", () => {
  // The sibling status write the first CAS skipped: `WHERE id = ?` alone let two
  // requests straddling the expiry instant (a double-clicked Accept is enough)
  // stamp `expired` over a committed `accepted` — leaving `responded_by` set,
  // the association live and the status contradicting both.
  const now = new Date("2026-08-03T00:00:00.000Z");
  const { sql, params } = expireInvitationQuery(INVITATION_ID, now).toSQL();

  assert.match(sql, /update "organization_invitations"/);
  assert.match(sql, /"status" = \$\d+/);
  assert.match(sql, /"expires_at" < \$\d+/);
  assert.ok(params.includes(INVITATION_ID));
  assert.ok(params.includes("pending"));
  assert.ok(params.includes("expired"));
});

// ----------------------------------------------------------------------------
// 6. Ids are ids
// ----------------------------------------------------------------------------

test("a malformed invitation id is not a lookup", async () => {
  // `getInvitation` is reachable with no session at all — the register beta gate
  // checks an invitation id before an account exists — so it refuses anything
  // that is not a uuid before it reaches the database.
  assert.equal(await getInvitation("not-a-uuid"), null);
  assert.equal(await getInvitation(""), null);
  assert.equal(await getInvitation("' or 1=1 --"), null);
});

test("isUuid accepts a uuid and nothing else", () => {
  assert.ok(isUuid(PLANT));
  for (const value of [
    "",
    "abc",
    `${PLANT} `,
    `${PLANT}x`,
    42,
    null,
    undefined,
    {},
  ]) {
    assert.ok(!isUuid(value), String(value));
  }
});
