// ============================================================================
// EVERY PER-SUITE DATABASE ANSWERS BEFORE A SINGLE SUITE RUNS (#594).
//
// THE SILENT PASS THIS EXISTS TO STOP. Every live suite guards itself with a
// `databaseReachable()` probe and SKIPS when it answers false. That is the
// right answer for `LIVE_DB_TESTS=1 pnpm test` on a laptop with no Postgres —
// but splitting one database into fourteen gave the probe a NEW way to be
// false: a database nobody created. The suite would skip, node:test would exit
// 0, and the lane would go green having executed none of its assertions. That
// is precisely the failure #411 existed to end ("assertions written, never
// executed"), re-entering through the door #594 opened.
//
// So the check moves ABOVE the runner. `pnpm test:live` means somebody has
// declared they have a live database, so an unreachable one is a broken setup
// and stops the lane before a single suite gets the chance to skip. It probes
// all fourteen and reports EVERY failure, because a half-prepared server is the
// likely state and one name at a time is a slow way to learn that.
//
// AND IT NAMES THE RIGHT REPAIR, which takes distinguishing two failures that
// look identical from the outside. `3D000` (`database "…" does not exist`) is
// the one `live-db-prepare.sh` fixes. Anything else — nothing listening on the
// proxy, wrong credentials, a `DATABASE_URL` inherited from `.env.local` that
// names a hosted Neon branch — is NOT fixed by creating databases, and saying
// so anyway sends the reader to the wrong script. So the failing message
// carries the endpoint and the base host it actually tried.
//
// It reuses the preload for the endpoint decision rather than repeating it:
// importing `live-db-endpoint` points neon-http at the proxy, and its
// `DATABASE_URL` rewrite is keyed on `process.argv[1]` being one of the suites
// in `LIVE_SUITES` — which, here, it is not. So nothing is rewritten and this
// keeps the base connection it needs to reach each database by name.
// ============================================================================

import { neon } from "@neondatabase/serverless";

import { DEFAULT_NEON_HTTP_PROXY_URL } from "./live-db-endpoint";
import { liveSuiteDatabases, LIVE_SUITES } from "./live-db-names";

/** Postgres's `invalid_catalog_name` — the database genuinely is not there. */
const UNDEFINED_DATABASE = "3D000";

type Probe = { database: string; error: unknown };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Is this the one failure `live-db-prepare.sh` repairs?
 *
 * TWO SHAPES, because the driver reports connection-time and query-time errors
 * differently and this failure is the former. A query that violates a
 * constraint comes back as a parsed `NeonDbError` with `code` populated (what
 * `seat-owner-uniqueness.test.ts` reads). A database that does not exist fails
 * before there is a query to parse: the driver raises `Server error (HTTP
 * status 500)` and leaves every field undefined, with Postgres's JSON body
 * stringified into the message. So the code is read from the field when it is
 * there and from the message when it is not — checked rather than assumed, on
 * a database dropped on purpose.
 */
function isMissingDatabase(error: unknown): boolean {
  const cause = (error as { cause?: unknown })?.cause;
  const code = ((cause ?? error) as { code?: string }).code;

  return (
    code === UNDEFINED_DATABASE ||
    new RegExp(`"code"\\s*:\\s*"${UNDEFINED_DATABASE}"`).test(describe(error))
  );
}

/** The base connection with its credentials removed, safe to print. */
function baseHost(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return "an unparseable DATABASE_URL";
  }
}

async function probe(database: string, base: string): Promise<Probe | null> {
  const url = new URL(base);
  url.pathname = `/${database}`;

  try {
    await neon(url.toString())`select 1`;
    return null;
  } catch (error) {
    return { database, error };
  }
}

/**
 * Null when the lane may start; otherwise the message explaining why not.
 *
 * Returned rather than thrown so the runner owns the exit — a stack trace over
 * a setup problem buries the one line that says what to do about it.
 */
export async function preflight(): Promise<string | null> {
  const base = process.env.DATABASE_URL;

  if (!base) {
    return (
      "DATABASE_URL is unset, so there is no server to look for the live " +
      "suite databases on."
    );
  }

  const endpoint =
    process.env.NEON_HTTP_PROXY_URL ?? DEFAULT_NEON_HTTP_PROXY_URL;
  const databases = liveSuiteDatabases();
  const failures = (
    await Promise.all(databases.map((database) => probe(database, base)))
  ).filter((failure): failure is Probe => failure !== null);

  if (failures.length === 0) return null;

  const missing = failures.filter((failure) =>
    isMissingDatabase(failure.error)
  );

  // EVERY probe failed and not one said "does not exist" — so the server, the
  // endpoint or the credentials are the problem, and creating databases is not
  // the repair. The "every" matters: with one database missing and thirteen
  // answering, this branch would name the wrong cause for the whole lane.
  if (missing.length === 0 && failures.length === databases.length) {
    return (
      `None of the ${databases.length} live suite databases could be reached.\n\n` +
      `    endpoint: ${endpoint}\n` +
      `    DATABASE_URL names: ${baseHost(base)}\n\n` +
      `This is the CONNECTION, not a missing database — every probe failed ` +
      `for a reason other than \`database … does not exist\`. Start the local ` +
      `stack with \`./scripts/live-db-stack.sh up\`, and check whether ` +
      `DATABASE_URL came from .env.local and names a hosted database.\n\n` +
      `First failure: ${describe(failures[0].error)}`
    );
  }

  const roster = failures
    .map(
      (failure) =>
        `    ${failure.database}\n        ${
          isMissingDatabase(failure.error)
            ? "does not exist"
            : describe(failure.error)
        }`
    )
    .join("\n");

  return (
    `${failures.length} of ${databases.length} live suite databases did not ` +
    `answer on ${baseHost(base)} (via ${endpoint}):\n\n${roster}\n\n` +
    (missing.length > 0
      ? `Create them — the script is re-runnable and is also how you RESET ` +
        `after a failed run, which leaves fixtures behind:\n\n` +
        `    ./scripts/live-db-prepare.sh\n\n`
      : "") +
    `Without this check the suites would SKIP on an unreachable database and ` +
    `the lane would report success having asserted nothing.`
  );
}

// Run directly for a standalone check; `scripts/live-db-run.ts` calls
// `preflight()` in-process as the first half of the lane.
const entry = process.argv[1];
if (entry && /live-db-preflight\.ts$/.test(entry)) {
  preflight().then(
    (failure) => {
      if (failure) {
        console.error(`\n${failure}\n`);
        process.exitCode = 1;
        return;
      }
      console.log(`live databases ready: ${LIVE_SUITES.length} suites`);
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    }
  );
}
