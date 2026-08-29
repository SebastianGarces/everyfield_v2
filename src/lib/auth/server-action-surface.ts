import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * THE AUTH SURFACE, READ OFF THE SOURCE TREE.
 *
 * Every export of a `"use server"` module is a POSTable endpoint reachable with
 * no session and no UI (`memory/invariants.md` → Authentication & Session), so
 * "which functions are endpoints, and does each one mint an actor before it
 * touches its argument?" is a question about the whole repository rather than
 * about one domain. This module is the static reader that answers it: a file
 * walk, a directive detector, a brace matcher, and a transitive "does this name
 * reach the session cookie" resolver.
 *
 * It lives beside `src/lib/auth/session.ts` — the module that owns the rule —
 * rather than inside whichever domain's test happened to need it first, and it
 * is a normal module rather than a `.test.ts` so a second caller can IMPORT it
 * instead of copying the walker. `src/lib/auth/server-action-surface.test.ts`
 * is the repo-wide assertion built on it; `src/lib/invitations/service.test.ts`
 * uses the same helpers for its domain-specific closure walks.
 *
 * Nothing here is imported by application code — it reads the filesystem and is
 * for tests and scripts only.
 */

export const SRC = path.join(process.cwd(), "src");

/** Every `.ts`/`.tsx` file under `src/`. */
export const TS_FILES: string[] = (function collect(dir: string): string[] {
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

const CODE_CACHE = new Map<string, string>();

/**
 * Comments and string literals, matched in ONE left-to-right pass so that
 * whichever opens first wins.
 *
 * TWO SEQUENTIAL `replace` CALLS GOT THIS WRONG, and the way it was wrong is
 * the way a static guard is worst: it deleted code silently. Stripping block
 * comments first meant a slash-star written INSIDE a line comment opened a
 * block that ran to the next star-slash anywhere below. `launch/actions.ts` has
 * one — a header
 * bullet naming the path `src/lib/launch/*` — and it swallowed the file's
 * entire import list plus the next docblock. Nothing failed: the mint walk was
 * looking for a literal `verifySession()` that survived below the wreckage, and
 * only #498's guard walk, which has to RESOLVE an import to see the guard,
 * noticed the imports were gone. A module could have hidden an unguarded export
 * the same way.
 *
 * String and template literals are matched too, and kept, so a `//` inside one
 * is not a comment — the same reason `https://` never was (the `(^|\s)` anchor
 * the old line pattern used).
 */
const COMMENT_OR_LITERAL =
  /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;

/**
 * A module with its comments removed. Every assertion built on this is about
 * CODE: a file that explains a rule by naming the shape it forbids
 * (`respondingUser`, `db.`, `"use server"`) would otherwise trip the test that
 * enforces it.
 */
export function codeOf(file: string): string {
  const cached = CODE_CACHE.get(file);
  if (cached !== undefined) return cached;

  const code = readFileSync(file, "utf8").replace(
    COMMENT_OR_LITERAL,
    (match, literal: string | undefined) => literal ?? ""
  );
  CODE_CACHE.set(file, code);
  return code;
}

export const rel = (full: string): string => path.relative(process.cwd(), full);

function specifiersMatching(code: string, patterns: RegExp[]): string[] {
  return patterns.flatMap((pattern) =>
    [...code.matchAll(pattern)].map(([, specifier]) => specifier)
  );
}

/**
 * Specifiers a module names in its STATIC import graph: value imports, value
 * re-exports (`export … from`) and side-effect imports. `import()` is excluded
 * BY DESIGN, which is the whole reason this is a separate export.
 *
 * It is the predicate every no-DATABASE_URL seam guard is written in terms of —
 * `src/lib/oversight/read-imports.test.ts`, the two import-free-leaf guards
 * (`@/lib/auth/roles`, `@/lib/oversight/org-label`) and the "no data-layer
 * import on the page" guard. Those modules keep their contract by DEFERRING
 * `@/db` into the call (`await import("@/db")`), so a scan that counted dynamic
 * specifiers would fail on the very code that satisfies the rule, while a scan
 * that missed the static forms would pass on the code that breaks it.
 *
 * IT EXISTS BECAUSE FOUR TESTS HAD WRITTEN THEIR OWN, each weaker than this one
 * and weaker in a different place. Measured, the copies caught:
 *
 *   - `^import\s+(?!type\b)[^;]*?from\s+"(@\/[^"]+)"` — 1 of the 5 ways to
 *     reach `@/db` at module scope. Double quotes only, unindented only, no
 *     side-effect import, no `export … from`.
 *   - `^import\s+(?!type\b)` (the two leaf guards) — missed `export … from`,
 *     which is EXACTLY the failure they exist to prevent (`register-path.ts`,
 *     `memory/invariants.md` → Multi-Tenancy), and missed an indented import.
 *   - `^import\s+[^;]*?from\s+"([^"]+)"` (the page guard) — the same four holes.
 *
 * The three anchors that close them: `^\s*` for indentation, `["']` for either
 * quote, `(?:import|export)` for the re-export, and the side-effect pattern for
 * a bare `import "@/db"`.
 */
export function staticValueSpecifiers(code: string): string[] {
  return specifiersMatching(code, [
    /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*["']([^"']+)["']/gm,
    /^\s*import\s*["']([^"']+)["']/gm,
  ]);
}

/** Specifiers whose module is actually emitted: value imports and `import()`. */
export function valueSpecifiers(code: string): string[] {
  return [
    ...staticValueSpecifiers(code),
    ...specifiersMatching(code, [/\bimport\(\s*["']([^"']+)["']\s*\)/g]),
  ];
}

/** The file a specifier names, or `null` for a bare package. */
export function resolveModule(from: string, specifier: string): string | null {
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
 * Every walk here turns on "is this a `"use server"` module", and getting that
 * answer wrong is not a cosmetic failure — a `"use server"` module is where the
 * endpoints are, and it is also the BOUNDARY the closure walks stop at. So a
 * false NEGATIVE hides a live endpoint from the checks, and a false POSITIVE
 * cuts the client-bundle walk short at a file that is not a boundary at all.
 *
 * The bug this replaces (#265 r2, HR4 evidence 2026-08-03): `/^["']use
 * server["'];/m` required a SEMICOLON. `"use server"` without one is the same
 * directive — ASI makes it an expression statement either way, and Next.js reads
 * it — so a `"use server"` module written without the semicolon was invisible to
 * both closure walks, and a live unauthenticated detach endpoint passed a 37/37
 * green suite. Only `format:check` objected, and a formatter is not a security
 * control.
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
 * semicolon" in the sibling test.
 */
export function declaresDirective(code: string, directive: string): boolean {
  const prologue = PROLOGUE.exec(code)?.[0] ?? "";
  return new RegExp(`["']${directive}["']`).test(prologue);
}

const DIRECTIVE_CACHE = new Map<string, boolean>();

/** `"use server"` / `'use server'`, semicolon or not, as the first statement. */
export function isUseServerModule(full: string): boolean {
  const cached = DIRECTIVE_CACHE.get(full);
  if (cached !== undefined) return cached;

  const declared = declaresDirective(codeOf(full), "use server");
  DIRECTIVE_CACHE.set(full, declared);
  return declared;
}

/** The same rule for the client half of the boundary. */
export function isUseClientModule(full: string): boolean {
  return declaresDirective(codeOf(full), "use client");
}

/**
 * The body of every top-level function in `code`, by name, found by MATCHING
 * BRACES rather than by looking for the next `\n}`.
 *
 * The round-6 version of the source assertion sliced at the first line-initial
 * `}` it could find, which is the closing brace of whatever nested block came
 * first — a `try`, an `if`, an object literal spread over lines. That is fine
 * while the mint is at the very top and catastrophic the moment somebody moves
 * it below one, because the scan then reads a body that stops before the
 * statement it is judging. Counting braces reads the whole function or nothing.
 *
 * THE RETURN TYPE IS NOT THE BODY. Finding the opening brace is its own small
 * problem, because a return type may CONTAIN braces:
 *
 *   async function currentViewer(): Promise<
 *     { ok: true; viewer: NotificationViewer } | { ok: false; error: string }
 *   > { … }
 *
 * — which is the real signature in `notifications/actions.ts`. A pattern that
 * took the first `{` after the parameter list would open at `{ ok: true …` and
 * read a "body" that is a type. So the scan walks forward from the closing
 * parenthesis and takes the first brace at ANGLE DEPTH ZERO; `=>` inside a
 * function type is not a closing angle bracket and is skipped.
 *
 * IT MATCHES `function` DECLARATIONS ONLY, which is a real limit and the reason
 * `valueExportStatements` exists: `export const fooAction = async (input) => …`
 * is just as POSTable and would be invisible here. Rather than grow a second
 * parser for a form the product does not use, the sibling test BANS that form in
 * `"use server"` modules and says so in the failure message, so the walk's blind
 * spot is a failing test instead of a hiding place.
 *
 * A GENERIC declaration — `export async function withChurchSession<T>(…)` — is
 * read like any other. That is not cosmetic: the people domain's shared
 * session envelope is written that way (`people/action-context.ts`), and a
 * header pattern that stopped at the `<` left the helper out of
 * `mintingExportsOf`, which reported thirteen correctly-guarded endpoints as
 * "parses an argument and never mints an actor". The walk under-approximates
 * on purpose everywhere else; here it was simply blind, so it is fixed rather
 * than exempted. `[^(]*` is what keeps the optional group from wandering into
 * the parameter list of a NON-generic declaration.
 *
 * Strings and template literals are not tracked. They do not need to be for this
 * corpus, and a mis-parse fails LOUD (an unbalanced count runs to end of file
 * and the assertions still see the real body) rather than silently short.
 */
export function functionBodies(
  code: string
): { name: string; body: string; exported: boolean }[] {
  const found: { name: string; body: string; exported: boolean }[] = [];
  const header =
    /(export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^(]*>\s*)?\(/g;

  for (const match of code.matchAll(header)) {
    let i = match.index + match[0].length;

    // The parameter list, which nests: `(fn: (a: string) => void)`.
    for (let parens = 1; i < code.length && parens > 0; i++) {
      if (code[i] === "(") parens++;
      else if (code[i] === ")") parens--;
    }

    // The return type, skipped to the first brace outside any `<…>`.
    let angle = 0;
    let open = -1;
    for (; i < code.length; i++) {
      const char = code[i];
      if (char === "<") angle++;
      else if (char === ">" && code[i - 1] !== "=")
        angle = Math.max(0, angle - 1);
      else if (char === "{" && angle === 0) {
        open = i;
        break;
      } else if (char === ";" && angle === 0) break; // an overload signature
    }
    if (open < 0) continue;

    let depth = 0;
    let end = code.length;

    for (let j = open; j < code.length; j++) {
      if (code[j] === "{") depth++;
      else if (code[j] === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }

    found.push({
      name: match[2],
      body: code.slice(open + 1, end),
      exported: Boolean(match[1]),
    });
  }

  return found;
}

/**
 * Every `catch (binding) { … }` block in `code`, with its body.
 *
 * A CATCH IS WHERE THE SESSIONLESS REFUSAL GOES WRONG (#508). `verifySession()`
 * throws, and an action that mints inside its `try` has a `catch` standing
 * between that throw and the framework — six modules turned it into
 * `{ success: false, error: "You must be logged in …" }`, which is the handled
 * answer an anonymous POST is never supposed to get. So the rule the sibling
 * test asserts is about catch bodies, and this is the reader for them.
 *
 * `.catch(` IS NOT ONE, and the lookbehind is what says so: a fire-and-forget
 * `sendEmail(…).catch((err) => …)` is a promise handler, not a boundary the
 * refusal passes through. `catch {` with no binding is not returned either —
 * there is no name to rethrow — which under-approximates on purpose, the same
 * way the rest of this module does.
 */
export function catchBlocks(code: string): { binding: string; body: string }[] {
  const found: { binding: string; body: string }[] = [];

  for (const match of code.matchAll(
    /(?<![.\w])catch\s*\(\s*(\w+)\s*\)\s*\{/g
  )) {
    const open = match.index + match[0].length - 1;

    let depth = 0;
    let end = code.length;
    for (let i = open; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    found.push({ binding: match[1], body: code.slice(open + 1, end) });
  }

  return found;
}

/** The one way out of a catch for a sessionless call (`@/lib/auth/unauthorized`). */
export const UNAUTHORIZED_RETHROW = ["rethrowUnauthorized"];

/**
 * Export statements whose endpoint `functionBodies` CANNOT read — a value
 * binding (`export const fooAction = async (input) => {…}`), a default export,
 * or a re-export.
 *
 * Each of these publishes a POSTable endpoint that the brace matcher above does
 * not return, so an action written that way would sail through the repo-wide
 * order assertion having never been looked at. The sibling test asserts this is
 * EMPTY for every `"use server"` module, which turns the parser's blind spot
 * into a loud failure at the moment somebody writes one.
 *
 * IT RETURNS THE WHOLE STATEMENT, braces included, because the second caller
 * reads the NAMES in it: `auth/roles.test.ts` asks "does any module but the leaf
 * export the role policy?", and a `.*$` pattern answers that question about the
 * first LINE only — so a re-export prettier had wrapped over four lines would
 * have been the one shape the guard could not see, which is the hole every
 * hand-rolled copy of this reader left open.
 */
export function valueExportStatements(code: string): string[] {
  return [
    /^export\s+(?:const|let|var)\s+\w+.*$/gm,
    /^export\s+default\b.*$/gm,
    /^export\s*\*.*$/gm,
    /^export\s*\{[^}]*\}[^;\n]*;?/gm,
  ].flatMap((pattern) =>
    (code.match(pattern) ?? []).map((line) => line.trim())
  );
}

/**
 * The two functions that READ THE SESSION COOKIE. Everything else that counts as
 * a mint counts because it reaches one of these.
 *
 * `verifySession` is the throwing form every action uses; `getCurrentSession` is
 * the nullable one it and the page guards are built on. Both live in
 * `src/lib/auth/session.ts` and nothing else in the product opens that cookie.
 */
export const SESSION_READS = ["verifySession", "getCurrentSession"];

/** `import { a, b as c } from "x"` → local name ⇒ { module, original }. */
export function importedBindings(
  file: string,
  code: string
): Map<string, { module: string; original: string }> {
  const bindings = new Map<string, { module: string; original: string }>();

  for (const match of code.matchAll(
    /^\s*import\s+(?!type\b)\{([^}]*)\}\s*from\s*["']([^"']+)["']/gm
  )) {
    const target = resolveModule(file, match[2]);
    if (target === null) continue;

    for (const clause of match[1].split(",")) {
      const parts = clause.trim().split(/\s+as\s+/);
      const original = parts[0]?.trim();
      const local = (parts[1] ?? parts[0])?.trim();
      if (!original || !local || original === "type") continue;
      bindings.set(local, { module: target, original });
    }
  }

  return bindings;
}

const REACHING_EXPORTS = new Map<string, readonly string[]>();

type ReachingNamesResult = {
  readonly names: Set<string>;
  readonly cycleFree: boolean;
};

/**
 * The names that MINT an actor when called from `file`: the two session reads,
 * any LOCAL function that reaches one transitively, and any IMPORTED binding
 * whose own module mints.
 *
 * Derived rather than declared, because a module is allowed to name its mint and
 * several do. `notifications/actions.ts` calls `currentViewer()`, a local helper
 * whose first line awaits `verifySession()`; `admin/feedback/actions.ts` calls
 * `requirePlatformAdmin()`, which is imported and reaches `getCurrentSession()`
 * one module away; `launch/actions.ts` calls `requireChurchSession()`. A scan
 * that only knew the literal string would have called those live, correctly-
 * guarded endpoints unminted and forced hand-written exemptions for them — and
 * an exemption list is exactly the thing that hid the invitations surface for a
 * whole round.
 *
 * `stack` breaks import cycles: a module already being resolved contributes
 * nothing rather than recursing, which under-approximates (a cyclic mint would
 * be missed) and so fails CLOSED — the assertion complains rather than passing.
 *
 * IT IS PARAMETERISED BY ITS ROOTS because the seat guard asks the identical
 * question of a different base case (#498): "which names reach `requireSeat`",
 * where the answer has to follow the same three edges — a local helper, a
 * domain's session envelope one module away (`withChurchSession`, `withChurch`,
 * `requireChurchSession`), and a re-export. That is this walk exactly, and a
 * second copy of it would be a second set of blind spots to keep in sync.
 */
function reachingNamesResult(
  file: string,
  code: string,
  roots: readonly string[],
  stack: ReadonlySet<string>
): ReachingNamesResult {
  const reaching = new Set(roots);
  let cycleFree = true;

  for (const [local, { module, original }] of importedBindings(file, code)) {
    if (stack.has(module)) {
      cycleFree = false;
      continue;
    }

    const imported = reachingExportsResult(
      module,
      roots,
      new Set([...stack, file])
    );
    cycleFree &&= imported.cycleFree;
    if (imported.names.has(original)) reaching.add(local);
  }

  const bodies = functionBodies(code);

  for (let pass = 0; pass <= bodies.length; pass++) {
    let grew = false;
    for (const fn of bodies) {
      if (reaching.has(fn.name)) continue;
      for (const root of reaching) {
        if (new RegExp(`\\b${root}\\s*\\(`).test(fn.body)) {
          reaching.add(fn.name);
          grew = true;
          break;
        }
      }
    }
    if (!grew) break;
  }

  return { names: reaching, cycleFree };
}

export function reachingNames(
  file: string,
  code: string,
  roots: readonly string[],
  stack: ReadonlySet<string> = new Set()
): Set<string> {
  return reachingNamesResult(file, code, roots, stack).names;
}

function reachingExportsResult(
  file: string,
  roots: readonly string[],
  stack: ReadonlySet<string>
): ReachingNamesResult {
  const key = `${roots.join(",")}\0${file}`;
  const cached = REACHING_EXPORTS.get(key);
  if (cached !== undefined) {
    return { names: new Set(cached), cycleFree: true };
  }

  const code = codeOf(file);
  const reaching = reachingNamesResult(file, code, roots, stack);
  const exported = new Set(
    functionBodies(code)
      .filter((fn) => fn.exported && reaching.names.has(fn.name))
      .map((fn) => fn.name)
  );

  // A root exported from the module that DEFINES it — `verifySession` and
  // `getCurrentSession` in session.ts, `requireSeat` in seats.ts — is a base
  // case: it qualifies by definition rather than by reaching anything.
  for (const name of roots) {
    if (
      new RegExp(
        `export\\s+(?:async\\s+)?(?:function|const)\\s+${name}\\b`
      ).test(code)
    ) {
      exported.add(name);
    }
  }

  // A recursive result is context-independent exactly when it never had to
  // cut an edge back into the active import stack. Cache those completed
  // subgraphs even when reached below a root call. Cyclic partials stay
  // uncached, preserving the existing fail-closed cycle behavior.
  if (reaching.cycleFree)
    REACHING_EXPORTS.set(key, Object.freeze([...exported]));
  return { names: exported, cycleFree: reaching.cycleFree };
}

/** Which of `file`'s exported functions reach `roots`, for an importer. */
export function reachingExportsOf(
  file: string,
  roots: readonly string[],
  stack: ReadonlySet<string>
): Set<string> {
  return reachingExportsResult(file, roots, stack).names;
}

/** The mint walk — {@link reachingNames} rooted at the two session reads. */
export function mintingNames(
  file: string,
  code: string,
  stack: ReadonlySet<string> = new Set()
): Set<string> {
  return reachingNames(file, code, SESSION_READS, stack);
}

/** Which of `file`'s exported functions mint, for an importer to consult. */
export function mintingExportsOf(
  file: string,
  stack: ReadonlySet<string>
): Set<string> {
  return reachingExportsOf(file, SESSION_READS, stack);
}

/**
 * One exported endpoint of one `"use server"` module, with the three offsets the
 * SESSION-FIRST rule is stated in terms of: where the actor is minted, where the
 * argument is first parsed, and where the enclosing `try` (if any) opens.
 */
export type ServerActionExport = {
  file: string;
  name: string;
  mint: number;
  parse: number;
  try: number;
  /** `src/app/(auth)/… → login` — the form every assertion reports in. */
  label: string;
};

/**
 * Every exported function of every `"use server"` module under `src/` THAT
 * PARSES AN ARGUMENT, with its offsets. An export that parses nothing is not
 * returned: it has no oracle to leak and no ordering to get wrong, which is what
 * keeps the scan honest about the rule rather than inventing a stricter one.
 */
export function parsingServerActionExports(): ServerActionExport[] {
  const found: ServerActionExport[] = [];

  for (const file of TS_FILES.filter(isUseServerModule)) {
    const code = codeOf(file);
    const mints = mintingNames(file, code);
    const mintPattern = new RegExp(`\\b(?:${[...mints].join("|")})\\s*\\(`);

    for (const fn of functionBodies(code)) {
      if (!fn.exported) continue;

      const parse = fn.body.indexOf(".safeParse(");
      if (parse < 0) continue;

      found.push({
        file,
        name: fn.name,
        mint: fn.body.search(mintPattern),
        parse,
        try: fn.body.search(/\btry\s*\{/),
        label: `${rel(file)} → ${fn.name}`,
      });
    }
  }

  return found;
}

/**
 * The `(auth)` and `(marketing)` route groups: the product's two public groups
 * (`memory/entrypoints.md`), whose endpoints are unauthenticated by
 * construction. Everything else in `src/app` sits behind the `(dashboard)`
 * layout's guard and is inside the SESSION-FIRST claim.
 */
export function isPublicRouteGroup(file: string): boolean {
  return /\/app\/\((?:auth|marketing)\)\//.test(file);
}

/** The one guard every `"use server"` export is required to reach (#498). */
export const SEAT_GUARD = ["requireSeat"];

/**
 * A `"use server"` directive that is NOT this module's prologue — a FUNCTION
 * -level directive, which publishes an endpoint the walks here cannot see.
 *
 * `isUseServerModule` asks about the prologue, and every walk in this file is
 * built on it, so an inline `async function act() { "use server"; … }` is a live
 * POST endpoint outside the auth surface those walks claim to cover. #498's
 * review found three of them — `saveAgendaAction` in a meetings page and the two
 * phase-template prompt actions in a component — one of which created 22–26
 * tasks per press, none of them carrying a seat check.
 *
 * The `codeOf` pass strips string literals only where they are LITERALS, so the
 * directive survives as one; a prologue directive is excluded by starting the
 * search after it. Returns the byte offsets, so the caller can report them.
 */
export function inlineServerDirectives(code: string): number[] {
  const prologue = PROLOGUE.exec(code)?.[0] ?? "";
  const found: number[] = [];

  for (const match of code.matchAll(/["']use server["']/g)) {
    if (match.index >= prologue.length) found.push(match.index);
  }

  return found;
}

/**
 * One exported endpoint of one `"use server"` module, with the two offsets the
 * SEAT-GUARD rule is stated in terms of.
 *
 * EVERY export, not only the ones that parse — which is the difference between
 * this reader and {@link parsingServerActionExports}. The ordering rule needs an
 * argument to be a rule about; the guard rule does not, and an export with no
 * argument at all is still a POSTable endpoint that has to say who may call it.
 */
export type GuardedExport = {
  file: string;
  name: string;
  /** Where the export reaches `requireSeat`, directly or through an envelope. */
  guard: number;
  /** Where it first parses an argument, or -1 if it parses none. */
  parse: number;
  /**
   * WHICH capability the guard was called with — the first string literal of
   * the guarding call, which is the capability in every shape the product uses:
   * `requireSeat("x")` directly, and `withChurchSession("x", …)`,
   * `withChurch("x", …)`, `requireChurchSession("x")` and `currentViewer("x")`
   * through the four session envelopes, each of which takes it FIRST.
   *
   * `null` when the export reaches no guard, or reaches one through a call
   * whose first argument is not a literal — which the mapping assertion in
   * `seat-guard.test.ts` treats as a failure, because a capability chosen at
   * runtime is one no reviewer can read off the diff.
   */
  capability: string | null;
  label: string;
};

/** The capability a guarding call names, from the first string literal in it. */
function capabilityAt(body: string, guard: number): string | null {
  if (guard < 0) return null;

  const open = body.indexOf("(", guard);
  if (open < 0) return null;

  // Only the FIRST argument counts, so the scan ends at the top-level comma
  // that closes it OR at the call's own `)`, whichever comes first. Both
  // terminators are needed: `withChurch(cap, "Failed to create team", …)` would
  // otherwise report the fallback copy, and `requireSeat("read")` — which has no
  // comma at all — would run to whatever comma turned up next in the body.
  let depth = 0;
  let end = -1;

  for (let i = open + 1; i < body.length; i++) {
    const char = body[i];
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" && depth === 0) {
      end = i;
      break;
    } else if (char === ")" || char === "]" || char === "}") depth--;
    else if (char === "," && depth === 0) {
      end = i;
      break;
    }
  }

  if (end < 0) return null;
  return (
    /^\s*["']([^"']+)["']\s*$/.exec(body.slice(open + 1, end))?.[1] ?? null
  );
}

/**
 * Every exported function of every `"use server"` module under `src/`, with the
 * offset at which it reaches the seat guard.
 *
 * `reachingNames` is what makes the envelope modules work without exemptions:
 * `people/actions.ts` guards through `withChurchSession`, `teams/actions.ts`
 * through `withChurch` and `launch/actions.ts` through its local
 * `requireChurchSession`, and each of those calls `requireSeat` one module (or
 * one function) away. A scan that only knew the literal string would have
 * called sixty correctly-guarded endpoints unguarded and forced a hand-written
 * exemption list — which is the thing this rule exists to not have.
 */
export function guardedServerActionExports(): GuardedExport[] {
  const found: GuardedExport[] = [];

  for (const file of TS_FILES.filter(isUseServerModule)) {
    const code = codeOf(file);
    const guards = reachingNames(file, code, SEAT_GUARD);
    const guardPattern = new RegExp(`\\b(?:${[...guards].join("|")})\\s*\\(`);

    for (const fn of functionBodies(code)) {
      if (!fn.exported) continue;

      const guard = fn.body.search(guardPattern);

      found.push({
        file,
        name: fn.name,
        guard,
        parse: fn.body.indexOf(".safeParse("),
        capability: capabilityAt(fn.body, guard),
        label: `${rel(file)} → ${fn.name}`,
      });
    }
  }

  return found;
}
