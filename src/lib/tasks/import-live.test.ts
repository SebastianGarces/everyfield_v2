import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";

import { asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { churches, tasks, users } from "@/db/schema";

import {
  UNKNOWN_TEMPLATE_ERROR,
  importTaskTemplate,
  planTemplateImport,
} from "./import";
import { findTaskTemplate, taskTemplateItemPriority } from "./templates";

// ----------------------------------------------------------------------------
// T-012 — the half that EXECUTES against a database.
//
// `import.test.ts` proves the schedule; this file proves the rows. It seeds a
// church and a planter, imports through the same function the server action
// calls, and reads the tasks back with a plain SELECT — so the assertions are
// about what is in the table, not about what the code returned.
//
// ⚠ THIS FILE SKIPS WHEN DATABASE_URL POINTS NOWHERE, AND IT DOES ON CI.
// A green PR check means the pure half held. The DB evidence comes from
// running this where a real database is configured:
//
//     pnpm exec tsx --env-file-if-exists=.env.local --test "src/lib/tasks/import*.test.ts"
//
// and `skipped 0` in that output is the line worth quoting.
// ----------------------------------------------------------------------------

const TEMPLATE_KEY = "post-meeting-follow-up";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

interface Fixture {
  churchId: string;
  otherChurchId: string;
  userId: string;
}

async function seed(prefix: string): Promise<Fixture> {
  const [church, otherChurch] = await db
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
      churchId: church.id,
    })
    .returning({ id: users.id });

  return {
    churchId: church.id,
    otherChurchId: otherChurch.id,
    userId: user.id,
  };
}

async function cleanup(fixture: Fixture): Promise<void> {
  const churchIds = [fixture.churchId, fixture.otherChurchId];
  await db.delete(tasks).where(inArray(tasks.churchId, churchIds));
  await db.delete(users).where(eq(users.id, fixture.userId));
  await db.delete(churches).where(inArray(churches.id, churchIds));
}

/** Straight from the table — no service read in the way. */
async function tasksOf(churchId: string) {
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      category: tasks.category,
      dueDate: tasks.dueDate,
      assignedToId: tasks.assignedToId,
      createdById: tasks.createdById,
      parentTaskId: tasks.parentTaskId,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(eq(tasks.churchId, churchId))
    .orderBy(asc(tasks.createdAt));
}

const SKIP_NOTE =
  "SKIPPED — the live T-012 assertions did NOT run. No reachable DATABASE_URL (this is the case on CI). Run in a worktree with .env.local linked: scripts/worktree-env.sh";

test("importing a template creates its tasks for the current church", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t313-${randomUUID().slice(0, 8)}`);
  const template = findTaskTemplate(TEMPLATE_KEY);
  assert.ok(template);

  try {
    const importedAt = new Date("2026-03-02T09:15:00.000Z");
    const result = await importTaskTemplate({
      churchId: fixture.churchId,
      userId: fixture.userId,
      templateKey: TEMPLATE_KEY,
      importedAt,
    });

    assert.equal(result.created.length, template.items.length);

    const rows = await tasksOf(fixture.churchId);
    assert.equal(rows.length, template.items.length);

    // Nothing landed in the other church. The import writes the church id it
    // was handed, and the action mints that from the session.
    assert.equal((await tasksOf(fixture.otherChurchId)).length, 0);

    const plan = planTemplateImport(template, importedAt);
    for (const [index, planned] of plan.tasks.entries()) {
      const row = rows[index];
      assert.equal(row.title, planned.title);
      assert.equal(row.description, planned.description);
      assert.equal(row.dueDate, planned.dueDate);
      assert.equal(row.status, "not_started");
      assert.equal(row.parentTaskId, null);
      // Top-level tasks, not a checklist on one task: `topLevelTasksOnly()`
      // would hide an imported set from the list and the badges alike.
    }
  } finally {
    await cleanup(fixture);
  }
});

test("imported tasks carry the template's category and priority", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t313-${randomUUID().slice(0, 8)}`);
  const template = findTaskTemplate(TEMPLATE_KEY);
  assert.ok(template);

  try {
    await importTaskTemplate({
      churchId: fixture.churchId,
      userId: fixture.userId,
      templateKey: TEMPLATE_KEY,
      importedAt: new Date("2026-03-02T09:15:00.000Z"),
    });

    const rows = await tasksOf(fixture.churchId);

    for (const [index, item] of template.items.entries()) {
      assert.equal(
        rows[index].category,
        template.category,
        `${item.key} was stored with category ${rows[index].category}`
      );
      assert.equal(
        rows[index].priority,
        taskTemplateItemPriority(template, item),
        `${item.key} was stored with priority ${rows[index].priority}`
      );
    }

    // Assigned to whoever imported it — an unassigned import reaches no "My
    // tasks" view, which is the hole #370 found under subtasks.
    for (const row of rows) {
      assert.equal(row.assignedToId, fixture.userId);
      assert.equal(row.createdById, fixture.userId);
    }
  } finally {
    await cleanup(fixture);
  }
});

