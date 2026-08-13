import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { localNeonHttpEndpoint } from "./connection";
import * as schema from "./schema";

// A local Postgres does not speak Neon's HTTP protocol, so when DATABASE_URL
// names one, the driver is pointed at the proxy that does. Real Neon hosts get
// `null` and keep the driver's own endpoint — production is byte-identical to
// what it was. The whole reason this line exists is `connection.ts`'s header:
// it is what makes the `LIVE_DB_TESTS=1` suites runnable in CI at all.
const localEndpoint = localNeonHttpEndpoint(
  process.env.DATABASE_URL,
  process.env.NEON_HTTP_PROXY_URL
);
if (localEndpoint) neonConfig.fetchEndpoint = localEndpoint;

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });

export type Database = typeof db;

// ============================================================================
// Atomicity — read this before writing any multi-statement mutation
// ============================================================================
//
// This app talks to Neon over HTTP (`drizzle-orm/neon-http`). That driver has
// NO interactive transactions: calling `db.transaction(async (tx) => ...)`
// throws "No transactions support in neon-http driver" at runtime, so it can
// never be used to make a sequence of awaited writes atomic. Reaching for it is
// worse than useless — it reads as transactional in the diff and is not.
//
// What IS available is a *batched* transaction. `db.batch([...])` ships every
// statement in one HTTP round trip and Neon runs them inside a single
// transaction: all commit, or none do. The constraint is that the whole batch
// must be built up front — no statement may depend on a previous one's result,
// and nothing else (a read, an event, an external call) may interleave.
//
// So there are exactly three sanctioned shapes:
//
//   1. Every write is known up front and touches only our own tables: pass them
//      all to `db.batch([...])`. Do NOT reach for `db.transaction`.
//
//   2. The writes must interleave with reads, events, or another feature's
//      writes, so they cannot share one SQL transaction at all: order the work
//      so the durable "this already happened" marker is written LAST, and make
//      every preceding step idempotent so a retry converges. A failure then
//      leaves the operation un-marked and safely replayable instead of
//      half-applied. `finalizeAttendance` in `src/lib/meetings/service.ts` is
//      the reference implementation of that pattern.
//
//   3. Concurrency, not just retries, has to be excluded. Ordering and
//      idempotency only make a *replay* safe; two requests interleaving can
//      still both pass a SELECT-then-INSERT guard, because nothing in
//      application code holds a lock between the two round trips. Push the
//      guard into the database — a (partial) unique index — and let the write
//      fail. `tasks_meeting_evaluation_unique_idx` is the reference example:
//      the uniquely-indexed row shares one INSERT statement with the rows it
//      speaks for, so the loser of a race writes nothing at all.
// ============================================================================
