import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { NewNotification, Notification } from "@/db/schema";
import { resend } from "@/lib/email/client";

import {
  enqueueNotificationSchema,
  runCancelByEntity,
  runEnqueue,
  type CancelByEntityDeps,
  type CancelByEntityInput,
  type EnqueueDeps,
  type EnqueueNotificationInput,
} from "./enqueue";

// ----------------------------------------------------------------------------
// The enqueue contract (N-001, N-002, N-011).
//
// The store below is a faithful stand-in for the three SQL statements the
// production deps issue — including the partial unique index on
// (church_id, dedupe_key), which is what makes a second enqueue a no-op rather
// than a second row. Driving `runEnqueue` through it exercises the real
// orchestration: what is faked is Postgres, not the logic under test.
// ----------------------------------------------------------------------------

const CHURCH_A = "11111111-1111-4111-8111-111111111111";
const CHURCH_B = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const TASK = "44444444-4444-4444-8444-444444444444";

class FakeNotificationStore implements EnqueueDeps, CancelByEntityDeps {
  readonly rows: Notification[] = [];
  private sequence = 0;

  /** Mirrors `INSERT ... ON CONFLICT DO NOTHING RETURNING *`. */
  async insertIfAbsent(row: NewNotification): Promise<Notification | null> {
    const dedupeKey = row.dedupeKey ?? null;

    // The partial unique index: NULL keys never collide.
    if (
      dedupeKey !== null &&
      this.rows.some(
        (existing) =>
          existing.churchId === row.churchId && existing.dedupeKey === dedupeKey
      )
    ) {
      return null;
    }

    this.sequence += 1;
    const now = new Date("2026-07-27T09:00:00.000Z");
    const stored: Notification = {
      id: `notification-${this.sequence}`,
      churchId: row.churchId,
      recipientUserId: row.recipientUserId,
      category: row.category,
      type: row.type,
      title: row.title,
      body: row.body,
      entityType: row.entityType ?? null,
      entityId: row.entityId ?? null,
      dedupeKey,
      scheduledFor: row.scheduledFor ?? now,
      status: row.status ?? "pending",
      readAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.rows.push(stored);
    return stored;
  }

  async findByDedupeKey(
    churchId: string,
    dedupeKey: string
  ): Promise<Notification | null> {
    return (
      this.rows.find(
        (row) => row.churchId === churchId && row.dedupeKey === dedupeKey
      ) ?? null
    );
  }

  async cancelPending({
    churchId,
    entityType,
    entityId,
    category,
  }: CancelByEntityInput): Promise<{ id: string }[]> {
    const matched = this.rows.filter(
      (row) =>
        row.churchId === churchId &&
        row.entityType === entityType &&
        row.entityId === entityId &&
        row.status === "pending" &&
        (category === undefined || row.category === category)
    );

    for (const row of matched) {
      row.status = "cancelled";
    }

    return matched.map((row) => ({ id: row.id }));
  }

  /** For before/after assertions that a call changed nothing. */
  snapshot(): string {
    return JSON.stringify(
      this.rows.map((row) => ({ id: row.id, status: row.status }))
    );
  }
}

function baseInput(
  overrides: Partial<EnqueueNotificationInput> = {}
): EnqueueNotificationInput {
  return {
    churchId: CHURCH_A,
    recipientUserId: USER,
    category: "tasks",
    type: "task.overdue",
    title: "Book the venue is overdue",
    body: "It was due yesterday.",
    entityType: "task",
    entityId: TASK,
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// N-001 / N-002 — records, never sends
// ----------------------------------------------------------------------------

test("enqueue records a pending notification and calls no provider", async (t) => {
  // The email client is the only provider F11 can reach. Spying on the Resend
  // send method covers every path into it, however it were reached.
  const send = t.mock.method(resend.emails, "send", async () => ({
    data: null,
    error: null,
  }));

  const store = new FakeNotificationStore();
  const result = await runEnqueue(store, baseInput());

  assert.equal(send.mock.callCount(), 0);

  assert.equal(result.created, true);
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].status, "pending");
  assert.equal(store.rows[0].churchId, CHURCH_A);
  assert.equal(store.rows[0].recipientUserId, USER);
  assert.equal(store.rows[0].category, "tasks");
  assert.equal(store.rows[0].type, "task.overdue");
  assert.equal(result.notification?.id, store.rows[0].id);
});

test("no module under src/lib/notifications imports an email provider", () => {
  // Belt to the spy's braces, and the stronger statement: enqueue cannot send
  // because nothing in this directory can reach a provider at all. A future
  // edit that adds the import fails here before it can fail in production.
  const dir = path.join(process.cwd(), "src/lib/notifications");
  const offenders: string[] = [];

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = readFileSync(path.join(dir, file), "utf8");
    if (/from\s+["'](resend|@\/lib\/email)/.test(source)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, []);
});

test("scheduledFor defaults to now and is preserved when supplied", async () => {
  const store = new FakeNotificationStore();
  const scheduledFor = new Date("2026-08-01T14:00:00.000Z");

  await runEnqueue(store, baseInput({ dedupeKey: "a", scheduledFor }));
  await runEnqueue(store, baseInput({ dedupeKey: "b" }));

  assert.equal(
    store.rows[0].scheduledFor.toISOString(),
    scheduledFor.toISOString()
  );
  assert.ok(store.rows[1].scheduledFor instanceof Date);
});

// ----------------------------------------------------------------------------
// N-001 — dedupe idempotency
// ----------------------------------------------------------------------------

test("a second enqueue with the same dedupeKey creates no second row", async () => {
  const store = new FakeNotificationStore();
  const input = baseInput({ dedupeKey: "task.overdue:" + TASK });

  const first = await runEnqueue(store, input);
  const second = await runEnqueue(store, input);

  assert.equal(store.rows.length, 1);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.notification?.id, first.notification?.id);
});

test("dedupe keys are scoped per church", async () => {
  const store = new FakeNotificationStore();
  const key = "task.overdue:shared";

  await runEnqueue(store, baseInput({ dedupeKey: key }));
  await runEnqueue(store, baseInput({ churchId: CHURCH_B, dedupeKey: key }));

  assert.equal(store.rows.length, 2);
  assert.deepEqual(
    store.rows.map((row) => row.churchId),
    [CHURCH_A, CHURCH_B]
  );
});

test("without a dedupe key every enqueue records its own row", async () => {
  const store = new FakeNotificationStore();

  await runEnqueue(store, baseInput());
  await runEnqueue(store, baseInput());

  assert.equal(store.rows.length, 2);
});

test("a conflict with no dedupe key is a bug, not a silent no-op", async () => {
  // The only conflict arbiter is the dedupe-key index. Deps reporting a
  // conflict for a keyless insert means the write vanished; that must surface.
  const brokenDeps: EnqueueDeps = {
    async insertIfAbsent() {
      return null;
    },
    async findByDedupeKey() {
      return null;
    },
  };

  await assert.rejects(
    () => runEnqueue(brokenDeps, baseInput()),
    /no dedupeKey/
  );
});

// ----------------------------------------------------------------------------
// Input contract
// ----------------------------------------------------------------------------

test("an entity reference must be complete or absent", () => {
  const withoutId = enqueueNotificationSchema.safeParse({
    ...baseInput(),
    entityId: undefined,
  });
  assert.equal(withoutId.success, false);

  const neither = enqueueNotificationSchema.safeParse({
    ...baseInput(),
    entityType: undefined,
    entityId: undefined,
  });
  assert.equal(neither.success, true);
});

test("an unknown category is rejected at the contract boundary", () => {
  const result = enqueueNotificationSchema.safeParse({
    ...baseInput(),
    category: "billing",
  });
  assert.equal(result.success, false);
});

test("empty rendered copy is rejected — F11 stores copy, it cannot invent it", () => {
  assert.equal(
    enqueueNotificationSchema.safeParse({ ...baseInput(), title: "   " })
      .success,
    false
  );
  assert.equal(
    enqueueNotificationSchema.safeParse({ ...baseInput(), body: "" }).success,
    false
  );
});

// ----------------------------------------------------------------------------
// N-011 — cancel by entity
// ----------------------------------------------------------------------------

test("cancelByEntity is safe on empty: no throw, no rows changed", async () => {
  const store = new FakeNotificationStore();
  await runEnqueue(store, baseInput({ entityType: "meeting", entityId: TASK }));

  const before = store.snapshot();

  const result = await runCancelByEntity(store, {
    churchId: CHURCH_A,
    entityType: "task",
    entityId: "55555555-5555-4555-8555-555555555555",
  });

  assert.deepEqual(result, { cancelledCount: 0, cancelledIds: [] });
  assert.equal(store.snapshot(), before);
});

test("cancelByEntity is safe on a store with nothing in it at all", async () => {
  const store = new FakeNotificationStore();

  const result = await runCancelByEntity(store, {
    churchId: CHURCH_A,
    entityType: "task",
    entityId: TASK,
  });

  assert.equal(result.cancelledCount, 0);
  assert.equal(store.rows.length, 0);
});

test("cancelByEntity cancels the entity's pending rows", async () => {
  const store = new FakeNotificationStore();
  await runEnqueue(store, baseInput({ dedupeKey: "one" }));
  await runEnqueue(store, baseInput({ dedupeKey: "two" }));

  const result = await runCancelByEntity(store, {
    churchId: CHURCH_A,
    entityType: "task",
    entityId: TASK,
  });

  assert.equal(result.cancelledCount, 2);
  assert.ok(store.rows.every((row) => row.status === "cancelled"));
});

test("cancelByEntity never reaches another church's rows", async () => {
  const store = new FakeNotificationStore();
  await runEnqueue(store, baseInput({ dedupeKey: "a" }));
  await runEnqueue(store, baseInput({ churchId: CHURCH_B, dedupeKey: "a" }));

  const result = await runCancelByEntity(store, {
    churchId: CHURCH_A,
    entityType: "task",
    entityId: TASK,
  });

  assert.equal(result.cancelledCount, 1);
  assert.equal(store.rows[1].status, "pending");
});

test("cancelByEntity can be narrowed to one category", async () => {
  const store = new FakeNotificationStore();
  await runEnqueue(store, baseInput({ dedupeKey: "t" }));
  await runEnqueue(
    store,
    baseInput({
      category: "meetings",
      type: "meeting.reminder",
      dedupeKey: "m",
    })
  );

  const result = await runCancelByEntity(store, {
    churchId: CHURCH_A,
    entityType: "task",
    entityId: TASK,
    category: "tasks",
  });

  assert.equal(result.cancelledCount, 1);
  assert.equal(store.rows[0].status, "cancelled");
  assert.equal(store.rows[1].status, "pending");
});

test("a second cancel is a no-op — cancelled rows are no longer pending", async () => {
  const store = new FakeNotificationStore();
  await runEnqueue(store, baseInput({ dedupeKey: "one" }));

  const input = {
    churchId: CHURCH_A,
    entityType: "task",
    entityId: TASK,
  };

  assert.equal((await runCancelByEntity(store, input)).cancelledCount, 1);

  const after = store.snapshot();
  assert.equal((await runCancelByEntity(store, input)).cancelledCount, 0);
  assert.equal(store.snapshot(), after);
});