test("the same template on two dates lands two different sets of due dates", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t313-${randomUUID().slice(0, 8)}`);
  const template = findTaskTemplate(TEMPLATE_KEY);
  assert.ok(template);

  try {
    const spring = await importTaskTemplate({
      churchId: fixture.churchId,
      userId: fixture.userId,
      templateKey: TEMPLATE_KEY,
      importedAt: new Date("2026-03-02T09:15:00.000Z"),
    });
    const autumn = await importTaskTemplate({
      churchId: fixture.churchId,
      userId: fixture.userId,
      templateKey: TEMPLATE_KEY,
      importedAt: new Date("2026-09-14T09:15:00.000Z"),
    });

    assert.equal(spring.importedOn, "2026-03-02");
    assert.equal(autumn.importedOn, "2026-09-14");

    for (const [index, springTask] of spring.created.entries()) {
      assert.notEqual(springTask.dueDate, autumn.created[index].dueDate);
    }

    // Neither set is a subset of the other: both are in the table in full.
    const rows = await tasksOf(fixture.churchId);
    assert.equal(rows.length, template.items.length * 2);
  } finally {
    await cleanup(fixture);
  }
});

test("importing twice creates two sets — nothing is silently deduped", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t313-${randomUUID().slice(0, 8)}`);
  const template = findTaskTemplate(TEMPLATE_KEY);
  assert.ok(template);

  try {
    const importedAt = new Date("2026-03-02T09:15:00.000Z");
    const first = await importTaskTemplate({
      churchId: fixture.churchId,
      userId: fixture.userId,
      templateKey: TEMPLATE_KEY,
      importedAt,
    });
    const second = await importTaskTemplate({
      churchId: fixture.churchId,
      userId: fixture.userId,
      templateKey: TEMPLATE_KEY,
      importedAt,
    });

    // Same day, same template: identical titles and dates, distinct rows.
    assert.equal(second.created.length, first.created.length);

    const rows = await tasksOf(fixture.churchId);
    assert.equal(rows.length, template.items.length * 2);

    const ids = new Set(rows.map((row) => row.id));
    assert.equal(ids.size, rows.length);

    for (const [index, item] of template.items.entries()) {
      assert.equal(first.created[index].title, item.title);
      assert.equal(second.created[index].title, item.title);
      assert.equal(first.created[index].dueDate, second.created[index].dueDate);
      assert.notEqual(first.created[index].id, second.created[index].id);
    }
  } finally {
    await cleanup(fixture);
  }
});

test("checklist order survives one multi-row insert", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t313-${randomUUID().slice(0, 8)}`);
  const template = findTaskTemplate(TEMPLATE_KEY);
  assert.ok(template);

  try {
    await importTaskTemplate({
      churchId: fixture.churchId,
      userId: fixture.userId,
      templateKey: TEMPLATE_KEY,
      importedAt: new Date("2026-03-02T09:15:00.000Z"),
    });

    // One INSERT stamps every default `created_at` with the same transaction
    // timestamp, which would leave catalog order to a random-UUID tiebreak.
    // The rows are stamped a millisecond apart, so ordering by `created_at`
    // returns the template's own order.
    const rows = await tasksOf(fixture.churchId);
    assert.deepEqual(
      rows.map((row) => row.title),
      template.items.map((item) => item.title)
    );

    const stamps = rows.map((row) => row.createdAt.getTime());
    assert.equal(new Set(stamps).size, stamps.length);
  } finally {
    await cleanup(fixture);
  }
});

test("an unknown template key writes nothing", async (t: TestContext) => {
  if (!(await databaseReachable())) return t.skip(SKIP_NOTE);

  const fixture = await seed(`__t313-${randomUUID().slice(0, 8)}`);

  try {
    await assert.rejects(
      () =>
        importTaskTemplate({
          churchId: fixture.churchId,
          userId: fixture.userId,
          templateKey: "no-such-template",
        }),
      new RegExp(UNKNOWN_TEMPLATE_ERROR)
    );

    assert.equal((await tasksOf(fixture.churchId)).length, 0);
  } finally {
    await cleanup(fixture);
  }
});
