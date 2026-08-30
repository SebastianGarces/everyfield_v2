import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  communicationRecipients,
  communications,
  evryActionPlans,
  evryActionPlanStates,
  evryExecutionAttempts,
  evryExecutionOutcomes,
  evryPlanConfirmations,
  evryProductAuditEvents,
  messageTemplates,
  persons,
  sendingChurches,
  users,
} from "@/db/schema";
import {
  correlationForPlanRequest,
  executionAttemptKey,
  executionEffectKey,
  planEventKey,
} from "@/lib/evry/audit/identity";
import {
  evryCapabilityRegistrationFor,
  type EvryEffectCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryEffectInput } from "@/lib/evry/executor";
import { mintEvryPlanRequestKey } from "@/lib/evry/plans";
import { recordAddressSuppression } from "@/lib/notifications/channels/suppression";

import {
  EVRY_COMMUNICATION_PERMANENT_PREFIX,
  type EvryCommunicationMailer,
  resolveEvryCommunicationAudience,
  sendFrozenEvryCommunication,
} from "./evry-send";
import { createCommunicationEvryMessageExecutions } from "@/lib/evry/capabilities/communication/messages";
import {
  claimEvryCommunicationSystemTemplateUpdate,
  claimEvryCommunicationTemplateCreate,
  claimEvryCommunicationTemplateDelete,
  claimEvryCommunicationTemplateFork,
  claimEvryCommunicationTemplateUpdate,
  getEvryCommunicationTemplateSnapshot,
} from "./evry-template-effect";
import { getTemplate, storedTemplateContent } from "./templates";

const CREATE_TEMPLATE = "communication.templates.create";
const UPDATE_TEMPLATE = "communication.templates.update";
const DELETE_TEMPLATE = "communication.templates.delete";
const FORK_TEMPLATE = "communication.templates.fork";
const SEND_MESSAGE = "communication.messages.send";
const RESEND_MESSAGE = "communication.resends.send-to-non-openers";
const FINGERPRINT = "a".repeat(64);

type LiveLayer = "execution" | "idempotency" | "errors";
const effectOutcomes = new Set<string>();

function recordEffectOutcome(identity: string, layer: LiveLayer) {
  effectOutcomes.add(`${identity}:${layer}`);
}

