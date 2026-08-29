import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  evryActionPlans,
  evryActionPlanStates,
  evryExecutionAttempts,
  evryExecutionOutcomes,
  evryPlanConfirmations,
  evryProductAuditEvents,
  personActivities,
  personTags,
  persons,
  tags,
  users,
} from "@/db/schema";
import {
  correlationForPlanRequest,
  executionEffectKey,
  executionAttemptKey,
  planEventKey,
} from "@/lib/evry/audit/identity";
import { mintEvryPlanRequestKey } from "@/lib/evry/plans";

import { claimEvryPersonNote } from "./activity";
import { claimEvryAssignTag } from "./evry-taxonomies";

const NOTE_IDENTITY = "people.crm.notes.add-note";
const TAG_IDENTITY = "people.crm.tags.assign-tag";
const FINGERPRINT = "a".repeat(64);

async function seedAttempt(input: {
  churchId: string;
  actorUserId: string;
  capabilityIdentity?: string;
  stepId?: string;
}) {
  const planId = randomUUID();
  const attemptId = randomUUID();
  const requestKey = mintEvryPlanRequestKey();
  const correlationId = correlationForPlanRequest(requestKey);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 15 * 60_000);
  const [proposal] = await db
    .insert(evryActionPlans)
    .values({
      id: planId,
      churchId: input.churchId,
      actorUserId: input.actorUserId,
      requestKey,
      intentFingerprint: createHash("sha256")
        .update(`intent:${planId}`)
        .digest("hex"),
      fingerprint: FINGERPRINT,
      document: {
        version: 1,
        steps: [
          {
            id: input.stepId ?? "add-note",
            capabilityIdentity: input.capabilityIdentity ?? NOTE_IDENTITY,
            effectClass: "database_write",
            arguments: {},
            dependsOn: [],
          },
        ],
      },
      createdAt,
      expiresAt,
    })
    .returning({ id: evryActionPlans.id });
  assert.ok(proposal);
  const [audit] = await db
    .insert(evryProductAuditEvents)
    .values({
      planId,
      churchId: input.churchId,
      actorUserId: input.actorUserId,
      planFingerprint: FINGERPRINT,
      correlationId,
      eventKey: planEventKey(planId, "plan_proposed"),
      eventType: "plan_proposed",
      occurredAt: createdAt,
    })
    .returning({ id: evryProductAuditEvents.id });
  const [confirmation] = await db
    .insert(evryPlanConfirmations)
    .values({
      planId,
      churchId: input.churchId,
      actorUserId: input.actorUserId,
      planFingerprint: FINGERPRINT,
      decidedAt: createdAt,
    })
    .returning({ id: evryPlanConfirmations.id });
  assert.ok(audit && confirmation);
  await db.batch([
    db.insert(evryActionPlanStates).values({
      planId,
      churchId: input.churchId,
      status: "executing",
      changedAt: createdAt,
    }),
    db.insert(evryExecutionAttempts).values({
      id: attemptId,
      planId,
      churchId: input.churchId,
      actorUserId: input.actorUserId,
      planFingerprint: FINGERPRINT,
      confirmationId: confirmation.id,
      proposalEventId: audit.id,
      correlationId,
      attemptKey: executionAttemptKey(planId, FINGERPRINT),
      startedAt: createdAt,
    }),
  ]);
  const stepId = input.stepId ?? "add-note";
  return {
    execution: {
      attemptId,
      planId,
      plantId: input.churchId,
      actorUserId: input.actorUserId,
      fingerprint: FINGERPRINT,
      correlationId,
      stepId,
      capabilityIdentity: input.capabilityIdentity ?? NOTE_IDENTITY,
    },
    effectKey: executionEffectKey(planId, FINGERPRINT, stepId),
  };
}

async function main(): Promise<void> {
  const plant = await db
    .insert(churches)
    .values({ name: "__People effect proof__" })
    .returning({ id: churches.id })
    .then(([row]) => row);
  assert.ok(plant);
  const [owner] = await db
    .insert(users)
    .values({
      email: `${randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: "Proof owner",
      churchId: plant.id,
      seat: "owner",
    })
    .returning({ id: users.id });
  assert.ok(owner);
  const [person] = await db
    .insert(persons)
    .values({
      churchId: plant.id,
      firstName: "Ada",
      lastName: "Lovelace",
      createdBy: owner.id,
    })
    .returning({ id: persons.id });
  assert.ok(person);

  const concurrent = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
  });
  const concurrentInput = {
    ...concurrent,
    personId: person.id,
    expectedFirstName: "Ada",
    expectedLastName: "Lovelace",
    note: "One concurrent note",
  };
  const race = await Promise.all([
    claimEvryPersonNote(concurrentInput),
    claimEvryPersonNote(concurrentInput),
  ]);
  assert.deepEqual(race, [
    { status: "completed", affectedCount: 1, excludedCount: 0 },
    { status: "completed", affectedCount: 1, excludedCount: 0 },
  ]);

  const lostResponse = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
  });
  const lostResponseInput = {
    ...lostResponse,
    personId: person.id,
    expectedFirstName: "Ada",
    expectedLastName: "Lovelace",
    note: "One response-loss note",
  };
  await claimEvryPersonNote(lostResponseInput); // committed; pretend its response vanished
  assert.deepEqual(await claimEvryPersonNote(lostResponseInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });

  const foreignPlant = await db
    .insert(churches)
    .values({ name: "__Foreign People effect proof__" })
    .returning({ id: churches.id })
    .then(([row]) => row);
  assert.ok(foreignPlant);
  const [foreignPerson] = await db
    .insert(persons)
    .values({
      churchId: foreignPlant.id,
      firstName: "Ada",
      lastName: "Lovelace",
      createdBy: owner.id,
    })
    .returning({ id: persons.id });
  assert.ok(foreignPerson);
  const refusedAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
  });
  assert.deepEqual(
    await claimEvryPersonNote({
      ...refusedAttempt,
      personId: foreignPerson.id,
      expectedFirstName: "Ada",
      expectedLastName: "Lovelace",
      note: "Must not cross plants",
    }),
    { status: "refused", excludedCount: 1 }
  );

  const [tag] = await db
    .insert(tags)
    .values({ churchId: plant.id, name: "Follow-up", color: "blue" })
    .returning({ id: tags.id });
  assert.ok(tag);
  const tagAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: TAG_IDENTITY,
    stepId: "assign-tag",
  });
  const tagInput = {
    ...tagAttempt,
    personId: person.id,
    expectedFirstName: "Ada",
    expectedLastName: "Lovelace",
    tagId: tag.id,
    expectedTagName: "Follow-up",
    expectedTagColor: "blue",
  };
  assert.deepEqual(await claimEvryAssignTag(tagInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryAssignTag(tagInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });

  const [activityCount, outcomeCount, membershipCount] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(personActivities)
      .where(
        and(
          eq(personActivities.churchId, plant.id),
          eq(personActivities.personId, person.id)
        )
      )
      .then(([row]) => row?.count ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(evryExecutionOutcomes)
      .where(eq(evryExecutionOutcomes.churchId, plant.id))
      .then(([row]) => row?.count ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(personTags)
      .where(
        and(
          eq(personTags.churchId, plant.id),
          eq(personTags.personId, person.id),
          eq(personTags.tagId, tag.id)
        )
      )
      .then(([row]) => row?.count ?? 0),
  ]);
  assert.equal(activityCount, 3);
  assert.equal(outcomeCount, 3);
  assert.equal(membershipCount, 1);

  process.stdout.write("People effect live proof passed\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
