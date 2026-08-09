import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  communicationRecipients,
  communications,
  persons,
  tasks,
  users,
} from "@/db/schema";
import { eventBus } from "@/lib/events/event-bus";

import { getPersonCommunications } from "./service";
import { LOGGED_ENTRY_STATUS, taskEntryReference } from "./log";

// ----------------------------------------------------------------------------
// COM-020 — the half that EXECUTES against a database.
//
// Seeds two churches, a person in each and the tasks that reach them, then
// emits `task.completed` on the REAL event bus — the same singleton
// `completeTask` emits on — and reads the result back through
// `getPersonCommunications`, which is what the person's Communication Log page
// calls. Nothing here stubs the wiring: if the subscription in
// `subscriptions.ts` were removed, these tests fail.
//
// ⚠ THIS FILE SKIPS WHEN DATABASE_URL POINTS NOWHERE, AND IT DOES ON CI.
// The PR check runs `pnpm test` with a placeholder URL and no Postgres behind
// it, so a green check means the SHAPE held (`log.test.ts`, which needs no
// database and runs everywhere) — it is NOT evidence that an entry was
// observed. That evidence comes from running this file where a real database
// is configured:
//
//     pnpm exec tsx --env-file-if-exists=.env.local --test "src/lib/communication/log*.test.ts"
//
// and `skipped 0` in that output is the thing worth quoting in the PR body.
//
// Every emission also runs the phase engine's dirty-marking handler, because
// both are mounted on `task.completed`. The first test asserts that mark landed
// as well — one event, two features, neither able to starve the other.
// ----------------------------------------------------------------------------

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

interface Fixture {
  prefix: string;
  churchAId: string;
  churchBId: string;
  userId: string;
  personAId: string;
  personBId: string;
  taskIds: string[];
}

/** Enough rows to make a completed task about a person, in two churches. */
async function seed(prefix: string): Promise<Fixture> {
  const [churchA, churchB] = await db
    .insert(churches)
    .values([{ name: `${prefix} A` }, { name: `${prefix} B` }])
    .returning({ id: churches.id });

  const [user] = await db
    .insert(users)
    .values({
      email: `${prefix}@example.test`,
      passwordHash: "not-a-real-hash",
      name: `${prefix} planter`,
      role: "planter",
      churchId: churchA.id,
    })
    .returning({ id: users.id });

  const [personA, personB] = await db
    .insert(persons)
    .values([
      {
        churchId: churchA.id,
        firstName: "Sarah",
        lastName: prefix,
        email: `sarah-${prefix}@example.test`,
        createdBy: user.id,
      },
      {
        churchId: churchB.id,
        firstName: "Other",
        lastName: prefix,
        createdBy: user.id,
      },
    ])
    .returning({ id: persons.id });

  return {
    prefix,
    churchAId: churchA.id,
    churchBId: churchB.id,
    userId: user.id,
    personAId: personA.id,
    personBId: personB.id,
    taskIds: [],
  };
}

/** A task that is already complete, as `completeTask` would have left it. */
async function seedCompletedTask(
  fixture: Fixture,
  attributes: {
    churchId: string;
    title: string;
    category?: "follow_up" | "administrative";
    relatedType: "person" | "meeting" | null;
    relatedId: string | null;
    completedAt: Date;
  }
): Promise<string> {
  const [task] = await db
    .insert(tasks)
    .values({
      churchId: attributes.churchId,
      title: attributes.title,
      status: "complete",
      category: attributes.category ?? "follow_up",
      relatedType: attributes.relatedType ?? undefined,
      relatedId: attributes.relatedId ?? undefined,
      completedAt: attributes.completedAt,
      completedById: fixture.userId,
      createdById: fixture.userId,
    })
    .returning({ id: tasks.id });

  fixture.taskIds.push(task.id);
  return task.id;
}

