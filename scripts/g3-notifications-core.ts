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
  churchPrivacySettings,
  notificationPreferences,
  notifications,
  sendingNetworks,
  users,
} from "@/db/schema";
import { canAccessChurch } from "@/lib/auth/access";
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
  preferenceOwnerFromSession,
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
  // Church A sits under a network, so a network_admin genuinely passes
  // `canAccessChurch` for it — which is the whole point of assertion 7c.
  const [network] = await db
    .insert(sendingNetworks)
    .values({ name: "Scratch Network" })
    .returning();

  const [churchA] = await db
    .insert(churches)
    .values({ name: "Scratch Church A", sendingNetworkId: network.id })
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

  // Preference ownership is a branded type — minted only from a verified
  // session, never from a bare id. This is the production call shape.
  const ownerA = preferenceOwnerFromSession({ user: userA });
  const ownerB = preferenceOwnerFromSession({ user: userB });

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
  // 3. enqueue SKIPS a recipient outside the church — no throw, and no row.
  // --------------------------------------------------------------------------
  const outsideBefore = await db
    .select({ id: notifications.id })
    .from(notifications);
  const outside = await enqueue({
    churchId: churchA.id,
    recipientUserId: userC.id,
    category: "tasks",
    type: "task.overdue",
    title: "t",
    body: "b",
  });
  assert.equal(outside.status, "skipped");
  assert.equal(outside.reason, "outside_church");
  assert.equal(outside.notification, null);
  const outsideAfter = await db
    .select({ id: notifications.id })
    .from(notifications);
  assert.equal(outsideAfter.length, outsideBefore.length);
  ok("enqueue skips a recipient who cannot access the church, writing no row");

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
  // 7b. N-011 reschedule — cancel RELEASES the key, against real Postgres.
  //
  // This is the assertion the whole of migration 0025 exists for, and it can
  // only be made here: a faked store cannot tell whether Postgres actually
  // infers the PARTIAL arbiter index from the predicate the ON CONFLICT clause
  // supplies. If those two ever drift, this call fails with "there is no unique
  // or exclusion constraint matching the ON CONFLICT specification" — so every
  // keyed enqueue below is also a live check on that inference.
  // --------------------------------------------------------------------------
  const rescheduleEntity = "66666666-6666-4666-8666-666666666666";
  const rescheduleKey = `meeting.reminder:${rescheduleEntity}:3d`;
  const rescheduleInput = {
    churchId: churchA.id,
    recipientUserId: userA.id,
    category: "meetings" as const,
    type: "meeting.reminder",
    title: "Vision meeting in 3 days",
    body: "Thursday, 7pm.",
    entityType: "meeting" as const,
    entityId: rescheduleEntity,
    dedupeKey: rescheduleKey,
  };

  const beforeMove = await enqueue(rescheduleInput);
  assert.equal(beforeMove.created, true);

  const moved = await cancelByEntity({
    churchId: churchA.id,
    entityType: "meeting",
    entityId: rescheduleEntity,
  });
  assert.equal(moved.cancelledCount, 1);

  const afterMove = await enqueue(rescheduleInput);
  assert.equal(
    afterMove.created,
    true,
    "the re-enqueue after a cancel was silently swallowed"
  );
  assert.equal(afterMove.notification?.status, "pending");
  assert.notEqual(afterMove.notification?.id, beforeMove.notification?.id);

  const rescheduleRows = await db
    .select({ id: notifications.id, status: notifications.status })
    .from(notifications)
    .where(
      and(
        eq(notifications.churchId, churchA.id),
        eq(notifications.dedupeKey, rescheduleKey)
      )
    );
  assert.equal(rescheduleRows.length, 2);
  assert.deepEqual(rescheduleRows.map((row) => row.status).sort(), [
    "cancelled",
    "pending",
  ]);
  ok("cancel + re-enqueue under one key => a NEW pending row (N-011)");

  // ...and the live row is still unique: a THIRD enqueue collapses into the
  // pending one rather than adding a third row.
  const third = await enqueue(rescheduleInput);
  assert.equal(third.created, false);
  assert.equal(third.notification?.id, afterMove.notification?.id);
  assert.equal(
    third.notification?.status,
    "pending",
    "the read-back handed back a cancelled row"
  );
  const stillTwoLive = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.churchId, churchA.id),
        eq(notifications.dedupeKey, rescheduleKey)
      )
    );
  assert.equal(stillTwoLive.length, 2);
  ok("the LIVE row is still unique, and never resolves to the cancelled one");

  // --------------------------------------------------------------------------
  // 7c. SECURITY — an oversight recipient is refused when the church has not
  // opted in (memory/invariants.md → Hierarchical Access Control).
  // --------------------------------------------------------------------------
  const [oversight] = await db
    .insert(users)
    .values({
      email: `oversight-${Date.now()}@example.test`,
      passwordHash: "x",
      role: "network_admin",
      sendingNetworkId: network.id,
    })
    .returning();

  // `canAccessChurch` alone says yes — the plant is in their network.
  assert.equal(await canAccessChurch(oversight, churchA.id), true);

  const oversightRowsBefore = await db
    .select({ id: notifications.id })
    .from(notifications);
  const barred = await enqueue({
    churchId: churchA.id,
    recipientUserId: oversight.id,
    category: "communication",
    type: "message.failed",
    title: "Delivery failed",
    body: "No contact in 30 days: Jane Doe, 555-1234.",
  });
  assert.equal(barred.status, "skipped");
  assert.equal(barred.reason, "oversight_privacy");
  const oversightRowsAfter = await db
    .select({ id: notifications.id })
    .from(notifications);
  assert.equal(oversightRowsAfter.length, oversightRowsBefore.length);
  ok("an oversight recipient is skipped while the privacy toggle is closed");

  // Opt in, and the SAME call is accepted — the gate is the toggle, not the
  // role.
  await db.insert(churchPrivacySettings).values({
    churchId: churchA.id,
    sharePeople: true,
  });
  const permitted = await enqueue({
    churchId: churchA.id,
    recipientUserId: oversight.id,
    category: "communication",
    type: "message.failed",
    title: "Delivery failed",
    body: "A message you sent could not be delivered.",
  });
  assert.equal(permitted.status, "recorded");
  assert.equal(permitted.created, true);
  ok("...and accepted once the church opts in to sharing that feature");

  // --------------------------------------------------------------------------
  // 7d. RULING (FRD Open Question #3) — `phase` and `digest` are eligible, and
  // gated by their OWN toggles, which migration 0026 added at DEFAULT FALSE.
  //
  // The church opted in to `share_people` above and to nothing else, so this
  // is the state every existing church is in: the new columns exist and are
  // false, and behaviour is unchanged from before the ruling.
  // --------------------------------------------------------------------------
  for (const category of ["phase", "digest"] as const) {
    const closed = await enqueue({
      churchId: churchA.id,
      recipientUserId: oversight.id,
      category,
      type: `${category}.update`,
      title: "Phase changed",
      body: "Now in Core Group.",
    });
    assert.equal(closed.status, "skipped", `${category} while opted out`);
    assert.equal(closed.reason, "oversight_privacy");
  }
  ok(
    "phase and digest skip an oversight recipient while their toggles are off"
  );

  // Turn on `share_phase` ALONE: phase opens, digest stays shut. The two are
  // independent columns, so sharing assessments is not sharing the roll-up.
  await db
    .update(churchPrivacySettings)
    .set({ sharePhase: true })
    .where(eq(churchPrivacySettings.churchId, churchA.id));

  const phaseOpen = await enqueue({
    churchId: churchA.id,
    recipientUserId: oversight.id,
    category: "phase",
    type: "phase.transition",
    title: "Phase changed",
    body: "Now in Core Group.",
  });
  assert.equal(phaseOpen.status, "recorded");
  assert.equal(phaseOpen.created, true);

  const digestStillShut = await enqueue({
    churchId: churchA.id,
    recipientUserId: oversight.id,
    category: "digest",
    type: "digest.weekly",
    title: "Your week",
    body: "Three things need attention.",
  });
  assert.equal(digestStillShut.status, "skipped");
  assert.equal(digestStillShut.reason, "oversight_privacy");
  ok("share_phase opens `phase` for oversight and leaves `digest` shut");

  await db
    .update(churchPrivacySettings)
    .set({ shareDigest: true })
    .where(eq(churchPrivacySettings.churchId, churchA.id));

  const digestOpen = await enqueue({
    churchId: churchA.id,
    recipientUserId: oversight.id,
    category: "digest",
    type: "digest.weekly",
    title: "Your week",
    body: "Three things need attention.",
  });
  assert.equal(digestOpen.status, "recorded");
  assert.equal(digestOpen.created, true);
  ok("share_digest opens `digest` for oversight");

  // --------------------------------------------------------------------------
  // 7e. RULING (skip, do not throw) — a fan-out with a barred recipient in the
  // MIDDLE completes for everyone else, against real Postgres.
  // --------------------------------------------------------------------------
  const [shutChurch] = await db
    .insert(churches)
    .values({ name: "Scratch Church C", sendingNetworkId: network.id })
    .returning();
  const [shutUser] = await db
    .insert(users)
    .values({
      email: `shut-${Date.now()}@example.test`,
      passwordHash: "x",
      role: "planter",
      churchId: shutChurch.id,
    })
    .returning();
  // No privacy-settings row at all for this church: every toggle closed, which
  // is what an oversight recipient there runs into.
  const fanoutEntity = "77777777-7777-4777-8777-777777777777";
  const fanoutRecipients = [shutUser.id, oversight.id, shutUser.id];
  const fanoutResults = [];
  for (const [index, recipientUserId] of fanoutRecipients.entries()) {
    fanoutResults.push(
      await enqueue({
        churchId: shutChurch.id,
        recipientUserId,
        category: "phase",
        type: "phase.transition",
        title: "Phase changed",
        body: "Now in Core Group.",
        entityType: "phase_assessment",
        entityId: fanoutEntity,
        // Distinct keys so the repeated recipient is not deduped away — this
        // assertion is about the SKIP not aborting the loop, not about dedupe.
        dedupeKey: `phase.transition:${fanoutEntity}:${index}`,
      })
    );
  }

  assert.deepEqual(
    fanoutResults.map((result) => result.status),
    ["recorded", "skipped", "recorded"],
    "the barred recipient aborted the fan-out"
  );
  assert.equal(fanoutResults[1].reason, "oversight_privacy");

  const fanoutWritten = await db
    .select({ recipientUserId: notifications.recipientUserId })
    .from(notifications)
    .where(eq(notifications.churchId, shutChurch.id));
  assert.equal(fanoutWritten.length, 2);
  assert.ok(
    fanoutWritten.every((row) => row.recipientUserId === shutUser.id),
    "a row was written for the barred recipient"
  );
  ok("a fan-out with a barred recipient mid-loop notifies everyone else");

  // --------------------------------------------------------------------------
  // 8. Preferences — unique (user, category, channel), upsert not duplicate.
  // --------------------------------------------------------------------------
  await setPreference(ownerA, {
    category: "digest",
    channel: "email",
    enabled: true,
    digestCadence: "daily",
  });
  await setPreference(ownerA, {
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
    resolvePreference(await loadUserPreferences(ownerA), "digest", "email")
      .digestCadence,
    "daily"
  );
  ok("toggle-without-cadence preserves the stored `daily`");

  // Absent row => coded default.
  const absent = resolvePreference(
    await loadUserPreferences(ownerB),
    "tasks",
    "email"
  );
  assert.equal(absent.source, "default");
  assert.equal(absent.enabled, true);
  ok("a user with no rows resolves to the category's coded default");

  // Validation now actually runs at the boundary.
  await assert.rejects(() =>
    setPreference(ownerA, {
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
