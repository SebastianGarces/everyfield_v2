import assert from "node:assert/strict";
import { test } from "node:test";

import { registerSubscriptions } from "./subscriptions";

// ----------------------------------------------------------------------------
// Subscription wiring (PE-010). We drive registerSubscriptions() with a fake
// bus and assert that every material event ends up with a handler registered,
// without touching the real singleton or the database.
// ----------------------------------------------------------------------------

interface Registration {
  eventType: string;
  handler: (event: never) => Promise<void>;
}

function makeFakeBus() {
  const registrations: Registration[] = [];
  let initialized = false;
  return {
    registrations,
    on<T>(eventType: string, handler: (event: T) => Promise<void>) {
      registrations.push({
        eventType,
        handler: handler as (event: never) => Promise<void>,
      });
    },
    isInitialized() {
      return initialized;
    },
    markInitialized() {
      initialized = true;
    },
    handlersFor(eventType: string) {
      return registrations.filter((r) => r.eventType === eventType);
    },
  };
}

const MATERIAL_EVENTS = [
  "meeting.attendance.finalized",
  "team.member.assigned",
  "person.created",
  "task.completed",
] as const;

test("each material event registers a dirty-marking handler (PE-010)", () => {
  const bus = makeFakeBus();
  registerSubscriptions(bus);

  for (const eventType of MATERIAL_EVENTS) {
    assert.ok(
      bus.handlersFor(eventType).length >= 1,
      `expected a handler registered for "${eventType}"`
    );
  }
});

test("existing subscriptions remain intact", () => {
  const bus = makeFakeBus();
  registerSubscriptions(bus);

  // Pre-existing cross-feature wiring must not be disturbed by PE wiring.
  for (const eventType of [
    "meeting.attendance.recorded",
    "team.leader.assigned",
    "meeting.evaluation.completed",
  ]) {
    assert.ok(
      bus.handlersFor(eventType).length >= 1,
      `expected existing handler for "${eventType}"`
    );
  }
});

test("registerSubscriptions is idempotent when already initialized", () => {
  const bus = makeFakeBus();
  registerSubscriptions(bus);
  const countAfterFirst = bus.registrations.length;

  // Second call should no-op because the bus reports initialized.
  registerSubscriptions(bus);
  assert.equal(bus.registrations.length, countAfterFirst);
});
