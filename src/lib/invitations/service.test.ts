import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { OrganizationInvitation } from "@/db/schema";
import type { OrganizationInvitationType } from "@/db/schema/organization-invitation";

import {
  INVITATION_EXPIRY_DAYS,
  InvitationError,
  NOT_AUTHORIZED_MESSAGE,
  associationStatement,
  expireInvitationQuery,
  invitationActorFromSession,
  invitationView,
  invitationsForOrgQuery,
  getInvitation,
  isUuid,
  lockTargetRow,
  resolveInvitationRequest,
  respondToInvitationQuery,
  revokeInvitationQuery,
  unboundTargetSlot,
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
// Four parts, and this file covers all four.
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
//    §1b′ extends the same treatment to the two OTHER `"use server"` modules in
//    this domain — the association surface and the org admin's sever, both added
//    by #304 and both on the allowlist in part 4. Being allowed to reach `./core`
//    is not the same claim as checking somebody first, and until round 5 nothing
//    made the second one about those five endpoints. It also pins the SESSION-
//    FIRST order ruled 2026-08-10: each export is called sessionless with a
//    well-formed argument AND a malformed one, and both must throw, so no
//    argument shape can be told from another with no session.
//
//    §1b″ closes the last gap in that claim (round 6). The invitations surface,
//    `oversight/invitations/actions.ts`, is the domain's third `"use server"`
//    module and its two `useActionState` endpoints parsed their FormData before
//    checking anybody — so the universal invariant round 5 wrote into
//    `memory/invariants.md` was false at the module the reader is most likely to
//    open. It is enumerated separately because its arguments are `FormData`, not
//    strings, and the well-formed/malformed pair has to be built with the field
//    names the schemas read. The source-order assertion below now covers all
//    three files, so the invariant is true domain-wide or the suite is red.
//
// 3. AUTHORITY — the check that stood between an anonymous request and a
//    stranger's association, now unit-tested per invitation type. §5 adds the
//    WRITES that authority guards: a response is a compare-and-set on `pending`,
//    and an accept binds a free slot or re-binds its own but never replaces
//    another org's (both statements of the batch, both read off the SQL).
//
// 4. REACHABILITY — the two ways a `"use server"` module OTHER than `service.ts`
//    can put `./core` back on the wire: re-exporting from it, or importing from
//    it and wrapping. Both are closure walks over the real module graph (see
//    "no 'use server' module republishes …"), and the second is governed by an
//    allowlist that is asserted exhaustive in both directions, because two
//    modules do legitimately reach it.
//
// GUARDRAIL MUTATIONS — the shapes this file has been WATCHED to reject. A
// guardrail nobody has seen fail has not been tested, so each of these was
// applied to a clean tree, run, and watched go red; the counts are output, not
// estimates. 3, 4, 5 and 7 are the four holes HR4 found in earlier versions of
// this file (#265, evidence comments 2026-08-03), each of which left the suite
// GREEN — 5 and 7 with `tsc` at exit 0 as well.
//
// HOW TO RUN ONE (these are recipes, so they have to compile as written):
// mutations 1-3 are appended to the END of `./service.ts`; 4, 5 and 7 add two
// new files each; 6 edits `CORE_REACHING_ACTION_MODULES` below. Mutations 1 and 3
// call `disassociateChurchFromNetwork`, which `service.ts` deliberately does NOT
// import, so they ALSO require adding the line
// `disassociateChurchFromNetwork,` to that file's existing `from "./core"`
// import block — without it you get
// `TS2304: Cannot find name 'disassociateChurchFromNetwork'` from
// `pnpm typecheck` instead of the documented red suite. Baseline for the counts
// below is 40 tests / 40 pass; take them in a tree nobody else is writing to
// (`git archive <sha> | tar -x -C <dir>`, node_modules symlinked in, `.env.local`
// copied), because a shared worktree gives different counts:
//
//   1. `export const detachPlantFromNetwork = async (churchId: string) => {
//        await disassociateChurchFromNetwork(churchId);
//      };`
//      → 37 pass / 3 fail: "the runtime export surface is exactly the four
//        lifecycle mutations", "every exported invitation action mints its actor
//        from the session", "nothing but the four lifecycle mutations is an
//        endpoint".
//
//   2. `export { disassociateChurchFromSendingChurch } from "./core";`
//      → 37 pass / 3 fail: "the runtime export surface …", "the action layer
//        publishes nothing it did not declare", "no 'use server' module
//        republishes the invitation logic layer".
//
//   3. `export default async function detachPlantFromNetwork(churchId: string) {
//        await disassociateChurchFromNetwork(churchId);
//      }`
//      → HOLE 1, and 38 pass / 2 fail. The old allowlist matched
//        `export (async) function|const|let|var|class` and therefore never
//        `export default`, so this — a real, POSTable, unauthenticated "detach
//        any church from its network by guessing a uuid" endpoint — passed
//        every test. Now fails "the runtime export surface …" (the namespace
//        grows the key `default`) and "the action layer publishes nothing it
//        did not declare", which bans a default export of a `"use server"`
//        module OUTRIGHT: the client names the reference, so there is no
//        allowlist entry it could ever match. Note that `pnpm typecheck` does
//        NOT catch this shape once the import above is supplied — it is exit 0
//        on the mutated tree, which is exactly why the guardrail has to.
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
//        logic layer" with the chain in the message — 39 pass / 1 fail. Adding
//        one more barrel in between reports all four files, so the depth is not
//        two either.
//
//   5. The SAME barrel, with `import` + a wrapper instead of `export … from`:
//        `src/lib/invitations/index.ts`
//          → `export * from "./core";`
//        `src/app/(dashboard)/oversight/detach-actions.ts`
//          → `"use server";`
//            `import { disassociateChurchFromNetwork } from "@/lib/invitations";`
//            `export async function detachPlantFromNetwork(churchId: string) {`
//            `  await disassociateChurchFromNetwork(churchId);`
//            `}`
//      → HOLE 3, and the reason this file was rejected a second time. Same live
//        unauthenticated "detach any church by guessing a uuid" endpoint, one
//        keyword different — and on the tree before that fix (`8a5360c`) it was
//        35 pass / 0 fail with `npx tsc --noEmit` at exit 0, because check (a)
//        tested the literal string `invitations/core` plus ONE resolved hop per
//        `from` specifier. Now 39 pass / 1 fail, same test, with the chain in
//        the message: the check is a CLOSURE over value imports and the question
//        it asks is "can this action module REACH core", not "does it spell it".
//
//   6. Allowlist rot, both directions — the assertions that stop
//      `CORE_REACHING_ACTION_MODULES` from becoming a blanket exemption:
//        (a) delete the `src/app/(auth)/register/actions.ts` entry
//            → 39 pass / 1 fail, reporting the real chain
//              `register/actions.ts → register/beta-gate.ts → core.ts`.
//        (b) add an entry for a module that does NOT reach core (e.g.
//            `src/app/(dashboard)/settings/actions.ts`)
//            → 39 pass / 1 fail: "an allowlist entry no longer reaches …". So a
//              padded or stale list is a failing test, not a quiet exemption.
//
//   7. Mutation 5 again, with ONE CHARACTER REMOVED — the directive's semicolon:
//        `src/lib/invitations/index.ts`
//          → `export * from "./core";`
//        `src/app/(dashboard)/oversight/detach-actions.ts`
//          → `"use server"`      ← no semicolon
//            `import { disassociateChurchFromNetwork } from "@/lib/invitations";`
//            `export async function detachPlantFromNetwork(churchId: string) {`
//            `  await disassociateChurchFromNetwork(churchId);`
//            `}`
//      → HOLE 4, and the third rejection. `"use server"` without a semicolon is
//        the SAME directive — ASI makes it an expression statement either way and
//        Next.js publishes the module's exports — but the detector required one
//        (`/^["']use server["'];/m`), so this module was not a `"use server"`
//        module as far as either closure walk was concerned. Identical live
//        unauthenticated detach endpoint, 37 pass / 0 fail on `feature/265-…-r2`
//        with `tsc` at exit 0; the only thing that objected was
//        `pnpm format:check`, and a formatter is not a security control. Now
//        39 pass / 1 fail, same test as mutations 4-6, because the directive is
//        read off the module's PROLOGUE (see `declaresDirective`) — and the rule
//        is separately pinned against synthetic code by "a directive is a
//        directive without its semicolon", so it cannot regress unnoticed on a
//        tree where every real file happens to be formatted.
//
// The compare-and-set is covered from both sides: §5 reads it off the generated
// SQL (the claim's `status = 'pending'`, the association's
// `EXISTS ... status = 'accepted'`, the slot rule
// `fk IS NULL OR fk = <this org>` on BOTH statements, the `FOR UPDATE` lock on
// the row the association writes, the expiry's `status = 'pending'`), and the G3
// harness (`scripts/g3-oversight-model.ts` §3d) races real accepts on a real
// database: against a revoke and against a decline (cases A-F), against a SECOND
// sequential accept from another org (case G), and against a CONCURRENT accept
// for the same free slot (case H, 10 runs — the one the row lock exists for).
// The SQL assertions are what make the harness's result attributable to the
// guard; the lock is the half that has nothing to assert in SQL text, since the
// fault it fixes was two snapshots and not a missing predicate.
//
// §7 is the last of the four: what an action HANDS BACK. `InvitationView`, not
// the row, because the row carries two internal user uuids.
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
const CODE_CACHE = new Map<string, string>();

function codeOf(file: string): string {
  const cached = CODE_CACHE.get(file);
  if (cached !== undefined) return cached;

  const code = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  CODE_CACHE.set(file, code);
  return code;
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

/**
 * A module's DIRECTIVE PROLOGUE: the run of string-literal statements at the top
 * of the file, comments already stripped by `codeOf`.
 *
 * Both walks below turn on "is this a `"use server"` module", and getting that
 * answer wrong is not a cosmetic failure — a `"use server"` module is where the
 * endpoints are, and it is also the BOUNDARY both walks stop at. So a
 * false NEGATIVE hides a live endpoint from the reachability check, and a false
 * POSITIVE cuts the client-bundle walk short at a file that is not a boundary at
 * all. Neither may be decided by a pattern that happens to fit today's files.
 *
 * The bug this replaces (#265 r2, HR4 evidence 2026-08-03): `/^["']use
 * server["'];/m` required a SEMICOLON. `"use server"` without one is the same
 * directive — ASI makes it an expression statement either way, and Next.js reads
 * it — so a `"use server"` module written without the semicolon was invisible to
 * both closure walks, and a live unauthenticated detach endpoint passed a 37/37
 * green suite. Only `format:check` objected, and a formatter is not a security
 * control. It is documented mutation 7.
 *
 * Anchoring on the PROLOGUE rather than on a line anywhere in the file is what
 * keeps it precise: a directive is only a directive as the module's first
 * statement, so `["use server"]` in an array or `/^["']use server["']/` in a
 * regex further down cannot be mistaken for one.
 */
const PROLOGUE = /^(?:\s*(?:"[^"\n]*"|'[^'\n]*')\s*;?)*/;

/**
 * Does `code` open with this directive? Takes CODE, not a path, so the rule
 * itself is unit-testable — see "a directive is a directive without its
 * semicolon".
 */
function declaresDirective(code: string, directive: string): boolean {
  const prologue = PROLOGUE.exec(code)?.[0] ?? "";
  return new RegExp(`["']${directive}["']`).test(prologue);
}

const DIRECTIVE_CACHE = new Map<string, boolean>();

/** `"use server"` / `'use server'`, semicolon or not, as the first statement. */
function isUseServerModule(full: string): boolean {
  const cached = DIRECTIVE_CACHE.get(full);
  if (cached !== undefined) return cached;

  const declared = declaresDirective(codeOf(full), "use server");
  DIRECTIVE_CACHE.set(full, declared);
  return declared;
}

/** The same rule for the client half of the boundary (see §1d). */
function isUseClientModule(full: string): boolean {
  return declaresDirective(codeOf(full), "use client");
}

const rel = (full: string) => path.relative(process.cwd(), full);

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
    { file: entry, chain: [rel(entry)] },
  ];

  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;

    for (const specifier of republishEdges(codeOf(file))) {
      const resolved = resolveModule(file, specifier);
      if (resolved === null) continue;

      const next = [...chain, rel(resolved)];
      if (resolved === CORE_PATH) return next;
      if (seen.has(resolved)) continue;

      seen.add(resolved);
      queue.push({ file: resolved, chain: next });
    }
  }

  return null;
}

