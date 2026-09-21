import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { neonConfig } from "@neondatabase/serverless";

function latch() {
  let release!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolve, refuse) => {
    release = resolve;
    reject = refuse;
  });
  const timer = setTimeout(
    () => reject(new Error("Proof barrier timed out")),
    15000
  );
  promise.then(
    () => clearTimeout(timer),
    () => clearTimeout(timer)
  );
  return { promise, release };
}
async function main() {
  // This proof is destructive only to its fresh UUID-owned fixture. Never point
  // it at a hosted database or preload a credentials file.
  const url = new URL(process.env.DATABASE_URL ?? "invalid:");
  const proxy = new URL(process.env.NEON_HTTP_PROXY_URL ?? "invalid:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(proxy.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/main");
  neonConfig.fetchEndpoint = () => proxy.toString();
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const requested = new URL(
      input instanceof Request ? input.url : String(input)
    );
    assert.equal(
      requested.origin,
      proxy.origin,
      "Proof forbids outbound provider requests"
    );
    return nativeFetch(input, { ...init, redirect: "error" });
  };
  let afterResponse:
    | ((body: { query?: string; queries?: unknown[] }) => Promise<void>)
    | undefined;
  neonConfig.fetchFunction = async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit
  ) => {
    const response = await fetch(input, {
      ...init,
      signal: AbortSignal.timeout(20000),
    });
    if (afterResponse && typeof init?.body === "string")
      await afterResponse(JSON.parse(init.body));
    return response;
  };
  const { db } = await import("../src/db/index");
  const { churches, users, tasks, taskDependencies } =
    await import("../src/db/schema/index");
  const { and, eq, sql } = await import("drizzle-orm");
  const { setTaskPrerequisites } =
    await import("../src/lib/tasks/dependencies");
  const {
    completeTask,
    ActiveTaskOccurrenceError,
    reopenTask,
    defaultBulkTaskDeps,
    createNextRecurrence,
    defaultRecurrenceDeps,
    deleteTask,
  } = await import("../src/lib/tasks/service");
  const { taskStructureLockStatement } =
    await import("../src/lib/tasks/structure-lock");
  const ownership = randomUUID();
  const [plant] = await db
    .insert(churches)
    .values({ name: `Native concurrency ${ownership}` })
    .returning();
  const [actor] = await db
    .insert(users)
    .values({
      email: `${ownership}@example.test`,
      passwordHash: "never-login",
      name: "Native proof",
      churchId: plant.id,
      seat: "owner",
    })
    .returning();
  const evidence: string[] = [];
  const fresh = async (extra: Partial<typeof tasks.$inferInsert> = {}) =>
    (
      await db
        .insert(tasks)
        .values({
          churchId: plant.id,
          createdById: actor.id,
          title: ownership,
          ...extra,
        })
        .returning()
    )[0]!;
  try {
    // Both requests begin together. The database trigger must refuse an edge
    // that closes a cycle even when the JS preflight saw an empty graph.
    const a = await fresh();
    const b = await fresh();
    const preflights = latch();
    let reads = 0;
    afterResponse = async (body) => {
      if (body.query?.startsWith('select "task_dependencies"."task_id"')) {
        if (++reads === 2) preflights.release();
        await preflights.promise;
      }
    };
    const edges = await Promise.allSettled([
      setTaskPrerequisites(plant.id, a.id, [b.id]),
      setTaskPrerequisites(plant.id, b.id, [a.id]),
    ]);
    afterResponse = undefined;
    assert.equal(reads, 2);
    assert.equal(edges.filter((r) => r.status === "fulfilled").length, 1);
    const edgeLoser = edges.find(
      (r) => r.status === "rejected"
    ) as PromiseRejectedResult;
    assert.equal(
      (edgeLoser.reason.cause ?? edgeLoser.reason).constraint,
      "task_dependencies_cycle_guard"
    );
    assert.equal(
      (
        await db
          .select()
          .from(taskDependencies)
          .where(eq(taskDependencies.churchId, plant.id))
      ).length,
      1
    );
    evidence.push(
      "opposite dependency writes: one winner, one refusal, one edge"
    );
    const c = await fresh();
    const d = await fresh();
    const target = await fresh();
    const committed = latch();
    const deliver = latch();
    let held = false;
    afterResponse = async (body) => {
      if (body.queries && !held) {
        held = true;
        committed.release();
        await deliver.promise;
      }
    };
    const firstReplace = setTaskPrerequisites(plant.id, target.id, [c.id]);
    firstReplace.catch(() => {
      committed.release();
      deliver.release();
    });
    await committed.promise;
    try {
      await setTaskPrerequisites(plant.id, target.id, [d.id]);
    } finally {
      deliver.release();
    }
    await firstReplace;
    afterResponse = undefined;
    const stored = await db
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.taskId, target.id));
    assert.deepEqual(
      stored.map((row) => row.prerequisiteTaskId),
      [d.id]
    );
    evidence.push(
      "postcommit response held across second replacement: both callers succeed, final set belongs to second writer"
    );
    const ordinary = await fresh();
    const completed = await Promise.allSettled([
      completeTask(plant.id, ordinary.id, actor),
      completeTask(plant.id, ordinary.id, actor),
    ]);
    assert.equal(completed.filter((r) => r.status === "fulfilled").length, 1);
    const completionLoser = completed.find(
      (r) => r.status === "rejected"
    ) as PromiseRejectedResult;
    assert.equal(completionLoser.reason.message, "Task is already complete");
    await reopenTask(plant.id, ordinary.id, actor);
    // The holder owns the advisory lock but has not touched the row. If a
    // waiter takes the row first, the holder's UPDATE will form a deadlock.
    const holder = db.batch([
      taskStructureLockStatement(plant.id),
      db.execute(sql`select pg_sleep(3)`),
      db
        .update(tasks)
        .set({ title: ownership })
        .where(eq(tasks.id, ordinary.id)),
    ]);
    const holding = Promise.resolve(holder);
    async function waitForActivity(fragment: string, advisory = false) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const activity = await db.execute(
          sql`select query from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and state='active' and query like ${fragment} and (${advisory} = false or (wait_event_type='Lock' and wait_event='advisory' and exists (select 1 from pg_locks waiting join pg_locks holder on holder.locktype=waiting.locktype and holder.database=waiting.database and holder.classid=waiting.classid and holder.objid=waiting.objid and holder.objsubid=waiting.objsubid where waiting.pid=pg_stat_activity.pid and not waiting.granted and holder.granted and holder.pid<>waiting.pid)))`
        );
        if (activity.rows.length) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Activity was not observed: ${fragment}`);
    }
    await waitForActivity("select pg_sleep(3)%");
    const waiting = defaultBulkTaskDeps.completeMany(
      plant.id,
      [ordinary.id],
      actor.id
    );
    await waitForActivity("select lock_task_structure(%", true);
    await Promise.all([holding, waiting]);
    await reopenTask(plant.id, ordinary.id, actor);
    await defaultBulkTaskDeps.rescheduleMany(
      plant.id,
      [ordinary.id],
      "2026-10-01"
    );
    evidence.push(
      "observed advisory-lock waiter before holder row write: bulk completion avoids lock inversion; reopen/reschedule succeed"
    );
    const seriesId = randomUUID();
    const recur = {
      status: "complete" as const,
      isRecurring: true,
      dueDate: "2026-09-21",
      recurrenceRule: { interval: "weekly", seriesId },
    };
    const first = await fresh(recur);
    const second = await fresh(recur);
    await fresh({
      parentTaskId: first.id,
      title: "checked",
      status: "complete",
    });
    await fresh({
      parentTaskId: second.id,
      title: "checked",
      status: "complete",
    });
    let arrivals = 0;
    const gate = latch();
    const deps = {
      ...defaultRecurrenceDeps,
      async findOpenInSeries(churchId: string, series: string) {
        const found = await defaultRecurrenceDeps.findOpenInSeries(
          churchId,
          series
        );
        if (++arrivals === 2) gate.release();
        await gate.promise;
        return found;
      },
    };
    const recurred = await Promise.allSettled([
      createNextRecurrence(first, "2026-09-21", deps),
      createNextRecurrence(second, "2026-09-21", deps),
    ]);
    assert.equal(recurred.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = recurred.find(
      (r) => r.status === "rejected"
    ) as PromiseRejectedResult;
    const error = rejected.reason.cause ?? rejected.reason;
    assert.equal(error.constraint, "tasks_open_recurrence_series_unique_idx");
    const rows = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, plant.id),
          sql`${tasks.recurrenceRule}->>'seriesId' = ${seriesId}`,
          eq(tasks.status, "not_started")
        )
      );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.dueDate, "2026-09-28");
    const children = await db
      .select()
      .from(tasks)
      .where(eq(tasks.parentTaskId, rows[0]!.id));
    assert.equal(children.length, 1);
    assert.equal(children[0]!.status, "not_started");
    evidence.push(
      "barrier-forced series race: exact unique refusal, one weekly successor and one unticked checklist"
    );
    await assert.rejects(reopenTask(plant.id, first.id, actor), (error) => {
      assert.ok(error instanceof ActiveTaskOccurrenceError);
      assert.ok(error.message.includes(rows[0]!.title));
      assert.ok(error.message.includes("2026-09-28"));
      assert.ok(
        error.message.includes("Continue with that occurrence in Tasks")
      );
      return true;
    });
    const [stillComplete] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, first.id));
    assert.equal(stillComplete!.status, "complete");
    await deleteTask(plant.id, rows[0]!.id);
    await reopenTask(plant.id, first.id, actor);
    const [reopenedPredecessor] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, first.id));
    assert.equal(reopenedPredecessor!.status, "not_started");
    evidence.push(
      "real recurrence index: reopen names active successor and preserves completed predecessor; succeeds after successor deletion"
    );
    const parent = await fresh();
    const child = await fresh({ parentTaskId: parent.id });
    const hierarchy = await Promise.allSettled([
      deleteTask(plant.id, parent.id),
      db.batch([
        taskStructureLockStatement(plant.id),
        db
          .update(tasks)
          .set({ parentTaskId: parent.id })
          .where(eq(tasks.id, c.id)),
      ]),
    ]);
    assert.ok(hierarchy.some((r) => r.status === "fulfilled"));
    const orphan = await db.execute(
      sql`select c.id from tasks c left join tasks p on p.id=c.parent_task_id where c.church_id=${plant.id}::uuid and c.deleted_at is null and c.parent_task_id is not null and (p.deleted_at is not null or p.id is null or p.parent_task_id is not null)`
    );
    assert.equal(orphan.rows.length, 0);
    assert.ok(child.id);
    evidence.push("parent deletion versus reparenting: no live orphan");
  } finally {
    await db
      .delete(taskDependencies)
      .where(eq(taskDependencies.churchId, plant.id));
    await db.delete(tasks).where(eq(tasks.churchId, plant.id));
    await db.delete(users).where(eq(users.id, actor.id));
    await db.delete(churches).where(eq(churches.id, plant.id));
  }
  console.log(
    JSON.stringify(
      {
        ownership,
        passed: evidence,
        cleanup: "deleted owned plant, user, tasks and dependencies",
      },
      null,
      2
    )
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
