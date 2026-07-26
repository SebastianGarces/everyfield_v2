import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

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
// So there are exactly two sanctioned shapes:
//
//   1. Every write is known up front and touches only our own tables:
//      use `atomicWrite([...])`.
//
//   2. The writes must interleave with reads, events, or another feature's
//      writes, so they cannot share one SQL transaction at all: order the work
//      so the durable "this already happened" marker is written LAST, and make
//      every preceding step idempotent so a retry converges. A failure then
//      leaves the operation un-marked and safely replayable instead of
//      half-applied. `finalizeAttendance` in `src/lib/meetings/service.ts` is
//      the reference implementation of that pattern.
// ============================================================================

/** A non-empty tuple of Drizzle statements, as accepted by `db.batch`. */
export type AtomicWriteBatch = Parameters<Database["batch"]>[0];

/**
 * Run several statements inside a single Neon transaction — all of them commit
 * or none do.
 *
 * Use this instead of `db.transaction()`, which the neon-http driver does not
 * support (see the note above). Every statement must be known before the call;
 * if a later write depends on an earlier one's result, a batch cannot express
 * it and you need the ordering + idempotency pattern instead.
 *
 * `client` is injectable so callers can be unit-tested without a database.
 */
export function atomicWrite(
  statements: AtomicWriteBatch,
  client: Pick<Database, "batch"> = db
) {
  return client.batch(statements);
}
