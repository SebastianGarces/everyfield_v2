import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  launchEvents,
  launchMilestones,
  launchMilestoneTasks,
  launches,
  tasks,
} from "@/db/schema";
import type { LaunchStatus } from "@/db/schema/launch";
import {
  createScratchPlant,
  databaseReachable,
  LIVE_DB,
  liveSkip as skip,
  sweepScratch,
  UNREACHABLE,
  type ScratchPlant,
} from "@/lib/testing/ministry-teams-scratch";

import {
  convergeLaunchReadiness,
  LAUNCH_MILESTONE_TEMPLATES,
} from "./milestones";
import { getLaunchForChurch, type LaunchRecord } from "./queries";

// ----------------------------------------------------------------------------
// #614 — a scheduled launch with zero milestone rows repairs itself on read.
//
// WHY THIS IS NOT A UNIT TEST. Every claim here is about which rows exist
// afterwards. The repair is `insert … on conflict (launch_id, template_key) do
// nothing` whose task insert reads that insert's own `RETURNING`, so the
// difference between a converge that is idempotent and one that hands a plant
// 46 tasks on its second page load is invisible in the generated SQL and
// invisible to a type. Two of the claims are about what Postgres does when two
// tabs arrive together, which nothing but a real database can answer.
//
// The plant, the actor and the sweep come from `ministry-teams-scratch` — the
// live lane's plumbing, not a ministry-teams fact — and this file adds the
// launch tables to the sweep before handing the plant back to it. Same opt-in
// flag, same reachability probe, same namespaced cleanup as its neighbours.
// ----------------------------------------------------------------------------

const SCRATCH_NAME = "__t614 launch readiness scratch__";

/** What the Playbook seeds: nine milestones, and the tasks under them. */
const MILESTONE_COUNT = LAUNCH_MILESTONE_TEMPLATES.length;
const TASK_COUNT = LAUNCH_MILESTONE_TEMPLATES.reduce(
  (total, template) => total + template.tasks.length,
  0
);

after(async () => {
  if (!LIVE_DB) return;
  if (!(await databaseReachable())) return;
  await sweep();
});

/**
 * The launch rows first, then the plant.
 *
 * `launches.church_id` references `churches`, and `launch_milestone_tasks`
 * references both a milestone and a task, so a delete list assembled in the
 * wrong order is a foreign-key error rather than a clean run.
 */
async function sweep(): Promise<void> {
  const scratch = await db.execute<{ id: string }>(
    sql`select id from churches where name = ${SCRATCH_NAME}`
  );

  for (const church of scratch.rows) {
    await db
      .delete(launchMilestoneTasks)
      .where(eq(launchMilestoneTasks.churchId, church.id));
    await db.delete(tasks).where(eq(tasks.churchId, church.id));
    await db
      .delete(launchMilestones)
      .where(eq(launchMilestones.churchId, church.id));
    await db.delete(launchEvents).where(eq(launchEvents.churchId, church.id));
    await db.delete(launches).where(eq(launches.churchId, church.id));
  }

  await sweepScratch(SCRATCH_NAME);
}

/**
 * THE STRANDED SHAPE, written the way the bug produced it: the durable date
 * write landed and the seed that follows it did not. `scheduleLaunchAction`
 * writes the date and seeds afterwards precisely so a failed seed cannot lose
 * the day, which is what leaves a row looking exactly like this one.
 */
async function scratchLaunch(
  plant: ScratchPlant,
  status: LaunchStatus = "scheduled",
  targetDate: string | null = "2027-02-05"
): Promise<LaunchRecord> {
  await db.insert(launches).values({
    churchId: plant.churchId,
    status,
    targetDate,
  });

  const launch = await getLaunchForChurch(plant.churchId);
  assert.ok(launch, "the scratch launch was not written");
  return launch;
}

async function milestoneRows(launchId: string) {
  return db
    .select({ id: launchMilestones.id, key: launchMilestones.templateKey })
    .from(launchMilestones)
    .where(eq(launchMilestones.launchId, launchId))
    .orderBy(launchMilestones.sortOrder);
}