async function seedEffect(input: {
  churchId: string;
  actorUserId: string;
  capabilityIdentity: string;
  stepId: string;
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
            id: input.stepId,
            capabilityIdentity: input.capabilityIdentity,
            effectClass:
              input.capabilityIdentity === SEND_MESSAGE ||
              input.capabilityIdentity === RESEND_MESSAGE
                ? "outbound_communication"
                : "database_write",
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
  const registration = evryCapabilityRegistrationFor(input.capabilityIdentity);
  assert.ok(registration?.operationKind === "effect");
  const actor = {
    userId: input.actorUserId,
    plantId: input.churchId,
    seat: "owner",
  } as unknown as EvryPlantActor;
  return {
    authorization: {
      actor,
      registration,
    } as unknown as EvryEffectCapabilityAuthorization,
    effectKey: executionEffectKey(planId, FINGERPRINT, input.stepId),
    arguments: {},
    execution: {
      attemptId,
      planId,
      plantId: input.churchId,
      actorUserId: input.actorUserId,
      fingerprint: FINGERPRINT,
      correlationId,
      stepId: input.stepId,
      capabilityIdentity: input.capabilityIdentity,
    },
  } satisfies EvryEffectInput;
}

function content(body: string) {
  return {
    name: "Follow up",
    description: null,
    category: "follow_up",
    channel: "email",
    subject: "Hello",
    ...storedTemplateContent(body),
  } as const;
}

function deterministicMailer(
  outcomes: readonly (
    | "accepted"
    | "accepted_response_lost"
    | "retryable"
    | "permanent"
  )[] = ["accepted"]
) {
  const calls: string[] = [];
  const deliveries = new Map<string, string>();
  let index = 0;
  const mailer: EvryCommunicationMailer = {
    async send(input) {
      calls.push(input.idempotencyKey);
      const existing = deliveries.get(input.idempotencyKey);
      if (existing) return { status: "accepted", providerId: existing };
      const outcome = outcomes[Math.min(index++, outcomes.length - 1)];
      if (outcome === "retryable") {
        return { status: "retryable", reason: "temporary outage" };
      }
      if (outcome === "permanent") {
        return { status: "permanent", reason: "rejected address" };
      }
      const providerId = `fake-${deliveries.size + 1}`;
      deliveries.set(input.idempotencyKey, providerId);
      if (outcome === "accepted_response_lost") {
        throw new Error("response lost after provider acceptance");
      }
      return { status: "accepted", providerId };
    },
  };
  return { mailer, calls, deliveries };
}

async function main(): Promise<void> {
  const [plant, foreignPlant] = await Promise.all([
    db
      .insert(churches)
      .values({ name: "__Communication effect proof__" })
      .returning({ id: churches.id })
      .then(([row]) => row),
    db
      .insert(churches)
      .values({ name: "__Foreign Communication effect proof__" })
      .returning({ id: churches.id })
      .then(([row]) => row),
  ]);
  assert.ok(plant && foreignPlant);
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
  const recipientEmail = `${randomUUID()}@scratch.invalid`;
  const suppressedEmail = `${randomUUID()}@scratch.invalid`;
  const [recipient, duplicateAddress, missingAddress, suppressed, foreign] =
    await Promise.all([
      db
        .insert(persons)
        .values({
          churchId: plant.id,
          firstName: "Ada",
          lastName: "Lovelace",
          email: recipientEmail,
          createdBy: owner.id,
        })
        .returning({ id: persons.id })
        .then(([row]) => row),
      db
        .insert(persons)
        .values({
          churchId: plant.id,
          firstName: "Ada Duplicate",
          lastName: "Lovelace",
          email: recipientEmail.toUpperCase(),
          createdBy: owner.id,
        })
        .returning({ id: persons.id })
        .then(([row]) => row),
      db
        .insert(persons)
        .values({
          churchId: plant.id,
          firstName: "No",
          lastName: "Address",
          createdBy: owner.id,
        })
        .returning({ id: persons.id })
        .then(([row]) => row),
      db
        .insert(persons)
        .values({
          churchId: plant.id,
          firstName: "Suppressed",
          lastName: "Address",
          email: suppressedEmail,
          createdBy: owner.id,
        })
        .returning({ id: persons.id })
        .then(([row]) => row),
      db
        .insert(persons)
        .values({
          churchId: foreignPlant.id,
          firstName: "Foreign",
          lastName: "Person",
          email: `${randomUUID()}@scratch.invalid`,
          createdBy: owner.id,
        })
        .returning({ id: persons.id })
        .then(([row]) => row),
    ]);
  assert.ok(
    recipient && duplicateAddress && missingAddress && suppressed && foreign
  );
  const [foreignTemplate] = await db
    .insert(messageTemplates)
    .values({
      churchId: foreignPlant.id,
      name: "Foreign mislabeled system template",
      category: "other",
      channel: "email",
      subject: "Foreign",
      body: "Foreign",
      bodyHtml: "<p>Foreign</p>",
      isSystem: true,
    })
    .returning({ id: messageTemplates.id });
  assert.ok(foreignTemplate);
  assert.equal(await getTemplate(foreignTemplate.id, plant.id), undefined);
  assert.equal(
    await getEvryCommunicationTemplateSnapshot({
      churchId: plant.id,
      templateId: foreignTemplate.id,
    }),
    null
  );
  await recordAddressSuppression({
    email: suppressedEmail,
    reason: "hard_bounce",
    source: "live-proof",
  });

  const createdTemplateId = randomUUID();
  const createEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: CREATE_TEMPLATE,
    stepId: "create-template",
  });
  const createInput = {
    effect: createEffect,
    identity: CREATE_TEMPLATE,
    templateId: createdTemplateId,
    content: content("<p>Hello Ada</p>"),
  };
  assert.deepEqual(await claimEvryCommunicationTemplateCreate(createInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  recordEffectOutcome(CREATE_TEMPLATE, "execution");
  assert.deepEqual(await claimEvryCommunicationTemplateCreate(createInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  recordEffectOutcome(CREATE_TEMPLATE, "idempotency");
  assert.deepEqual(
    await claimEvryCommunicationTemplateCreate({
      ...createInput,
      identity: UPDATE_TEMPLATE,
    }),
    { status: "refused", excludedCount: 1 }
  );
  recordEffectOutcome(CREATE_TEMPLATE, "errors");
  const createdSnapshot = await getEvryCommunicationTemplateSnapshot({
    churchId: plant.id,
    templateId: createdTemplateId,
  });
  assert.ok(createdSnapshot);

  const updateEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: UPDATE_TEMPLATE,
    stepId: "update-template",
  });
  const updateInput = {
    effect: updateEffect,
    identity: UPDATE_TEMPLATE,
    templateId: createdTemplateId,
    expectedUpdatedAt: createdSnapshot.updatedAt,
    content: content("<p>Updated Ada</p>"),
  };
  assert.deepEqual(await claimEvryCommunicationTemplateUpdate(updateInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  recordEffectOutcome(UPDATE_TEMPLATE, "execution");
  assert.deepEqual(await claimEvryCommunicationTemplateUpdate(updateInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  recordEffectOutcome(UPDATE_TEMPLATE, "idempotency");
  const staleUpdateEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: UPDATE_TEMPLATE,
    stepId: "stale-update-template",
  });
  assert.deepEqual(
    await claimEvryCommunicationTemplateUpdate({
      ...updateInput,
      effect: staleUpdateEffect,
      expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
    }),
    { status: "refused", excludedCount: 1 }
  );
  recordEffectOutcome(UPDATE_TEMPLATE, "errors");

  const systemRows = await db
    .insert(messageTemplates)
    .values([
      {
        name: "Legacy system fork",
        category: "other",
        channel: "email",
        subject: "Legacy",
        body: "Legacy plain text",
        bodyHtml: null,
        mergeFields: ["first_name"],
        isSystem: true,
      },
      {
        name: "Legacy system edit",
        category: "other",
        channel: "email",
        subject: "Legacy",
        body: "Legacy plain text",
        bodyHtml: null,
        mergeFields: ["first_name"],
        isSystem: true,
      },
      {
        name: "System merge-field drift",
        category: "other",
        channel: "email",
        subject: "Legacy",
        body: "Legacy plain text",
        bodyHtml: null,
        mergeFields: ["first_name"],
        isSystem: true,
      },
    ])
    .returning();
  assert.equal(systemRows.length, 3);
  const [systemFork, systemEdit, systemDrift] = systemRows;
  assert.ok(systemFork && systemEdit && systemDrift);
  const forkSnapshot = await getEvryCommunicationTemplateSnapshot({
    churchId: plant.id,
    templateId: systemFork.id,
  });
  const editSnapshot = await getEvryCommunicationTemplateSnapshot({
    churchId: plant.id,
    templateId: systemEdit.id,
  });
  const driftSnapshot = await getEvryCommunicationTemplateSnapshot({
    churchId: plant.id,
    templateId: systemDrift.id,
  });
  assert.ok(forkSnapshot && editSnapshot && driftSnapshot);
  const forkEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: FORK_TEMPLATE,
    stepId: "fork-template",
  });
  const forkId = randomUUID();
  assert.deepEqual(
    await claimEvryCommunicationTemplateFork({
      effect: forkEffect,
      identity: FORK_TEMPLATE,
      source: forkSnapshot,
      forkId,
    }),
    { status: "completed", affectedCount: 1, excludedCount: 0 }
  );
  recordEffectOutcome(FORK_TEMPLATE, "execution");
  assert.deepEqual(
    await claimEvryCommunicationTemplateFork({
      effect: forkEffect,
      identity: FORK_TEMPLATE,
      source: forkSnapshot,
      forkId,
    }),
    { status: "completed", affectedCount: 1, excludedCount: 0 }
  );
  recordEffectOutcome(FORK_TEMPLATE, "idempotency");
  const frozenFork = await getEvryCommunicationTemplateSnapshot({
    churchId: plant.id,
    templateId: forkId,
  });
  assert.deepEqual(frozenFork?.mergeFields, forkSnapshot.mergeFields);
  const staleForkEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: FORK_TEMPLATE,
    stepId: "stale-fork-template",
  });
  assert.deepEqual(
    await claimEvryCommunicationTemplateFork({
      effect: staleForkEffect,
      identity: FORK_TEMPLATE,
      source: {
        ...forkSnapshot,
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
      forkId: randomUUID(),
    }),
    { status: "refused", excludedCount: 1 }
  );
  recordEffectOutcome(FORK_TEMPLATE, "errors");

  await db
    .update(messageTemplates)
    .set({ mergeFields: ["church_name"] })
    .where(eq(messageTemplates.id, systemDrift.id));
  const drifted = await getEvryCommunicationTemplateSnapshot({
    churchId: plant.id,
    templateId: systemDrift.id,
  });
  assert.ok(drifted);
  assert.equal(
    drifted.updatedAt,
    driftSnapshot.updatedAt,
    "the regression changes only merge_fields, as the seed script can"
  );
  assert.notDeepEqual(drifted.mergeFields, driftSnapshot.mergeFields);
  const driftedForkEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: FORK_TEMPLATE,
    stepId: "drifted-fork",
  });
  assert.deepEqual(
    await claimEvryCommunicationTemplateFork({
      effect: driftedForkEffect,
      identity: FORK_TEMPLATE,
      source: driftSnapshot,
      forkId: randomUUID(),
    }),
    { status: "refused", excludedCount: 1 }
  );
  const driftedEditEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: UPDATE_TEMPLATE,
    stepId: "drifted-system-update",
  });
  assert.deepEqual(
    await claimEvryCommunicationSystemTemplateUpdate({
      effect: driftedEditEffect,
      identity: UPDATE_TEMPLATE,
      source: driftSnapshot,
      forkId: randomUUID(),
      content: content("<p>Unapproved merge fields</p>"),
    }),
    { status: "refused", excludedCount: 1 }
  );
  const systemEditEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: UPDATE_TEMPLATE,
    stepId: "edit-system-template",
  });
  const systemEditForkId = randomUUID();
  assert.deepEqual(
    await claimEvryCommunicationSystemTemplateUpdate({
      effect: systemEditEffect,
      identity: UPDATE_TEMPLATE,
      source: editSnapshot,
      forkId: systemEditForkId,
      content: content("<p>Edited legacy content</p>"),
    }),
    { status: "completed", affectedCount: 1, excludedCount: 0 }
  );
  const editedSystemCopy = await getEvryCommunicationTemplateSnapshot({
    churchId: plant.id,
    templateId: systemEditForkId,
  });
  assert.deepEqual(editedSystemCopy?.mergeFields, editSnapshot.mergeFields);

  const deletableId = randomUUID();
  await db.insert(messageTemplates).values({
    id: deletableId,
    churchId: plant.id,
    ...content("Delete me"),
    isSystem: false,
  });
  const deletable = await getEvryCommunicationTemplateSnapshot({
    churchId: plant.id,
    templateId: deletableId,
  });
  assert.ok(deletable);
  const deleteEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: DELETE_TEMPLATE,
    stepId: "delete-template",
  });
  assert.deepEqual(
    await claimEvryCommunicationTemplateDelete({
      effect: deleteEffect,
      identity: DELETE_TEMPLATE,
      templateId: deletableId,
      expectedUpdatedAt: deletable.updatedAt,
    }),
    { status: "completed", affectedCount: 1, excludedCount: 0 }
  );
  recordEffectOutcome(DELETE_TEMPLATE, "execution");
  assert.deepEqual(
    await claimEvryCommunicationTemplateDelete({
      effect: deleteEffect,
      identity: DELETE_TEMPLATE,
      templateId: deletableId,
      expectedUpdatedAt: deletable.updatedAt,
    }),
    { status: "completed", affectedCount: 1, excludedCount: 0 }
  );
  recordEffectOutcome(DELETE_TEMPLATE, "idempotency");
  const staleDeleteEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: DELETE_TEMPLATE,
    stepId: "stale-delete-template",
  });
  assert.deepEqual(
    await claimEvryCommunicationTemplateDelete({
      effect: staleDeleteEffect,
      identity: DELETE_TEMPLATE,
      templateId: createdTemplateId,
      expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
    }),
    { status: "refused", excludedCount: 1 }
  );
  recordEffectOutcome(DELETE_TEMPLATE, "errors");

  const audience = await resolveEvryCommunicationAudience({
    churchId: plant.id,
    recipientIds: [
      recipient.id,
      recipient.id,
      duplicateAddress.id,
      missingAddress.id,
      suppressed.id,
      foreign.id,
    ],
    subject: "Hello {{first_name}}",
    body: "<p>Welcome {{first_name}}</p>",
  });
  assert.ok(audience);

  // Authorization was minted while this was one exact plant account. A
  // competing tenancy appears before execution; neither durable preparation
  // nor the provider seam may be reached through that stale authorization.
  const dualTenancyEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: SEND_MESSAGE,
    stepId: "send-dual-tenancy",
  });
  const dualTenancyMailer = deterministicMailer();
  const dualTenancyCommunicationId = randomUUID();
  const [competingTenancy] = await db
    .insert(sendingChurches)
    .values({ name: "__Communication competing tenancy__" })
    .returning({ id: sendingChurches.id });
  assert.ok(competingTenancy);
  await db
    .update(users)
    .set({ sendingChurchId: competingTenancy.id })
    .where(eq(users.id, owner.id));
  let dualTenancyResult;
  try {
    dualTenancyResult = await sendFrozenEvryCommunication({
      effect: dualTenancyEffect,
      identity: SEND_MESSAGE,
      communicationId: dualTenancyCommunicationId,
      audience,
      mailer: dualTenancyMailer.mailer,
    });
  } finally {
    await db
      .update(users)
      .set({ sendingChurchId: null })
      .where(eq(users.id, owner.id));
  }
  assert.deepEqual(dualTenancyResult, {
    status: "refused",
    excludedCount: 1,
  });
  assert.equal(dualTenancyMailer.calls.length, 0);
  assert.deepEqual(
    await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(communications)
        .where(eq(communications.id, dualTenancyCommunicationId))
        .then(([row]) => row?.count ?? -1),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(communicationRecipients)
        .where(
          eq(
            communicationRecipients.communicationId,
            dualTenancyCommunicationId
          )
        )
        .then(([row]) => row?.count ?? -1),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(evryExecutionOutcomes)
        .where(
          eq(evryExecutionOutcomes.planId, dualTenancyEffect.execution.planId)
        )
        .then(([row]) => row?.count ?? -1),
    ]),
    [0, 0, 0]
  );
  assert.equal(audience.recipients.length, 1);
  assert.equal(
    audience.exclusions.reduce((sum, item) => sum + item.count, 0),
    5
  );

  const concurrentEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: SEND_MESSAGE,
    stepId: "send-concurrently",
  });
  const concurrentMailer = deterministicMailer();
  const concurrentInput = {
    effect: concurrentEffect,
    identity: SEND_MESSAGE,
    communicationId: randomUUID(),
    audience,
    mailer: concurrentMailer.mailer,
  };
  assert.deepEqual(
    await Promise.all([
      sendFrozenEvryCommunication(concurrentInput),
      sendFrozenEvryCommunication(concurrentInput),
    ]),
    [
      { status: "completed", affectedCount: 1, excludedCount: 5 },
      { status: "completed", affectedCount: 1, excludedCount: 5 },
    ]
  );
  recordEffectOutcome(SEND_MESSAGE, "execution");
  assert.equal(new Set(concurrentMailer.calls).size, 1);
  assert.equal(concurrentMailer.deliveries.size, 1);
  assert.deepEqual(await sendFrozenEvryCommunication(concurrentInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 5,
  });
  assert.equal(concurrentMailer.deliveries.size, 1);
  recordEffectOutcome(SEND_MESSAGE, "idempotency");

  const transientEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: SEND_MESSAGE,
    stepId: "send-transient-retry",
  });
  const transientMailer = deterministicMailer(["retryable", "accepted"]);
  const transientInput = {
    effect: transientEffect,
    identity: SEND_MESSAGE,
    communicationId: randomUUID(),
    audience,
    mailer: transientMailer.mailer,
  };
  assert.deepEqual(await sendFrozenEvryCommunication(transientInput), {
    status: "retryable",
  });
  assert.deepEqual(await sendFrozenEvryCommunication(transientInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 5,
  });
  assert.equal(new Set(transientMailer.calls).size, 1);
  assert.equal(transientMailer.deliveries.size, 1);

  const shrinkEmail = `${randomUUID()}@scratch.invalid`;
  const [shrinkPerson] = await db
    .insert(persons)
    .values({
      churchId: plant.id,
      firstName: "Later",
      lastName: "Suppressed",
      email: shrinkEmail,
      createdBy: owner.id,
    })
    .returning({ id: persons.id });
  assert.ok(shrinkPerson);
  const shrinkAudience = await resolveEvryCommunicationAudience({
    churchId: plant.id,
    recipientIds: [shrinkPerson.id],
    subject: "Frozen",
    body: "Approved",
  });
  assert.ok(shrinkAudience);
  await recordAddressSuppression({
    email: shrinkEmail,
    reason: "hard_bounce",
    source: "live-proof-after-confirmation",
  });
  const shrinkEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: SEND_MESSAGE,
    stepId: "send-after-suppression",
  });
  const shrinkMailer = deterministicMailer();
  const shrinkCommunicationId = randomUUID();
  assert.deepEqual(
    await sendFrozenEvryCommunication({
      effect: shrinkEffect,
      identity: SEND_MESSAGE,
      communicationId: shrinkCommunicationId,
      audience: shrinkAudience,
      mailer: shrinkMailer.mailer,
    }),
    { status: "refused", excludedCount: 1 }
  );
  assert.equal(shrinkMailer.calls.length, 0);
  assert.deepEqual(
    await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(communications)
        .where(eq(communications.id, shrinkCommunicationId))
        .then(([row]) => row?.count ?? -1),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(communicationRecipients)
        .where(
          eq(communicationRecipients.communicationId, shrinkCommunicationId)
        )
        .then(([row]) => row?.count ?? -1),
    ]),
    [0, 0]
  );

  // A webhook can suppress a later recipient while an already-approved batch
  // is in flight. The provider seam records that suppression after recipient
  // one, proving recipient two is rechecked rather than mailed from the stale
  // whole-batch snapshot.
  const raceEmails = [
    `${randomUUID()}@scratch.invalid`,
    `${randomUUID()}@scratch.invalid`,
  ] as const;
  const racePeople = await Promise.all(
    raceEmails.map((email, index) =>
      db
        .insert(persons)
        .values({
          churchId: plant.id,
          firstName: `Race ${index + 1}`,
          lastName: "Recipient",
          email,
          createdBy: owner.id,
        })
        .returning({ id: persons.id })
        .then(([row]) => row)
    )
  );
  assert.ok(racePeople[0] && racePeople[1]);
  const raceAudience = await resolveEvryCommunicationAudience({
    churchId: plant.id,
    recipientIds: [racePeople[0].id, racePeople[1].id],
    subject: "Suppression race",
    body: "Approved batch",
  });
  assert.ok(raceAudience && raceAudience.recipients.length === 2);

  // Authority loss after a provider acceptance is not a clean refusal: one
  // irreversible recipient already landed. Preserve the prepared rows and a
  // retryable result, then prove the same effect converges after authority is
  // restored without resending the completed recipient.
  const authorityRaceEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: SEND_MESSAGE,
    stepId: "send-authority-race",
  });
  const authorityRaceCommunicationId = randomUUID();
  const authorityRaceCalls: string[] = [];
  const authorityRaceMailer: EvryCommunicationMailer = {
    async send(input) {
      authorityRaceCalls.push(input.to);
      if (authorityRaceCalls.length === 1) {
        await db
          .update(users)
          .set({ sendingChurchId: competingTenancy.id })
          .where(eq(users.id, owner.id));
      }
      return {
        status: "accepted",
        providerId: `authority-race-${input.to}`,
      };
    },
  };
  const authorityRaceInput = {
    effect: authorityRaceEffect,
    identity: SEND_MESSAGE,
    communicationId: authorityRaceCommunicationId,
    audience: raceAudience,
    mailer: authorityRaceMailer,
  };
  let authorityRaceResult;
  try {
    authorityRaceResult = await sendFrozenEvryCommunication(authorityRaceInput);
  } finally {
    await db
      .update(users)
      .set({ sendingChurchId: null })
      .where(eq(users.id, owner.id));
  }
  assert.deepEqual(authorityRaceResult, { status: "retryable" });
  assert.equal(authorityRaceCalls.length, 1);
  assert.deepEqual(
    (
      await db
        .select({ status: communicationRecipients.status })
        .from(communicationRecipients)
        .where(
          eq(
            communicationRecipients.communicationId,
            authorityRaceCommunicationId
          )
        )
    )
      .map(({ status }) => status)
      .toSorted(),
    ["pending", "sent"]
  );
  assert.equal(
    (
      await db
        .select({ id: evryExecutionOutcomes.id })
        .from(evryExecutionOutcomes)
        .where(
          eq(evryExecutionOutcomes.planId, authorityRaceEffect.execution.planId)
        )
    ).length,
    0
  );
  assert.deepEqual(await sendFrozenEvryCommunication(authorityRaceInput), {
    status: "completed",
    affectedCount: 2,
    excludedCount: 0,
  });
  assert.equal(authorityRaceCalls.length, 2);
  assert.deepEqual(
    (
      await db
        .select({ status: communicationRecipients.status })
        .from(communicationRecipients)
        .where(
          eq(
            communicationRecipients.communicationId,
            authorityRaceCommunicationId
          )
        )
    ).map(({ status }) => status),
    ["sent", "sent"]
  );

  const laterRecipient = raceAudience.recipients[1];
  assert.ok(laterRecipient);
  const raceCalls: string[] = [];
  const raceMailer: EvryCommunicationMailer = {
    async send(input) {
      raceCalls.push(input.to);
      if (raceCalls.length === 1) {
        await recordAddressSuppression({
          email: laterRecipient.email,
          reason: "spam_complaint",
          source: "live-proof-between-provider-calls",
        });
      }
      return { status: "accepted", providerId: `race-${raceCalls.length}` };
    },
  };
  const raceEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: SEND_MESSAGE,
    stepId: "send-suppression-race",
  });
  const raceCommunicationId = randomUUID();
  assert.deepEqual(
    await sendFrozenEvryCommunication({
      effect: raceEffect,
      identity: SEND_MESSAGE,
      communicationId: raceCommunicationId,
      audience: raceAudience,
      mailer: raceMailer,
    }),
    { status: "completed", affectedCount: 1, excludedCount: 1 }
  );
  assert.deepEqual(raceCalls, [raceAudience.recipients[0]?.email]);
  const raceRows = await db
    .select({
      personId: communicationRecipients.personId,
      status: communicationRecipients.status,
      errorMessage: communicationRecipients.errorMessage,
      externalId: communicationRecipients.externalId,
    })
    .from(communicationRecipients)
    .where(eq(communicationRecipients.communicationId, raceCommunicationId));
  assert.equal(raceRows.length, 2);
  const skipped = raceRows.find(
    ({ personId }) => personId === laterRecipient.personId
  );
  assert.equal(skipped?.status, "failed");
  assert.equal(skipped?.externalId, null);
  assert.match(
    skipped?.errorMessage ?? "",
    new RegExp(`^${EVRY_COMMUNICATION_PERMANENT_PREFIX}`)
  );

  const groupEmail = `${randomUUID()}@scratch.invalid`;
  const [groupPerson] = await db
    .insert(persons)
    .values({
      churchId: plant.id,
      firstName: "Reviewed",
      lastName: "Prospect",
      email: groupEmail,
      status: "leader",
      createdBy: owner.id,
    })
    .returning({ id: persons.id });
  assert.ok(groupPerson);
  const groupAudience = await resolveEvryCommunicationAudience({
    churchId: plant.id,
    recipientIds: [groupPerson.id],
    subject: "Reviewed group",
    body: "Approved group message",
  });
  assert.ok(groupAudience);
  const groupEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: SEND_MESSAGE,
    stepId: "send-after-group-change",
  });
  const groupCommunicationId = randomUUID();
  const groupMailer = deterministicMailer();
  const groupSend = createCommunicationEvryMessageExecutions({
    mailer: groupMailer.mailer,
  }).send;
  await db.insert(persons).values({
    churchId: plant.id,
    firstName: "Added",
    lastName: "Prospect",
    email: `${randomUUID()}@scratch.invalid`,
    status: "leader",
    createdBy: owner.id,
  });
  assert.deepEqual(
    await groupSend.executeIfCurrent({
      ...groupEffect,
      arguments: {
        communicationId: groupCommunicationId,
        recipientSource: { kind: "group", selector: "leaders" },
        audience: groupAudience,
      },
    }),
    { status: "refused", excludedCount: 1 }
  );
  assert.equal(groupMailer.calls.length, 0);
  assert.deepEqual(
    await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(communications)
        .where(eq(communications.id, groupCommunicationId))
        .then(([row]) => row?.count ?? -1),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(communicationRecipients)
        .where(
          eq(communicationRecipients.communicationId, groupCommunicationId)
        )
        .then(([row]) => row?.count ?? -1),
    ]),
    [0, 0]
  );

  const permanentEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: SEND_MESSAGE,
    stepId: "send-permanent-failure",
  });
  const permanentMailer = deterministicMailer(["permanent"]);
  const permanentInput = {
    effect: permanentEffect,
    identity: SEND_MESSAGE,
    communicationId: randomUUID(),
    audience,
    mailer: permanentMailer.mailer,
  };
  assert.deepEqual(await sendFrozenEvryCommunication(permanentInput), {
    status: "failed",
    excludedCount: 6,
  });
  assert.deepEqual(await sendFrozenEvryCommunication(permanentInput), {
    status: "failed",
    excludedCount: 6,
  });
  assert.equal(permanentMailer.calls.length, 1);
  recordEffectOutcome(SEND_MESSAGE, "errors");

  async function seedResendSource(sentAt: Date) {
    const sourceId = randomUUID();
    const source = {
      id: sourceId,
      subject: "Original message",
      body: "Original body",
      bodyHtml: null,
      channel: "email" as const,
      templateId: null,
      meetingId: null,
      status: "sent" as const,
      sentAt: sentAt.toISOString(),
      recipientCount: 1,
    };
    await db.insert(communications).values({
      ...source,
      sentAt,
      churchId: plant.id,
      createdById: owner.id,
    });
    await db.insert(communicationRecipients).values({
      churchId: plant.id,
      communicationId: sourceId,
      personId: recipient.id,
      email: recipientEmail,
      channel: "email",
      status: "delivered",
      deliveredAt: sentAt,
    });
    const resolved = await resolveEvryCommunicationAudience({
      churchId: plant.id,
      recipientIds: [recipient.id],
      subject: source.subject,
      body: source.body,
      channel: "email",
    });
    assert.ok(resolved);
    return { source, audience: resolved };
  }

  const resendSource = await seedResendSource(
    new Date(Date.now() - 48 * 60 * 60_000)
  );
  const resendEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: RESEND_MESSAGE,
    stepId: "resend-non-openers",
  });
  const resendMailer = deterministicMailer(["accepted_response_lost"]);
  const resendAdapter = createCommunicationEvryMessageExecutions({
    mailer: resendMailer.mailer,
  }).resend;
  const resendInput = {
    ...resendEffect,
    arguments: {
      source: resendSource.source,
      nonOpenerPersonIds: [recipient.id],
      communicationId: randomUUID(),
      audience: resendSource.audience,
    },
  };
  assert.deepEqual(await resendAdapter.executeIfCurrent(resendInput), {
    status: "retryable",
  });
  assert.deepEqual(await resendAdapter.executeIfCurrent(resendInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  recordEffectOutcome(RESEND_MESSAGE, "execution");
  assert.deepEqual(await resendAdapter.executeIfCurrent(resendInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.equal(resendMailer.deliveries.size, 1);
  assert.equal(new Set(resendMailer.calls).size, 1);
  recordEffectOutcome(RESEND_MESSAGE, "idempotency");

  const refusedEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: RESEND_MESSAGE,
    stepId: "resend-wrong-source",
  });
  assert.deepEqual(
    await resendAdapter.executeIfCurrent({
      ...refusedEffect,
      arguments: {
        ...resendInput.arguments,
        source: { ...resendSource.source, subject: "Changed source" },
      },
    }),
    { status: "refused", excludedCount: 1 }
  );

  const cooldownSource = await seedResendSource(new Date());
  const cooldownEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: RESEND_MESSAGE,
    stepId: "resend-cooldown",
  });
  assert.deepEqual(
    await resendAdapter.executeIfCurrent({
      ...cooldownEffect,
      arguments: {
        source: cooldownSource.source,
        nonOpenerPersonIds: [recipient.id],
        communicationId: randomUUID(),
        audience: cooldownSource.audience,
      },
    }),
    { status: "refused", excludedCount: 1 }
  );

  await db
    .update(communicationRecipients)
    .set({ status: "opened", openedAt: new Date() })
    .where(eq(communicationRecipients.communicationId, resendSource.source.id));
  const openerEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: RESEND_MESSAGE,
    stepId: "resend-current-openers",
  });
  assert.deepEqual(
    await resendAdapter.executeIfCurrent({
      ...openerEffect,
      arguments: {
        source: resendSource.source,
        nonOpenerPersonIds: [recipient.id],
        communicationId: randomUUID(),
        audience: resendSource.audience,
      },
    }),
    { status: "refused", excludedCount: 1 }
  );
  assert.equal(resendMailer.calls.length, 2);
  assert.equal(resendMailer.deliveries.size, 1);

  const failedSource = await seedResendSource(
    new Date(Date.now() - 48 * 60 * 60_000)
  );
  const failedResendEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: RESEND_MESSAGE,
    stepId: "failed-resend-non-openers",
  });
  const failedResendMailer = deterministicMailer(["permanent"]);
  const failedResendAdapter = createCommunicationEvryMessageExecutions({
    mailer: failedResendMailer.mailer,
  }).resend;
  const failedResendInput = {
    ...failedResendEffect,
    arguments: {
      source: failedSource.source,
      nonOpenerPersonIds: [recipient.id],
      communicationId: randomUUID(),
      audience: failedSource.audience,
    },
  };
  assert.deepEqual(
    await failedResendAdapter.executeIfCurrent(failedResendInput),
    { status: "failed", excludedCount: 1 }
  );
  assert.deepEqual(
    await failedResendAdapter.executeIfCurrent(failedResendInput),
    { status: "failed", excludedCount: 1 }
  );
  assert.equal(failedResendMailer.calls.length, 1);
  recordEffectOutcome(RESEND_MESSAGE, "errors");

  const [counts] = await db
    .select({
      communications: sql<number>`count(distinct ${communications.id})::int`,
      recipients: sql<number>`count(distinct ${communicationRecipients.id})::int`,
      outcomes: sql<number>`count(distinct ${evryExecutionOutcomes.id})::int`,
    })
    .from(communications)
    .leftJoin(
      communicationRecipients,
      eq(communicationRecipients.communicationId, communications.id)
    )
    .leftJoin(
      evryExecutionOutcomes,
      eq(evryExecutionOutcomes.churchId, communications.churchId)
    )
    .where(eq(communications.churchId, plant.id));
  assert.ok(counts);
  assert.ok(counts.communications >= 8);
  assert.ok(counts.recipients >= 8);
  assert.ok(counts.outcomes >= 8);

  const foreignMessage = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communications)
    .where(eq(communications.churchId, foreignPlant.id))
    .then(([row]) => row?.count ?? 0);
  assert.equal(foreignMessage, 0);

  assert.deepEqual(
    [...effectOutcomes].sort(),
    [
      CREATE_TEMPLATE,
      DELETE_TEMPLATE,
      FORK_TEMPLATE,
      RESEND_MESSAGE,
      SEND_MESSAGE,
      UPDATE_TEMPLATE,
    ]
      .flatMap((identity) =>
        ["execution", "idempotency", "errors"].map(
          (layer) => `${identity}:${layer}`
        )
      )
      .sort()
  );
  process.stdout.write("Communication effect live proof passed\n");
  process.stdout.write(
    `EVRY_COMMUNICATION_EFFECT_OUTCOMES=${JSON.stringify([...effectOutcomes].sort())}\n`
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
