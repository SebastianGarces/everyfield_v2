/** Real database/action proof plus browser fixtures. Requires an owned preview database. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mock } from "node:test";
import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  churches,
  users,
  persons,
  churchMeetings,
  ministryTeams,
  tasks,
  type User,
} from "@/db/schema";
import { UnauthorizedError } from "@/lib/auth/unauthorized";

async function main() {
  const database = new URL(process.env.DATABASE_URL!);
  assert.match(
    process.env.TASKS_AUDIT_DATABASE ?? "",
    /^ef_preview_[a-f0-9]{12}$/
  );
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  assert.equal(database.hostname, "localhost");
  assert.equal(database.pathname, `/${process.env.TASKS_AUDIT_DATABASE}`);
  const output = process.env.TASKS_AUDIT_FIXTURE_PATH;
  assert.ok(output, "private fixture output is required");
  assert.ok(
    output.startsWith("/private/tmp/"),
    "private fixture output is required"
  );
  let actor: User | null = null;
  mock.module("@/lib/auth/session", {
    namedExports: {
      verifySession: async () => {
        if (!actor) throw new UnauthorizedError();
        return { user: actor };
      },
    },
  });
  mock.module("next/cache", {
    namedExports: { refresh() {}, revalidatePath() {} },
  });
  mock.module("next/navigation", {
    namedExports: {
      redirect() {
        throw new Error("redirect");
      },
    },
  });
  const { createTaskAction, updateTaskAction } =
    await import("@/app/(dashboard)/tasks/actions");
  const { readTaskListPage } = await import("@/lib/tasks/list-page");
  const { TASK_SORT_KEYS, getTaskCounts } = await import("@/lib/tasks/service");
  const { listTaskRelationOptions } = await import("@/lib/tasks/relations");
  const { listOpenFollowUpTasks } =
    await import("@/lib/tasks/follow-up-ownership");
  const { filterFollowUpTasks } =
    await import("@/lib/tasks/follow-up-ownership.shared");
  const { parseTaskListSearchParams } = await import("@/lib/tasks/list-params");
  const { taskListScope } = await import("@/lib/tasks/list-page");

  const password = crypto.randomUUID();
  const passwordHash = await hash(password);
  const fixtureKey = crypto.randomUUID().slice(0, 8);
  const plants = await db
    .insert(churches)
    .values([
      {
        name: `Task proof ${fixtureKey}`,
        currentPhase: 2,
        onboardingCompletedAt: new Date(),
      },
      {
        name: `Foreign task proof ${fixtureKey}`,
        currentPhase: 2,
        onboardingCompletedAt: new Date(),
      },
    ])
    .returning();
  const accounts = await db
    .insert(users)
    .values([
      {
        name: "Task Owner",
        email: `task-owner-${fixtureKey}@proof.invalid`,
        seat: "owner",
        churchId: plants[0].id,
        passwordHash,
      },
      {
        name: "Task Member",
        email: `task-member-${fixtureKey}@proof.invalid`,
        seat: "member",
        churchId: plants[0].id,
        passwordHash,
      },
      {
        name: "Foreign Owner",
        email: `task-foreign-${fixtureKey}@proof.invalid`,
        seat: "owner",
        churchId: plants[1].id,
        passwordHash,
      },
    ])
    .returning();
  const [owner, member, foreign] = accounts;
  const people = await db
    .insert(persons)
    .values([
      {
        churchId: plants[0].id,
        firstName: "Ada",
        lastName: "Related",
        status: "core_group",
        userId: owner.id,
        createdBy: owner.id,
      },
      {
        churchId: plants[0].id,
        firstName: "Deleted",
        lastName: "Related",
        deletedAt: new Date(),
        createdBy: owner.id,
      },
      {
        churchId: plants[1].id,
        firstName: "Foreign",
        lastName: "Related",
        createdBy: foreign.id,
      },
    ])
    .returning();
  const meetings = await db
    .insert(churchMeetings)
    .values(
      accounts
        .filter((u) => u.seat === "owner")
        .map((u) => ({
          churchId: u.churchId!,
          type: "orientation" as const,
          title: `${u.name} relation meeting`,
          datetime: new Date("2026-09-20T16:00:00Z"),
          createdBy: u.id,
        }))
    )
    .returning();
  const teams = await db
    .insert(ministryTeams)
    .values(
      accounts
        .filter((u) => u.seat === "owner")
        .map((u) => ({
          churchId: u.churchId!,
          name: `${u.name} relation team`,
          type: "custom" as const,
          createdBy: u.id,
        }))
    )
    .returning();
  writeFileSync(
    output,
    JSON.stringify(
      {
        database: database.pathname,
        password,
        accounts: accounts.map(({ id, email, seat }) => ({ id, email, seat })),
        churches: plants.map((p) => p.id),
        people: people.map((p) => p.id),
        meetings: meetings.map((m) => m.id),
        teams: teams.map((t) => t.id),
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  actor = owner;
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  const options = await listTaskRelationOptions(plants[0].id);
  assert.equal(options.length, 3);
  assert.ok(
    !options.some((o) => o.id === people[1].id || o.id === people[2].id)
  );
  let relationTaskId = "";
  for (const [relatedType, relatedId] of [
    ["person", people[0].id],
    ["meeting", meetings[0].id],
    ["team", teams[0].id],
  ]) {
    const created = await createTaskAction(
      form({ title: `Relation ${relatedType}`, relatedType, relatedId })
    );
    assert.equal(created.success, true, JSON.stringify(created));
    if (!created.success) throw new Error("create failed");
    assert.equal(created.data.relatedId, relatedId);
    relationTaskId = created.data.id;
  }
  for (const [relatedType, relatedId] of [
    ["person", people[1].id],
    ["person", people[2].id],
    ["meeting", meetings[1].id],
    ["team", teams[1].id],
    ["person", crypto.randomUUID()],
    ["person", "bad-id"],
    ["person", ""],
  ]) {
    const result = await createTaskAction(
      form({ title: "Refused relation", relatedType, relatedId })
    );
    assert.equal(result.success, false, JSON.stringify(result));
  }
  assert.equal(
    (
      await updateTaskAction(
        relationTaskId,
        form({ relatedType: "person", relatedId: people[0].id })
      )
    ).success,
    true
  );
  assert.equal(
    (
      await updateTaskAction(
        relationTaskId,
        form({ title: "Preserved relation" })
      )
    ).success,
    true
  );
  let [stored] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, relationTaskId));
  assert.equal(stored.relatedId, people[0].id);
  assert.equal(
    (
      await updateTaskAction(
        relationTaskId,
        form({ relatedType: "meeting", relatedId: meetings[1].id })
      )
    ).success,
    false
  );
  assert.equal(
    (
      await updateTaskAction(
        relationTaskId,
        form({ relatedType: "", relatedId: "" })
      )
    ).success,
    true
  );
  [stored] = await db.select().from(tasks).where(eq(tasks.id, relationTaskId));
  assert.equal(stored.relatedType, null);
  assert.equal(stored.relatedId, null);
  // A partial request racing a complete replacement must not form a mixed pair.
  const [partial, replacement] = await Promise.all([
    updateTaskAction(relationTaskId, form({ relatedId: people[0].id })),
    updateTaskAction(
      relationTaskId,
      form({ relatedType: "team", relatedId: teams[0].id })
    ),
  ]);
  assert.equal(partial.success, false);
  assert.equal(replacement.success, true);
  [stored] = await db.select().from(tasks).where(eq(tasks.id, relationTaskId));
  assert.equal(stored.relatedType, "team");
  assert.equal(stored.relatedId, teams[0].id);
  // Meeting-generated completion links remain system-owned.
  await db
    .update(tasks)
    .set({
      relatedType: "meeting",
      relatedId: meetings[0].id,
      completionEvent: "meeting.evaluation.completed",
    })
    .where(eq(tasks.id, relationTaskId));
  assert.equal(
    (
      await updateTaskAction(
        relationTaskId,
        form({ relatedType: "person", relatedId: people[0].id })
      )
    ).success,
    false
  );
  assert.equal(
    (
      await updateTaskAction(
        relationTaskId,
        form({ title: "Managed relation retained" })
      )
    ).success,
    true
  );
  actor = member;
  await assert.rejects(createTaskAction(form({ title: "Unauthorized" })));
  await assert.rejects(
    updateTaskAction(relationTaskId, form({ title: "Unauthorized" }))
  );
  actor = null;
  await assert.rejects(createTaskAction(form({ title: "Unauthenticated" })));
  actor = owner;

  const seeded = await db
    .insert(tasks)
    .values(
      Array.from({ length: 56 }, (_, index) => ({
        churchId: plants[0].id,
        createdById: owner.id,
        assignedToId: owner.id,
        title: `Sort ${String(55 - index).padStart(2, "0")}`,
        category: "training" as const,
        priority: (["low", "high", "urgent", "medium"] as const)[index % 4],
        status: (
          ["not_started", "in_progress", "blocked", "complete"] as const
        )[index % 4],
        dueDate:
          index % 7 === 0
            ? null
            : `2026-09-${String(1 + (index % 28)).padStart(2, "0")}`,
        createdAt: new Date(Date.UTC(2026, 8, 1 + (index % 28))),
      }))
    )
    .returning();
  for (const sortBy of [
    "due_date",
    "priority",
    "status",
    "created_at",
    "title",
  ] as const) {
    for (const sortDir of ["asc", "desc"] as const) {
      const params = {
        view: "all",
        category: "training",
        completed: "true",
        sortBy,
        sortDir,
      };
      const first = await readTaskListPage(plants[0].id, owner.id, params);
      assert.equal(first.tasks.length, 50);
      assert.ok(first.nextCursor);
      const second = await readTaskListPage(
        plants[0].id,
        owner.id,
        params,
        first.nextCursor
      );
      const actual = [...first.tasks, ...second.tasks].map((t) => t.id);
      const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
      const expected = [...seeded]
        .sort(
          (a, b) =>
            (sortDir === "asc" ? 1 : -1) *
            (compare(
              TASK_SORT_KEYS[sortBy].of(a),
              TASK_SORT_KEYS[sortBy].of(b)
            ) || compare(a.id, b.id))
        )
        .map((t) => t.id);
      assert.deepEqual(actual, expected, `${sortBy} ${sortDir}`);
      assert.equal(new Set(actual).size, 56);
    }
  }
  const dateParams = {
    view: "all",
    category: "training",
    completed: "true",
    dueDateFrom: "2026-09-05",
    dueDateTo: "2026-09-10",
  };
  const dated = await readTaskListPage(plants[0].id, owner.id, dateParams);
  const expectedDateRows = seeded.filter(
    (t) => t.dueDate && t.dueDate >= "2026-09-05" && t.dueDate <= "2026-09-10"
  );
  assert.equal(dated.total, expectedDateRows.length);
  const counts = await getTaskCounts(
    plants[0].id,
    taskListScope(owner.id, parseTaskListSearchParams(dateParams))
  );
  assert.equal(
    counts.notStarted + counts.inProgress + counts.blocked + counts.complete,
    dated.total
  );
  await db.insert(tasks).values([
    {
      churchId: plants[0].id,
      createdById: owner.id,
      title: "Filtered follow-up",
      category: "follow_up",
      priority: "high",
      status: "blocked",
      assignedToId: owner.id,
      dueDate: "2026-09-10",
    },
    {
      churchId: plants[0].id,
      createdById: owner.id,
      title: "Unowned follow-up",
      category: "follow_up",
      priority: "low",
      status: "not_started",
      dueDate: "2026-09-20",
    },
  ]);
  const followUps = await listOpenFollowUpTasks(plants[0].id);
  assert.equal(
    filterFollowUpTasks(
      followUps,
      parseTaskListSearchParams({ category: "vision_meeting" })
    ).length,
    0
  );
  assert.equal(
    filterFollowUpTasks(
      followUps,
      parseTaskListSearchParams({
        priority: "high",
        status: "blocked",
        dueDateTo: "2026-09-10",
      })
    ).length,
    1
  );
  console.log(
    "PASS: relation create/replace/clear/preserve, malformed/deleted/foreign refusals, unauthorized actions, all 10 sort orders across 56 rows, date count parity, assignment filters. Browser fixtures retained in owned database; teardown owner must remove that database."
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