/**
 * The VALUE-IMPORT chain from `entry` to `core.ts`, or `null` when there is none.
 *
 * A ban on REACHABILITY, not on a spelling — HOLE 3. The check this replaces
 * tested `/invitations\/core/` against the source plus ONE `resolveModule` hop
 * per `from` specifier, so a one-line barrel (`index.ts` → `export * from
 * "./core"`) plus `import { disassociateChurchFromNetwork } from
 * "@/lib/invitations"` wrapped in an exported action was a live, POSTable,
 * unauthenticated "detach any church by guessing a uuid" endpoint that left the
 * suite green AND `tsc` at exit 0. Two hops would not have been enough either;
 * this is a closure.
 *
 * A `"use server"` module is a BOUNDARY, not an edge, exactly as in the
 * client-bundle walk (§1d): the client holds a reference and the body stays
 * server-side, so `some/actions.ts → service.ts → core.ts` is not this module's
 * reach — and `service.ts` is checked as its own entry anyway. Traversing it
 * would make every future action module that merely CALLS `acceptInvitation`
 * fail this test.
 */
function importChainToCore(entry: string): string[] | null {
  const seen = new Set<string>([entry]);
  const queue: Array<{ file: string; chain: string[] }> = [
    { file: entry, chain: [rel(entry)] },
  ];

  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;

    for (const specifier of valueSpecifiers(codeOf(file))) {
      const resolved = resolveModule(file, specifier);
      if (resolved === null) continue;

      const next = [...chain, rel(resolved)];
      if (resolved === CORE_PATH) return next;
      if (seen.has(resolved)) continue;

      seen.add(resolved);
      if (isUseServerModule(resolved)) continue;
      queue.push({ file: resolved, chain: next });
    }
  }

  return null;
}

