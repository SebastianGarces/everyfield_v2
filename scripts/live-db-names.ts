// ============================================================================
// WHICH SUITES ARE LIVE, AND WHICH DATABASE EACH ONE OWNS (#594).
//
// THE SHARED WRITE TARGET, AND WHY IT HAD TO GO. `pnpm test:live` hands its
// suite files to ONE node:test invocation, and node:test runs each file in its
// own child process — in parallel. Until this module they all pointed at one
// database, so a suite's fixtures were visible to every sibling's queries while
// those siblings were mid-write. That is a shared mutable object with fourteen
// writers, and `memory/` → the separate-before-serializing principle says to
// eliminate the sharing before reaching for a lock: these suites publish
// INDEPENDENT facts about their own scratch fixtures, so they never needed one
// canonical database at all.
//
// It went red exactly where the principle predicts. `seat-owner-uniqueness`
// asks a question about the WHOLE `users` table — "no row on this database
// names more than one tenancy" — while `auth/access.test.ts` deliberately
// inserts such a row and leaves it alive until its own `after()` sweep. Two
// processes, one table, and a census that counts whatever happens to be
// committed when it runs: red at head, green on a re-run of the identical
// commit (PR #586).
//
// THE LIST IS DATA, NOT A COMMAND LINE. `LIVE_SUITES` below is the one place
// the membership lives, and every consumer imports it: the runner that spawns
// node:test, the preload that repoints each child, the preparer that creates
// the databases, and the coverage test that holds it to the files which
// actually opt into `LIVE_DB_TESTS`. It used to live inside the `test:live`
// string in package.json and be recovered from there by regex — which meant an
// invariant about fourteen databases rested on string-matching a shell command,
// and consumers could disagree about membership without anything noticing.
//
// WHY DATABASES AND NOT SCHEMAS. The ruling on #594 offered schema-per-suite
// with `search_path` as the lighter option. It is not reachable through this
// stack, and that was measured rather than assumed: neon-http is STATELESS —
// every query is its own HTTP request — so a `SET search_path` never survives
// to the next statement, and the one connection-level channel that would
// (`?options=-c search_path=…` in the connection string) is dropped by
// `local-neon-http-proxy`, which reads only the user, password and DATABASE out
// of the `Neon-Connection-String` header and takes its host from its own env. A
// database per suite rides that honoured database component, and
// `CREATE DATABASE … TEMPLATE` makes it cheaper than a schema would have been:
// the 61 migrations apply ONCE to a template and every suite database is a
// file-level copy of it.
// ============================================================================

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every suite that runs against a real database, repo-relative and POSIX.
 *
 * A suite belongs here exactly when it reads `process.env.LIVE_DB_TESTS`;
 * `src/db/live-suite-coverage.test.ts` fails the build on any that opts in and
 * is missing, so this list cannot quietly go short.
 */
export const LIVE_SUITES = [
  "src/db/seat-owner-uniqueness.test.ts",
  "src/lib/auth/access.test.ts",
  "src/lib/auth/email-change-live.test.ts",
  "src/lib/communication/fork-and-token-race.test.ts",
  "src/lib/communication/evry-effect-live.test.ts",
  "src/lib/evry/plans/confirmation-race.test.ts",
  "src/lib/evry/audit/audit-live.test.ts",
  "src/lib/evry/conversations/conversations-live.test.ts",
  "src/lib/evry/executor/executor-live.test.ts",
  "src/lib/evry/recipes/recipe-live.test.ts",
  "src/lib/evry/runs/runs-live.test.ts",
  "src/lib/ministry-teams/leader-sync-live.test.ts",
  "src/lib/ministry-teams/leadership-fill-live.test.ts",
  "src/lib/ministry-teams/responsibilities-live.test.ts",
  "src/lib/ministry-teams/role-seat-race.test.ts",
  "src/lib/ministry-teams/teams-init-race.test.ts",
  "src/lib/invitations/seat-invitations-live.test.ts",
  "src/lib/launch/readiness-converge-live.test.ts",
  "src/lib/people/person-link-live.test.ts",
  "src/lib/people/evry-effect-live.test.ts",
  "src/lib/phase-engine/transitions/declaration-race.test.ts",
  "src/lib/seats/seat-removal-live.test.ts",
  "src/lib/tasks/follow-up-race.test.ts",
  "src/lib/tasks/subtask-parent-fk.test.ts",
] as const;

/**
 * The repo root, resolved from THIS FILE rather than `process.cwd()`.
 *
 * cwd is not a property of the repository — it is a property of where somebody
 * typed the command. Deriving from it meant a run started in a subdirectory
 * silently failed the "is this a live suite" test in the preload, every child
 * kept the shared base `DATABASE_URL`, and #594 came back with the lane green.
 */
export const REPO_ROOT = path.resolve(
  fileURLToPath(import.meta.url),
  "..",
  ".."
);

/**
 * Postgres truncates an identifier past this many bytes, and truncation is how
 * two suites would silently end up sharing one database again. So it is an
 * error here rather than a surprise there.
 */
const MAX_IDENTIFIER_BYTES = 63;

/**
 * The database a live suite owns, derived from its repo-relative path so that
 * the name says which file it belongs to when an operator lists the databases.
 *
 * `src/lib/ministry-teams/leader-sync-live.test.ts`
 *   → `live_lib_ministry_teams_leader_sync_live`
 */
export function databaseForSuite(repoRelativePath: string): string {
  const posix = repoRelativePath.split(path.sep).join("/");

  if (!posix.startsWith("src/") || !posix.endsWith(".test.ts")) {
    throw new Error(
      `not a live suite path: ${repoRelativePath} — expected src/….test.ts`
    );
  }

  const name =
    "live_" +
    posix
      .slice("src/".length, -".test.ts".length)
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .toLowerCase();

  if (Buffer.byteLength(name) > MAX_IDENTIFIER_BYTES) {
    throw new Error(
      `${repoRelativePath} derives the database name \`${name}\`, which is ` +
        `longer than Postgres's ${MAX_IDENTIFIER_BYTES}-byte identifier limit. ` +
        `Postgres would TRUNCATE it, and a truncated name can collide with ` +
        `another suite's — which is the shared database #594 removed. Shorten ` +
        `the path or give the derivation an explicit override.`
    );
  }

  return name;
}

/**
 * The suite this path IS, or null when it is not one of them.
 *
 * Membership is the LIST, never a shape test on the path: `src/**\/*.test.ts`
 * matches some 250 files, three of which are live suites deliberately left out
 * of the lane. Handing one of those a database nobody created would make it
 * skip on an unreachable connection and report success.
 */
export function suiteForPath(absolutePath: string): string | null {
  const relative = path
    .relative(REPO_ROOT, path.resolve(absolutePath))
    .split(path.sep)
    .join("/");

  return LIVE_SUITES.find((suite) => suite === relative) ?? null;
}

/** Every database `pnpm test:live` needs to exist before it runs. */
export function liveSuiteDatabases(): string[] {
  return LIVE_SUITES.map(databaseForSuite);
}

// Run directly — `tsx scripts/live-db-names.ts` — it prints one database name
// per line, which is what `scripts/live-db-prepare.sh` loops over. Both sides go
// through `realpathSync` via `path.resolve`: on macOS `/tmp` is a symlink to
// `/private/tmp`, so the raw strings differ for the same file.
// `import.meta.filename` is undefined under tsx, hence the url.
const entry = process.argv[1];
if (entry && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  process.stdout.write(liveSuiteDatabases().join("\n") + "\n");
}
