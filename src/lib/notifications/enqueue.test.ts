import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { NewNotification, Notification } from "@/db/schema";
import { resend } from "@/lib/email/client";

import { notificationCategories, oversightPrivacyFeature } from "./categories";
import {
  cancelByEntitySchema,
  enqueueNotificationSchema,
  runCancelByEntity,
  runEnqueue,
  type CancelByEntityDeps,
  type CancelByEntityInput,
  type EnqueueDeps,
  type EnqueueNotificationInput,
  type RecipientCheck,
} from "./enqueue";

// ----------------------------------------------------------------------------
// The enqueue contract (N-001, N-002, N-011).
//
// The store below is a faithful stand-in for the SQL the production deps issue
// — including the partial unique index on
// (church_id, recipient_user_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND
// status <> 'cancelled', which is what makes a second enqueue TO THE SAME
// RECIPIENT a no-op rather than a second row, while the same key for a
// different recipient still records its own AND a key whose only holder was
// cancelled is free again. Driving `runEnqueue` through it exercises the real
// orchestration: what is faked is Postgres, not the logic under test. The index
// itself is asserted against the generated migration below, so the fake cannot
// drift away from it.
// ----------------------------------------------------------------------------

const CHURCH_A = "11111111-1111-4111-8111-111111111111";
const CHURCH_B = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const TASK = "44444444-4444-4444-8444-444444444444";
const OTHER_USER = "66666666-6666-4666-8666-666666666666";
const OUTSIDER = "77777777-7777-4777-8777-777777777777";
/** A network admin whose oversight reach covers church A. */
const OVERSIGHT = "88888888-8888-4888-8888-888888888888";

/** Who may be notified about what — the membership source, faked. */
const MEMBERSHIPS: Record<string, string[]> = {
  [USER]: [CHURCH_A, CHURCH_B],
  [OTHER_USER]: [CHURCH_A],
  [OUTSIDER]: [],
  [OVERSIGHT]: [CHURCH_A],
};

/**
 * The church's opt-in privacy toggles, faked. Absent church = absent settings
 * row = every feature closed, which is the production default.
 */
const SHARED_FEATURES: Record<string, string[]> = {};

class FakeNotificationStore implements EnqueueDeps, CancelByEntityDeps {
  readonly rows: Notification[] = [];
  private sequence = 0;

  /**
   * Mirrors `dbEnqueueDeps.recipientMayBeNotified`: church access first, then —
   * for oversight users only — the church's privacy toggle for the category's
   * feature.
   */
  async recipientMayBeNotified(
    churchId: string,
    recipientUserId: string,
    category: EnqueueNotificationInput["category"]
  ): Promise<RecipientCheck> {
    if (!(MEMBERSHIPS[recipientUserId] ?? []).includes(churchId)) {
      return { allowed: false, reason: "outside_church" };
    }

    if (recipientUserId === OVERSIGHT) {
      const feature = oversightPrivacyFeature(category);
      if (
        feature === null ||
        !(SHARED_FEATURES[churchId] ?? []).includes(feature)
      ) {
        return { allowed: false, reason: "oversight_privacy" };
      }
    }

    return { allowed: true };
  }

