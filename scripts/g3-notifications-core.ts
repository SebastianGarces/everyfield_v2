/**
 * G3 harness for N-CORE (issue #130) — real database, scratch database only.
 *
 * Runs the SHIPPED functions — `enqueue`, `cancelByEntity`, the `queries.ts`
 * read paths and `preferences.ts` — against a Postgres that has had every
 * migration applied by `pnpm db:migrate`. Nothing is faked, and nothing here is
 * a stand-in for SQL: the unit tests already cover the logic, this covers what
 * the database actually does with it.
 *
 * NEVER point it at a real database: it seeds churches and users and leaves
 * them behind. Create a scratch one first.
 *
 *   psql "$DATABASE_URL" -c 'create database scratch_ncore'
 *   export DATABASE_URL="<same url, /scratch_ncore>"
 *   pnpm db:migrate
 *   pnpm exec tsx scripts/g3-notifications-core.ts
 *   psql "<original url>" -c 'drop database scratch_ncore'
 */
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  churches,
  notificationPreferences,
  notifications,
  users,
} from "@/db/schema";
import {
  cancelByEntity,
  enqueue,
  type EnqueueResult,
} from "@/lib/notifications/enqueue";
import {
  getNotificationById,
  getUnreadCount,
  listNotifications,
} from "@/lib/notifications/queries";
import {
  loadUserPreferences,
  resolvePreference,
  setPreference,
} from "@/lib/notifications/preferences";

const results: string[] = [];
function ok(label: string) {
  results.push(`PASS  ${label}`);
  console.log(`PASS  ${label}`);
}