async function taskRows(churchId: string) {
  return db
    .select({ id: tasks.id, title: tasks.title, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.churchId, churchId), eq(tasks.category, "launch_prep")))
    .orderBy(tasks.title);
}

test(
  "a scheduled launch with zero milestone rows builds its board on that same visit",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    // AC 1, on the shape Riverside actually sat in: scheduled, a day named, and
    // no readiness list anywhere.
    const plant = await createScratchPlant(SCRATCH_NAME);
    const launch = await scratchLaunch(plant);
    assert.deepEqual(
      await milestoneRows(launch.id),
      [],
      "the fixture must start stranded, or this proves nothing"
    );

    const readiness = await convergeLaunchReadiness(launch, plant.actorId);

    assert.equal(readiness.totalCount, MILESTONE_COUNT);
    assert.equal(readiness.completedCount, 0);
    assert.equal(readiness.openTaskCount, TASK_COUNT);
    assert.deepEqual(
      readiness.milestones.map((milestone) => milestone.templateKey),
      LAUNCH_MILESTONE_TEMPLATES.map((template) => template.templateKey),
      "the board comes back in template order, not insertion order"
    );

    // And it is STORED, not assembled in memory for one render.
    assert.equal((await milestoneRows(launch.id)).length, MILESTONE_COUNT);
    assert.equal((await taskRows(plant.churchId)).length, TASK_COUNT);
  }
);

test(
  "a second visit inserts nothing — the repair is idempotent",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    // AC 4. The page runs this on EVERY render, so "safe to run again" is not a
    // nicety: get it wrong and a planter who reloads twice owns 69 tasks.
    const plant = await createScratchPlant(SCRATCH_NAME);
    const launch = await scratchLaunch(plant);

    await convergeLaunchReadiness(launch, plant.actorId);
    const first = await milestoneRows(launch.id);
    const firstTasks = await taskRows(plant.churchId);

    await convergeLaunchReadiness(launch, plant.actorId);
    const second = await milestoneRows(launch.id);
    const secondTasks = await taskRows(plant.churchId);

    assert.deepEqual(second, first, "the second converge wrote a milestone");
    assert.deepEqual(
      secondTasks.map((task) => task.id),
      firstTasks.map((task) => task.id),
      "the second converge wrote a task — the SAME rows must come back, not a fresh set with the same titles"
    );

    // A third, because "runs twice" and "runs on every page load" are different
    // claims and the page makes the second one.
    await convergeLaunchReadiness(launch, plant.actorId);
    assert.equal((await taskRows(plant.churchId)).length, TASK_COUNT);
  }
);

test(
  "two tabs opened together produce ONE readiness list",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    // Ordering does nothing against concurrency (invariants → Atomicity): both
    // visits pass any count check. The unique index on (launch_id,
    // template_key) is the guard, and the task insert riding the milestone
    // insert's RETURNING is what keeps the loser from writing 23 orphan tasks.
    // Three runs, because a race that loses one time in three still ships.
    for (let run = 1; run <= 3; run++) {
      const plant = await createScratchPlant(SCRATCH_NAME);
      const launch = await scratchLaunch(plant);

      const [left, right] = await Promise.all([
        convergeLaunchReadiness(launch, plant.actorId),
        convergeLaunchReadiness(launch, plant.actorId),
      ]);

      assert.equal(
        (await milestoneRows(launch.id)).length,
        MILESTONE_COUNT,
        `run ${run}: the race doubled the milestones`
      );
      assert.equal(
        (await taskRows(plant.churchId)).length,
        TASK_COUNT,
        `run ${run}: the race doubled the tasks`
      );
      // Both visits render a full board. The one that lost the insert reads the
      // winner's rows, which are the plant's readiness list just as much.
      assert.equal(left.totalCount, MILESTONE_COUNT, `run ${run}: left`);
      assert.equal(right.totalCount, MILESTONE_COUNT, `run ${run}: right`);
    }
  }
);

