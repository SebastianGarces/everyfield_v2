import assert from "node:assert/strict";
import { db } from "../src/db";
import {
  churches,
  users,
  persons,
  trainingCompletions,
  recordCorrections,
} from "../src/db/schema";
import {
  createTeam,
  updateTeam,
  listTeams,
} from "../src/lib/ministry-teams/teams";
import {
  createTrainingProgram,
  markTrainingComplete,
  undoTrainingComplete,
  getPersonTraining,
  updateTrainingProgram,
} from "../src/lib/ministry-teams/training";
import { and, eq } from "drizzle-orm";
async function main() {
  const [church] = await db
    .insert(churches)
    .values({ name: "Alpha corrections proof" })
    .returning();
  const [user] = await db
    .insert(users)
    .values({
      name: "Proof",
      email: `${crypto.randomUUID()}@example.test`,
      passwordHash: "fixture",
      seat: "owner",
      churchId: church.id,
    })
    .returning();
  const [person] = await db
    .insert(persons)
    .values({
      churchId: church.id,
      firstName: "Proof",
      lastName: "Training",
      createdBy: user.id,
    })
    .returning();
  const team = await createTeam(church.id, user.id, { name: "Original" });
  const changed = await updateTeam(
    church.id,
    team.id,
    { name: "Corrected", status: "archived" },
    user.id,
    team.updatedAt.toISOString()
  );
  assert.equal(changed.name, "Corrected");
  assert(!(await listTeams(church.id)).some((t) => t.id === team.id));
  assert((await listTeams(church.id, true)).some((t) => t.id === team.id));
  await assert.rejects(() =>
    updateTeam(
      church.id,
      team.id,
      { name: "Stale" },
      user.id,
      team.updatedAt.toISOString()
    )
  );
  await assert.rejects(() =>
    updateTeam(crypto.randomUUID(), team.id, { name: "Foreign" }, user.id)
  );
  const program = await createTrainingProgram(church.id, user.id, {
    name: "Original program",
  });
  const corrected = await updateTrainingProgram(
    church.id,
    program.id,
    user.id,
    { name: "Corrected program", isRequired: true },
    program.updatedAt.toISOString()
  );
  assert.equal(corrected.name, "Corrected program");
  await assert.rejects(() =>
    updateTrainingProgram(
      church.id,
      program.id,
      user.id,
      { name: "Stale" },
      program.updatedAt.toISOString()
    )
  );
  const completion = await markTrainingComplete(
    church.id,
    person.id,
    program.id,
    user.id
  );
  await undoTrainingComplete(church.id, person.id, program.id, user.id);
  assert.equal(
    (await getPersonTraining(church.id, person.id))[0].completedAt,
    null
  );
  await assert.rejects(() =>
    undoTrainingComplete(church.id, person.id, program.id, user.id)
  );
  const renewed = await markTrainingComplete(
    church.id,
    person.id,
    program.id,
    user.id
  );
  assert.equal(renewed.id, completion.id);
  assert(renewed.revokedAt === null);
  await assert.rejects(() =>
    markTrainingComplete(church.id, person.id, program.id, user.id)
  );
  await assert.rejects(() =>
    undoTrainingComplete(crypto.randomUUID(), person.id, program.id, user.id)
  );
  const history = await db
    .select()
    .from(recordCorrections)
    .where(eq(recordCorrections.churchId, church.id));
  assert.equal(history.length, 3);
  console.log(
    "PASS team correction/archive/stale/foreign; training program correction/stale; undo/repeat/recomplete/foreign; retained original identity and 3 audit rows"
  );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
