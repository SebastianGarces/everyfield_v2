import assert from "node:assert/strict";
import { test } from "node:test";

import { atomicWrite, type AtomicWriteBatch, type Database } from ".";

// ----------------------------------------------------------------------------
// MEET-011 — `atomicWrite` is the sanctioned way to make several writes commit
// together, because the neon-http driver has no interactive transactions (see
// the note in index.ts). These tests pin the delegation contract; the
// transactional behaviour itself is Neon's and is covered by integration
// testing against a live Postgres.
// ----------------------------------------------------------------------------

function fakeClient(result: unknown[] = []) {
  const seen: AtomicWriteBatch[] = [];
  const client = {
    batch: (async (statements: AtomicWriteBatch) => {
      seen.push(statements);
      return result;
    }) as unknown as Database["batch"],
  };
  return { client, seen };
}

test("atomicWrite hands the whole batch to the driver in one call", async () => {
  const { client, seen } = fakeClient();
  const statements = ["stmt-a", "stmt-b"] as unknown as AtomicWriteBatch;

  await atomicWrite(statements, client);

  assert.equal(
    seen.length,
    1,
    "must be a single round trip, not one per write"
  );
  assert.deepEqual(seen[0], statements);
});

test("atomicWrite returns the driver's results", async () => {
  const { client } = fakeClient([{ id: "1" }, { id: "2" }]);

  const result = await atomicWrite(
    ["stmt"] as unknown as AtomicWriteBatch,
    client
  );

  assert.deepEqual(result, [{ id: "1" }, { id: "2" }]);
});

test("atomicWrite propagates a failed batch instead of swallowing it", async () => {
  const client = {
    batch: (async () => {
      throw new Error("deadlock detected");
    }) as unknown as Database["batch"],
  };

  await assert.rejects(
    () => atomicWrite(["stmt"] as unknown as AtomicWriteBatch, client),
    /deadlock detected/
  );
});
