import assert from "node:assert/strict";
import { z } from "zod";
import { fixtureId, type FixtureManifest } from "./manifest";
import type { FixtureStore } from "./store";

export const launchReviewId = (m: FixtureManifest, name: string) =>
  fixtureId(`${m.caseId}:${m.repetition}`, `launch-review:${name}`);

/** Add to the standard disposable seed; a complete task belongs to the open milestone. */
export function seedLaunchReviewFixture(
  m: FixtureManifest,
  store: FixtureStore
) {
  const i = m.ids;
  store.sql(`
    insert into launch_milestones(id,launch_id,church_id,template_key,area,title,completed_at) values
    ${Array.from({ length: 7 }, (_, j) => {
      const n = j + 1;
      return `('${launchReviewId(m, `milestone-${n}`)}','${i.launch}','${i.plant}','operations.review_${n}','operations','Preparation ${n}',${n <= 3 ? "'2026-09-10'::timestamp" : "null"})`;
    }).join(",")};
    insert into tasks(id,church_id,title,status,priority,due_date,assigned_to_id,created_by_id) values
    ${Array.from({ length: 14 }, (_, j) => {
      const n = j + 1;
      return `('${launchReviewId(m, `task-${n}`)}','${i.plant}','Launch preparation ${n}','${n === 14 ? "complete" : "not_started"}','medium','2026-09-25','${i.actor}','${i.actor}')`;
    }).join(",")};
    insert into launch_milestone_tasks(church_id,milestone_id,task_id) values
    ${Array.from({ length: 14 }, (_, j) => `('${i.plant}','${i["milestone-open"]}','${launchReviewId(m, `task-${j + 1}`)}')`).join(",")};
  `);
}

/** Independent SQL truth: preparation is not inferred from the tool's output. */
export function launchReviewTruth(m: FixtureManifest, store: FixtureStore) {
  const i = m.ids;
  const milestones = z
    .object({ total: z.number(), complete: z.number(), remaining: z.number() })
    .parse(
      store.query(
        `select count(*)::int total,count(*) filter(where completed_at is not null)::int complete,count(*) filter(where completed_at is null)::int remaining from launch_milestones where church_id='${i.plant}' and launch_id='${i.launch}'`
      )[0]
    );
  const tasks = store.query(
    `select distinct t.id,t.status from tasks t join launch_milestone_tasks link on link.task_id=t.id and link.church_id=t.church_id join launch_milestones m on m.id=link.milestone_id and m.church_id=link.church_id where t.church_id='${i.plant}' and m.launch_id='${i.launch}' and t.deleted_at is null`
  );
  const openTaskIds = tasks
    .filter((t) => t.status !== "complete")
    .map((t) => z.string().parse(t.id))
    .sort();
  const completedTaskIds = tasks
    .filter((t) => t.status === "complete")
    .map((t) => z.string().parse(t.id))
    .sort();
  assert.deepEqual(milestones, { total: 9, complete: 4, remaining: 5 });
  assert.equal(openTaskIds.length, 13);
  assert.deepEqual(completedTaskIds, [launchReviewId(m, "task-14")]);
  return { milestones, openTaskIds, completedTaskIds };
}
