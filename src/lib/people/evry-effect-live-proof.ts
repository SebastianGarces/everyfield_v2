import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  assessments,
  churches,
  commitments,
  evryActionPlans,
  evryActionPlanStates,
  evryExecutionAttempts,
  evryExecutionOutcomes,
  evryPlanConfirmations,
  evryProductAuditEvents,
  households,
  interviews,
  personActivities,
  personTags,
  persons,
  skillsInventory,
  tags,
  users,
} from "@/db/schema";
import {
  correlationForPlanRequest,
  executionEffectKey,
  executionAttemptKey,
  planEventKey,
} from "@/lib/evry/audit/identity";
import {
  PEOPLE_CORE_EXECUTION_REGISTRY,
  PEOPLE_CORE_IDENTITIES,
} from "@/lib/evry/capabilities/people/core";
import {
  PEOPLE_FILE_EXECUTION_REGISTRY,
  PEOPLE_FILE_IDENTITIES,
} from "@/lib/evry/capabilities/people/files";
import {
  removeEvryPeopleAttachment,
  stageEvryPeopleAttachment,
} from "@/lib/evry/capabilities/people/attachments";
import generatedPeopleInventory from "@/lib/evry/capabilities/people/inventory.generated.json";
import {
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_READ_REGISTRATIONS,
} from "@/lib/evry/capabilities/production";
import {
  evryCapabilityRegistrationFor,
  type EvryEffectCapabilityAuthorization,
  type EvryReadCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import { storedEvryReadArtifactDocument } from "@/lib/evry/conversations/artifacts";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { mintEvryPlanRequestKey } from "@/lib/evry/plans";
import { executeAuthorizedEvryRead } from "@/lib/evry/reads/contract";

import {
  claimEvryPersonNote,
  claimEvryPersonNoteDelete,
  claimEvryPersonNoteEdit,
} from "./activity";
import {
  claimEvryChangePersonStatus,
  claimEvryCreatePerson,
  claimEvryDeletePerson,
  claimEvryReorderPeople,
  claimEvryUpdatePerson,
} from "./evry-core";
import { claimEvryBulkImport } from "./evry-files";
import {
  claimEvryAddToHousehold,
  claimEvryCreateHouseholdWithHead,
  claimEvryDeleteHousehold,
  claimEvryPropagateHouseholdAddress,
  claimEvryRemoveFromHousehold,
  claimEvryUpdateHousehold,
} from "./evry-households";
import {
  claimEvryCreateAssessment,
  claimEvryCreateCommitment,
  claimEvryCreateInterview,
} from "./evry-milestones";
import {
  claimEvryAddSkill,
  claimEvryAssignTag,
  claimEvryCreateTag,
  claimEvryDeleteTag,
  claimEvryRemoveSkill,
  claimEvryRemoveTag,
  claimEvryUpdateSkill,
  claimEvryUpdateTag,
} from "./evry-taxonomies";
import {
  claimEvryPersonPhotoMutation,
  getEvryPersonPhotoSnapshot,
} from "./person-photo";
import { executeBulkImport } from "./import";
import { createPerson } from "./service";

const NOTE_IDENTITY = "people.crm.notes.add-note";
const TAG_IDENTITY = "people.crm.tags.assign-tag";
const CREATE_PERSON_IDENTITY = "people.crm.people.create-person";
const CREATE_HOUSEHOLD_IDENTITY =
  "people.crm.households.create-household-with-head";
const ASSESSMENT_IDENTITY = "people.crm.assessments.create-assessment";
const INTERVIEW_IDENTITY = "people.crm.assessments.create-interview";
const COMMITMENT_IDENTITY = "people.crm.assessments.create-commitment";
const IMPORT_IDENTITY = "people.crm.imports.execute-bulk-import";
const EFFECT_IDENTITIES = [
  "people.crm.assessments.create-assessment",
  "people.crm.assessments.create-commitment",
  "people.crm.assessments.create-interview",
  "people.crm.households.add-to-household",
  "people.crm.households.create-household-with-head",
  "people.crm.households.delete-household",
  "people.crm.households.propagate-address",
  "people.crm.households.remove-from-household",
  "people.crm.households.update-household",
  "people.crm.imports.execute-bulk-import",
  "people.crm.notes.add-note",
  "people.crm.notes.delete-note",
  "people.crm.notes.edit-note",
  "people.crm.people.change-status",
  "people.crm.people.change-status-with-reason",
  "people.crm.people.create-person",
  "people.crm.people.delete-person",
  "people.crm.people.quick-add-person",
  "people.crm.people.remove-person-photo",
  "people.crm.people.update-person",
  "people.crm.people.upload-person-photo",
  "people.crm.skills.add-skill",
  "people.crm.skills.remove-skill",
  "people.crm.skills.update-skill",
  "people.crm.stages.reorder-pipeline",
  "people.crm.tags.assign-tag",
  "people.crm.tags.create-tag",
  "people.crm.tags.delete-tag",
  "people.crm.tags.remove-tag",
  "people.crm.tags.update-tag",
] as const;
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

async function personSnapshotForImport(plantId: string, personId: string) {
  return db
    .select({
      firstName: persons.firstName,
      lastName: persons.lastName,
      email: persons.email,
      phone: persons.phone,
      addressLine1: persons.addressLine1,
      addressLine2: persons.addressLine2,
      city: persons.city,
      state: persons.state,
      postalCode: persons.postalCode,
      country: persons.country,
      status: persons.status,
      backgroundCheckStatus: persons.backgroundCheckStatus,
      source: persons.source,
      sourceDetails: persons.sourceDetails,
      notes: persons.notes,
      householdId: persons.householdId,
      householdRole: persons.householdRole,
    })
    .from(persons)
    .where(and(eq(persons.churchId, plantId), eq(persons.id, personId)))
    .then(([row]) => row ?? null);
}

async function householdSnapshotFor(plantId: string, householdId: string) {
  return db
    .select({
      name: households.name,
      addressLine1: households.addressLine1,
      addressLine2: households.addressLine2,
      city: households.city,
      state: households.state,
      postalCode: households.postalCode,
      country: households.country,
    })
    .from(households)
    .where(
      and(eq(households.churchId, plantId), eq(households.id, householdId))
    )
    .then(([row]) => row ?? null);
}

async function householdMemberSnapshotFor(plantId: string, personId: string) {
  return db
    .select({
      personId: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
      householdId: persons.householdId,
      householdRole: persons.householdRole,
      addressLine1: persons.addressLine1,
      addressLine2: persons.addressLine2,
      city: persons.city,
      state: persons.state,
      postalCode: persons.postalCode,
      country: persons.country,
    })
    .from(persons)
    .where(and(eq(persons.churchId, plantId), eq(persons.id, personId)))
    .then(([row]) => row ?? null);
}

async function main(): Promise<void> {
  const provenEffects = new Set<string>();
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
  provenEffects.add(NOTE_IDENTITY);
  const noteSnapshot = await db
    .select({ id: personActivities.id, metadata: personActivities.metadata })
    .from(personActivities)
    .where(
      and(
        eq(personActivities.churchId, plant.id),
        eq(personActivities.personId, person.id),
        eq(personActivities.performedBy, owner.id),
        eq(personActivities.activityType, "note_added"),
        sql`${personActivities.metadata}->>'note' = 'One response-loss note'`
      )
    )
    .then(([row]) => row);
  assert.ok(noteSnapshot);
  const editNoteAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.notes.edit-note",
    stepId: "edit-note",
  });
  const editNoteInput = {
    ...editNoteAttempt,
    personId: person.id,
    activityId: noteSnapshot.id,
    expectedMetadataJson: JSON.stringify(noteSnapshot.metadata),
    note: "Edited response-loss note",
    editedAt: "2026-08-29T12:00:00.000Z",
  };
  assert.deepEqual(await claimEvryPersonNoteEdit(editNoteInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryPersonNoteEdit(editNoteInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.notes.edit-note");
  const editedMetadata = await db
    .select({ metadata: personActivities.metadata })
    .from(personActivities)
    .where(eq(personActivities.id, noteSnapshot.id))
    .then(([row]) => row?.metadata);
  assert.ok(editedMetadata);
  const deleteNoteAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.notes.delete-note",
    stepId: "delete-note",
  });
  const deleteNoteInput = {
    ...deleteNoteAttempt,
    personId: person.id,
    activityId: noteSnapshot.id,
    expectedMetadataJson: JSON.stringify(editedMetadata),
  };
  assert.deepEqual(await claimEvryPersonNoteDelete(deleteNoteInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryPersonNoteDelete(deleteNoteInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.notes.delete-note");

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

  const createAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: CREATE_PERSON_IDENTITY,
    stepId: "create-person",
  });
  const createInput = {
    ...createAttempt,
    person: {
      firstName: "Grace",
      lastName: "Hopper",
      email: "grace@scratch.invalid",
      phone: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      country: "US",
      status: "prospect",
      backgroundCheckStatus: "not_started",
      source: null,
      sourceDetails: null,
      notes: null,
      householdId: null,
      householdRole: null,
    } as const,
    activitySource: "form" as const,
    expectedHouseholdName: null,
  };
  const interfacePerson = await createPerson(
    plant.id,
    owner.id,
    {
      firstName: createInput.person.firstName,
      lastName: createInput.person.lastName,
      email: createInput.person.email,
      country: createInput.person.country,
      status: createInput.person.status,
      backgroundCheckStatus: createInput.person.backgroundCheckStatus,
    },
    "form"
  );
  await claimEvryCreatePerson(createInput); // committed; pretend its response vanished
  assert.deepEqual(await claimEvryCreatePerson(createInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  const graceRows = await db
    .select({
      id: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
      email: persons.email,
      phone: persons.phone,
      addressLine1: persons.addressLine1,
      addressLine2: persons.addressLine2,
      city: persons.city,
      state: persons.state,
      postalCode: persons.postalCode,
      country: persons.country,
      status: persons.status,
      backgroundCheckStatus: persons.backgroundCheckStatus,
      source: persons.source,
      sourceDetails: persons.sourceDetails,
      notes: persons.notes,
      householdId: persons.householdId,
      householdRole: persons.householdRole,
      createdBy: persons.createdBy,
    })
    .from(persons)
    .where(
      and(
        eq(persons.churchId, plant.id),
        eq(persons.email, "grace@scratch.invalid")
      )
    );
  const grace = graceRows.find(({ id }) => id !== interfacePerson.id);
  assert.ok(grace);
  const interfaceRow = graceRows.find(({ id }) => id === interfacePerson.id);
  assert.ok(interfaceRow);
  const normalizeCreatedPerson = ({
    id: _id,
    ...row
  }: (typeof graceRows)[number]) => row;
  assert.deepEqual(
    normalizeCreatedPerson(grace),
    normalizeCreatedPerson(interfaceRow)
  );
  const creationActivities = await db
    .select({
      personId: personActivities.personId,
      metadata: personActivities.metadata,
    })
    .from(personActivities)
    .where(
      and(
        eq(personActivities.churchId, plant.id),
        eq(personActivities.activityType, "person_created"),
        sql`${personActivities.personId} in (${grace.id}::uuid, ${interfacePerson.id}::uuid)`
      )
    );
  assert.deepEqual(
    creationActivities
      .map(({ metadata }) => metadata)
      .toSorted((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      ),
    [{ source: "form" }, { source: "form" }]
  );
  provenEffects.add(CREATE_PERSON_IDENTITY);

  const quickAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.people.quick-add-person",
    stepId: "quick-add-person",
  });
  const quickInput = {
    ...quickAttempt,
    person: {
      ...createInput.person,
      firstName: "Quick",
      lastName: "Proof",
      email: "quick@scratch.invalid",
    },
    activitySource: "quick_add" as const,
    expectedHouseholdName: null,
  };
  assert.deepEqual(await claimEvryCreatePerson(quickInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryCreatePerson(quickInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.people.quick-add-person");
  const quickPerson = await db
    .select({ id: persons.id })
    .from(persons)
    .where(
      and(
        eq(persons.churchId, plant.id),
        eq(persons.email, quickInput.person.email)
      )
    )
    .then(([row]) => row);
  assert.ok(quickPerson);
  const quickBaseline = await personSnapshotForImport(plant.id, quickPerson.id);
  assert.ok(quickBaseline);
  const updateAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.people.update-person",
    stepId: "update-person",
  });
  const updateInput = {
    ...updateAttempt,
    personId: quickPerson.id,
    baselineJson: JSON.stringify(quickBaseline),
    after: { ...quickBaseline, notes: "Updated by the production proof" },
  };
  assert.deepEqual(await claimEvryUpdatePerson(updateInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryUpdatePerson(updateInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.people.update-person");
  const statusAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.people.change-status",
    stepId: "change-status",
  });
  const statusInput = {
    ...statusAttempt,
    personId: quickPerson.id,
    expectedFirstName: "Quick",
    expectedLastName: "Proof",
    expectedStatus: "prospect",
    newStatus: "connected",
    reason: null,
    skippedStatuses: [] as string[],
  };
  assert.deepEqual(await claimEvryChangePersonStatus(statusInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryChangePersonStatus(statusInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.people.change-status");
  const reasonAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.people.change-status-with-reason",
    stepId: "change-status-with-reason",
  });
  const reasonInput = {
    ...reasonAttempt,
    personId: quickPerson.id,
    expectedFirstName: "Quick",
    expectedLastName: "Proof",
    expectedStatus: "connected",
    newStatus: "inactive",
    reason: "Moved away",
    skippedStatuses: ["attendee"],
  };
  assert.deepEqual(await claimEvryChangePersonStatus(reasonInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryChangePersonStatus(reasonInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.people.change-status-with-reason");
  const orderRows = await db
    .select({
      personId: persons.id,
      expectedStatus: persons.status,
      expectedOrder: persons.pipelineSortOrder,
    })
    .from(persons)
    .where(
      and(
        eq(persons.churchId, plant.id),
        sql`${persons.id} in (${person.id}::uuid, ${quickPerson.id}::uuid)`
      )
    );
  const reorderAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.stages.reorder-pipeline",
    stepId: "reorder-pipeline",
  });
  const reorderInput = {
    ...reorderAttempt,
    entries: orderRows.map((row, index) => ({ ...row, newOrder: index + 10 })),
  };
  assert.deepEqual(await claimEvryReorderPeople(reorderInput), {
    status: "completed",
    affectedCount: 2,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryReorderPeople(reorderInput), {
    status: "completed",
    affectedCount: 2,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.stages.reorder-pipeline");
  const deleteBaseline = await personSnapshotForImport(
    plant.id,
    quickPerson.id
  );
  assert.ok(deleteBaseline);
  const deletePersonAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.people.delete-person",
    stepId: "delete-person",
  });
  const deletePersonInput = {
    ...deletePersonAttempt,
    personId: quickPerson.id,
    baselineJson: JSON.stringify(deleteBaseline),
  };
  assert.deepEqual(await claimEvryDeletePerson(deletePersonInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryDeletePerson(deletePersonInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.people.delete-person");

  const assessmentAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: ASSESSMENT_IDENTITY,
    stepId: "assessment",
  });
  const assessmentInput = {
    ...assessmentAttempt,
    person: {
      personId: grace.id,
      firstName: "Grace",
      lastName: "Hopper",
      status: "prospect",
    },
    values: {
      assessmentDate: "2026-08-29",
      committedScore: 5,
      committedNotes: null,
      compelledScore: 4,
      compelledNotes: null,
      contagiousScore: 3,
      contagiousNotes: null,
      courageousScore: 5,
      courageousNotes: null,
    },
  };
  assert.deepEqual(await claimEvryCreateAssessment(assessmentInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryCreateAssessment(assessmentInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add(ASSESSMENT_IDENTITY);
  const interviewAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: INTERVIEW_IDENTITY,
    stepId: "interview",
  });
  const interviewInput = {
    ...interviewAttempt,
    person: {
      personId: grace.id,
      firstName: "Grace",
      lastName: "Hopper",
      status: "prospect",
    },
    values: {
      interviewDate: "2026-08-29",
      maturityStatus: "pass",
      maturityNotes: null,
      giftedStatus: "pass",
      giftedNotes: null,
      chemistryStatus: "concern",
      chemistryNotes: "Follow up",
      rightReasonsStatus: "pass",
      rightReasonsNotes: null,
      seasonStatus: "pass",
      seasonNotes: null,
      overallResult: "qualified_with_notes",
      nextSteps: "Follow up",
    },
  };
  await claimEvryCreateInterview(interviewInput);
  assert.deepEqual(await claimEvryCreateInterview(interviewInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add(INTERVIEW_IDENTITY);
  const commitmentAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: COMMITMENT_IDENTITY,
    stepId: "commitment",
  });
  const commitmentInput = {
    ...commitmentAttempt,
    person: {
      personId: grace.id,
      firstName: "Grace",
      lastName: "Hopper",
      status: "interviewed",
    },
    values: {
      commitmentType: "core_group",
      signedDate: "2026-08-29",
      witnessedBy: owner.id,
      witnessLabel: "Proof owner",
      notes: null,
      documentKey: null,
    },
  };
  assert.deepEqual(await claimEvryCreateCommitment(commitmentInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryCreateCommitment(commitmentInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add(COMMITMENT_IDENTITY);
  const importAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: IMPORT_IDENTITY,
    stepId: "bulk-import",
  });
  const importedIds = [randomUUID(), randomUUID()];
  const importInput = {
    ...importAttempt,
    duplicateSnapshotJson: JSON.stringify([
      {
        rowNumber: 2,
        email: "katherine@scratch.invalid",
        phone: null,
        firstName: "Katherine",
        lastName: "Johnson",
        matchIds: [],
        disposition: "create",
        targetPersonId: null,
      },
      {
        rowNumber: 3,
        email: "dorothy@scratch.invalid",
        phone: null,
        firstName: "Dorothy",
        lastName: "Vaughan",
        matchIds: [],
        disposition: "create",
        targetPersonId: null,
      },
    ]),
    rows: [
      {
        rowNumber: 2,
        rowKey: "1".repeat(64),
        personId: importedIds[0]!,
        firstName: "Katherine",
        lastName: "Johnson",
        email: "katherine@scratch.invalid",
        phone: null,
        source: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: "US",
        notes: null,
        disposition: "create" as const,
        targetPersonId: null,
        expectedTargetJson: null,
      },
      {
        rowNumber: 3,
        rowKey: "2".repeat(64),
        personId: importedIds[1]!,
        firstName: "Dorothy",
        lastName: "Vaughan",
        email: "dorothy@scratch.invalid",
        phone: null,
        source: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: "US",
        notes: null,
        disposition: "create" as const,
        targetPersonId: null,
        expectedTargetJson: null,
      },
    ],
  };
  await claimEvryBulkImport(importInput);
  assert.deepEqual(await claimEvryBulkImport(importInput), {
    status: "completed",
    affectedCount: 2,
    excludedCount: 0,
  });
  provenEffects.add(IMPORT_IDENTITY);

  const mergeTarget = await personSnapshotForImport(plant.id, person.id);
  assert.ok(mergeTarget);
  const mergeAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: IMPORT_IDENTITY,
    stepId: "merge-import",
  });
  const mergeInput = {
    ...mergeAttempt,
    duplicateSnapshotJson: JSON.stringify([
      {
        rowNumber: 2,
        email: "ada@scratch.invalid",
        phone: "+1 555 0199",
        firstName: "Ada",
        lastName: "Lovelace",
        matchIds: [person.id],
        disposition: "merge",
        targetPersonId: person.id,
      },
    ]),
    rows: [
      {
        rowNumber: 2,
        rowKey: "3".repeat(64),
        personId: randomUUID(),
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@scratch.invalid",
        phone: "+1 555 0199",
        source: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: "US",
        notes: "Merged from the import review",
        disposition: "merge" as const,
        targetPersonId: person.id,
        expectedTargetJson: JSON.stringify(mergeTarget),
      },
    ],
  };
  await claimEvryBulkImport(mergeInput);
  assert.deepEqual(await claimEvryBulkImport(mergeInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(
    await db
      .select({ phone: persons.phone, notes: persons.notes })
      .from(persons)
      .where(and(eq(persons.churchId, plant.id), eq(persons.id, person.id)))
      .then(([row]) => row),
    { phone: "+1 555 0199", notes: "Merged from the import review" }
  );

  const duplicateTargetAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: IMPORT_IDENTITY,
    stepId: "duplicate-target-import",
  });
  const duplicateTargetRows = [2, 3].map((rowNumber) => ({
    ...mergeInput.rows[0],
    rowNumber,
    rowKey: String(rowNumber + 3).repeat(64),
    personId: randomUUID(),
  }));
  assert.deepEqual(
    await claimEvryBulkImport({
      ...duplicateTargetAttempt,
      duplicateSnapshotJson: JSON.stringify(
        duplicateTargetRows.map((row) => ({
          rowNumber: row.rowNumber,
          email: row.email,
          phone: row.phone,
          firstName: row.firstName,
          lastName: row.lastName,
          matchIds: [person.id],
          disposition: "merge",
          targetPersonId: person.id,
        }))
      ),
      rows: duplicateTargetRows,
    }),
    { status: "refused", excludedCount: 1 }
  );
  assert.equal(
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(evryExecutionOutcomes)
      .where(
        eq(
          evryExecutionOutcomes.attemptId,
          duplicateTargetAttempt.execution.attemptId
        )
      )
      .then(([row]) => row?.count ?? 0),
    0
  );

  const concurrentMergeBaseline = await personSnapshotForImport(
    plant.id,
    person.id
  );
  assert.ok(concurrentMergeBaseline);
  const concurrentMergeSnapshot = JSON.stringify([
    {
      rowNumber: 2,
      email: "ada@scratch.invalid",
      phone: "+1 555 0199",
      firstName: "Ada",
      lastName: "Lovelace",
      matchIds: [person.id],
      disposition: "merge",
      targetPersonId: person.id,
    },
  ]);
  const activityCountBeforeConcurrentMerge = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(personActivities)
    .where(
      and(
        eq(personActivities.churchId, plant.id),
        eq(personActivities.personId, person.id)
      )
    )
    .then(([row]) => row?.count ?? 0);
  const concurrentMergeAttempts = await Promise.all(
    ["merge-race-a", "merge-race-b"].map((stepId) =>
      seedAttempt({
        churchId: plant.id,
        actorUserId: owner.id,
        capabilityIdentity: IMPORT_IDENTITY,
        stepId,
      })
    )
  );
  const concurrentMergeOutcomes = await Promise.all(
    concurrentMergeAttempts.map((attempt, index) =>
      claimEvryBulkImport({
        ...attempt,
        duplicateSnapshotJson: concurrentMergeSnapshot,
        rows: [
          {
            ...mergeInput.rows[0],
            rowKey: String(index + 6).repeat(64),
            personId: randomUUID(),
            notes: `Concurrent merge ${index + 1}`,
            expectedTargetJson: JSON.stringify(concurrentMergeBaseline),
          },
        ],
      })
    )
  );
  assert.deepEqual(concurrentMergeOutcomes.map(({ status }) => status).sort(), [
    "completed",
    "refused",
  ]);
  assert.equal(
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(personActivities)
      .where(
        and(
          eq(personActivities.churchId, plant.id),
          eq(personActivities.personId, person.id)
        )
      )
      .then(([row]) => row?.count ?? 0),
    activityCountBeforeConcurrentMerge + 1
  );

  const rollbackAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: IMPORT_IDENTITY,
    stepId: "all-or-nothing-import",
  });
  const rollbackEmail = "must-rollback@scratch.invalid";
  const rollbackCreateId = randomUUID();
  const rollbackActivityCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(personActivities)
    .where(eq(personActivities.churchId, plant.id))
    .then(([row]) => row?.count ?? 0);
  assert.deepEqual(
    await claimEvryBulkImport({
      ...rollbackAttempt,
      duplicateSnapshotJson: JSON.stringify([
        {
          rowNumber: 2,
          email: rollbackEmail,
          phone: null,
          firstName: "Must",
          lastName: "Rollback",
          matchIds: [],
          disposition: "create",
          targetPersonId: null,
        },
        { ...JSON.parse(concurrentMergeSnapshot)[0], rowNumber: 3 },
      ]),
      rows: [
        {
          ...importInput.rows[0],
          rowKey: "8".repeat(64),
          personId: rollbackCreateId,
          firstName: "Must",
          lastName: "Rollback",
          email: rollbackEmail,
        },
        {
          ...mergeInput.rows[0],
          rowNumber: 3,
          rowKey: "9".repeat(64),
          personId: randomUUID(),
          expectedTargetJson: JSON.stringify(concurrentMergeBaseline),
        },
      ],
    }),
    { status: "refused", excludedCount: 1 }
  );
  assert.equal(
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(persons)
      .where(
        and(eq(persons.churchId, plant.id), eq(persons.email, rollbackEmail))
      )
      .then(([row]) => row?.count ?? 0),
    0
  );
  assert.equal(
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(personActivities)
      .where(eq(personActivities.churchId, plant.id))
      .then(([row]) => row?.count ?? 0),
    rollbackActivityCount
  );
  assert.deepEqual(
    await executeBulkImport(
      plant.id,
      owner.id,
      [
        {
          rowNumber: 2,
          data: {
            firstName: "Grace",
            lastName: "Hopper",
            email: "grace@scratch.invalid",
            city: "Arlington",
            notes: "Merged through the People import workflow",
          },
          valid: true,
          errors: [],
          duplicates: {
            exactMatch: {
              id: interfacePerson.id,
              displayName: "Grace Hopper",
            },
            potentialMatches: [],
          },
        },
      ],
      { 2: "merge" }
    ),
    { created: 0, merged: 1, skipped: 0, errors: 0 }
  );
  assert.deepEqual(
    await db
      .select({ city: persons.city, notes: persons.notes })
      .from(persons)
      .where(
        and(eq(persons.churchId, plant.id), eq(persons.id, interfacePerson.id))
      )
      .then(([row]) => row),
    {
      city: "Arlington",
      notes: "Merged through the People import workflow",
    }
  );

  const duplicateSnapshotJson = JSON.stringify([
    {
      rowNumber: 2,
      email: "race@scratch.invalid",
      phone: null,
      firstName: "Concurrent",
      lastName: "Writer",
      matchIds: [],
      disposition: "create",
      targetPersonId: null,
    },
  ]);
  const racingImports = await Promise.all(
    await Promise.all(
      ["duplicate-race-import-a", "duplicate-race-import-b"].map((stepId) =>
        seedAttempt({
          churchId: plant.id,
          actorUserId: owner.id,
          capabilityIdentity: IMPORT_IDENTITY,
          stepId,
        })
      )
    ).then((attempts) =>
      attempts.map((attempt, index) =>
        claimEvryBulkImport({
          ...attempt,
          duplicateSnapshotJson,
          rows: [
            {
              rowNumber: 2,
              rowKey: String(4 + index).repeat(64),
              personId: randomUUID(),
              firstName: "Concurrent",
              lastName: "Writer",
              email: "race@scratch.invalid",
              phone: null,
              source: null,
              addressLine1: null,
              addressLine2: null,
              city: null,
              state: null,
              postalCode: null,
              country: "US",
              notes: null,
              disposition: "create",
              targetPersonId: null,
              expectedTargetJson: null,
            },
          ],
        })
      )
    )
  );
  assert.deepEqual(racingImports.map((result) => result.status).sort(), [
    "completed",
    "refused",
  ]);
  assert.equal(
    await db
      .select({ count: sql<number>`count(*)::int` })
      .from(persons)
      .where(
        and(
          eq(persons.churchId, plant.id),
          eq(persons.email, "race@scratch.invalid")
        )
      )
      .then(([row]) => row?.count),
    1
  );
  const importRegistration = evryCapabilityRegistrationFor(IMPORT_IDENTITY);
  const importExecution =
    PEOPLE_FILE_EXECUTION_REGISTRY.registrationFor(IMPORT_IDENTITY);
  assert.ok(importRegistration && importExecution);
  const authorization = {
    actor: {
      userId: owner.id,
      plantId: plant.id,
      seat: "owner",
    } as EvryPlantActor,
    registration: importRegistration,
  } as unknown as EvryEffectCapabilityAuthorization;
  assert.deepEqual(
    await importExecution.executeIfCurrent({
      authorization,
      execution: importAttempt.execution,
      effectKey: importAttempt.effectKey,
      arguments: {
        attachmentReference: "unread-because-the-durable-result-exists",
        attachmentDigest: "f".repeat(64),
        originalName: "unread.csv",
        previewFingerprint: "e".repeat(64),
        duplicateSnapshotJson: importInput.duplicateSnapshotJson,
        rowsJson: JSON.stringify(importInput.rows),
        totalRows: 2,
      },
    }),
    { status: "completed", affectedCount: 2, excludedCount: 0 }
  );

  const photoAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: PEOPLE_FILE_IDENTITIES.photo,
    stepId: "upload-photo",
  });
  const photoStorageEvents: string[] = [];
  const photoStorage = {
    store(key: string) {
      photoStorageEvents.push(`store:${key}`);
      return Promise.resolve();
    },
    remove(key: string) {
      photoStorageEvents.push(`remove:${key}`);
      return Promise.resolve();
    },
    list() {
      return Promise.resolve(
        photoStorageEvents
          .filter((event) => event.startsWith("store:"))
          .map((event) => event.slice("store:".length))
      );
    },
  };
  assert.deepEqual(
    await claimEvryPersonPhotoMutation({
      ...photoAttempt,
      personId: person.id,
      expectedDigest: null,
      mutation: {
        kind: "upload",
        attachmentDigest: "f".repeat(64),
        bytes: Buffer.from("photo"),
        contentType: "image/jpeg",
      },
      storage: photoStorage,
    }),
    { status: "completed", affectedCount: 1, excludedCount: 0 }
  );
  const photoRegistration = evryCapabilityRegistrationFor(
    PEOPLE_FILE_IDENTITIES.photo
  );
  const photoExecution = PEOPLE_FILE_EXECUTION_REGISTRY.registrationFor(
    PEOPLE_FILE_IDENTITIES.photo
  );
  assert.ok(photoRegistration && photoExecution);
  assert.deepEqual(
    await photoExecution.executeIfCurrent({
      authorization: {
        actor: authorization.actor,
        registration: photoRegistration,
      } as unknown as EvryEffectCapabilityAuthorization,
      execution: photoAttempt.execution,
      effectKey: photoAttempt.effectKey,
      arguments: {
        personId: person.id,
        personLabel: "Ada Lovelace",
        expectedFirstName: "Ada",
        expectedLastName: "Lovelace",
        currentPhotoDigest: null,
        attachmentReference: "unread-because-the-durable-result-exists",
        attachmentDigest: "f".repeat(64),
        contentType: "image/jpeg",
        size: 1,
        originalName: "unread.jpg",
      },
    }),
    { status: "completed", affectedCount: 1, excludedCount: 0 }
  );
  provenEffects.add(PEOPLE_FILE_IDENTITIES.photo);

  const removePhotoAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: PEOPLE_CORE_IDENTITIES.removePhoto,
    stepId: "remove-photo",
  });
  const uploadedPhoto = await getEvryPersonPhotoSnapshot(plant.id, person.id);
  assert.ok(uploadedPhoto?.digest);
  assert.deepEqual(
    await claimEvryPersonPhotoMutation({
      ...removePhotoAttempt,
      personId: person.id,
      expectedDigest: uploadedPhoto.digest,
      mutation: { kind: "remove" },
      storage: photoStorage,
    }),
    { status: "completed", affectedCount: 1, excludedCount: 0 }
  );
  assert.equal(photoStorageEvents.length, 2);
  assert.match(photoStorageEvents[0] ?? "", /^store:people\//);
  assert.equal(
    photoStorageEvents[1],
    `remove:${photoStorageEvents[0]?.slice(6)}`
  );
  const removePhotoRegistration = evryCapabilityRegistrationFor(
    PEOPLE_CORE_IDENTITIES.removePhoto
  );
  const removePhotoExecution = PEOPLE_CORE_EXECUTION_REGISTRY.registrationFor(
    PEOPLE_CORE_IDENTITIES.removePhoto
  );
  assert.ok(removePhotoRegistration && removePhotoExecution);
  assert.deepEqual(
    await removePhotoExecution.executeIfCurrent({
      authorization: {
        actor: authorization.actor,
        registration: removePhotoRegistration,
      } as unknown as EvryEffectCapabilityAuthorization,
      execution: removePhotoAttempt.execution,
      effectKey: removePhotoAttempt.effectKey,
      arguments: {
        personId: person.id,
        personLabel: "Ada Lovelace",
        photoDigest: uploadedPhoto.digest,
      },
    }),
    { status: "completed", affectedCount: 1, excludedCount: 0 }
  );
  provenEffects.add(PEOPLE_CORE_IDENTITIES.removePhoto);

  const householdAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: CREATE_HOUSEHOLD_IDENTITY,
    stepId: "create-household",
  });
  const householdId = randomUUID();
  const householdInput = {
    ...householdAttempt,
    person: {
      personId: person.id,
      firstName: "Ada",
      lastName: "Lovelace",
      householdId: null,
      householdRole: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      country: "US",
    },
    householdId,
    householdName: "Lovelace",
    usePersonAddress: false,
  };
  await claimEvryCreateHouseholdWithHead(householdInput);
  assert.deepEqual(await claimEvryCreateHouseholdWithHead(householdInput), {
    status: "completed",
    affectedCount: 2,
    excludedCount: 0,
  });
  provenEffects.add(CREATE_HOUSEHOLD_IDENTITY);
  const householdBefore = await householdSnapshotFor(plant.id, householdId);
  assert.ok(householdBefore);
  const householdAfter = {
    ...householdBefore,
    name: "Lovelace household",
    addressLine1: "123 Proof Street",
    city: "Arlington",
    state: "VA",
    postalCode: "22201",
  };
  const updateHouseholdAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.households.update-household",
    stepId: "update-household",
  });
  const updateHouseholdInput = {
    ...updateHouseholdAttempt,
    householdId,
    before: householdBefore,
    after: householdAfter,
  };
  assert.deepEqual(await claimEvryUpdateHousehold(updateHouseholdInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryUpdateHousehold(updateHouseholdInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.households.update-household");
  const headBeforePropagation = await householdMemberSnapshotFor(
    plant.id,
    person.id
  );
  assert.ok(headBeforePropagation);
  const propagateAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.households.propagate-address",
    stepId: "propagate-address",
  });
  const propagateInput = {
    ...propagateAttempt,
    householdId,
    household: householdAfter,
    members: [headBeforePropagation],
  };
  assert.deepEqual(await claimEvryPropagateHouseholdAddress(propagateInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryPropagateHouseholdAddress(propagateInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.households.propagate-address");
  const [householdMember] = await db
    .insert(persons)
    .values({
      churchId: plant.id,
      firstName: "Household",
      lastName: "Member",
      createdBy: owner.id,
    })
    .returning({ id: persons.id });
  assert.ok(householdMember);
  const memberBeforeAdd = await householdMemberSnapshotFor(
    plant.id,
    householdMember.id
  );
  assert.ok(memberBeforeAdd);
  const addHouseholdAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.households.add-to-household",
    stepId: "add-to-household",
  });
  const addHouseholdInput = {
    ...addHouseholdAttempt,
    person: memberBeforeAdd,
    householdId,
    household: householdAfter,
    role: "member",
    afterAddress: {
      addressLine1: householdAfter.addressLine1,
      addressLine2: householdAfter.addressLine2,
      city: householdAfter.city,
      state: householdAfter.state,
      postalCode: householdAfter.postalCode,
      country: householdAfter.country,
    },
  };
  assert.deepEqual(await claimEvryAddToHousehold(addHouseholdInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryAddToHousehold(addHouseholdInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.households.add-to-household");
  const memberBeforeRemove = await householdMemberSnapshotFor(
    plant.id,
    householdMember.id
  );
  assert.ok(memberBeforeRemove);
  const removeHouseholdAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.households.remove-from-household",
    stepId: "remove-from-household",
  });
  const removeHouseholdInput = {
    ...removeHouseholdAttempt,
    person: memberBeforeRemove,
    household: householdAfter,
  };
  assert.deepEqual(await claimEvryRemoveFromHousehold(removeHouseholdInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryRemoveFromHousehold(removeHouseholdInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.households.remove-from-household");
  const headBeforeRemove = await householdMemberSnapshotFor(
    plant.id,
    person.id
  );
  assert.ok(headBeforeRemove);
  const removeHeadAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.households.remove-from-household",
    stepId: "remove-head-from-household",
  });
  assert.equal(
    (
      await claimEvryRemoveFromHousehold({
        ...removeHeadAttempt,
        person: headBeforeRemove,
        household: householdAfter,
      })
    ).status,
    "completed"
  );
  const deleteHouseholdAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.households.delete-household",
    stepId: "delete-household",
  });
  const deleteHouseholdInput = {
    ...deleteHouseholdAttempt,
    householdId,
    household: householdAfter,
  };
  assert.deepEqual(await claimEvryDeleteHousehold(deleteHouseholdInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryDeleteHousehold(deleteHouseholdInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.households.delete-household");

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
  provenEffects.add(TAG_IDENTITY);
  const removeTagAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.tags.remove-tag",
    stepId: "remove-tag",
  });
  const removeTagInput = { ...tagInput, ...removeTagAttempt };
  assert.deepEqual(await claimEvryRemoveTag(removeTagInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryRemoveTag(removeTagInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.tags.remove-tag");
  const createTagAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.tags.create-tag",
    stepId: "create-tag",
  });
  const createTagInput = {
    ...createTagAttempt,
    name: "Created by Evry proof",
    color: "green",
  };
  assert.deepEqual(await claimEvryCreateTag(createTagInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryCreateTag(createTagInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.tags.create-tag");
  const createdTag = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.churchId, plant.id), eq(tags.name, createTagInput.name)))
    .then(([row]) => row);
  assert.ok(createdTag);
  const updateTagAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.tags.update-tag",
    stepId: "update-tag",
  });
  const updateTagInput = {
    ...updateTagAttempt,
    tagId: createdTag.id,
    expectedName: createTagInput.name,
    expectedColor: "green",
    name: "Updated by Evry proof",
    color: "purple",
  };
  assert.deepEqual(await claimEvryUpdateTag(updateTagInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryUpdateTag(updateTagInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.tags.update-tag");
  const deleteTagAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.tags.delete-tag",
    stepId: "delete-tag",
  });
  const deleteTagInput = {
    ...deleteTagAttempt,
    tagId: tag.id,
    expectedName: "Follow-up",
    expectedColor: "blue",
    expectedPersonIds: [] as string[],
  };
  assert.deepEqual(await claimEvryDeleteTag(deleteTagInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryDeleteTag(deleteTagInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.tags.delete-tag");

  const addSkillAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.skills.add-skill",
    stepId: "add-skill",
  });
  const addSkillInput = {
    ...addSkillAttempt,
    personId: person.id,
    expectedFirstName: "Ada",
    expectedLastName: "Lovelace",
    category: "Technology",
    name: "Computing",
    proficiency: "advanced",
    notes: "Production proof",
  };
  assert.deepEqual(await claimEvryAddSkill(addSkillInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryAddSkill(addSkillInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.skills.add-skill");
  const skill = await db
    .select({ id: skillsInventory.id })
    .from(skillsInventory)
    .where(
      and(
        eq(skillsInventory.churchId, plant.id),
        eq(skillsInventory.personId, person.id),
        eq(skillsInventory.skillName, "Computing")
      )
    )
    .then(([row]) => row);
  assert.ok(skill);
  const updateSkillAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.skills.update-skill",
    stepId: "update-skill",
  });
  const updateSkillInput = {
    ...updateSkillAttempt,
    skillId: skill.id,
    personId: person.id,
    expectedFirstName: "Ada",
    expectedLastName: "Lovelace",
    expectedCategory: "Technology",
    expectedName: "Computing",
    expectedProficiency: "advanced",
    expectedNotes: "Production proof",
    category: "Technology",
    name: "Systems",
    proficiency: "expert",
    notes: "Updated production proof",
  };
  assert.deepEqual(await claimEvryUpdateSkill(updateSkillInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryUpdateSkill(updateSkillInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.skills.update-skill");
  const removeSkillAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: "people.crm.skills.remove-skill",
    stepId: "remove-skill",
  });
  const removeSkillInput = {
    ...removeSkillAttempt,
    skillId: skill.id,
    personId: person.id,
    expectedFirstName: "Ada",
    expectedLastName: "Lovelace",
    expectedCategory: "Technology",
    expectedName: "Systems",
    expectedProficiency: "expert",
    expectedNotes: "Updated production proof",
  };
  assert.deepEqual(await claimEvryRemoveSkill(removeSkillInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await claimEvryRemoveSkill(removeSkillInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  provenEffects.add("people.crm.skills.remove-skill");
  assert.deepEqual(await claimEvryAssignTag(tagInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });

  const [
    activityCount,
    outcomeCount,
    membershipCount,
    createdPersonCount,
    householdCount,
    assessmentCount,
    interviewCount,
    commitmentCount,
    graceStatus,
    importedCount,
  ] = await Promise.all([
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
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(persons)
      .where(
        and(
          eq(persons.churchId, plant.id),
          eq(persons.email, "grace@scratch.invalid")
        )
      )
      .then(([row]) => row?.count ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(households)
      .where(
        and(eq(households.churchId, plant.id), eq(households.id, householdId))
      )
      .then(([row]) => row?.count ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(assessments)
      .where(
        and(
          eq(assessments.churchId, plant.id),
          eq(assessments.personId, grace.id)
        )
      )
      .then(([row]) => row?.count ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(interviews)
      .where(
        and(
          eq(interviews.churchId, plant.id),
          eq(interviews.personId, grace.id)
        )
      )
      .then(([row]) => row?.count ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(commitments)
      .where(
        and(
          eq(commitments.churchId, plant.id),
          eq(commitments.personId, grace.id)
        )
      )
      .then(([row]) => row?.count ?? 0),
    db
      .select({ status: persons.status })
      .from(persons)
      .where(and(eq(persons.churchId, plant.id), eq(persons.id, grace.id)))
      .then(([row]) => row?.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(persons)
      .where(
        and(
          eq(persons.churchId, plant.id),
          sql`${persons.id} in (${importedIds[0]}::uuid, ${importedIds[1]}::uuid)`
        )
      )
      .then(([row]) => row?.count ?? 0),
  ]);
  assert.ok(activityCount >= 10);
  assert.ok(outcomeCount >= EFFECT_IDENTITIES.length);
  assert.equal(membershipCount, 0);
  assert.equal(createdPersonCount, 2);
  assert.equal(householdCount, 0);
  assert.equal(assessmentCount, 1);
  assert.equal(interviewCount, 1);
  assert.equal(commitmentCount, 1);
  assert.equal(graceStatus, "core_group");
  assert.equal(importedCount, 2);

  const [readHousehold] = await db
    .insert(households)
    .values({ churchId: plant.id, name: "Read proof household" })
    .returning({ id: households.id });
  assert.ok(readHousehold);
  const commitmentForRead = await db
    .select({ id: commitments.id })
    .from(commitments)
    .where(
      and(
        eq(commitments.churchId, plant.id),
        eq(commitments.personId, grace.id)
      )
    )
    .then(([row]) => row);
  assert.ok(commitmentForRead);
  await db
    .update(commitments)
    .set({
      documentUrl: `commitments/${plant.id}/${grace.id}/${randomUUID()}.pdf`,
    })
    .where(eq(commitments.id, commitmentForRead.id));
  const csvBytes = Buffer.from(
    "First Name *,Last Name *,Email\nRead,Preview,read-preview@scratch.invalid"
  );
  const stagedCsv = await stageEvryPeopleAttachment({
    actor: authorization.actor,
    kind: "people_csv",
    personId: null,
    file: {
      name: "people-proof.csv",
      type: "text/csv",
      size: csvBytes.length,
      async arrayBuffer() {
        return csvBytes.buffer.slice(
          csvBytes.byteOffset,
          csvBytes.byteOffset + csvBytes.byteLength
        ) as ArrayBuffer;
      },
    },
  });
  assert.ok(stagedCsv);
  const readInputs: Readonly<Record<string, unknown>> = {
    "people.crm.assessments.get-assessments": { personId: grace.id },
    "people.crm.assessments.get-commitment-download-url": {
      commitmentId: commitmentForRead.id,
    },
    "people.crm.assessments.get-commitments": { personId: grace.id },
    "people.crm.assessments.get-interviews": { personId: grace.id },
    "people.crm.assessments.get-latest-commitment": { personId: grace.id },
    "people.crm.duplicates.check-for-duplicates": {
      email: "ada@scratch.invalid",
      firstName: "Ada",
      lastName: "Lovelace",
      phone: null,
    },
    "people.crm.exports.export-people": {
      status: [],
      source: [],
      search: null,
      tagIds: [],
    },
    "people.crm.households.get-household": {
      householdId: readHousehold.id,
    },
    "people.crm.households.get-household-members": {
      householdId: readHousehold.id,
    },
    "people.crm.households.list-households": {},
    "people.crm.imports.download-csv-template": {},
    "people.crm.imports.preview-import": {
      attachmentReference: stagedCsv.reference,
      attachmentDigest: stagedCsv.metadata.digest,
    },
    "people.crm.notes.get-activities": { personId: person.id, cursor: null },
    "people.crm.notes.get-more-activities": {
      personId: person.id,
      cursor: null,
    },
    "people.crm.people.get-person": { personId: person.id },
    "people.crm.people.get-person-photo": { personId: person.id },
    "people.crm.people.list-people": { search: "Ada" },
    "people.crm.people.load-more-people": { cursor: person.id },
    "people.crm.skills.get-person-skills": { personId: person.id },
    "people.crm.stages.get-pipeline-data": {},
    "people.crm.tags.get-person-tags": { personId: person.id },
    "people.crm.tags.list-tags": {},
  };
  const provenReads = new Set<string>();
  try {
    for (const registration of PRODUCTION_EVRY_READ_REGISTRATIONS) {
      const input = readInputs[registration.capabilityIdentity];
      assert.notEqual(
        input,
        undefined,
        `Missing live read input for ${registration.capabilityIdentity}`
      );
      const authority = evryCapabilityRegistrationFor(
        registration.capabilityIdentity
      );
      assert.ok(authority);
      const artifact = await executeAuthorizedEvryRead(
        registration,
        {
          actor: authorization.actor,
          registration: authority,
        } as unknown as EvryReadCapabilityAuthorization,
        { literalUserText: "production read proof", pageContext: null },
        input
      );
      assert.ok(
        artifact,
        `Production read returned no artifact: ${registration.capabilityIdentity}`
      );
      if (artifact.kind !== "read") {
        assert.fail(
          `Production read returned ${artifact.kind}: ${registration.capabilityIdentity}`
        );
      }
      const storedArtifact = storedEvryReadArtifactDocument(artifact);
      assert.equal(storedArtifact.kind, "read");
      const replayedArtifact = await executeAuthorizedEvryRead(
        registration,
        {
          actor: authorization.actor,
          registration: authority,
        } as unknown as EvryReadCapabilityAuthorization,
        { literalUserText: "production read replay proof", pageContext: null },
        input
      );
      assert.ok(replayedArtifact);
      if (replayedArtifact.kind !== "read") {
        assert.fail(
          `Production read replay returned ${replayedArtifact.kind}: ${registration.capabilityIdentity}`
        );
      }
      assert.deepEqual(
        storedEvryReadArtifactDocument(replayedArtifact),
        storedArtifact
      );
      provenReads.add(registration.capabilityIdentity);
    }
  } finally {
    await removeEvryPeopleAttachment({
      actor: authorization.actor,
      reference: stagedCsv.reference,
      expectedKind: "people_csv",
    });
  }
  assert.deepEqual(
    [...provenReads].sort(),
    generatedPeopleInventory.capabilities
      .filter(({ operationKind }) => operationKind === "read")
      .map(({ identity }) => identity)
      .sort()
  );
  assert.deepEqual([...provenEffects].sort(), [...EFFECT_IDENTITIES].sort());
  for (const identity of EFFECT_IDENTITIES) {
    const registration =
      PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(identity);
    const capability = evryCapabilityRegistrationFor(identity);
    assert.ok(registration && capability);
    const invalidAttempt = await seedAttempt({
      churchId: plant.id,
      actorUserId: owner.id,
      capabilityIdentity: identity,
      stepId: `invalid-${identity.split(".").at(-1)}`,
    });
    assert.deepEqual(
      await registration.executeIfCurrent({
        authorization: {
          actor: authorization.actor,
          registration: capability,
        } as unknown as EvryEffectCapabilityAuthorization,
        execution: invalidAttempt.execution,
        effectKey: invalidAttempt.effectKey,
        arguments: {} as never,
      }),
      { status: "refused", excludedCount: 1 },
      `Expected operation-specific refusal for ${identity}`
    );
  }
  const completedEffectIdentities = new Set(
    (
      await db
        .select({ identity: evryExecutionOutcomes.capabilityIdentity })
        .from(evryExecutionOutcomes)
        .where(
          and(
            eq(evryExecutionOutcomes.churchId, plant.id),
            eq(evryExecutionOutcomes.status, "completed")
          )
        )
    ).map(({ identity }) => identity)
  );
  assert.deepEqual(
    EFFECT_IDENTITIES.filter(
      (identity) => !completedEffectIdentities.has(identity)
    ),
    []
  );

  process.stdout.write(
    `People effect live proof passed (${completedEffectIdentities.size} operation-specific identities)\n`
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