  /** Mirrors `INSERT ... ON CONFLICT DO NOTHING RETURNING *`. */
  async insertIfAbsent(row: NewNotification): Promise<Notification | null> {
    const dedupeKey = row.dedupeKey ?? null;

    // The partial unique index on (church_id, recipient_user_id, dedupe_key)
    // WHERE dedupe_key IS NOT NULL AND status <> 'cancelled': NULL keys never
    // collide, the same key for a different recipient is a different row, and a
    // CANCELLED row is not in the index at all — so it cannot arbitrate.
    if (
      dedupeKey !== null &&
      this.rows.some(
        (existing) =>
          existing.churchId === row.churchId &&
          existing.recipientUserId === row.recipientUserId &&
          existing.dedupeKey === dedupeKey &&
          existing.status !== "cancelled"
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

  /** The read-back carries the index's liveness term, as production's does. */
  async findByDedupeKey(
    churchId: string,
    recipientUserId: string,
    dedupeKey: string
  ): Promise<Notification | null> {
    return (
      this.rows.find(
        (row) =>
          row.churchId === churchId &&
          row.recipientUserId === recipientUserId &&
          row.dedupeKey === dedupeKey &&
          row.status !== "cancelled"
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

test("the same dedupeKey for two recipients in one church records two rows", async () => {
  // The fan-out shape, and the reason the recipient is in the unique index.
  // A meeting reminder is ONE event with one natural key, sent to every
  // attendee: the caller loops the recipients and reuses the key. If dedupe
  // were (church, key) only, attendee #1 would win the insert and #2 would come
  // back `created: false` holding attendee #1's row — the notification silently
  // never sent, and no way for the caller to notice.
  const store = new FakeNotificationStore();
  const key = "meeting.reminder:" + TASK + ":3d";

  const first = await runEnqueue(
    store,
    baseInput({
      category: "meetings",
      type: "meeting.reminder",
      dedupeKey: key,
    })
  );
  const second = await runEnqueue(
    store,
    baseInput({
      category: "meetings",
      type: "meeting.reminder",
      recipientUserId: OTHER_USER,
      dedupeKey: key,
    })
  );

  assert.equal(store.rows.length, 2);
  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.notEqual(second.notification?.id, first.notification?.id);
  assert.deepEqual(
    store.rows.map((row) => row.recipientUserId),
    [USER, OTHER_USER]
  );
});

test("the same dedupeKey for the SAME recipient still collapses", async () => {
  // The other half of the pair: per-recipient idempotency is still idempotency.
  const store = new FakeNotificationStore();
  const key = "meeting.reminder:" + TASK + ":3d";
  const input = baseInput({
    category: "meetings",
    type: "meeting.reminder",
    recipientUserId: OTHER_USER,
    dedupeKey: key,
  });

  await runEnqueue(store, input);
  const second = await runEnqueue(store, input);

  assert.equal(store.rows.length, 1);
  assert.equal(second.created, false);
});

test("the migration creates the (church, recipient, key) LIVE partial unique index", () => {
  // The fake store above mirrors this index; if the migration ever stopped
  // matching it, the fake would keep passing while production quietly changed
  // behaviour. The index is the real arbiter for ON CONFLICT DO NOTHING, so it
  // is asserted rather than assumed — and 0025 is the version that counts,
  // because it is the one carrying the `status <> 'cancelled'` liveness term.
  const sql = readFileSync(
    path.join(
      process.cwd(),
      "src/db/migrations/0025_notification_dedupe_liveness.sql"
    ),
    "utf8"
  );

  assert.match(
    sql,
    /CREATE UNIQUE INDEX "notifications_dedupe_key_unique_idx" ON "notifications" USING btree \("church_id","recipient_user_id","dedupe_key"\) WHERE "notifications"\."dedupe_key" is not null and "notifications"\."status" <> 'cancelled'/
  );
});

test("the ON CONFLICT predicate is byte-identical to the index predicate", () => {
  // Postgres infers a PARTIAL arbiter index only from a matching predicate. If
  // these two drift, every keyed enqueue fails at runtime with "there is no
  // unique or exclusion constraint matching the ON CONFLICT specification" —
  // a failure no unit test with a faked store can see, so it is asserted on the
  // source text of both sides.
  // Comments stripped first: the ROLLBACK recipe in the header quotes the OLD
  // predicate verbatim, and matching that would compare 0025 against 0023.
  const migration = readFileSync(
    path.join(
      process.cwd(),
      "src/db/migrations/0025_notification_dedupe_liveness.sql"
    ),
    "utf8"
  )
    .split("\n")
    .filter((line) => !line.startsWith("--"))
    .join("\n");
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/notifications/enqueue.ts"),
    "utf8"
  );

  const indexPredicate = migration.match(
    /CREATE UNIQUE INDEX "notifications_dedupe_key_unique_idx"[^;]*WHERE (.+);/
  )?.[1];
  assert.ok(indexPredicate, "no index predicate found in 0025");

  // The drizzle template renders `${notifications.dedupeKey}` as the qualified
  // column, so normalise the interpolations to what reaches Postgres.
  const conflictPredicate = source
    .match(/where: sql`(.+)`,/)?.[1]
    ?.replaceAll("${notifications.dedupeKey}", '"notifications"."dedupe_key"')
    .replaceAll("${notifications.status}", '"notifications"."status"');

  assert.equal(conflictPredicate, indexPredicate);
});

// ----------------------------------------------------------------------------
// N-011 — cancel RELEASES the key (reschedule, reopen)
// ----------------------------------------------------------------------------

test("cancel then re-enqueue under the same key records a NEW pending row", async () => {
  // The blocking bug this liveness term exists to fix. N-011 says reschedule is
  // cancel + re-enqueue, and reopen (task completed -> cancelled, task reopened
  // -> re-enqueue) is the same shape. With a key-only index the CANCELLED row
  // went on occupying its key forever: the re-enqueue was absorbed by ON
  // CONFLICT, the caller got `created: false` holding a cancelled row, and the
  // notification vanished — no pending row for the dispatcher, and nothing in
  // the feed either, with no error anywhere.
  const store = new FakeNotificationStore();
  const key = `meeting.reminder:${TASK}:3d`;
  const input = baseInput({
    category: "meetings",
    type: "meeting.reminder",
    entityType: "meeting",
    dedupeKey: key,
  });

  const first = await runEnqueue(store, input);
  assert.equal(first.created, true);

  const cancelled = await runCancelByEntity(store, {
    churchId: CHURCH_A,
    entityType: "meeting",
    entityId: TASK,
  });
  assert.equal(cancelled.cancelledCount, 1);

  const second = await runEnqueue(store, input);

  assert.equal(second.created, true, "the re-enqueue was silently swallowed");
  assert.equal(second.notification?.status, "pending");
  assert.notEqual(second.notification?.id, first.notification?.id);

  assert.equal(store.rows.length, 2);
  assert.deepEqual(
    store.rows.map((row) => row.status),
    ["cancelled", "pending"]
  );
  // The cancelled row keeps its key: the audit trail is what the partial index
  // buys over nulling the column.
  assert.deepEqual(
    store.rows.map((row) => row.dedupeKey),
    [key, key]
  );
});

test("a cancelled row is never handed back as a dedupe hit", async () => {
  // The other half: even if the insert had been absorbed, the read-back must
  // not resolve to a row that will never be delivered.
  const store = new FakeNotificationStore();
  const key = "task.overdue:" + TASK;

  await runEnqueue(store, baseInput({ dedupeKey: key }));
  await runCancelByEntity(store, {
    churchId: CHURCH_A,
    entityType: "task",
    entityId: TASK,
  });

  const found = await store.findByDedupeKey(CHURCH_A, USER, key);
  assert.equal(found, null);
});

test("a DELIVERED row still reserves its key — dedupe is not undone by cancel alone", async () => {
  // Liveness means cancelled, not "any terminal state". A delivered
  // announcement happened, and re-announcing it is precisely what dedupe stops.
  const store = new FakeNotificationStore();
  const key = "task.overdue:" + TASK;

  await runEnqueue(store, baseInput({ dedupeKey: key }));
  store.rows[0].status = "delivered";

  const second = await runEnqueue(store, baseInput({ dedupeKey: key }));

  assert.equal(second.created, false);
  assert.equal(store.rows.length, 1);
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
    async recipientMayBeNotified() {
      return { allowed: true };
    },
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
// The (church, recipient) relationship is checked, not assumed
// ----------------------------------------------------------------------------

test("a recipient outside the church is refused, and nothing is written", async () => {
  // The tenancy fact a comment used to stand in for. A caller that derived
  // recipientUserId from request input would otherwise file a notification for
  // a stranger into a tenant they do not belong to — where, being church-scoped,
  // it becomes readable inside that church.
  const store = new FakeNotificationStore();

  await assert.rejects(
    () => runEnqueue(store, baseInput({ recipientUserId: OUTSIDER })),
    /does not belong to church/
  );

  assert.equal(store.rows.length, 0);
});

test("the check is per church, not per user — the same user can be in-scope elsewhere", async () => {
  const store = new FakeNotificationStore();

  // OTHER_USER belongs to church A only.
  await runEnqueue(store, baseInput({ recipientUserId: OTHER_USER }));
  await assert.rejects(
    () =>
      runEnqueue(
        store,
        baseInput({ churchId: CHURCH_B, recipientUserId: OTHER_USER })
      ),
    /does not belong to church/
  );

  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].churchId, CHURCH_A);
});

test("membership is checked BEFORE the insert is attempted", async () => {
  // Not a post-hoc audit: the refused enqueue must never reach the table.
  let insertAttempts = 0;
  const deps: EnqueueDeps = {
    async recipientMayBeNotified() {
      return { allowed: false, reason: "outside_church" };
    },
    async insertIfAbsent() {
      insertAttempts += 1;
      return null;
    },
    async findByDedupeKey() {
      return null;
    },
  };

  await assert.rejects(() => runEnqueue(deps, baseInput()));
  assert.equal(insertAttempts, 0);
});

// ----------------------------------------------------------------------------
// Oversight recipients are subject to the church's privacy toggles
// ----------------------------------------------------------------------------

test("an oversight recipient is refused when the church has not opted in", async () => {
  // memory/invariants.md → Hierarchical Access Control: oversight users see
  // aggregate metrics only, gated by `church_privacy_settings`, which defaults
  // to all-false (an absent settings row is a closed one). `canAccessChurch`
  // alone returns TRUE for a network admin on every plant beneath them, so
  // gating on it would ship item-level feature copy — "No contact in 30 days:
  // Jane Doe" — straight past a toggle the church deliberately left closed.
  const store = new FakeNotificationStore();

  await assert.rejects(
    () =>
      runEnqueue(
        store,
        baseInput({
          category: "communication",
          type: "message.failed",
          entityType: "message",
          recipientUserId: OVERSIGHT,
        })
      ),
    /may not be notified about "communication"/
  );

  assert.equal(store.rows.length, 0);
});

test("the refusal is NOT a tenancy error — the oversight user can access the church", async () => {
  // Two different facts, and they must stay distinguishable: this recipient
  // passes `canAccessChurch`. What they lack is the church's consent.
  const store = new FakeNotificationStore();

  const check = await store.recipientMayBeNotified(
    CHURCH_A,
    OVERSIGHT,
    "tasks"
  );
  assert.deepEqual(check, { allowed: false, reason: "oversight_privacy" });

  const outsider = await store.recipientMayBeNotified(
    CHURCH_A,
    OUTSIDER,
    "tasks"
  );
  assert.deepEqual(outsider, { allowed: false, reason: "outside_church" });
});

test("phase and digest have no toggle, so an oversight recipient is refused outright", async () => {
  // `church_privacy_settings` has no column for either: `phase` has no toggle
  // at all, and `digest` is a roll-up OF the other categories that no single
  // toggle can answer for. Fail closed pending a ruling.
  assert.equal(oversightPrivacyFeature("phase"), null);
  assert.equal(oversightPrivacyFeature("digest"), null);

  const store = new FakeNotificationStore();
  for (const category of ["phase", "digest"] as const) {
    await assert.rejects(
      () =>
        runEnqueue(
          store,
          baseInput({
            category,
            type: `${category}.update`,
            entityType: undefined,
            entityId: undefined,
            recipientUserId: OVERSIGHT,
          })
        ),
      /may not be notified about/
    );
  }
  assert.equal(store.rows.length, 0);
});

test("a church-level recipient is never subject to a privacy toggle", async () => {
  // `canAccessFeatureData` returns true for planter/coach/team_member without
  // consulting settings, and the enqueue gate must not be stricter than the
  // read gate it mirrors.
  const store = new FakeNotificationStore();

  for (const category of ["tasks", "phase", "digest"] as const) {
    const result = await runEnqueue(
      store,
      baseInput({
        category,
        type: `${category}.update`,
        entityType: undefined,
        entityId: undefined,
      })
    );
    assert.equal(result.created, true);
  }

  assert.equal(store.rows.length, 3);
});

test("every category maps to a toggle or to an explicit null — none is missing", () => {
  // A category added without a decision here would otherwise inherit whatever
  // `?? null` happened to do. Stating it makes the omission visible.
  for (const category of notificationCategories) {
    const feature = oversightPrivacyFeature(category);
    assert.ok(
      feature === null || typeof feature === "string",
      `no oversight decision recorded for "${category}"`
    );
  }
});

// ----------------------------------------------------------------------------
// Input contract
// ----------------------------------------------------------------------------

test("entityType is a closed set, not free text", () => {
  // `cancelByEntity` is a church-wide denial primitive keyed on
  // (entity_type, entity_id). A free-text discriminator lets a typo cancel
  // nothing silently and lets request-forwarded input aim it anywhere.
  assert.equal(
    enqueueNotificationSchema.safeParse({
      ...baseInput(),
      entityType: "invoice",
    }).success,
    false
  );
  assert.equal(
    cancelByEntitySchema.safeParse({
      churchId: CHURCH_A,
      entityType: "invoice",
      entityId: TASK,
    }).success,
    false
  );
  assert.equal(
    cancelByEntitySchema.safeParse({
      churchId: CHURCH_A,
      entityType: "meeting",
      entityId: TASK,
    }).success,
    true
  );
});

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

  const input: CancelByEntityInput = {
    churchId: CHURCH_A,
    entityType: "task",
    entityId: TASK,
  };

  assert.equal((await runCancelByEntity(store, input)).cancelledCount, 1);

  const after = store.snapshot();
  assert.equal((await runCancelByEntity(store, input)).cancelledCount, 0);
  assert.equal(store.snapshot(), after);
});
