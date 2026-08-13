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
// ============================================================================

import { neonConfig } from "@neondatabase/serverless";

/** Where `local-neon-http-proxy` listens by default (docker-compose and CI). */
export const DEFAULT_NEON_HTTP_PROXY_URL = "http://localhost:4444/sql";

neonConfig.fetchEndpoint =
  process.env.NEON_HTTP_PROXY_URL ?? DEFAULT_NEON_HTTP_PROXY_URL;
