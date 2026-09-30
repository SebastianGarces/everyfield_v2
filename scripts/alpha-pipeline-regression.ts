import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { persons, tasks } from "@/db/schema";
import { db } from "@/db";
import { getPipelineData } from "@/lib/people/pipeline";
import { getFollowUpInfo } from "@/lib/people/follow-up-warning";

async function main() {
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  const f = JSON.parse(readFileSync(process.argv[2], "utf8"));
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/" + f.database);
  const actor = f.accounts[0].id;
  const now = new Date("2026-09-30T12:00:00Z");
  const cases = [
    { name: "prospect-no-task", status: "prospect", expect: 0 },
    { name: "interviewed-no-task", status: "interviewed", expect: 0 },
    { name: "core-no-task", status: "core_group", expect: 0 },
    { name: "launch-no-task", status: "launch_team", expect: 0 },
    {
      name: "recent-overdue",
      status: "prospect",
      expect: 1,
      due: "2026-09-29",
    },
    { name: "future", status: "prospect", expect: 0, due: "2026-10-01" },
    { name: "undated", status: "prospect", expect: 0, due: null },
    {
      name: "complete",
      status: "core_group",
      expect: 0,
      due: "2026-09-29",
      taskStatus: "complete",
    },
    {
      name: "waived",
      status: "core_group",
      expect: 0,
      due: "2026-09-29",
      taskStatus: "no_longer_needed",
    },
    { name: "multiple", status: "launch_team", expect: 1, due: "2026-10-01" },
    {
      name: "foreign-task",
      status: "prospect",
      expect: 0,
      due: "2026-09-29",
      foreign: true,
    },
    {
      name: "checklist",
      status: "prospect",
      expect: 0,
      due: "2026-09-29",
      checklist: true,
    },
    {
      name: "deleted",
      status: "prospect",
      expect: 0,
      due: "2026-09-29",
      deleted: true,
    },
  ] as const;
  const ids = new Map<string, string>();
  for (const row of cases) {
    const [p] = await db
      .insert(persons)
      .values({
        churchId: f.primaryChurchId,
        firstName: "Regression",
        lastName: row.name,
        status: row.status,
        createdBy: actor,
        createdAt: new Date("2026-08-01T00:00:00Z"),
      })
      .returning();
    ids.set(row.name, p.id);
    if ("due" in row) {
      let parent: string | null = null;
      if ("checklist" in row) {
        const [t] = await db
          .insert(tasks)
          .values({
            churchId: f.primaryChurchId,
            title: "Regression parent",
            createdById: actor,
          })
          .returning();
        parent = t.id;
      }
      await db.insert(tasks).values({
        churchId: "foreign" in row ? f.foreignChurchId : f.primaryChurchId,
        title: "Regression " + row.name,
        createdById: actor,
        category: "follow_up",
        relatedType: "person",
        relatedId: p.id,
        dueDate: row.due,
        status: "taskStatus" in row ? row.taskStatus : "not_started",
        parentTaskId: parent,
        deletedAt: "deleted" in row ? now : null,
      });
      if (row.name === "multiple")
        await db
          .insert(tasks)
          .values({
            churchId: f.primaryChurchId,
            title: "Regression additional overdue",
            createdById: actor,
            category: "follow_up",
            relatedType: "person",
            relatedId: p.id,
            dueDate: "2026-09-28",
          });
    }
  }
  const pipeline = await getPipelineData(f.primaryChurchId);
  const people = Object.values(pipeline.people).flat();
  for (const row of cases) {
    const p = people.find((p) => p.id === ids.get(row.name));
    assert.ok(p, row.name);
    assert.equal(
      getFollowUpInfo(p.followUpTasks, now, "America/Chicago")?.overdueCount ??
        0,
      row.expect,
      row.name
    );
    if (
      !row.expect &&
      !("due" in row && ["future", "undated"].includes(row.name))
    )
      assert.equal(p.followUpTasks?.length, 0, row.name + " task withheld");
  }
  console.log(
    JSON.stringify({
      passed: true,
      cases: cases.length,
      ids: Object.fromEntries(ids),
      proof:
        "stage-independent explicit-task warnings, tenant/checklist/deletion/settled exclusion",
    })
  );
}
main();
