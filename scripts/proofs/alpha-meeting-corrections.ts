import assert from "node:assert/strict";
import { db } from "@/db";
import {
  churches,
  users,
  churchMeetings,
  recordCorrections,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  createLocation,
  updateLocation,
  deactivateLocation,
  restoreLocation,
  listLocations,
  getLocation,
} from "@/lib/meetings/locations";
import {
  createEvaluation,
  updateEvaluation,
  getEvaluation,
  createMeeting,
} from "@/lib/meetings/service";
async function main() {
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/alpha_corrections"
  );
  console.log("start fixture");
  const suffix = crypto.randomUUID();
  const [plant, foreign] = await db
    .insert(churches)
    .values([{ name: `Correction ${suffix}` }, { name: `Foreign ${suffix}` }])
    .returning();
  const [actor] = await db
    .insert(users)
    .values({
      name: "Correction owner",
      email: `correction-${suffix}@example.test`,
      seat: "owner",
      churchId: plant.id,
      passwordHash: "not-a-login",
    })
    .returning();
  console.log("fixture ready");
  const location = await createLocation(plant.id, {
    name: "Old hall",
    address: "Old address",
  });
  console.log("location created");
  const corrected = await updateLocation(
    plant.id,
    location.id,
    { name: "New hall" },
    actor.id,
    location.updatedAt.toISOString()
  );
  assert.equal(corrected.name, "New hall");
  await assert.rejects(
    updateLocation(
      plant.id,
      location.id,
      { name: "Stale" },
      actor.id,
      location.updatedAt.toISOString()
    )
  );
  await assert.rejects(
    updateLocation(foreign.id, location.id, { name: "Foreign" }, actor.id)
  );
  const [meeting] = await db
    .insert(churchMeetings)
    .values({
      churchId: plant.id,
      type: "vision_meeting",
      status: "completed",
      datetime: new Date(),
      createdBy: actor.id,
      locationId: location.id,
      locationName: location.name,
      locationAddress: location.address,
    })
    .returning();
  await deactivateLocation(plant.id, location.id, actor.id);
  assert.equal((await listLocations(plant.id)).length, 0);
  assert.equal((await getLocation(plant.id, location.id))?.isActive, false);
  await assert.rejects(
    createMeeting(plant.id, actor.id, {
      type: "vision_meeting",
      datetime: new Date(),
      locationId: location.id,
    })
  );
  assert.equal((await listLocations(plant.id, true)).length, 1);
  await assert.rejects(restoreLocation(foreign.id, location.id, actor.id));
  await restoreLocation(plant.id, location.id, actor.id);
  await restoreLocation(plant.id, location.id, actor.id);
  assert.equal((await listLocations(plant.id)).length, 1);
  const data = {
    attendanceScore: 3,
    locationScore: 3,
    logisticsScore: 3,
    agendaScore: 3,
    vibeScore: 3,
    messageScore: 3,
    closeScore: 3,
    nextStepsScore: 3,
    notes: "Original",
  };
  console.log("before evaluation");
  const evaluation = await createEvaluation(
    plant.id,
    meeting.id,
    actor.id,
    data
  );
  console.log("evaluation created");
  const result = await updateEvaluation(
    plant.id,
    meeting.id,
    actor.id,
    { ...data, attendanceScore: 5, notes: "" },
    evaluation.updatedAt.toISOString()
  );
  assert.equal(result.totalScore, "3.3");
  assert.equal(result.notes, "");
  await assert.rejects(
    updateEvaluation(
      plant.id,
      meeting.id,
      actor.id,
      data,
      evaluation.updatedAt.toISOString()
    )
  );
  await assert.rejects(
    updateEvaluation(
      foreign.id,
      meeting.id,
      actor.id,
      data,
      result.updatedAt.toISOString()
    )
  );
  const histories = await db
    .select()
    .from(recordCorrections)
    .where(eq(recordCorrections.churchId, plant.id));
  assert.equal(histories.length, 4);
  const history = histories.find((r) => r.entityType === "meeting_evaluation")!;
  assert.equal((history.before as any).attendance_score, 3);
  assert.equal((history.after as any).attendance_score, 5);
  assert.equal((history.after as any).notes, "");
  assert.equal((await getEvaluation(plant.id, meeting.id))?.notes, "");
  console.log(
    "PASS location edit/archive, historical reference, archived selection refusal, stale/foreign refusals; evaluation correction/recalculation/empty notes, stale/foreign refusals, archive/restore idempotence, exact 4 history entries"
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
