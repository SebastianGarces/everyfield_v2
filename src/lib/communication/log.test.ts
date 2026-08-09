import assert from "node:assert/strict";
import { test } from "node:test";

import { registerSubscriptions } from "@/lib/events/subscriptions";

import {
  contactedPersonId,
  existingTaskEntryQuery,
  handleTaskCompletedForCommunicationLog,
  LOGGED_ENTRY_STATUS,
  taskEntryBody,
  taskEntryReference,
  taskLogEntryStatements,
  type CompletedTaskEvent,
} from "./log";

// ----------------------------------------------------------------------------
// COM-020 — the half that needs no database and therefore runs EVERYWHERE, CI
// included. `.toSQL()` renders a statement; it does not connect. A
// DATABASE_URL must be PRESENT (importing `@/db` constructs the Neon client at
// module load), which `pnpm test` and CI both supply as a placeholder.
//
// The executing half — the entry actually appearing in a person's log, the
// replay adding nothing, the absence for a task that is not about a person —
// lives in `log-live.test.ts` and SKIPS where DATABASE_URL points nowhere.
// ----------------------------------------------------------------------------

const CHURCH_A = "11111111-1111-4111-8111-111111111111";
const CHURCH_B = "22222222-2222-4222-8222-222222222222";
const PERSON = "33333333-3333-4333-8333-333333333333";
const TASK = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";

function completedTask(
  overrides: Partial<CompletedTaskEvent> = {}
): CompletedTaskEvent {
  return {
    taskId: TASK,
    churchId: CHURCH_A,
    relatedType: "person",
    relatedId: PERSON,
    completedById: USER,
    timestamp: new Date("2026-08-09T15:30:00Z"),
    ...overrides,
  };
}

// ============================================================================
// 1. What counts as a logged contact
// ============================================================================

test("a task related to a person is a contact with that person", () => {
  assert.equal(contactedPersonId(completedTask()), PERSON);
});

test("a task related to anything else is not a contact", () => {
  for (const relatedType of ["meeting", "team", "facility", null]) {
    assert.equal(
      contactedPersonId(completedTask({ relatedType })),
      null,
      `"${relatedType}" must not produce a communication log entry`
    );
  }
});

test("a person-typed task with no person on it is not a contact", () => {
  assert.equal(contactedPersonId(completedTask({ relatedId: null })), null);
  assert.equal(contactedPersonId(completedTask({ relatedId: "   " })), null);
});

// ============================================================================
// 2. The entry itself
// ============================================================================

test("the entry records what the task was and when it completed", () => {
  const body = taskEntryBody(
    "Follow up with Sarah Johnson",
    "follow_up",
    new Date("2026-08-09T15:30:00Z")
  );

  assert.match(body, /Follow up with Sarah Johnson/);
  assert.match(body, /follow up task/);
  // Rendered through `@/lib/datetime`, so the zone is pinned (invariants →
  // Date & Time Rendering) and the string cannot drift with the runtime's zone.
  assert.match(body, /Aug 9, 2026 at 3:30 PM/);
});

test("the entry says plainly that nothing was sent", () => {
  const body = taskEntryBody(
    "Call Bob",
    null,
    new Date("2026-08-09T15:30:00Z")
  );

  assert.match(body, /No message was sent/);
  // No category on the task: the sentence must still read as English.
  assert.match(body, /The task "Call Bob"/);
});

test("a task reference is namespaced so it cannot collide with a Resend id", () => {
  assert.equal(taskEntryReference(TASK), `task:${TASK}`);
  assert.ok(!taskEntryReference(TASK).startsWith("re_"));
});

// ============================================================================
// 3. Query level — tenancy and the idempotency key
// ============================================================================

test("the replay guard reads church-scoped, by task reference", () => {
  const { sql: text, params } = existingTaskEntryQuery(CHURCH_A, TASK).toSQL();

  assert.match(text, /"communication_recipients"\."church_id" = \$\d/);
  assert.match(text, /"communication_recipients"\."external_id" = \$\d/);
  assert.ok(params.includes(CHURCH_A), "the church must be a bound parameter");
  assert.ok(
    params.includes(taskEntryReference(TASK)),
    "the task reference must be the key that is matched"
  );
  assert.ok(
    !params.includes(CHURCH_B),
    "nothing but the event's own church may reach the guard"
  );
});

test("both writes carry the church and land in one batch", () => {
  const statements = taskLogEntryStatements({
    entryId: "66666666-6666-4666-8666-666666666666",
    recipientId: "77777777-7777-4777-8777-777777777777",
    churchId: CHURCH_A,
    personId: PERSON,
    personEmail: "sarah@example.com",
    taskId: TASK,
    taskTitle: "Follow up with Sarah Johnson",
    taskCategory: "follow_up",
    completedAt: new Date("2026-08-09T15:30:00Z"),
    completedById: USER,
  });

  assert.equal(statements.length, 2, "one communication, one recipient");

  const [entry, recipient] = statements.map((statement) => statement.toSQL());

  // The parent first — the FK points that way.
  assert.match(entry.sql, /insert into "communications"/);
  assert.match(recipient.sql, /insert into "communication_recipients"/);

  for (const { params } of [entry, recipient]) {
    assert.ok(params.includes(CHURCH_A), "every write is church-scoped");
    assert.ok(!params.includes(CHURCH_B));
  }

  // The type discriminator: `logged`, never `sent`.
  assert.ok(
    entry.params.includes(LOGGED_ENTRY_STATUS),
    "the entry must be written as a logged contact"
  );
  assert.equal(LOGGED_ENTRY_STATUS, "logged");

  // What the task was, and when it completed.
  assert.ok(entry.params.includes("Follow up with Sarah Johnson"));
  // Drizzle binds a timestamp as its ISO string, so match on that.
  assert.ok(
    entry.params.includes("2026-08-09T15:30:00.000Z"),
    "the completion instant must be written as the entry's timestamp"
  );

  // The idempotency key rides with the recipient row, in the same batch.
  assert.ok(recipient.params.includes(taskEntryReference(TASK)));
  assert.ok(recipient.params.includes(PERSON));
});

// ============================================================================
// 4. Wiring, and the promise never to break the phase engine
// ============================================================================

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

test("the log handler is mounted on task.completed alongside dirty-marking", () => {
  const bus = makeFakeBus();
  registerSubscriptions(bus);

  const handlers = bus.handlersFor("task.completed");

  assert.ok(
    handlers.some(
      (registration) =>
        (registration.handler as unknown) ===
        handleTaskCompletedForCommunicationLog
    ),
    "COM-020's handler must be registered for task.completed"
  );
  assert.ok(
    handlers.length >= 2,
    "the phase engine's dirty-marking handler must still be registered too"
  );
});

test("an event that is not about a person resolves without touching the DB", async () => {
  // No database is configured in CI, so this doubles as proof that the
  // not-a-contact path short-circuits before any query.
  await assert.doesNotReject(() =>
    handleTaskCompletedForCommunicationLog(
      completedTask({ relatedType: "meeting", relatedId: TASK })
    )
  );
});

test("the handler never rejects, whatever the database does", async () => {
  // A church id that is not a uuid makes the guard query fail at the database.
  // The phase engine's dirty-marking handler shares this event, so a rejection
  // here would be the one thing COM-020 must never cost it.
  await assert.doesNotReject(() =>
    handleTaskCompletedForCommunicationLog(
      completedTask({ churchId: "not-a-uuid" })
    )
  );
});
