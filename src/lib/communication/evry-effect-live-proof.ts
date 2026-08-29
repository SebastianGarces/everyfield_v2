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
  type EvryCommunicationMailer,
  resolveEvryCommunicationAudience,
  sendFrozenEvryCommunication,
} from "./evry-send";
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

const effectOutcomes = new Map<
  string,
  { execution: boolean; idempotency: boolean; errors: boolean }
>();

function recordEffectOutcome(identity: string) {
  effectOutcomes.set(identity, {
    execution: true,
    idempotency: true,
    errors: true,
  });
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
  outcomes: readonly ("accepted" | "retryable" | "permanent")[] = ["accepted"]
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
  await claimEvryCommunicationTemplateCreate(createInput);
  assert.deepEqual(await claimEvryCommunicationTemplateCreate(createInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(
    await claimEvryCommunicationTemplateCreate({
      ...createInput,
      identity: UPDATE_TEMPLATE,
    }),
    { status: "refused", excludedCount: 1 }
  );
  recordEffectOutcome(CREATE_TEMPLATE);
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
  await claimEvryCommunicationTemplateUpdate(updateInput);
  assert.deepEqual(await claimEvryCommunicationTemplateUpdate(updateInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
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
  recordEffectOutcome(UPDATE_TEMPLATE);

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
        isSystem: true,
      },
      {
        name: "Legacy system edit",
        category: "other",
        channel: "email",
        subject: "Legacy",
        body: "Legacy plain text",
        bodyHtml: null,
        isSystem: true,
      },
    ])
    .returning();
  assert.equal(systemRows.length, 2);
  const [systemFork, systemEdit] = systemRows;
  assert.ok(systemFork && systemEdit);
  const forkSnapshot = await getEvryCommunicationTemplateSnapshot({
    churchId: plant.id,
    templateId: systemFork.id,
  });
  const editSnapshot = await getEvryCommunicationTemplateSnapshot({
    churchId: plant.id,
    templateId: systemEdit.id,
  });
  assert.ok(forkSnapshot && editSnapshot);
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
  assert.deepEqual(
    await claimEvryCommunicationTemplateFork({
      effect: forkEffect,
      identity: FORK_TEMPLATE,
      source: forkSnapshot,
      forkId,
    }),
    { status: "completed", affectedCount: 1, excludedCount: 0 }
  );
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
  recordEffectOutcome(FORK_TEMPLATE);
  const systemEditEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: UPDATE_TEMPLATE,
    stepId: "edit-system-template",
  });
  assert.deepEqual(
    await claimEvryCommunicationSystemTemplateUpdate({
      effect: systemEditEffect,
      identity: UPDATE_TEMPLATE,
      source: editSnapshot,
      forkId: randomUUID(),
      content: content("<p>Edited legacy content</p>"),
    }),
    { status: "completed", affectedCount: 1, excludedCount: 0 }
  );

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
  assert.deepEqual(
    await claimEvryCommunicationTemplateDelete({
      effect: deleteEffect,
      identity: DELETE_TEMPLATE,
      templateId: deletableId,
      expectedUpdatedAt: deletable.updatedAt,
    }),
    { status: "completed", affectedCount: 1, excludedCount: 0 }
  );
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
  recordEffectOutcome(DELETE_TEMPLATE);

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
  assert.equal(new Set(concurrentMailer.calls).size, 1);
  assert.equal(concurrentMailer.deliveries.size, 1);
  assert.deepEqual(await sendFrozenEvryCommunication(concurrentInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 5,
  });
  assert.equal(concurrentMailer.deliveries.size, 1);

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
  assert.deepEqual(
    await sendFrozenEvryCommunication({
      effect: shrinkEffect,
      identity: SEND_MESSAGE,
      communicationId: randomUUID(),
      audience: shrinkAudience,
      mailer: shrinkMailer.mailer,
    }),
    { status: "completed", affectedCount: 0, excludedCount: 1 }
  );
  assert.equal(shrinkMailer.calls.length, 0);

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
  recordEffectOutcome(SEND_MESSAGE);

  const resendEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: RESEND_MESSAGE,
    stepId: "resend-non-openers",
  });
  const resendMailer = deterministicMailer();
  const resendInput = {
    effect: resendEffect,
    identity: RESEND_MESSAGE,
    communicationId: randomUUID(),
    audience,
    mailer: resendMailer.mailer,
  };
  assert.deepEqual(await sendFrozenEvryCommunication(resendInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 5,
  });
  assert.deepEqual(await sendFrozenEvryCommunication(resendInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 5,
  });
  assert.equal(resendMailer.calls.length, 1);

  const failedResendEffect = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    capabilityIdentity: RESEND_MESSAGE,
    stepId: "failed-resend-non-openers",
  });
  const failedResendMailer = deterministicMailer(["permanent"]);
  const failedResendInput = {
    effect: failedResendEffect,
    identity: RESEND_MESSAGE,
    communicationId: randomUUID(),
    audience,
    mailer: failedResendMailer.mailer,
  };
  assert.deepEqual(await sendFrozenEvryCommunication(failedResendInput), {
    status: "failed",
    excludedCount: 6,
  });
  assert.deepEqual(await sendFrozenEvryCommunication(failedResendInput), {
    status: "failed",
    excludedCount: 6,
  });
  assert.equal(failedResendMailer.calls.length, 1);
  recordEffectOutcome(RESEND_MESSAGE);

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
  assert.equal(counts.communications, 6);
  assert.equal(counts.recipients, 6);
  assert.ok(counts.outcomes >= 8);

  const foreignMessage = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communications)
    .where(eq(communications.churchId, foreignPlant.id))
    .then(([row]) => row?.count ?? 0);
  assert.equal(foreignMessage, 0);

  assert.deepEqual(
    [...effectOutcomes.keys()].sort(),
    [
      CREATE_TEMPLATE,
      DELETE_TEMPLATE,
      FORK_TEMPLATE,
      RESEND_MESSAGE,
      SEND_MESSAGE,
      UPDATE_TEMPLATE,
    ].sort()
  );
  process.stdout.write("Communication effect live proof passed\n");
  process.stdout.write(
    `EVRY_COMMUNICATION_EFFECT_OUTCOMES=${JSON.stringify(Object.fromEntries(effectOutcomes))}\n`
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
