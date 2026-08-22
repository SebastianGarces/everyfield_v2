// ============================================================================
// WHERE THE neon-http DRIVER SENDS ITS SQL WHILE THE LIVE SUITES RUN (#411).
//
// A TEST-RUNNER PRELOAD, NOT A PRODUCTION SEAM. The opt-in race suites
// (`LIVE_DB_TESTS=1` — fork-and-token-race, role-seat-race, teams-init-race,
// declaration-race, subtask-parent-fk) need a REAL Postgres, and `@/db` is a
// neon-http client: it speaks Neon's HTTP protocol and cannot talk to a plain
// Postgres over TCP. `local-neon-http-proxy` serves that protocol in front of
// any Postgres, so pointing `neonConfig.fetchEndpoint` at it runs the SAME
// driver, the same `db.batch`, the same `ON CONFLICT` SQL, against a container.
//
// WHY NOT node-postgres. `db.batch()` exists only on the batching drivers
// (neon-http, libsql, d1) and every write path here is built on it
// (`memory/invariants.md` → Transactions: neon-http has no interactive
// transactions, so a batch IS the transaction). A suite run on a driver without
// `batch` would exercise code the application never executes.
//
// WHY IT LIVES HERE AND NOT IN `src/db/index.ts`. The decision is not "which
// host is local" — a hostname allowlist is a guess about a developer's compose
// file, and a `NEON_HTTP_PROXY_URL` set by accident in Vercel would redirect
// production traffic. The decision is "this process is a live-suite run, so send
// neon-http at the proxy", which is knowledge the TEST RUNNER has and the
// application never needs. So it is preloaded by `pnpm test:live` (`--import`,
// which node:test propagates to the per-file child processes, landing before any
// suite imports `@/db`) and the request path keeps its two original lines.
//
// Anything else that must reach a local Postgres through neon-http — the eval
// seed, a one-off script — sets `NEON_HTTP_PROXY_URL` and makes the same move
// deliberately. Never import this module from `src/`.
//
// AND WHICH DATABASE IT SENDS THEM TO (#594). node:test runs each suite file in
// its own CHILD PROCESS, and this module is preloaded into every one of them —
// which makes it the only place that knows both "this is a live run" and "this
// process is running THAT file". So it is also where each suite is pointed at
// its own database: one `DATABASE_URL` rewrite, before `src/db/index.ts` reads
// the variable, and the fourteen suites stop sharing a write target.
// `scripts/live-db-names.ts` carries the derivation and the why.
//
// THE REWRITE RIDES THE ONE THING THE PROXY HONOURS. neon-http puts the
// connection string in a `Neon-Connection-String` header per request;
// `local-neon-http-proxy` reads the user, password and DATABASE out of it and
// takes the host from its own env. So changing the database component is
// enough, and changing anything else would be theatre.
// ============================================================================

import { neonConfig } from "@neondatabase/serverless";

import { databaseForSuite, suiteForPath } from "./live-db-names";

/** Where `local-neon-http-proxy` listens by default (docker-compose and CI). */
export const DEFAULT_NEON_HTTP_PROXY_URL = "http://localhost:4444/sql";

neonConfig.fetchEndpoint =
  process.env.NEON_HTTP_PROXY_URL ?? DEFAULT_NEON_HTTP_PROXY_URL;

// WHICH SUITE THIS PROCESS IS. node:test gives the child `process.argv[1]` as
// the test file it is about to run, and `suiteForPath` answers from the
// `LIVE_SUITES` LIST — never from the shape of the path. Both halves matter:
//
//   · A shape test (`src/…​.test.ts`) matches some 250 files, three of which are
//     live suites deliberately left out of this lane. Preloading one of those
//     would hand it a database nobody created, and it would SKIP and pass.
//   · `suiteForPath` resolves against a repo root derived from this file rather
//     than `process.cwd()`, so a run started from a subdirectory cannot fail
//     the match, leave every child on the shared base URL, and quietly restore
//     the #594 race with the lane green.
//
// The parent runner and the preflight both land here with argv[1] pointing at
// something that is not a suite; they reach no database of their own, so
// leaving their `DATABASE_URL` alone is correct rather than merely harmless.
const suite = process.argv[1] ? suiteForPath(process.argv[1]) : null;

if (suite) {
  const base = process.env.DATABASE_URL;

  // Fail closed and say so. The alternative — carry on against whatever the
  // variable happened to hold — is how fourteen suites shared one database in
  // the first place.
  if (!base) {
    throw new Error(
      `${suite} is a live suite, but DATABASE_URL is unset, so there is no ` +
        `base connection to point at its own database.`
    );
  }

  const url = new URL(base);
  url.pathname = `/${databaseForSuite(suite)}`;
  process.env.DATABASE_URL = url.toString();
}