/**
 * THE ALLOWLIST: every `"use server"` module allowed to reach `./core` at all,
 * and why. Nothing else may, however many modules it routes through.
 *
 * Asserted EXHAUSTIVE IN BOTH DIRECTIONS below — a module that reaches the logic
 * layer without an entry here fails, and an entry that no longer reaches it fails
 * too. The second half is the point: without it this list rots into a blanket
 * exemption, which is how a guardrail ends up reporting success over a hole. When
 * #277 and #278 add their authenticated `disassociate*` wrappers, each adds its
 * own line here in the same diff — a reviewer reads the reason and decides, which
 * is what the prose this replaced only wished for.
 *
 * Paths are repo-relative, `/`-separated.
 */
const CORE_REACHING_ACTION_MODULES: ReadonlyArray<readonly [string, string]> = [
  [
    "src/lib/invitations/service.ts",
    "the four session-minted lifecycle actions — this module is core's front door, and every other assertion in this file pins its shape",
  ],
  [
    "src/app/(dashboard)/settings/association/actions.ts",
    "#304/OV-007a — the PLANTER'S sever, which by ruling #274 ships with the surface that owns its authority rule rather than as a fifth lifecycle action. `leaveOversightOrgAs` takes the actor and a two-valued org KIND, never a church or org id; the FK null, its tenancy assertion and the audit row are one statement inside the logic layer. Accept and decline are re-wrapped here only to add `refresh()`",
  ],
  [
    "src/app/(dashboard)/oversight/plants/[id]/actions.ts",
    "#304/OV-007b — the ORG ADMIN'S sever, the mirror of the planter's and on the same ruling (#274): each side's wrapper ships with the surface that owns its authority rule, never as a fifth lifecycle action. `removePlantFromOrgAs` takes a church id — an org has many plants, so which one is a real choice — and NOTHING else: the org, its kind and the actor all come from the session, and the FK is nulled only while it still points at that org",
  ],
  [
    "src/app/(auth)/register/actions.ts",
    "two things, both necessarily session-free because no account exists yet: (1) the private-beta gate — `./beta-gate` → `hasValidInvitationBypass` → `getInvitation`, a READ, because an invitation id IS the bypass token (core.ts → Query Invitations); (2) #23's redemption — `bindOpenInvitationTarget` then `acceptInvitationAs`, which turn an invite link into an association. The WRITES are reached only from inside `register`, after the account has been created, and the actor is minted from the user row this same request inserted",
  ],
];

// The surface that consumes the four actions is deliberately NOT on that list:
// `(dash)/oversight/invitations/actions.ts` imports `service.ts` only, so the
// walk stops at that `"use server"` boundary and #23 added no new reach.

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
// 1b′. Forgery — the two association action modules #304 added (OV-007a/b, WS3)
//
// `service.ts` is not the only `"use server"` module in the invitation domain
// any more. #304 added the planter's association surface and the org admin's
// sever, both on `CORE_REACHING_ACTION_MODULES` above, and each publishes its
// own POST endpoints. §1b proves the four lifecycle actions refuse a sessionless
// call; without this the five newest endpoints had no equivalent, and the walk
// above only proves they are ALLOWED to reach `./core`, never that they check
// anybody first.
//
// It also pins the SESSION-FIRST order ruled 2026-08-10 (round 5 of #304). Each
// export is called twice with no session — once with a WELL-FORMED argument and
// once with a malformed one — and both must throw. That is the assertion the
// order exists for: while `safeParse` ran first, the malformed call returned
// `{ success: false, error: "Unknown invitation" }` to an anonymous caller and
// the well-formed one threw, so the pair of answers distinguished a valid uuid
// from an invalid one with no session at all. Two identical throws is what
// "nothing is examined before the session" looks like from outside.
// ----------------------------------------------------------------------------

/**
 * The association endpoint surface, DECLARED — module by module, export by
 * export. Asserted exhaustive against the real module namespace below, so a
 * sixth endpoint added to either file fails here until it is written down and
 * put through the sessionless call.
 */
const ASSOCIATION_ACTION_MODULES: ReadonlyArray<{
  readonly label: string;
  readonly load: () => Promise<Record<string, unknown>>;
  readonly exports: readonly string[];
}> = [
  {
    label: "src/app/(dashboard)/settings/association/actions.ts",
    load: async () =>
      (await import("@/app/(dashboard)/settings/association/actions")) as unknown as Record<
        string,
        unknown
      >,
    exports: [
      "acceptAssociationInvitation",
      "declineAssociationInvitation",
      "leaveNetwork",
      "leaveOversightOrg",
    ],
  },
  {
    label: "src/app/(dashboard)/oversight/plants/[id]/actions.ts",
    load: async () =>
      (await import("@/app/(dashboard)/oversight/plants/[id]/actions")) as unknown as Record<
        string,
        unknown
      >,
    exports: ["removePlantFromOrg"],
  },
];

test("the association modules publish exactly the endpoints they declare", async () => {
  // The same assertion §1a makes about `service.ts`, made about the two modules
  // #304 added: the module namespace IS the auth surface, so it is read off the
  // real import rather than grepped. `leaveNetwork` taking no argument at all is
  // part of the shape being pinned — a later "convenience" parameter on it would
  // be a network id a forged POST could aim (OV-013).
  for (const target of ASSOCIATION_ACTION_MODULES) {
    const mod = await target.load();
    assert.deepEqual(
      Object.keys(mod).sort(),
      [...target.exports].sort(),
      target.label
    );
  }
});

