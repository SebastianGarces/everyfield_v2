import assert from "node:assert/strict";
import { test } from "node:test";

import { eventBus } from "./event-bus";

// ----------------------------------------------------------------------------
// MEET-011 — strict emission.
//
// Default emission is fire-and-forget: handler failures are logged and the
// emitter carries on. `finalizeAttendance` cannot work that way — it only marks
// a meeting finalized once its follow-up tasks exist, so it has to be able to
// SEE a handler failure. These tests pin both halves of that contract.
//
// The bus is marked initialized up front so `emit` skips the lazy
// `registerSubscriptions` import and we exercise only the handlers registered
// here. node:test runs each file in its own process, so the singleton is not
// shared with other suites.
// ----------------------------------------------------------------------------

eventBus.markInitialized();

interface TestEvent {
  type: string;
  churchId: string;
}

test("non-strict emit swallows handler failures (unchanged default)", async () => {
  const seen: string[] = [];
  eventBus.on<TestEvent>("test.lenient", async () => {
    throw new Error("handler exploded");
  });
  eventBus.on<TestEvent>("test.lenient", async () => {
    seen.push("second handler ran");
  });

  await eventBus.emit<TestEvent>({ type: "test.lenient", churchId: "c1" });

  assert.deepEqual(seen, ["second handler ran"]);
});

test("strict emit rethrows once every handler has settled", async () => {
  const seen: string[] = [];
  eventBus.on<TestEvent>("test.strict", async () => {
    throw new Error("follow-up generation failed");
  });
  eventBus.on<TestEvent>("test.strict", async () => {
    seen.push("best-effort handler still ran");
  });

  await assert.rejects(
    () =>
      eventBus.emit<TestEvent>(
        { type: "test.strict", churchId: "c1" },
        { strict: true }
      ),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError, "expected an AggregateError");
      assert.equal(error.errors.length, 1);
      assert.match(error.message, /test\.strict/);
      return true;
    }
  );

  // Strict changes what the EMITTER learns, not whether handlers run: the
  // best-effort subscriber (e.g. Phase Engine dirty-marking) still executed.
  assert.deepEqual(seen, ["best-effort handler still ran"]);
});

test("strict emit resolves normally when every handler succeeds", async () => {
  const seen: string[] = [];
  eventBus.on<TestEvent>("test.strict.ok", async () => {
    seen.push("ran");
  });

  await eventBus.emit<TestEvent>(
    { type: "test.strict.ok", churchId: "c1" },
    { strict: true }
  );

  assert.deepEqual(seen, ["ran"]);
});

test("strict emit with no subscribers is not an error", async () => {
  await eventBus.emit<TestEvent>(
    { type: "test.strict.unsubscribed", churchId: "c1" },
    { strict: true }
  );
  assert.equal(eventBus.handlerCount("test.strict.unsubscribed"), 0);
});