/** The event `emitTaskCompleted` publishes, restated so the test owns it. */
async function fireTaskCompleted(input: {
  taskId: string;
  churchId: string;
  category: string | null;
  relatedType: string | null;
  relatedId: string | null;
  completedById: string;
}): Promise<void> {
  await eventBus.emit({
    type: "task.completed",
    ...input,
    timestamp: new Date(),
  });
}

async function cleanup(fixture: Fixture): Promise<void> {
  const churchIds = [fixture.churchAId, fixture.churchBId];

  await db
    .delete(communicationRecipients)
    .where(inArray(communicationRecipients.churchId, churchIds));
  await db
    .delete(communications)
    .where(inArray(communications.churchId, churchIds));
  await db.delete(tasks).where(inArray(tasks.churchId, churchIds));
  await db.delete(persons).where(inArray(persons.churchId, churchIds));
  await db.delete(users).where(eq(users.id, fixture.userId));
  await db.delete(churches).where(inArray(churches.id, churchIds));
}

async function entriesFor(churchId: string, taskId: string) {
  return db
    .select({
      status: communications.status,
      subject: communications.subject,
      body: communications.body,
      sentAt: communications.sentAt,
      personId: communicationRecipients.personId,
    })
    .from(communicationRecipients)
    .innerJoin(
      communications,
      eq(communicationRecipients.communicationId, communications.id)
    )
    .where(
      and(
        eq(communicationRecipients.churchId, churchId),
        eq(communicationRecipients.externalId, taskEntryReference(taskId))
      )
    );
}

test("a completed follow-up task lands in that person's communication log", async (t: TestContext) => {
  if (!(await databaseReachable())) {
    return t.skip(
      "SKIPPED — the live COM-020 assertions did NOT run. No reachable DATABASE_URL (this is the case on CI). Run in a worktree with .env.local linked: scripts/worktree-env.sh"
    );
  }

  const fixture = await seed(`__t83-${randomUUID().slice(0, 8)}`);
  const completedAt = new Date("2026-08-09T15:30:00.000Z");

  try {
    const taskId = await seedCompletedTask(fixture, {
      churchId: fixture.churchAId,
      title: `Follow up with Sarah ${fixture.prefix}`,
      relatedType: "person",
      relatedId: fixture.personAId,
      completedAt,
    });

    await fireTaskCompleted({
      taskId,
      churchId: fixture.churchAId,
      category: "follow_up",
      relatedType: "person",
      relatedId: fixture.personAId,
      completedById: fixture.userId,
    });

    // --- AC1: it is in the log the person's page reads --------------------
    const log = await getPersonCommunications(
      fixture.churchAId,
      fixture.personAId
    );
    assert.equal(log.length, 1, "expected exactly one communication log entry");

    // --- AC2: what the task was, when it completed, and not an email ------
    const [{ communication }] = log;
    assert.equal(
      communication.status,
      LOGGED_ENTRY_STATUS,
      "a logged contact must be distinguishable from a sent email"
    );
    assert.notEqual(communication.status, "sent");
    assert.equal(
      communication.subject,
      `Follow up with Sarah ${fixture.prefix}`
    );
    assert.equal(
      communication.sentAt?.toISOString(),
      completedAt.toISOString(),
      "the entry is stamped with the moment the task completed"
    );
    assert.match(communication.body, /No message was sent/);

    // --- the risk note: the phase engine still got its dirty mark ---------
    const [church] = await db
      .select({ lastMaterialEventAt: churches.lastMaterialEventAt })
      .from(churches)
      .where(eq(churches.id, fixture.churchAId));
    assert.ok(
      church.lastMaterialEventAt,
      "the same task.completed must still mark the plant dirty (PE-010)"
    );
  } finally {
    await cleanup(fixture);
  }
});

