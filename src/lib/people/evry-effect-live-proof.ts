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
  evryCapabilityRegistrationFor,
  type EvryEffectCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { mintEvryPlanRequestKey } from "@/lib/evry/plans";

import { claimEvryPersonNote } from "./activity";
import { claimEvryCreatePerson } from "./evry-core";
import { claimEvryBulkImport } from "./evry-files";
import { claimEvryCreateHouseholdWithHead } from "./evry-households";
import {
  claimEvryCreateAssessment,
  claimEvryCreateCommitment,
  claimEvryCreateInterview,
} from "./evry-milestones";
import { claimEvryAssignTag } from "./evry-taxonomies";
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

  const assessmentAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: ASSESSMENT_IDENTITY,
    stepId: "assessment",
  });
  assert.deepEqual(
    await claimEvryCreateAssessment({
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
    }),
    { status: "completed", affectedCount: 1, excludedCount: 0 }
  );
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
  const commitmentAttempt = await seedAttempt({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: COMMITMENT_IDENTITY,
    stepId: "commitment",
  });
  assert.deepEqual(
    await claimEvryCreateCommitment({
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
    }),
    { status: "completed", affectedCount: 1, excludedCount: 0 }
  );
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
      },
      {
        rowNumber: 3,
        email: "dorothy@scratch.invalid",
        phone: null,
        firstName: "Dorothy",
        lastName: "Vaughan",
        matchIds: [],
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

  const [mergeTarget] = await db
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
    .where(and(eq(persons.churchId, plant.id), eq(persons.id, person.id)));
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
        createCount: 2,
        mergeCount: 0,
        skipCount: 0,
        invalidCount: 0,
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
  assert.equal(activityCount, 5);
  assert.equal(outcomeCount, 13);
  assert.equal(membershipCount, 1);
  assert.equal(createdPersonCount, 2);
  assert.equal(householdCount, 1);
  assert.equal(assessmentCount, 1);
  assert.equal(interviewCount, 1);
  assert.equal(commitmentCount, 1);
  assert.equal(graceStatus, "core_group");
  assert.equal(importedCount, 2);

  process.stdout.write("People effect live proof passed\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