async function main() {
  // --------------------------------------------------------------------------
  // Seed: one church, two users in it; one church B with its own user.
  // --------------------------------------------------------------------------
  const [churchA] = await db
    .insert(churches)
    .values({ name: "Scratch Church A" })
    .returning();
  const [churchB] = await db
    .insert(churches)
    .values({ name: "Scratch Church B" })
    .returning();

  const [userA] = await db
    .insert(users)
    .values({
      email: `a-${Date.now()}@example.test`,
      passwordHash: "x",
      role: "planter",
      churchId: churchA.id,
    })
    .returning();
  const [userB] = await db
    .insert(users)
    .values({
      email: `b-${Date.now()}@example.test`,
      passwordHash: "x",
      role: "team_member",
      churchId: churchA.id,
    })
    .returning();
  const [userC] = await db
    .insert(users)
    .values({
      email: `c-${Date.now()}@example.test`,
      passwordHash: "x",
      role: "planter",
      churchId: churchB.id,
    })
    .returning();

  const scopeA = { churchId: churchA.id, recipientUserId: userA.id };
  const scopeB = { churchId: churchA.id, recipientUserId: userB.id };
  const entityId = "44444444-4444-4444-8444-444444444444";

  // --------------------------------------------------------------------------
  // 1. enqueue records a PENDING row and calls no provider (row assertion).
  // --------------------------------------------------------------------------
  const first = await enqueue({
    churchId: churchA.id,
    recipientUserId: userA.id,
    category: "tasks",
    type: "task.overdue",
    title: "Book the venue is overdue",
    body: "It was due yesterday.",
    entityType: "task",
    entityId,
    dedupeKey: `task.overdue:${entityId}`,
  });
  assert.equal(first.created, true);
  assert.equal(first.notification?.status, "pending");
  ok("enqueue records a pending row");

  // --------------------------------------------------------------------------
  // 2. BLOCKER #1 — same dedupeKey, two DIFFERENT recipients, one church.
  // --------------------------------------------------------------------------
  const fanoutKey = `meeting.reminder:${entityId}:3d`;
  const fanout: EnqueueResult[] = [];
  for (const recipient of [userA, userB]) {
    fanout.push(
      await enqueue({
        churchId: churchA.id,
        recipientUserId: recipient.id,
        category: "meetings",
        type: "meeting.reminder",
        title: "Vision meeting in 3 days",
        body: "Thursday, 7pm.",
        entityType: "meeting",
        entityId,
        dedupeKey: fanoutKey,
      })
    );
  }
  assert.equal(fanout[0].created, true);
  assert.equal(fanout[1].created, true, "attendee #2 was swallowed");
  assert.notEqual(fanout[0].notification?.id, fanout[1].notification?.id);

  const fanoutRows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.churchId, churchA.id),
        eq(notifications.dedupeKey, fanoutKey)
      )
    );
  assert.equal(fanoutRows.length, 2);
  ok("same dedupeKey + two recipients in one church => TWO rows");

  // ... and the same key for the SAME recipient still collapses.
  const repeat = await enqueue({
    churchId: churchA.id,
    recipientUserId: userA.id,
    category: "meetings",
    type: "meeting.reminder",
    title: "Vision meeting in 3 days",
    body: "Thursday, 7pm.",
    entityType: "meeting",
    entityId,
    dedupeKey: fanoutKey,
  });
  assert.equal(repeat.created, false);
  assert.equal(repeat.notification?.id, fanout[0].notification?.id);
  const stillTwo = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.churchId, churchA.id),
        eq(notifications.dedupeKey, fanoutKey)
      )
    );
  assert.equal(stillTwo.length, 2);
  ok("same dedupeKey + same recipient => still ONE row (ON CONFLICT works)");

  // --------------------------------------------------------------------------
  // 3. enqueue refuses a recipient outside the church.
  // --------------------------------------------------------------------------
  await assert.rejects(
    () =>
      enqueue({
        churchId: churchA.id,
        recipientUserId: userC.id,
        category: "tasks",
        type: "task.overdue",
        title: "t",
        body: "b",
      }),
    /does not belong to church/
  );
  ok("enqueue refuses a recipient who cannot access the church");

  // --------------------------------------------------------------------------
  // 4. SECURITY — user A's read paths return ZERO of user B's rows.
  // --------------------------------------------------------------------------
  const bOnly = await enqueue({
    churchId: churchA.id,
    recipientUserId: userB.id,
    category: "communication",
    type: "message.failed",
    title: "B's private notification",
    body: "Only B may read this.",
  });
  const aFeed = await listNotifications(scopeA);
  assert.ok(!aFeed.some((row) => row.id === bOnly.notification?.id));
  assert.ok(aFeed.every((row) => row.title !== "B's private notification"));
  assert.equal(await getNotificationById(scopeA, bOnly.notification!.id), null);
  const bFeed = await listNotifications(scopeB);
  assert.ok(bFeed.some((row) => row.id === bOnly.notification?.id));
  ok(
    "same church, other user: A's feed and by-id read return zero of B's rows"
  );

  // Cross-church stays closed too.
  assert.equal(
    await getNotificationById(
      { churchId: churchB.id, recipientUserId: userA.id },
      first.notification!.id
    ),
    null
  );
  ok("cross-church fetch by id returns nothing");

  // The feed row carries no queue internals.
  assert.ok(!("dedupeKey" in aFeed[0]));
  assert.ok(!("scheduledFor" in aFeed[0]));
  ok("feed rows carry no dedupe_key / scheduled_for");

  // --------------------------------------------------------------------------
  // 5. BLOCKER #2a — a cancelled row leaves BOTH the feed and the unread count.
  // --------------------------------------------------------------------------
  const beforeFeed = await listNotifications(scopeA);
  const beforeCount = await getUnreadCount(scopeA);
  assert.ok(beforeFeed.some((row) => row.entityId === entityId));

  const cancelled = await cancelByEntity({
    churchId: churchA.id,
    entityType: "meeting",
    entityId,
  });
  assert.ok(cancelled.cancelledCount >= 1);

  const afterFeed = await listNotifications(scopeA);
  const afterCount = await getUnreadCount(scopeA);
  assert.ok(
    !afterFeed.some((row) => row.id === fanout[0].notification?.id),
    "cancelled row still in the feed"
  );
  assert.equal(afterCount, beforeCount - 1);
  assert.equal(afterFeed.length, beforeFeed.length - 1);
  ok("a row cancelled by cancelByEntity disappears from feed AND unread count");

  // --------------------------------------------------------------------------
  // 6. BLOCKER #2b — a future-scheduled row is neither shown nor counted.
  // --------------------------------------------------------------------------
  const countBeforeFuture = await getUnreadCount(scopeA);
  const future = await enqueue({
    churchId: churchA.id,
    recipientUserId: userA.id,
    category: "meetings",
    type: "meeting.reminder",
    title: "Not due for three days",
    body: "Should not be visible yet.",
    scheduledFor: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  });
  const feedWithFuture = await listNotifications(scopeA);
  assert.ok(!feedWithFuture.some((row) => row.id === future.notification?.id));
  assert.equal(await getUnreadCount(scopeA), countBeforeFuture);
  ok("a future-scheduled notification is not shown and not counted");

  // ...and it IS visible once due.
  const feedLater = await listNotifications(scopeA, {
    now: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
  });
  assert.ok(feedLater.some((row) => row.id === future.notification?.id));
  ok("the same row appears once its scheduled_for has passed");

  // --------------------------------------------------------------------------
  // 7. cancelByEntity is safe on empty.
  // --------------------------------------------------------------------------
  const rowsBefore = await db
    .select({ id: notifications.id })
    .from(notifications);
  const empty = await cancelByEntity({
    churchId: churchA.id,
    entityType: "task",
    entityId: "55555555-5555-4555-8555-555555555555",
  });
  assert.deepEqual(empty, { cancelledCount: 0, cancelledIds: [] });
  const rowsAfter = await db
    .select({ id: notifications.id })
    .from(notifications);
  assert.equal(rowsAfter.length, rowsBefore.length);
  ok("cancelByEntity on nothing: no throw, no rows changed");

  // --------------------------------------------------------------------------
  // 8. Preferences — unique (user, category, channel), upsert not duplicate.
  // --------------------------------------------------------------------------
  await setPreference(userA.id, {
    category: "digest",
    channel: "email",
    enabled: true,
    digestCadence: "daily",
  });
  await setPreference(userA.id, {
    category: "digest",
    channel: "email",
    enabled: false,
  });
  const prefRows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userA.id));
  assert.equal(prefRows.length, 1);
  ok("writing a preference twice updates rather than duplicates");

  // The cadence survives a toggle that did not resend it.
  assert.equal(prefRows[0].enabled, false);
  assert.equal(prefRows[0].digestCadence, "daily");
  assert.equal(
    resolvePreference(await loadUserPreferences(userA.id), "digest", "email")
      .digestCadence,
    "daily"
  );
  ok("toggle-without-cadence preserves the stored `daily`");

  // Absent row => coded default.
  const absent = resolvePreference(
    await loadUserPreferences(userB.id),
    "tasks",
    "email"
  );
  assert.equal(absent.source, "default");
  assert.equal(absent.enabled, true);
  ok("a user with no rows resolves to the category's coded default");

  // Validation now actually runs at the boundary.
  await assert.rejects(() =>
    setPreference(userA.id, {
      // @ts-expect-error runtime guard is the point
      category: "billing",
      channel: "email",
      enabled: false,
    })
  );
  ok("setPreference rejects an unknown category before it reaches the table");

  // --------------------------------------------------------------------------
  // 9. CHECK constraints — the database refuses what the parse would have.
  // --------------------------------------------------------------------------
  async function violates(statement: Promise<unknown>, constraint: string) {
    try {
      await statement;
      assert.fail(`expected ${constraint} to reject the write`);
    } catch (error) {
      const cause = (error as { cause?: { message?: string } }).cause;
      const message = `${(error as Error).message} ${cause?.message ?? ""}`;
      assert.match(message, new RegExp(constraint));
    }
  }

  await violates(
    db.execute(
      sql`insert into notification_preferences (user_id, category, channel, enabled) values (${userA.id}, 'billing', 'email', true)`
    ),
    "notification_preferences_category_check"
  );
  await violates(
    db.execute(
      sql`insert into notifications (church_id, recipient_user_id, category, type, title, body) values (${churchA.id}, ${userA.id}, 'billing', 't', 't', 'b')`
    ),
    "notifications_category_check"
  );
  ok("CHECK constraints reject an unrecognised category at the DB boundary");

  console.log("\n--- ALL G3 ASSERTIONS PASSED ---");
  console.log(results.length, "assertions");
}

main().catch((error) => {
  console.error("FAIL:", error);
  process.exit(1);
});
