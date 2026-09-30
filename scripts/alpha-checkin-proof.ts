import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { churches, users, tasks, ministryTeams } from "../src/db/schema";
import {
  saveCheckin,
  correctCheckin,
  listCheckinHistory,
} from "../src/lib/phase-engine/planter-checkin-db";
import { listTasks, getTaskCounts } from "../src/lib/tasks/service";
async function main() {
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  const [church] = await db.select().from(churches).limit(1);
  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.churchId, church.id))
    .limit(1);
  const answer = {
    spiritually: "steady",
    marriageFamily: "steady",
    financially: "steady",
    pace: "steady",
    note: "private original",
  } as const;
  const first = await saveCheckin(church.id, owner.id, "2026-08-03", answer);
  assert.deepEqual(first.editHistory, []);
  await correctCheckin(church.id, owner.id, first.id, {
    ...answer,
    pace: "strained",
    note: "corrected",
  });
  const rows = await listCheckinHistory(church.id);
  const updated = rows.find((r) => r.id === first.id)!;
  assert.equal(updated.note, "corrected");
  assert.equal(updated.editHistory.length, 1);
  assert.equal(updated.editHistory[0].note, "private original");
  assert.equal(updated.editHistory[0].answeredById, owner.id);
  const foreignId = "a20ca88a-bf40-43f0-9aaf-f72521a6ffad";
  assert.equal(
    await correctCheckin(foreignId, owner.id, first.id, answer),
    false
  );
  assert.deepEqual(await listCheckinHistory(foreignId), []);
  await Promise.all([
    saveCheckin(church.id, owner.id, "2026-08-03", {
      ...answer,
      note: "concurrent 1",
    }),
    saveCheckin(church.id, owner.id, "2026-08-03", {
      ...answer,
      note: "concurrent 2",
    }),
  ]);
  const final = (await listCheckinHistory(church.id)).find(
    (r) => r.id === first.id
  )!;
  assert.equal(final.editHistory.length, 3);
  assert.ok(final.editHistory.some((r) => r.note === "corrected"));
  assert.ok(final.editHistory.some((r) => r.note?.startsWith("concurrent")));
  const [team] = await db
    .insert(ministryTeams)
    .values({
      churchId: church.id,
      name: "Alpha filter team",
      createdBy: owner.id,
    })
    .returning();
  await db.insert(tasks).values([
    {
      churchId: church.id,
      title: "Team filter matches",
      relatedType: "team",
      relatedId: team.id,
      createdById: owner.id,
    },
    {
      churchId: church.id,
      title: "Team filter excludes",
      createdById: owner.id,
    },
  ]);
  const filtered = await listTasks(church.id, {
    teamId: team.id,
    includeCompleted: true,
  });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.tasks[0].title, "Team filter matches");
  assert.equal(
    (await getTaskCounts(church.id, { teamId: team.id })).notStarted,
    1
  );
  assert.equal((await listTasks(foreignId, { teamId: team.id })).total, 0);
  console.log(
    "PASS: private correction, prior snapshots, concurrent corrections, foreign tenant rejection, explicit team filter/list/count scoping"
  );
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
