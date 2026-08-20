import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { churches, taskDependencies, tasks, users } from "@/db/schema";

import {
  DEPENDENCY_CROSS_CHURCH_ERROR,
  DEPENDENCY_CYCLE_ERROR,
  setTaskPrerequisites,
} from "./dependencies";

// ----------------------------------------------------------------------------
// T-015 — the half that EXECUTES against a database.
//
// The hermetic suite pins the cycle walk and the insert…select SQL. This file
// pins the ROWS: an edge lands, a cycle is refused, and a foreign church's
// task is refused. Assertions read `task_dependencies` with a plain SELECT.
//
// ⚠ THIS FILE SKIPS WHEN DATABASE_URL POINTS NOWHERE, AND IT DOES ON CI.
// A green PR check means the pure half held. The DB evidence comes from
// running this where a real database is configured (and 0048 has been
// applied):
//
//     pnpm exec tsx --env-file-if-exists=.env.local --test "src/lib/tasks/dependencies*.test.ts"
// ----------------------------------------------------------------------------

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1 from task_dependencies limit 0`);
    return true;
  } catch {
    return false;
  }
}

const SKIP_NOTE =
  "SKIPPED — the live T-015 assertions did NOT run. No reachable DATABASE_URL, or migration 0048 has not been applied. Run `pnpm db:migrate` in a worktree with .env.local linked.";

interface Fixture {
  churchId: string;
  otherChurchId: string;
  userId: string;
  otherUserId: string;
}

async function seed(prefix: string): Promise<Fixture> {
  const [church, otherChurch] = await db
    .insert(churches)
    .values([{ name: `${prefix} A` }, { name: `${prefix} B` }])
    .returning({ id: churches.id });

  const [user, otherUser] = await db
    .insert(users)
    .values([
      {
        email: `${prefix}-a@example.test`,
        passwordHash: "not-a-real-hash",
        name: `${prefix} planter A`,
        seat: "owner",
        churchId: church.id,
      },
      {
        email: `${prefix}-b@example.test`,
        passwordHash: "not-a-real-hash",
        name: `${prefix} planter B`,
        seat: "owner",
        churchId: otherChurch.id,
      },
    ])
    .returning({ id: users.id });

  return {
    churchId: church.id,
    otherChurchId: otherChurch.id,
    userId: user.id,
    otherUserId: otherUser.id,
  };
}

async function cleanup(fixture: Fixture): Promise<void> {
  const churchIds = [fixture.churchId, fixture.otherChurchId];
  await db
    .delete(taskDependencies)
    .where(inArray(taskDependencies.churchId, churchIds));
  await db.delete(tasks).where(inArray(tasks.churchId, churchIds));
  await db
    .delete(users)
    .where(inArray(users.id, [fixture.userId, fixture.otherUserId]));
  await db.delete(churches).where(inArray(churches.id, churchIds));
}

async function createTask(
  fixture: Fixture,
  title: string,
  churchId = fixture.churchId,
  userId = fixture.userId
) {
  const [row] = await db
    .insert(tasks)
    .values({
      churchId,
      title,
      createdById: userId,
    })
    .returning({ id: tasks.id });
  return row.id;
}

async function edgesOf(churchId: string, taskId: string) {
  return db
    .select({
      taskId: taskDependencies.taskId,
      prerequisiteTaskId: taskDependencies.prerequisiteTaskId,
      churchId: taskDependencies.churchId,
    })
    .from(taskDependencies)
    .where(
      and(
        eq(taskDependencies.churchId, churchId),
        eq(taskDependencies.taskId, taskId)
      )
    );
}

test("a task can declare one or more prerequisite tasks — the edge rows exist", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t015-${randomUUID().slice(0, 8)}`);

  try {
    const dependent = await createTask(fixture, "Print flyers");
    const first = await createTask(fixture, "Book the room");
    const second = await createTask(fixture, "Confirm the speaker");

    await setTaskPrerequisites(fixture.churchId, dependent, [first, second]);

    const rows = await edgesOf(fixture.churchId, dependent);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => row.prerequisiteTaskId).toSorted(),
      [first, second].toSorted()
    );
    for (const row of rows) {
      assert.equal(row.taskId, dependent);
      assert.equal(row.churchId, fixture.churchId);
    }
  } finally {
    await cleanup(fixture);
  }
});

test("a cycle A→B→A is rejected at write time", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t015-${randomUUID().slice(0, 8)}`);

  try {
    const taskA = await createTask(fixture, "A");
    const taskB = await createTask(fixture, "B");

    await setTaskPrerequisites(fixture.churchId, taskA, [taskB]);

    await assert.rejects(
      () => setTaskPrerequisites(fixture.churchId, taskB, [taskA]),
      new RegExp(DEPENDENCY_CYCLE_ERROR)
    );

    assert.equal((await edgesOf(fixture.churchId, taskB)).length, 0);
    assert.equal((await edgesOf(fixture.churchId, taskA)).length, 1);
  } finally {
    await cleanup(fixture);
  }
});

test("a task cannot depend on another church's task", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t015-${randomUUID().slice(0, 8)}`);

  try {
    const mine = await createTask(fixture, "Our task");
    const theirs = await createTask(
      fixture,
      "Their task",
      fixture.otherChurchId,
      fixture.otherUserId
    );

    await assert.rejects(
      () => setTaskPrerequisites(fixture.churchId, mine, [theirs]),
      new RegExp(DEPENDENCY_CROSS_CHURCH_ERROR)
    );

    assert.equal((await edgesOf(fixture.churchId, mine)).length, 0);
    assert.equal((await edgesOf(fixture.otherChurchId, mine)).length, 0);
  } finally {
    await cleanup(fixture);
  }
});
