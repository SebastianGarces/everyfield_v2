/**
 * ONE ASSERTION FOR "EVERY WRITE BELONGS TO THE BATCH".
 *
 * `memory/invariants.md` → Transactions / Atomicity says two things about a
 * write path whose writes are known up front: `db.transaction()` throws at
 * runtime (neon-http has no interactive transactions), and all of the writes go
 * into ONE `db.batch([...])`. Both are properties of SOURCE — a unit test's
 * process cannot execute a DB write — so each service that has to hold them
 * reads its own function body back and matches three regexes over it.
 *
 * Those three regexes are the decision, and a second copy of them is what
 * drifts: widen one to catch `db.execute`, or a `.transaction(` spelled across
 * a newline, and the other keeps passing on the module IT guards while the same
 * rule is now checked two different ways. `transitions/service.test.ts` and
 * `signals/attestation-service.test.ts` shipped the same three assertions in one
 * commit, and `src/lib/notifications/queries.test.ts` already reasons about the
 * rule in prose — so the decision lives here, once, and the call sites pass a
 * body and a label.
 *
 * Cut the body with `sourceReader` (`./source-span`), never a bare `indexOf`: a
 * moved anchor must throw rather than silently widen the span to the whole
 * module, which is how a source-shaped test goes green on a subject it no
 * longer covers.
 *
 * Test-only, and about no feature — the same reason `source-span.ts` sits here.
 * Nothing in application code imports it.
 */

import assert from "node:assert/strict";

/**
 * Assert that `body` performs all of its writes inside one `db.batch([...])`.
 *
 * @param body   The function's source, cut with `sourceReader(...).span(...)`.
 * @param label  What the function is called, so a failure names its subject.
 */
export function assertBatchedWrites(body: string, label: string): void {
  assert.match(
    body,
    /await db\.batch\(\[/,
    `${label}: the writes must be one Neon batched transaction — neon-http has no db.transaction`
  );
  assert.equal(
    /await db\.transaction\(/.test(body),
    false,
    `${label}: db.transaction() throws at runtime on neon-http`
  );

  // The point of the batch is that there is no SECOND awaited write beside it.
  // Reads (a snapshot build, a lookup) are fine and stay above it.
  const writes = body.match(/await db\s*\n?\s*\.(insert|update|delete)\b/g);
  assert.equal(
    writes,
    null,
    `${label}: every write belongs to the batch; found ${writes?.join(", ")}`
  );
}