test("replaying task.completed adds no second entry", async (t: TestContext) => {
  if (!(await databaseReachable())) {
    return t.skip("SKIPPED — no reachable DATABASE_URL (CI). See file header.");
  }

  const fixture = await seed(`__t83-${randomUUID().slice(0, 8)}`);

  try {
    const taskId = await seedCompletedTask(fixture, {
      churchId: fixture.churchAId,
      title: `Follow up twice ${fixture.prefix}`,
      relatedType: "person",
      relatedId: fixture.personAId,
      completedAt: new Date("2026-08-09T15:30:00.000Z"),
    });

    const event = {
      taskId,
      churchId: fixture.churchAId,
      category: "follow_up",
      relatedType: "person",
      relatedId: fixture.personAId,
      completedById: fixture.userId,
    };

    await fireTaskCompleted(event);
    await fireTaskCompleted(event);

    const entries = await entriesFor(fixture.churchAId, taskId);
    assert.equal(entries.length, 1, "a replayed event must not duplicate");

    const log = await getPersonCommunications(
      fixture.churchAId,
      fixture.personAId
    );
    assert.equal(log.length, 1);
  } finally {
    await cleanup(fixture);
  }
});

test("a completed task that is not about a person logs nothing", async (t: TestContext) => {
  if (!(await databaseReachable())) {
    return t.skip("SKIPPED — no reachable DATABASE_URL (CI). See file header.");
  }

  const fixture = await seed(`__t83-${randomUUID().slice(0, 8)}`);

  try {
    const meetingTaskId = await seedCompletedTask(fixture, {
      churchId: fixture.churchAId,
      title: `Book the room ${fixture.prefix}`,
      relatedType: "meeting",
      // A meeting id is not seeded; `related_id` is a bare uuid column with no
      // FK, and the handler must refuse on `related_type` alone anyway.
      relatedId: randomUUID(),
      completedAt: new Date("2026-08-09T15:30:00.000Z"),
    });
    const looseTaskId = await seedCompletedTask(fixture, {
      churchId: fixture.churchAId,
      title: `Buy chairs ${fixture.prefix}`,
      category: "administrative",
      relatedType: null,
      relatedId: null,
      completedAt: new Date("2026-08-09T15:30:00.000Z"),
    });

    await fireTaskCompleted({
      taskId: meetingTaskId,
      churchId: fixture.churchAId,
      category: "vision_meeting",
      relatedType: "meeting",
      relatedId: randomUUID(),
      completedById: fixture.userId,
    });
    await fireTaskCompleted({
      taskId: looseTaskId,
      churchId: fixture.churchAId,
      category: "administrative",
      relatedType: null,
      relatedId: null,
      completedById: fixture.userId,
    });

    const written = await db
      .select({ id: communications.id })
      .from(communications)
      .where(eq(communications.churchId, fixture.churchAId));

    assert.equal(
      written.length,
      0,
      "only a task attached to a person may write a communication log entry"
    );
  } finally {
    await cleanup(fixture);
  }
});

test("an event may not log against a person in another church", async (t: TestContext) => {
  if (!(await databaseReachable())) {
    return t.skip("SKIPPED — no reachable DATABASE_URL (CI). See file header.");
  }

  const fixture = await seed(`__t83-${randomUUID().slice(0, 8)}`);

  try {
    // The task belongs to church A; the person named on it belongs to church B.
    const taskId = await seedCompletedTask(fixture, {
      churchId: fixture.churchAId,
      title: `Cross-tenant ${fixture.prefix}`,
      relatedType: "person",
      relatedId: fixture.personBId,
      completedAt: new Date("2026-08-09T15:30:00.000Z"),
    });

    await fireTaskCompleted({
      taskId,
      churchId: fixture.churchAId,
      category: "follow_up",
      relatedType: "person",
      relatedId: fixture.personBId,
      completedById: fixture.userId,
    });

    assert.equal(
      (await entriesFor(fixture.churchAId, taskId)).length,
      0,
      "church A must not log against church B's person"
    );
    assert.equal(
      (await getPersonCommunications(fixture.churchBId, fixture.personBId))
        .length,
      0,
      "church B's person must not receive an entry either"
    );
  } finally {
    await cleanup(fixture);
  }
});
