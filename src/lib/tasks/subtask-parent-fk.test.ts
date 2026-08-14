import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";

import { eq, like, sql } from "drizzle-orm";

import { db } from "@/db";
import { churches, tasks, users } from "@/db/schema";

// ----------------------------------------------------------------------------
// #405 D5 — `tasks.parent_task_id` is a self-FK with ON DELETE CASCADE
// (migration 0038). Two facts, and neither is observable without a database:
//
//   1. A parent id naming no task is now UNREPRESENTABLE. Before the FK the
//      column was a bare uuid, so `createTask`'s `assertSubtaskNesting` was the
//      only thing between a forged `parentTaskId` and a row nothing renders — a
//      subtask is filtered out of `/tasks` by `topLevelTasksOnly()` and
//      reachable only through its parent's detail view, so it was live work
//      counted by `getTaskCounts` that no surface could show or close.
//   2. A HARD delete of a parent takes its children with it, rather than
//      leaving them or failing the delete.
//
// A referential constraint is enforced by Postgres or by nothing, so this is
// OPT-IN against a real database: `LIVE_DB_TESTS=1 pnpm test`. Same convention,
// flag and reachability probe as `teams-init-race.test.ts` — `DATABASE_URL` is
// deliberately not the signal, because CI sets an unreachable placeholder.
//
// The hermetic half (the schema still DECLARES the cascade, and the migration
// nulls dangling parents before validating it) is
// `src/db/schema/ruled-guards.test.ts`, which runs on every `pnpm test`.
//
// SOFT DELETES ARE UNAFFECTED and that is asserted below: `deleteTask` stamps
// `deleted_at`, which Postgres sees as an ordinary UPDATE, so the application's
// own parent+children clause is still doing the work there.
//
// Everything written here is namespaced by `SCRATCH_NAME` and swept in `after`.
// ----------------------------------------------------------------------------

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test` with a reachable DATABASE_URL — a foreign key is enforced by Postgres or by nothing";

const UNREACHABLE =
  "SKIPPED — LIVE_DB_TESTS=1 was set but DATABASE_URL points at no reachable Postgres, so the constraint was NOT exercised";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

const SCRATCH_NAME = "__t405 subtask parent fk scratch__";

async function sweep(): Promise<void> {
  const scratch = await db
    .select({ id: churches.id })
    .from(churches)
    .where(like(churches.name, SCRATCH_NAME));

  for (const church of scratch) {
    await db.delete(tasks).where(eq(tasks.churchId, church.id));
    await db.delete(users).where(eq(users.churchId, church.id));
    await db.delete(churches).where(eq(churches.id, church.id));
  }
}

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweep();
});

async function createScratchPlant(): Promise<{
  churchId: string;
  userId: string;
}> {
  const [church] = await db
    .insert(churches)
    .values({ name: SCRATCH_NAME, currentPhase: 3 })
    .returning({ id: churches.id });

  const [user] = await db
    .insert(users)
    .values({
      email: `${crypto.randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: SCRATCH_NAME,
      role: "planter",
      churchId: church.id,
    })
    .returning({ id: users.id });

  return { churchId: church.id, userId: user.id };
}

test(
  "a subtask whose parent names no task is refused by the database",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    await sweep();
    const { churchId, userId } = await createScratchPlant();

    await assert.rejects(
      () =>
        db.insert(tasks).values({
          churchId,
          title: "Orphan",
          createdById: userId,
          // A parent that does not exist — a forged id, or a parent deleted
          // between the nesting check and the insert.
          parentTaskId: crypto.randomUUID(),
        }),
      (error: unknown) => {
        const text = [
          error instanceof Error ? error.message : String(error),
          error instanceof Error && error.cause instanceof Error
            ? error.cause.message
            : "",
        ].join(" ");
        assert.match(text, /tasks_parent_task_id_tasks_id_fk/);
        return true;
      },
      "an orphan subtask must be refused — application code is not the guard"
    );

    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.churchId, churchId));
    assert.equal(n, 0, "the refused insert wrote a row anyway");
  }
);

test(
  "a HARD delete of a parent takes its checklist with it; a soft delete does not",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    await sweep();
    const { churchId, userId } = await createScratchPlant();

    const [parent] = await db
      .insert(tasks)
      .values({ churchId, title: "Parent", createdById: userId })
      .returning({ id: tasks.id });

    await db.insert(tasks).values([
      {
        churchId,
        title: "Item one",
        createdById: userId,
        parentTaskId: parent.id,
      },
      {
        churchId,
        title: "Item two",
        createdById: userId,
        parentTaskId: parent.id,
      },
    ]);

    // A soft delete is an UPDATE, so the cascade does not fire — the rows are
    // still there, which is exactly why `deleteTask` stamps the children too.
    await db
      .update(tasks)
      .set({ deletedAt: new Date() })
      .where(eq(tasks.id, parent.id));

    const [{ afterSoft }] = await db
      .select({ afterSoft: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.churchId, churchId));
    assert.equal(
      afterSoft,
      3,
      "a soft delete must not remove rows — the cascade fires on DELETE only"
    );

    await db.delete(tasks).where(eq(tasks.id, parent.id));

    const [{ afterHard }] = await db
      .select({ afterHard: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.churchId, churchId));
    assert.equal(
      afterHard,
      0,
      "the children survived a hard delete of their parent, or blocked it"
    );
  }
);