test(
  "the repair never overwrites work the plant has already done",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    // The seed runs on every render, so the question a planter would ask is
    // whether it resets them. It cannot: `on conflict do nothing` writes no
    // milestone, and the task insert only ever sees milestones it just created.
    const plant = await createScratchPlant(SCRATCH_NAME);
    const launch = await scratchLaunch(plant);
    await convergeLaunchReadiness(launch, plant.actorId);

    const [ticked] = await taskRows(plant.churchId);
    await db
      .update(tasks)
      .set({ status: "complete", title: "Order the projector, not the truss" })
      .where(eq(tasks.id, ticked.id));

    const after = await convergeLaunchReadiness(launch, plant.actorId);

    assert.equal(after.totalCount, MILESTONE_COUNT);
    assert.equal(
      after.openTaskCount,
      TASK_COUNT - 1,
      "the completed task came back open, or a duplicate was inserted beside it"
    );
    const [kept] = await db
      .select({ title: tasks.title, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, ticked.id));
    assert.equal(kept.title, "Order the projector, not the truss");
    assert.equal(kept.status, "complete");
    assert.equal((await taskRows(plant.churchId)).length, TASK_COUNT);
  }
);

test(
  "a launch with no day named is never seeded",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    // `planning` is the row existing WITHOUT a committed date. Nothing is
    // seeded until a day is named, and a converge that ignored the status would
    // hand every new plant a readiness list for a launch it has not scheduled.
    const plant = await createScratchPlant(SCRATCH_NAME);
    const launch = await scratchLaunch(plant, "planning", null);

    const readiness = await convergeLaunchReadiness(launch, plant.actorId);

    assert.equal(readiness.totalCount, 0);
    assert.deepEqual(await milestoneRows(launch.id), []);
    assert.deepEqual(await taskRows(plant.churchId), []);
  }
);

test(
  "a completed launch is left alone, and a postponed one is not",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    // The two ends of the ruling in `EXPECTS_READINESS`. Seeding a completed
    // launch would hand a plant 23 open tasks the Monday after it launched; a
    // postponed launch carries a NEW date and goes on preparing, so it wants
    // its list exactly as a scheduled one does.
    const done = await createScratchPlant(SCRATCH_NAME);
    const doneLaunch = await scratchLaunch(done, "completed", "2026-01-11");
    assert.equal(
      (await convergeLaunchReadiness(doneLaunch, done.actorId)).totalCount,
      0
    );
    assert.deepEqual(await milestoneRows(doneLaunch.id), []);

    const moved = await createScratchPlant(SCRATCH_NAME);
    const movedLaunch = await scratchLaunch(moved, "postponed", "2027-09-12");
    assert.equal(
      (await convergeLaunchReadiness(movedLaunch, moved.actorId)).totalCount,
      MILESTONE_COUNT
    );
  }
);

test(
  "every row the repair writes carries the plant's own tenant",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    await sweep();

    // There is no RLS behind any of this (invariants → Multi-Tenancy), and the
    // repair writes three tables. A second plant is here so a missing church_id
    // shows up as a row belonging to nobody rather than as a passing count.
    const ours = await createScratchPlant(SCRATCH_NAME);
    const theirs = await createScratchPlant(SCRATCH_NAME);
    const ourLaunch = await scratchLaunch(ours);
    await scratchLaunch(theirs);

    await convergeLaunchReadiness(ourLaunch, ours.actorId);

    for (const [table, column] of [
      [launchMilestones, launchMilestones.churchId],
      [launchMilestoneTasks, launchMilestoneTasks.churchId],
    ] as const) {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(column, theirs.churchId));
      assert.equal(n, 0, "a repaired plant's rows landed on another church");
    }

    assert.deepEqual(await taskRows(theirs.churchId), []);
    assert.equal((await taskRows(ours.churchId)).length, TASK_COUNT);
  }
);