test("every association action refuses a call with no session, well-formed argument or not", async () => {
  // The forged POST, executed against the newest endpoints. The forged actor is
  // the same one §1b uses — the `respondingUser` shape that was once trusted —
  // and it lands in no parameter, because none of these five declares one.
  //
  // Both spellings of the refusal are the same refusal: in a real request with
  // no session cookie `verifySession()` throws `Unauthorized`; in this bare
  // process `cookies()` itself refuses, there being no request to read one from.
  // Either way it is a throw and not a `{ success: false }`, so nothing
  // downstream can mistake it for a handled outcome — and, crucially, the
  // malformed argument produces the SAME throw rather than a parse result.
  const forged = {
    id: "55555555-5555-4555-8555-555555555555",
    role: "planter" as const,
    churchId: "11111111-1111-4111-8111-111111111111",
  };

  // A syntactically valid uuid (`safeParse` would have accepted it) and a
  // string that is not one (`safeParse` would have rejected it). The endpoints
  // taking a two-valued org KIND read the same pair the same way: "network" is
  // well-formed, "" is not.
  const wellFormed = ["77777777-7777-4777-8777-777777777777", "network"];
  const malformed = ["not-a-uuid", ""];

  for (const target of ASSOCIATION_ACTION_MODULES) {
    const mod = await target.load();

    for (const name of target.exports) {
      const action = mod[name];
      assert.equal(typeof action, "function", `${target.label} → ${name}`);

      for (const argument of [...wellFormed, ...malformed]) {
        await assert.rejects(
          async () =>
            (action as (...args: unknown[]) => Promise<unknown>)(
              argument,
              forged
            ),
          (error: unknown) =>
            error instanceof Error &&
            /Unauthorized|outside a request scope/.test(error.message),
          `${target.label} → ${name}(${JSON.stringify(argument)})`
        );
      }

      // And with no argument at all — the shape `leaveNetwork` actually has.
      await assert.rejects(
        async () => (action as (...args: unknown[]) => Promise<unknown>)(),
        (error: unknown) =>
          error instanceof Error &&
          /Unauthorized|outside a request scope/.test(error.message),
        `${target.label} → ${name}()`
      );
    }
  }
});

// ----------------------------------------------------------------------------
// 1b″. Forgery — the FormData actions on the invitations surface (#23 / OV-003)
//
// The third `"use server"` module in this domain, and the one round 6 caught:
// `oversight/invitations/actions.ts` publishes two `useActionState` endpoints,
// and until this round both of them ran `safeParse` before any session check.
// They are enumerated apart from `ASSOCIATION_ACTION_MODULES` because their
// arguments are not strings — a `useActionState` action is called
// `(prevState, formData)`, so the well-formed/malformed pair has to be built as
// real `FormData` with the field names the schemas read.
//
// The same claim is being made about them: a sessionless call throws for BOTH
// argument shapes. While the parse ran first, a malformed `inviteeEmail`
// returned `{ error: "Enter a valid email address" }` to an anonymous caller
// and a well-formed one threw — the pair of answers told a valid address shape
// from an invalid one with no session at all. Two identical throws is what
// "nothing is examined before the session" looks like from outside.
//
// The mint here is deliberately a DUPLICATE: the service mints its own actor
// and this module passes nothing down. That is why the runtime assertion alone
// would not have caught the fault — the endpoints already refused a sessionless
// WELL-FORMED call, from inside the service. The malformed half is the half
// that fails when the guard is missing.
// ----------------------------------------------------------------------------

/**
 * The FormData endpoint surface, DECLARED — export by export, each with the
 * form the real client submits and a malformed twin of it. Asserted exhaustive
 * against the real module namespace below, so a third endpoint on this surface
 * fails here until it is written down and put through the sessionless call.
 */
const FORM_ACTION_MODULE = {
  label: "src/app/(dashboard)/oversight/invitations/actions.ts",
  load: async () =>
    (await import("@/app/(dashboard)/oversight/invitations/actions")) as unknown as Record<
      string,
      unknown
    >,
  exports: [
    {
      name: "createInvitationAction",
      // `safeParse` would accept the first and reject the second.
      wellFormed: { inviteeEmail: "a@b.co", inviteAs: "church" },
      malformed: { inviteeEmail: "nope", inviteAs: "church" },
    },
    {
      name: "revokeInvitationAction",
      wellFormed: { invitationId: "77777777-7777-4777-8777-777777777777" },
      malformed: { invitationId: "not-a-uuid" },
    },
  ],
} as const;

function formDataOf(fields: Readonly<Record<string, string>>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

test("the invitations action module publishes exactly the endpoints it declares", async () => {
  const mod = await FORM_ACTION_MODULE.load();

  assert.deepEqual(
    Object.keys(mod).sort(),
    FORM_ACTION_MODULE.exports.map((e) => e.name).toSorted(),
    FORM_ACTION_MODULE.label
  );
});

test("every invitations FormData action refuses a call with no session, well-formed form or not", async () => {
  const mod = await FORM_ACTION_MODULE.load();

  for (const { name, wellFormed, malformed } of FORM_ACTION_MODULE.exports) {
    const action = mod[name];
    assert.equal(
      typeof action,
      "function",
      `${FORM_ACTION_MODULE.label} → ${name}`
    );

    for (const [shape, fields] of [
      ["well-formed", wellFormed],
      ["malformed", malformed],
    ] as const) {
      // Called the way React calls it — previous state, then the form — and
      // also with the form alone, which is what a hand-rolled POST produces.
      for (const args of [[{}, formDataOf(fields)], [formDataOf(fields)]]) {
        await assert.rejects(
          async () =>
            (action as (...a: unknown[]) => Promise<unknown>)(...args),
          (error: unknown) =>
            error instanceof Error &&
            /Unauthorized|outside a request scope/.test(error.message),
          `${FORM_ACTION_MODULE.label} → ${name} (${shape}, ${args.length} args)`
        );
      }
    }

    // And with no argument at all.
    await assert.rejects(
      async () => (action as (...a: unknown[]) => Promise<unknown>)(),
      (error: unknown) =>
        error instanceof Error &&
        /Unauthorized|outside a request scope/.test(error.message),
      `${FORM_ACTION_MODULE.label} → ${name}()`
    );
  }
});

test("the session mint is the FIRST statement of every invitation-domain action", () => {
  // The structural half, read off the source. §1b′/§1b″ above prove the
  // endpoints refuse; this proves WHERE they refuse, which is what stops the
  // parse from creeping back above the mint in a later edit that still passes a
  // sessionless call (it would — a malformed id would return
  // `{ success: false }`, and `assert.rejects` on the well-formed one alone
  // would not notice).
  //
  // The list is every `"use server"` module in this domain that parses an
  // argument, and it is what round 6 grew: the invitations surface was the one
  // module the round-5 pass wrote the universal invariant about without ever
  // asserting it, and both of its exports parsed first.
  //
  // Read from the function body's first line: `verifySession()` must appear
  // before the first `safeParse` in each exported function.
  for (const file of [
    path.join(SRC, "app/(dashboard)/settings/association/actions.ts"),
    path.join(SRC, "app/(dashboard)/oversight/plants/[id]/actions.ts"),
    path.join(SRC, "app/(dashboard)/oversight/invitations/actions.ts"),
  ]) {
    const code = codeOf(file);
    const bodies = [
      ...code.matchAll(/export\s+async\s+function\s+(\w+)\s*\([^)]*\)[^{]*\{/g),
    ];

    assert.ok(bodies.length > 0, `no exported actions found in ${rel(file)}`);

    for (const match of bodies) {
      const body = code.slice(match.index + match[0].length);
      const end = body.search(/\n\}/);
      const scoped = end === -1 ? body : body.slice(0, end);

      const mint = scoped.indexOf("verifySession()");
      const parse = scoped.indexOf(".safeParse(");

      assert.ok(mint >= 0, `${rel(file)} → ${match[1]} never mints an actor`);
      if (parse >= 0) {
        assert.ok(
          mint < parse,
          `${rel(file)} → ${match[1]} parses its argument before checking the session`
        );
      }
    }
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

  // ...and the two walks below agree, since they are what actually decides.
  assert.ok(isUseServerModule(SERVICE_PATH), "service.ts is the action layer");
  assert.ok(!isUseServerModule(CORE_PATH), "core.ts must not be an endpoint");
});

test("a directive is a directive without its semicolon", () => {
  // The guardrail on the guardrail (#265 r2, HOLE 4 — documented mutation 7).
  // Both closure walks ask `isUseServerModule`, and the previous detector
  // required a trailing semicolon: `"use server"` on its own is the same
  // directive (ASI; Next.js reads it), so a module written that way was invisible
  // to both walks and shipped a live unauthenticated endpoint through a green
  // 37/37 suite. Only `format:check` noticed, and a formatter is not a security
  // control — which is why the rule is pinned here, against synthetic code, and
  // not only exercised on whatever the repo's files happen to look like today.
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
  // detection is its own bug: these walks STOP at `"use server"` boundaries, so
  // a false positive silently prunes the subtree it should have followed.
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
  // one real file of each kind — otherwise §1d walks nothing.
  assert.ok(declaresDirective('"use client"\n', "use client"));
  assert.ok(TS_FILES.some(isUseClientModule), "no client entries found");
  assert.ok(TS_FILES.some(isUseServerModule), "no action modules found");
});

test("no 'use server' module republishes the invitation logic layer", () => {
  // Two loopholes — republishing and importing — and this covers both, each as a
  // CLOSURE over the real module graph. What it does NOT do is look for the
  // string `@/lib/invitations/core`: a barrel makes the same endpoint out of a
  // different spelling, which is how HOLE 3 shipped through a green suite.
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
  // (a) REACHABILITY — HOLE 3. Any action module whose VALUE imports can reach
  // `./core`, transitively, stopping at `"use server"` boundaries exactly as
  // §1d's walk does. Importing a primitive there is one keystroke from exporting
  // it, so the ban is on the IMPORT — and on reaching the module, not on writing
  // the specifier `@/lib/invitations/core`, because a barrel plus an `import`
  // and a one-line wrapper is the same endpoint spelled differently (it passed
  // the previous version of this check with `tsc` at exit 0).
  //
  // Two action modules legitimately reach it and are allowlisted BY NAME, with
  // the reason, in `CORE_REACHING_ACTION_MODULES`. The allowlist is asserted
  // exhaustive in both directions, so it cannot quietly become an exemption for
  // everything, and #277/#278 have to add themselves on purpose.
  const republishers: string[] = [];
  const reaching = new Map<string, string>();

  for (const full of TS_FILES) {
    if (!isUseServerModule(full)) continue;

    // (b) Republication — checked in every action module, `service.ts` included.
    const republished = republishChainToCore(full);
    if (republished) {
      republishers.push(`republishes: ${republished.join(" → ")}`);
    }

    // (a) Reachability — likewise every action module, `service.ts` included;
    // the allowlist, not a skip, is what excuses the two that may.
    const imported = importChainToCore(full);
    if (imported) {
      reaching.set(rel(full), imported.join(" → "));
    }
  }

  assert.deepEqual(republishers, []);

  const allowed = new Map(CORE_REACHING_ACTION_MODULES);

  const unexpected = [...reaching]
    .filter(([module]) => !allowed.has(module))
    .map(([, chain]) => chain);

  assert.deepEqual(
    unexpected,
    [],
    `a "use server" module reaches ${rel(CORE_PATH)} with no allowlist entry — wrap the primitive in an action that mints an actor, or add the module to CORE_REACHING_ACTION_MODULES with the reason:\n  ${unexpected.join("\n  ")}`
  );

  const stale = [...allowed.keys()].filter((module) => !reaching.has(module));

  assert.deepEqual(
    stale,
    [],
    `an allowlist entry no longer reaches ${rel(CORE_PATH)} — delete the line rather than leave a standing exemption:\n  ${stale.join("\n  ")}`
  );
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
  // Same semicolon-agnostic prologue rule as the server side: a `"use client"`
  // written without one is still a client entry, and missing it would take the
  // whole subtree it imports out of this walk.
  const clientEntries = TS_FILES.filter(isUseClientModule);

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
const INVITEE_EMAIL = "planter@example.com";

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
  //
  // ALL THREE accept statements are checked, because all three switch on `type`:
  // an arm missing from the claim's guard would fail OPEN in the statement that
  // decides whether anything is written at all, and one missing from the lock
  // would let an accept run with nothing locked.
  for (const type of UNKNOWN_TYPES) {
    const invitation = {
      type,
      targetChurchId: PLANT,
      targetSendingChurchId: SENDING_CHURCH,
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: NETWORK,
    };

    assert.throws(
      () => associationStatement(invitation, INVITATION_ID),
      InvitationError,
      type
    );
    assert.throws(() => unboundTargetSlot(invitation), InvitationError, type);
    assert.throws(() => lockTargetRow(invitation), InvitationError, type);
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
    const invitation = {
      targetChurchId: PLANT,
      targetSendingChurchId: SENDING_CHURCH,
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: NETWORK,
      ...override,
    };

    assert.throws(
      () => associationStatement(invitation, INVITATION_ID),
      InvitationError,
      override.type
    );
    // Same rule in the claim's guard, or an inconsistent row would be claimed
    // and then not associated.
    assert.throws(
      () => unboundTargetSlot(invitation),
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
    inviteeEmail: INVITEE_EMAIL,
    targetChurchId: PLANT,
  });

  assert.ok(resolved.ok);
  assert.deepEqual(resolved.values, {
    type: "church_to_sending_church",
    inviterUserId: PLANTER_ID,
    inviteeEmail: INVITEE_EMAIL,
    targetChurchId: PLANT,
    targetSendingChurchId: null,
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: null,
  });
});

test("org ids smuggled onto the payload are discarded, not written", () => {
  // The write-path half of "a forged POST changes nothing". The inviting org
  // decides who ends up associated with whom — and who receives the one
  // oversight notification that bypasses consent — so it is derived from the
  // session and a client value for it is dropped on the floor.
  const resolved = resolveInvitationRequest(SC_ADMIN, {
    inviteeEmail: INVITEE_EMAIL,
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
    inviteeEmail: INVITEE_EMAIL,
    targetChurchId: PLANT,
  });
  assert.ok(plant.ok);
  assert.equal(plant.values.type, "church_to_network");
  assert.equal(plant.values.sendingNetworkId, NETWORK);

  const sendingChurch = resolveInvitationRequest(NETWORK_ADMIN, {
    inviteeEmail: INVITEE_EMAIL,
    targetSendingChurchId: SENDING_CHURCH,
  });
  assert.ok(sendingChurch.ok);
  assert.equal(sendingChurch.values.type, "sending_church_to_network");
  assert.equal(sendingChurch.values.sendingNetworkId, NETWORK);
  assert.equal(sendingChurch.values.targetChurchId, null);
});

test("a sending church cannot invite another sending church", () => {
  const resolved = resolveInvitationRequest(SC_ADMIN, {
    inviteeEmail: INVITEE_EMAIL,
    targetSendingChurchId: OTHER_SENDING_CHURCH,
  });

  assert.ok(!resolved.ok);

  // …nor an OPEN invitation to one: `inviteAs` is the same decision made before
  // the invitee has an account, and the same rule has to hold there.
  assert.ok(
    !resolveInvitationRequest(SC_ADMIN, {
      inviteeEmail: INVITEE_EMAIL,
      inviteAs: "sending_church",
    }).ok
  );
});

test("nobody without an oversight role may invite", () => {
  for (const role of ["planter", "coach", "team_member"] as const) {
    const resolved = resolveInvitationRequest(
      actor({ role, churchId: PLANT }),
      { inviteeEmail: INVITEE_EMAIL, targetChurchId: OTHER_PLANT }
    );
    assert.ok(!resolved.ok, role);
  }
});

test("an oversight admin with no org of their own may not invite", () => {
  assert.ok(
    !resolveInvitationRequest(actor({ role: "sending_church_admin" }), {
      inviteeEmail: INVITEE_EMAIL,
      targetChurchId: PLANT,
    }).ok
  );
  assert.ok(
    !resolveInvitationRequest(actor({ role: "network_admin" }), {
      inviteeEmail: INVITEE_EMAIL,
      targetChurchId: PLANT,
    }).ok
  );
});

test("at most one target, and only a well-formed id", () => {
  // #23 made "no target" LEGAL — an open invitation to somebody with no account
  // yet, whose organization does not exist to be pointed at until they register
  // (`bindOpenInvitationTarget`). Everything else about the rule is unchanged:
  // never two targets, and never a value that is not a uuid.
  const cases = [
    { targetChurchId: PLANT, targetSendingChurchId: SENDING_CHURCH },
    { targetChurchId: "not-a-uuid" },
    { targetChurchId: "' or 1=1 --" },
    { targetSendingChurchId: "42" },
    // The address is the one field a create form asks for, so it is validated
    // like one — an unparseable one never reaches a row.
    { inviteeEmail: "not-an-email", targetChurchId: PLANT },
    { inviteeEmail: "   ", targetChurchId: PLANT },
  ];

  for (const request of cases) {
    assert.ok(
      !resolveInvitationRequest(NETWORK_ADMIN, {
        inviteeEmail: INVITEE_EMAIL,
        ...request,
      }).ok,
      JSON.stringify(request)
    );
  }

  const open = resolveInvitationRequest(NETWORK_ADMIN, {
    inviteeEmail: INVITEE_EMAIL,
    inviteAs: "church",
  });
  assert.ok(open.ok);
  assert.equal(open.values.type, "church_to_network");
  assert.equal(open.values.targetChurchId, null);
  assert.equal(open.values.targetSendingChurchId, null);
});

test("the expiry window is server-fixed and not a client input", () => {
  // RULED 2026-08-03 (#265 r3): there is no client-facing expiry. An earlier
  // round of this fix let the caller name a window, clamped to 1–90 days with
  // user-facing copy for the refusal — an unspecified knob on a `"use server"`
  // endpoint, which is exactly the kind of surface this ticket exists to remove.
  // #23's create form gets no expiry field, so nothing needs one.
  //
  // Three assertions, because "we deleted the parameter" has to stay deleted:
  // the request TYPE rejects it (excess-property check, and an unused
  // `@ts-expect-error` is itself an error), the resolved row carries no expiry
  // field for a value to travel in, and the word appears nowhere in the logic
  // layer's code — so a helpful future `expiresInDays?: number` fails here rather
  // than shipping.
  const smuggled = resolveInvitationRequest(NETWORK_ADMIN, {
    inviteeEmail: INVITEE_EMAIL,
    targetChurchId: PLANT,
    // @ts-expect-error the ruling, as a compile error: expiry is not a request field
    expiresInDays: 36500,
  });

  assert.ok(smuggled.ok);
  assert.ok(!("expiresInDays" in smuggled.values), "expiry reached the row");
  assert.deepEqual(Object.keys(smuggled.values).sort(), [
    "inviteeEmail",
    "inviterUserId",
    "sendingChurchId",
    "sendingNetworkId",
    "targetChurchId",
    "targetSendingChurchId",
    "type",
  ]);

  assert.doesNotMatch(CORE_CODE, /expiresInDays/);
  assert.doesNotMatch(SERVICE_CODE, /expiresInDays/);
  assert.equal(INVITATION_EXPIRY_DAYS, 30);
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

/** Just the WHERE clause — `returning()` names every column and would answer for any of them. */
function whereOf(sql: string): string {
  const start = sql.indexOf(" where ");
  const end = sql.indexOf(" returning ");
  return sql.slice(start, end === -1 ? undefined : end);
}

test("the revoke statement is scoped to the session's own ORG", () => {
  // RULED 2026-08-04 (#23): revoke is scoped to the INVITING ORG, not the
  // inviting user — the pending list already is, so a second admin of the same
  // sending church was shown a queue whose Revoke button refused them.
  //
  // The authority check lives in the UPDATE, so this is where it has to be read:
  // the bound parameters carry the actor's OWN org id (from the session) and the
  // invitation id, no foreign org id appears, and `inviter_user_id` is gone from
  // the WHERE entirely. Also `status = 'pending'`, so a revoke can never
  // resurrect an answered invitation.
  const invitationId = "66666666-6666-4666-8666-666666666666";

  const network = revokeInvitationQuery(
    actor({ role: "network_admin", sendingNetworkId: NETWORK }),
    invitationId
  ).toSQL();

  assert.match(network.sql, /"sending_network_id" = \$\d+/);
  // The WHERE, not the whole statement: `returning()` names every column, so
  // `inviter_user_id` appears there and always will.
  assert.doesNotMatch(whereOf(network.sql), /inviter_user_id/);
  assert.ok(network.params.includes(NETWORK));
  assert.ok(network.params.includes(invitationId));
  assert.ok(network.params.includes("pending"));
  assert.ok(!network.params.includes(OTHER_SENDING_CHURCH));

  const sendingChurch = revokeInvitationQuery(SC_ADMIN, invitationId).toSQL();
  assert.match(sendingChurch.sql, /"sending_church_id" = \$\d+/);
  assert.doesNotMatch(whereOf(sendingChurch.sql), /inviter_user_id/);
  assert.ok(sendingChurch.params.includes(SENDING_CHURCH));
  assert.ok(!sendingChurch.params.includes(NETWORK));

  // …and the id of the admin doing the revoking is bound NOWHERE, which is the
  // whole change: a colleague who did not send it matches the same row.
  assert.ok(!sendingChurch.params.includes(PLANTER_ID));
  assert.ok(!sendingChurch.params.includes(FOREIGN_ID));
});

test("nobody outside an inviting org can revoke anything", () => {
  // The other half of "keep the checks strict". A planter, a team member, a
  // coach, and an oversight admin who has no org of their own each produce a
  // WHERE that matches NOTHING — not a missing predicate that `and()` would
  // drop, which would turn this statement into "revoke by id" for anyone.
  const invitationId = "66666666-6666-4666-8666-666666666666";

  for (const caller of [
    PLANTER,
    TEAM_MEMBER,
    actor({ role: "coach" }),
    actor({ role: "sending_church_admin", sendingChurchId: null }),
    actor({ role: "network_admin", sendingNetworkId: null }),
  ]) {
    const { sql, params } = revokeInvitationQuery(caller, invitationId).toSQL();

    assert.match(sql, /false/, caller.role);
    assert.doesNotMatch(sql, /"sending_church_id" = \$\d+/, caller.role);
    assert.doesNotMatch(sql, /"sending_network_id" = \$\d+/, caller.role);
    assert.ok(!params.includes(SENDING_CHURCH), caller.role);
    assert.ok(!params.includes(NETWORK), caller.role);
  }
});

test("the list and the revoke agree on what 'our invitations' means", () => {
  // The property the ruling turns on, asserted rather than promised: the org
  // predicate the pending list is read with is the SAME predicate the revoke
  // writes with. Two definitions of "ours" is exactly how a screen ends up
  // showing an admin a row whose button refuses them.
  for (const admin of [SC_ADMIN, NETWORK_ADMIN]) {
    const listed = invitationsForOrgQuery(admin).toSQL();
    const revoked = revokeInvitationQuery(
      admin,
      "66666666-6666-4666-8666-666666666666"
    ).toSQL();

    // Compared by COLUMN, not by rendered fragment: the two statements bind
    // their parameters at different positions ($1 in a select, $4 in an update),
    // and the placeholder number is not the thing that has to agree.
    const orgPredicate = /"(sending_church_id|sending_network_id)" = \$\d+/;
    const fromList = whereOf(listed.sql).match(orgPredicate);
    const fromRevoke = whereOf(revoked.sql).match(orgPredicate);

    assert.ok(fromList, admin.role);
    assert.ok(fromRevoke, admin.role);
    assert.equal(fromRevoke[1], fromList[1], admin.role);

    const orgId = admin.sendingChurchId ?? admin.sendingNetworkId;
    assert.ok(orgId, admin.role);
    assert.ok(listed.params.includes(orgId), admin.role);
    assert.ok(revoked.params.includes(orgId), admin.role);
  }
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

test("an accept binds a free slot or its own, and never replaces another org's", () => {
  // The second-accept ruling (#265, 2026-08-03), read off BOTH statements of the
  // batch. Plant P accepted sending church A; nothing stops B inviting P too, and
  // P's planter has authority over that invitation as well — so without this the
  // accept set `sending_church_id = B` and severed A with no type-to-confirm, no
  // notification to A and no audit row, the three things #274/OV-007 requires of
  // a sever, while A's invitation still read `accepted`.
  //
  // The guard has to be on statement ONE, the claim, and not only on the
  // association: the batch commits what matched, so a claim that won while the
  // association matched nothing would leave the invitation reading `accepted`
  // with the plant still bound to A. Hence both spellings of one rule, and hence
  // this test reads both. `IS NULL OR = this org` and not `IS NULL`, because
  // re-binding the same org must stay the idempotent no-op the replay path
  // depends on.
  const cases = [
    {
      invitation: {
        type: "church_to_sending_church" as const,
        targetChurchId: PLANT,
        targetSendingChurchId: null,
        sendingChurchId: SENDING_CHURCH,
        sendingNetworkId: null,
      },
      slot: /\("churches"\."sending_church_id" is null or "churches"\."sending_church_id" = \$\d+\)/,
      target: /exists \(select "id" from "churches"/,
      org: SENDING_CHURCH,
    },
    {
      invitation: {
        type: "church_to_network" as const,
        targetChurchId: PLANT,
        targetSendingChurchId: null,
        sendingChurchId: null,
        sendingNetworkId: NETWORK,
      },
      slot: /\("churches"\."sending_network_id" is null or "churches"\."sending_network_id" = \$\d+\)/,
      target: /exists \(select "id" from "churches"/,
      org: NETWORK,
    },
    {
      invitation: {
        type: "sending_church_to_network" as const,
        targetChurchId: null,
        targetSendingChurchId: SENDING_CHURCH,
        sendingChurchId: null,
        sendingNetworkId: NETWORK,
      },
      slot: /\("sending_churches"\."sending_network_id" is null or "sending_churches"\."sending_network_id" = \$\d+\)/,
      target: /exists \(select "id" from "sending_churches"/,
      org: NETWORK,
    },
  ];

  for (const { invitation, slot, target, org } of cases) {
    const association = associationStatement(invitation, INVITATION_ID).toSQL();
    assert.match(association.sql, slot, invitation.type);

    const claim = respondToInvitationQuery(
      PLANTER,
      INVITATION_ID,
      "accepted",
      unboundTargetSlot(invitation)
    ).toSQL();

    assert.match(claim.sql, target, invitation.type);
    assert.match(claim.sql, slot, invitation.type);
    assert.ok(claim.params.includes(org), invitation.type);
    // Still a compare-and-set: the slot rule is an EXTRA predicate, not a
    // replacement for the one that makes a second response match no row.
    assert.ok(claim.params.includes("pending"), invitation.type);
  }

  // A DECLINE takes no slot guard: declining says nothing about who the plant is
  // bound to, and an already-associated plant must still be able to say no.
  const decline = respondToInvitationQuery(
    PLANTER,
    INVITATION_ID,
    "declined"
  ).toSQL();

  assert.doesNotMatch(decline.sql, /exists/);
  assert.ok(decline.params.includes("pending"));
});

test("the accept batch locks the row the association will write", () => {
  // The accept-vs-accept race (#265 r3, HR4 evidence 2026-08-03). The slot rule
  // above is a SUBQUERY on the target's table, and a subquery reads a snapshot
  // and takes no lock — while the claim it guards updates a different table. So
  // two accepts of two DIFFERENT invitations for ONE free slot contended on
  // nothing: both claims committed `accepted`, READ COMMITTED's re-check made the
  // second association match nothing, and the loser announced an oversight
  // milestone for an association it never wrote (reproduced 6/10 runs).
  //
  // `lockTargetRow` is statement ONE of the batch and takes a row lock on the
  // entity the association will update, so the second accept waits for the
  // first to COMMIT and then evaluates the slot rule against what it wrote. What
  // is assertable here is that the lock exists, is `FOR UPDATE`, and names the
  // SAME table and row the association writes — a lock on anything else (the
  // invitation, say) would serialise nothing, since the two accepts are two
  // different invitations. That it then behaves is §3d case H, on a real
  // database, because the fault was two snapshots and not a missing predicate.
  const cases = [
    {
      invitation: {
        type: "church_to_sending_church" as const,
        targetChurchId: PLANT,
        targetSendingChurchId: null,
        sendingChurchId: SENDING_CHURCH,
        sendingNetworkId: null,
      },
      table: /from "churches"/,
      id: PLANT,
    },
    {
      invitation: {
        type: "church_to_network" as const,
        targetChurchId: PLANT,
        targetSendingChurchId: null,
        sendingChurchId: null,
        sendingNetworkId: NETWORK,
      },
      table: /from "churches"/,
      id: PLANT,
    },
    {
      invitation: {
        type: "sending_church_to_network" as const,
        targetChurchId: null,
        targetSendingChurchId: SENDING_CHURCH,
        sendingChurchId: null,
        sendingNetworkId: NETWORK,
      },
      table: /from "sending_churches"/,
      id: SENDING_CHURCH,
    },
  ];

  for (const { invitation, table, id } of cases) {
    const lock = lockTargetRow(invitation).toSQL();

    assert.match(lock.sql, /^select /, invitation.type);
    assert.match(lock.sql, table, invitation.type);
    assert.match(lock.sql, /for update\s*$/, invitation.type);
    assert.deepEqual(lock.params, [id], invitation.type);

    // The same table the association updates — otherwise the lock is on a row
    // nobody is competing for.
    const written = associationStatement(invitation, INVITATION_ID).toSQL().sql;
    const [, locked] = /from "(\w+)"/.exec(lock.sql) ?? [];
    assert.match(written, new RegExp(`^update "${locked}"`), invitation.type);

    // ...and it writes nothing itself: the lock is the whole contribution, and
    // a write here would be a third statement nobody accounted for. (The `for
    // update` clause is stripped first — it is the lock, not a write.)
    assert.doesNotMatch(
      lock.sql.replace(/\s*for update\s*$/, ""),
      /update|insert|delete/,
      invitation.type
    );
  }
});

test("the association reports whether it bound anything", () => {
  // The milestone is gated on the ASSOCIATION's rowcount, not the claim's, so
  // the statement has to return something. Without `returning()` "bound" and
  // "matched nothing" are indistinguishable, and the one state with no repair
  // path in the product — accepted, unassociated, milestone already announced —
  // would be reported to the user as success.
  for (const invitation of [
    {
      type: "church_to_sending_church" as const,
      targetChurchId: PLANT,
      targetSendingChurchId: null,
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: null,
    },
    {
      type: "sending_church_to_network" as const,
      targetChurchId: null,
      targetSendingChurchId: SENDING_CHURCH,
      sendingChurchId: null,
      sendingNetworkId: NETWORK,
    },
  ]) {
    const { sql } = associationStatement(invitation, INVITATION_ID).toSQL();
    assert.match(sql, /returning "id"/, invitation.type);
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

// ----------------------------------------------------------------------------
// 7. What comes back — a view, not the row
// ----------------------------------------------------------------------------

test("an action result carries no internal user ids", () => {
  // The four actions used to return the raw `organization_invitations` row, which
  // carries `inviter_user_id` and `responded_by` — so the invitee was told the
  // inviting admin's user id and the inviter the responder's. Nothing renders
  // either (a name is a join, not an id) and an id that reaches the client is an
  // id a request can be aimed at. Narrowed in `./core` so all four inherit it,
  // and pinned here rather than left to four call sites.
  const row: OrganizationInvitation = {
    id: INVITATION_ID,
    type: "church_to_sending_church",
    inviterUserId: FOREIGN_ID,
    inviteeEmail: INVITEE_EMAIL,
    targetChurchId: PLANT,
    targetSendingChurchId: null,
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: null,
    status: "accepted",
    respondedBy: PLANTER_ID,
    respondedAt: new Date("2026-08-03T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    expiresAt: new Date("2026-09-01T00:00:00.000Z"),
  };

  const view = invitationView(row);

  assert.deepEqual(Object.keys(view).sort(), [
    "createdAt",
    "expiresAt",
    "id",
    // The address the ADMIN typed — what the invitations list renders. Not an
    // identifier a request can be aimed at, unlike the two ids below it.
    "inviteeEmail",
    "respondedAt",
    "sendingChurchId",
    "sendingNetworkId",
    "status",
    "targetChurchId",
    "targetSendingChurchId",
    "type",
  ]);
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes(FOREIGN_ID), "the inviter's user id leaked");
  assert.ok(!serialized.includes(PLANTER_ID), "the responder's user id leaked");

  // ...and the action layer returns THAT, not what the mutation handed it.
  assert.match(SERVICE_CODE, /invitationView\(await mutate\(\)\)/);
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
