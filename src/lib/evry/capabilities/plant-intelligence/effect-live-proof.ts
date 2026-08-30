import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

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
  insightFeedback,
  phaseTransitions,
  planterCheckins,
  plantAssessments,
  plantInsights,
  plantSignals,
  users,
  wikiArticles,
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
import {
  createEvryExecutionCapabilityRegistry,
  type EvryEffectInput,
  type EvryEffectResult,
} from "@/lib/evry/executor";
import { mintEvryPlanRequestKey, type EvryJsonValue } from "@/lib/evry/plans";
import { evryPublicArtifactSchema } from "@/lib/evry/artifacts/public";
import { ACTIVE_RUBRIC } from "@/lib/phase-engine/rubric";
import { resolveAuthorizedEvryPageContext } from "@/lib/evry/resolvers/page-context";

import { PLANT_INTELLIGENCE_EFFECT_IDENTITIES } from "./catalog";
import {
  acknowledgeArgumentsSchema,
  attestationArgumentsSchema,
  checkinArgumentsSchema,
  createPlantIntelligenceExecutions,
  feedbackArgumentsSchema,
  resolvePlantIntelligenceEffectArguments,
  transitionArgumentsSchema,
} from "./effects";
import {
  readPlantIntelligenceAssessmentForPlant,
  readPlantIntelligenceDeclarationsForPlant,
  readPlantIntelligenceFeedbackForPlant,
  readPlantIntelligenceSignalsForPlant,
  selectPlantIntelligenceEvryRead,
} from "./reads";

const FINGERPRINT = "a".repeat(64);
const effectOutcomes = new Set<string>();
const identities = PLANT_INTELLIGENCE_EFFECT_IDENTITIES;
const refreshes: string[][] = [];
const liveExecutionRegistry = createEvryExecutionCapabilityRegistry(
  createPlantIntelligenceExecutions((paths) => {
    refreshes.push([...paths]);
  })
);

function record(
  identity: string,
  layer: "execution" | "idempotency" | "errors"
) {
  effectOutcomes.add(`${identity}:${layer}`);
}

async function seedEffect(input: {
  churchId: string;
  actorUserId: string;
  actorSeat: "owner" | "admin" | "member";
  capabilityIdentity: string;
  arguments: Record<string, EvryJsonValue>;
}): Promise<EvryEffectInput> {
  const planId = randomUUID();
  const attemptId = randomUUID();
  const requestKey = mintEvryPlanRequestKey();
  const correlationId = correlationForPlanRequest(requestKey);
  const createdAt = new Date();
  const stepId = `step-${randomUUID()}`;
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
            id: stepId,
            capabilityIdentity: input.capabilityIdentity,
            effectClass: "database_write",
            arguments: input.arguments,
            dependsOn: [],
          },
        ],
      },
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 15 * 60_000),
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
    seat: input.actorSeat,
  } as unknown as EvryPlantActor;
  return {
    authorization: { actor, registration } as EvryEffectCapabilityAuthorization,
    effectKey: executionEffectKey(planId, FINGERPRINT, stepId),
    arguments: input.arguments,
    execution: {
      attemptId,
      planId,
      plantId: input.churchId,
      actorUserId: input.actorUserId,
      fingerprint: FINGERPRINT,
      correlationId,
      stepId,
      capabilityIdentity: input.capabilityIdentity,
    },
  };
}

async function execute(input: EvryEffectInput): Promise<EvryEffectResult> {
  const registration = liveExecutionRegistry.registrationFor(
    input.execution.capabilityIdentity
  );
  assert.ok(registration);
  return registration.executeIfCurrent(input);
}

function continuationCommand(
  artifact: { filters: readonly { value: string }[] },
  prefix: string
) {
  return (
    artifact.filters.find(({ value }) => value.startsWith(`${prefix} cursor `))
      ?.value ?? null
  );
}

function appendUnique(target: Set<string>, ids: readonly string[]) {
  for (const id of ids) {
    assert.equal(target.has(id), false, `duplicate paginated item ${id}`);
    target.add(id);
  }
}

async function main() {
  const [plant, foreignPlant] = await Promise.all([
    db
      .insert(churches)
      .values({ name: "__Plant Intelligence proof__", currentPhase: 1 })
      .returning({ id: churches.id }),
    db
      .insert(churches)
      .values({ name: "__Foreign Plant Intelligence proof__", currentPhase: 4 })
      .returning({ id: churches.id }),
  ]).then(([left, right]) => [left[0], right[0]]);
  assert.ok(plant && foreignPlant);
  const [owner, admin, member, foreignOwner] = await Promise.all([
    db
      .insert(users)
      .values({
        email: `${randomUUID()}@scratch.invalid`,
        passwordHash: "scratch",
        name: "PI owner",
        churchId: plant.id,
        seat: "owner",
      })
      .returning({ id: users.id }),
    db
      .insert(users)
      .values({
        email: `${randomUUID()}@scratch.invalid`,
        passwordHash: "scratch",
        name: "PI admin",
        churchId: plant.id,
        seat: "admin",
      })
      .returning({ id: users.id }),
    db
      .insert(users)
      .values({
        email: `${randomUUID()}@scratch.invalid`,
        passwordHash: "scratch",
        name: "PI member",
        churchId: plant.id,
        seat: "member",
      })
      .returning({ id: users.id }),
    db
      .insert(users)
      .values({
        email: `${randomUUID()}@scratch.invalid`,
        passwordHash: "scratch",
        name: "Foreign PI owner",
        churchId: foreignPlant.id,
        seat: "owner",
      })
      .returning({ id: users.id }),
  ]).then((rows) => rows.map(([row]) => row));
  assert.ok(owner && admin && member && foreignOwner);

  const [assessment, foreignAssessment] = await Promise.all([
    db
      .insert(plantAssessments)
      .values({
        churchId: plant.id,
        phase: 1,
        rubricVersion: ACTIVE_RUBRIC.version,
        factSnapshot: {},
        status: "complete",
      })
      .returning(),
    db
      .insert(plantAssessments)
      .values({
        churchId: foreignPlant.id,
        phase: 4,
        rubricVersion: ACTIVE_RUBRIC.version,
        factSnapshot: {},
        status: "complete",
      })
      .returning(),
  ]).then((rows) => rows.map(([row]) => row));
  assert.ok(assessment && foreignAssessment);
  const irregularWikiSlug = "guides/100% ready #1?";
  await db.insert(wikiArticles).values({
    slug: irregularWikiSlug,
    title: "Irregular stored source",
    content: "Stored source body",
    contentType: "guide",
    status: "published",
  });
  const [insight, foreignInsight] = await Promise.all([
    db
      .insert(plantInsights)
      .values({
        assessmentId: assessment.id,
        churchId: plant.id,
        audience: "planter",
        category: "phase_progress",
        severity: "info",
        title: "Stored local insight",
        body: "Stored body",
        relatedArticleSlugs: [irregularWikiSlug],
        rank: 1,
      })
      .returning(),
    db
      .insert(plantInsights)
      .values({
        assessmentId: foreignAssessment.id,
        churchId: foreignPlant.id,
        audience: "planter",
        category: "phase_progress",
        severity: "info",
        title: "Stored foreign insight",
        body: "Foreign body",
        rank: 1,
      })
      .returning(),
  ]).then((rows) => rows.map(([row]) => row));
  assert.ok(insight && foreignInsight);
  assert.deepEqual(
    await resolveAuthorizedEvryPageContext({
      actor: {
        userId: owner.id,
        plantId: plant.id,
        seat: "owner",
      } as unknown as EvryPlantActor,
      pageContext: { kind: "plant_intelligence", recordId: "current" },
    }),
    {
      kind: "plant_intelligence",
      recordId: assessment.id,
      label: `Plant Intelligence · ${assessment.generatedAt.toISOString()}`,
    }
  );
  assert.equal(
    await resolveAuthorizedEvryPageContext({
      actor: {
        userId: foreignOwner.id,
        plantId: foreignPlant.id,
        seat: "owner",
      } as unknown as EvryPlantActor,
      pageContext: { kind: "plant_intelligence", recordId: assessment.id },
    }),
    null,
    "a caller-supplied assessment id is never a cross-plant page-context selector"
  );

  const transitionInput = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    actorSeat: "owner",
    capabilityIdentity: identities.transitionPhase,
    arguments: transitionArgumentsSchema.parse({
      expected: { currentPhase: 1 },
      toPhase: 2,
      reason: "Exact phase reason",
    }),
  });
  const transitionRace = await Promise.all([
    execute(transitionInput),
    execute(transitionInput),
  ]);
  assert.deepEqual(transitionRace, [
    { status: "completed", affectedCount: 1, excludedCount: 0 },
    { status: "completed", affectedCount: 1, excludedCount: 0 },
  ]);
  assert.equal(
    (
      await db
        .select()
        .from(phaseTransitions)
        .where(eq(phaseTransitions.churchId, plant.id))
    ).length,
    1
  );
  assert.equal(
    (
      await db
        .select({ phase: churches.currentPhase })
        .from(churches)
        .where(eq(churches.id, plant.id))
    )[0]?.phase,
    2
  );
  const differentKeyTransitions = await Promise.all(
    [3, 4].map(async (toPhase) =>
      seedEffect({
        churchId: plant.id,
        actorUserId: owner.id,
        actorSeat: "owner",
        capabilityIdentity: identities.transitionPhase,
        arguments: transitionArgumentsSchema.parse({
          expected: { currentPhase: 2 },
          toPhase,
          reason: `Different-key transition to ${toPhase}`,
        }),
      })
    )
  );
  const differentKeyResults = await Promise.all(
    differentKeyTransitions.map(execute)
  );
  assert.deepEqual(
    differentKeyResults.map(({ status }) => status).sort(),
    ["completed", "refused"],
    "a current-phase CAS permits exactly one differently keyed transition"
  );
  assert.equal(
    (
      await db
        .select()
        .from(phaseTransitions)
        .where(eq(phaseTransitions.churchId, plant.id))
    ).length,
    2,
    "the losing key writes no audit row"
  );
  assert.ok(
    [3, 4].includes(
      (
        await db
          .select({ phase: churches.currentPhase })
          .from(churches)
          .where(eq(churches.id, plant.id))
      )[0]?.phase ?? -1
    )
  );
  record(identities.transitionPhase, "execution");
  record(identities.transitionPhase, "idempotency");
  const staleTransition = await seedEffect({
    ...transitionInput.authorization.actor,
    churchId: plant.id,
    actorUserId: owner.id,
    actorSeat: "owner",
    capabilityIdentity: identities.transitionPhase,
    arguments: transitionArgumentsSchema.parse({
      expected: { currentPhase: 1 },
      toPhase: 3,
      reason: "Stale",
    }),
  });
  assert.deepEqual(await execute(staleTransition), {
    status: "refused",
    excludedCount: 1,
  });
  record(identities.transitionPhase, "errors");

  const acknowledgeInput = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    actorSeat: "owner",
    capabilityIdentity: identities.acknowledgeAssessment,
    arguments: acknowledgeArgumentsSchema.parse({
      expected: {
        id: assessment.id,
        generatedAt: assessment.generatedAt.toISOString(),
        planterSeenAt: null,
      },
    }),
  });
  assert.deepEqual(await execute(acknowledgeInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await execute(acknowledgeInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.ok(
    (
      await db
        .select({ seen: plantAssessments.planterSeenAt })
        .from(plantAssessments)
        .where(eq(plantAssessments.id, assessment.id))
    )[0]?.seen
  );
  record(identities.acknowledgeAssessment, "execution");
  record(identities.acknowledgeAssessment, "idempotency");
  const foreignAcknowledge = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    actorSeat: "owner",
    capabilityIdentity: identities.acknowledgeAssessment,
    arguments: acknowledgeArgumentsSchema.parse({
      expected: {
        id: foreignAssessment.id,
        generatedAt: foreignAssessment.generatedAt.toISOString(),
        planterSeenAt: null,
      },
    }),
  });
  assert.deepEqual(await execute(foreignAcknowledge), {
    status: "refused",
    excludedCount: 1,
  });
  record(identities.acknowledgeAssessment, "errors");

  const attestationInput = await seedEffect({
    churchId: plant.id,
    actorUserId: admin.id,
    actorSeat: "admin",
    capabilityIdentity: identities.setAttestation,
    arguments: attestationArgumentsSchema.parse({
      signalKey: "values_documented",
      expected: null,
      value: "Exact attestation",
    }),
  });
  const attestationRace = await Promise.all([
    execute(attestationInput),
    execute(attestationInput),
  ]);
  assert.deepEqual(attestationRace, [
    { status: "completed", affectedCount: 1, excludedCount: 0 },
    { status: "completed", affectedCount: 1, excludedCount: 0 },
  ]);
  assert.equal(
    (
      await db
        .select()
        .from(plantSignals)
        .where(
          and(
            eq(plantSignals.churchId, plant.id),
            eq(plantSignals.signalKey, "values_documented")
          )
        )
    ).length,
    1
  );
  const oldAttestationTime = new Date("2020-01-01T00:00:00.000Z");
  const [oldAttestation] = await db
    .update(plantSignals)
    .set({ attestedAt: oldAttestationTime, updatedAt: oldAttestationTime })
    .where(
      and(
        eq(plantSignals.churchId, plant.id),
        eq(plantSignals.signalKey, "values_documented")
      )
    )
    .returning();
  assert.ok(oldAttestation);
  const [plantBeforeSameValueAttestation] = await db
    .select({ lastMaterialEventAt: churches.lastMaterialEventAt })
    .from(churches)
    .where(eq(churches.id, plant.id));
  assert.ok(plantBeforeSameValueAttestation?.lastMaterialEventAt);
  const resolvedSameValueAttestation =
    await resolvePlantIntelligenceEffectArguments(
      { userId: owner.id, plantId: plant.id, seat: "owner" } as EvryPlantActor,
      {
        kind: "attestation",
        signalKey: "values_documented",
        value: "Exact attestation",
      }
    );
  assert.ok(resolvedSameValueAttestation);
  const sameValueAttestation = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    actorSeat: "owner",
    capabilityIdentity: identities.setAttestation,
    arguments: attestationArgumentsSchema.parse({
      signalKey: "values_documented",
      expected: {
        id: oldAttestation.id,
        value: oldAttestation.value,
        attestedById: oldAttestation.attestedById,
        attestedAt: oldAttestation.attestedAt.toISOString(),
        updatedAt: oldAttestation.updatedAt.toISOString(),
      },
      value: "Exact attestation",
    }),
  });
  assert.deepEqual(await execute(sameValueAttestation), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  const [refreshedAttestation] = await db
    .select()
    .from(plantSignals)
    .where(eq(plantSignals.id, oldAttestation.id));
  const [dirtiedPlant] = await db
    .select({ lastMaterialEventAt: churches.lastMaterialEventAt })
    .from(churches)
    .where(eq(churches.id, plant.id));
  assert.equal(refreshedAttestation?.attestedById, owner.id);
  assert.ok(refreshedAttestation!.attestedAt > oldAttestationTime);
  assert.ok(refreshedAttestation!.updatedAt > oldAttestationTime);
  assert.ok(
    dirtiedPlant!.lastMaterialEventAt! >
      plantBeforeSameValueAttestation.lastMaterialEventAt
  );
  record(identities.setAttestation, "execution");
  record(identities.setAttestation, "idempotency");
  const staleAttestation = await seedEffect({
    churchId: plant.id,
    actorUserId: admin.id,
    actorSeat: "admin",
    capabilityIdentity: identities.setAttestation,
    arguments: attestationArgumentsSchema.parse({
      signalKey: "values_documented",
      expected: null,
      value: false,
    }),
  });
  assert.deepEqual(await execute(staleAttestation), {
    status: "refused",
    excludedCount: 1,
  });
  const seatDriftAttestation = await seedEffect({
    churchId: plant.id,
    actorUserId: admin.id,
    actorSeat: "admin",
    capabilityIdentity: identities.setAttestation,
    arguments: attestationArgumentsSchema.parse({
      signalKey: "systems_tested",
      expected: null,
      value: true,
    }),
  });
  await db.update(users).set({ seat: "member" }).where(eq(users.id, admin.id));
  assert.deepEqual(await execute(seatDriftAttestation), {
    status: "refused",
    excludedCount: 1,
  });
  await db.update(users).set({ seat: "admin" }).where(eq(users.id, admin.id));
  const unavailableAttempt = await seedEffect({
    churchId: plant.id,
    actorUserId: admin.id,
    actorSeat: "admin",
    capabilityIdentity: identities.setAttestation,
    arguments: attestationArgumentsSchema.parse({
      signalKey: "financial_base_established",
      expected: null,
      value: true,
    }),
  });
  await db
    .delete(evryActionPlanStates)
    .where(
      eq(evryActionPlanStates.planId, unavailableAttempt.execution.planId)
    );
  assert.deepEqual(await execute(unavailableAttempt), { status: "retryable" });
  record(identities.setAttestation, "errors");

  const feedbackInput = await seedEffect({
    churchId: plant.id,
    actorUserId: member.id,
    actorSeat: "member",
    capabilityIdentity: identities.submitFeedback,
    arguments: feedbackArgumentsSchema.parse({
      insight: {
        id: insight.id,
        assessmentId: assessment.id,
        rubricVersion: assessment.rubricVersion,
        title: insight.title,
      },
      expected: null,
      rating: "useful",
      comment: "Exact feedback",
    }),
  });
  assert.deepEqual(await execute(feedbackInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await execute(feedbackInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.equal(
    (
      await db
        .select()
        .from(insightFeedback)
        .where(
          and(
            eq(insightFeedback.churchId, plant.id),
            eq(insightFeedback.userId, member.id)
          )
        )
    ).length,
    1
  );
  record(identities.submitFeedback, "execution");
  record(identities.submitFeedback, "idempotency");
  const foreignFeedback = await seedEffect({
    churchId: plant.id,
    actorUserId: member.id,
    actorSeat: "member",
    capabilityIdentity: identities.submitFeedback,
    arguments: feedbackArgumentsSchema.parse({
      insight: {
        id: foreignInsight.id,
        assessmentId: foreignAssessment.id,
        rubricVersion: foreignAssessment.rubricVersion,
        title: foreignInsight.title,
      },
      expected: null,
      rating: "not_useful",
      comment: null,
    }),
  });
  assert.deepEqual(await execute(foreignFeedback), {
    status: "refused",
    excludedCount: 1,
  });
  const [storedFeedback] = await db
    .select()
    .from(insightFeedback)
    .where(
      and(
        eq(insightFeedback.insightId, insight.id),
        eq(insightFeedback.userId, member.id)
      )
    )
    .limit(1);
  assert.ok(storedFeedback);
  const sourceDriftFeedback = await seedEffect({
    churchId: plant.id,
    actorUserId: member.id,
    actorSeat: "member",
    capabilityIdentity: identities.submitFeedback,
    arguments: feedbackArgumentsSchema.parse({
      insight: {
        id: insight.id,
        assessmentId: assessment.id,
        rubricVersion: assessment.rubricVersion,
        title: insight.title,
      },
      expected: {
        id: storedFeedback.id,
        rating: storedFeedback.rating,
        comment: storedFeedback.comment,
        updatedAt: storedFeedback.updatedAt.toISOString(),
      },
      rating: "not_useful",
      comment: "Changed feedback",
    }),
  });
  await db
    .update(plantInsights)
    .set({ title: "Drifted stored title" })
    .where(eq(plantInsights.id, insight.id));
  assert.deepEqual(await execute(sourceDriftFeedback), {
    status: "refused",
    excludedCount: 1,
  });
  record(identities.submitFeedback, "errors");

  const weekStart = new Date();
  weekStart.setUTCDate(
    weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7)
  );
  const week = weekStart.toISOString().slice(0, 10);
  const checkinInput = await seedEffect({
    churchId: plant.id,
    actorUserId: admin.id,
    actorSeat: "admin",
    capabilityIdentity: identities.saveCheckin,
    arguments: checkinArgumentsSchema.parse({
      weekStart: week,
      expected: null,
      spiritually: "steady",
      marriageFamily: "strained",
      financially: "steady",
      pace: "struggling",
      note: "Private exact note",
    }),
  });
  assert.deepEqual(await execute(checkinInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.deepEqual(await execute(checkinInput), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  assert.equal(
    (
      await db
        .select()
        .from(planterCheckins)
        .where(eq(planterCheckins.churchId, plant.id))
    ).length,
    1
  );
  const oldCheckinTime = new Date("2020-01-02T00:00:00.000Z");
  const [oldCheckin] = await db
    .update(planterCheckins)
    .set({ updatedAt: oldCheckinTime })
    .where(eq(planterCheckins.churchId, plant.id))
    .returning();
  assert.ok(oldCheckin);
  const resolvedSameValueCheckin =
    await resolvePlantIntelligenceEffectArguments(
      { userId: owner.id, plantId: plant.id, seat: "owner" } as EvryPlantActor,
      {
        kind: "checkin",
        spiritually: oldCheckin.spiritually,
        marriageFamily: oldCheckin.marriageFamily,
        financially: oldCheckin.financially,
        pace: oldCheckin.pace,
        note: oldCheckin.note,
      }
    );
  assert.ok(resolvedSameValueCheckin);
  const sameValueCheckin = await seedEffect({
    churchId: plant.id,
    actorUserId: owner.id,
    actorSeat: "owner",
    capabilityIdentity: identities.saveCheckin,
    arguments: checkinArgumentsSchema.parse({
      weekStart: week,
      expected: {
        id: oldCheckin.id,
        spiritually: oldCheckin.spiritually,
        marriageFamily: oldCheckin.marriageFamily,
        financially: oldCheckin.financially,
        pace: oldCheckin.pace,
        note: oldCheckin.note,
        answeredById: oldCheckin.answeredById,
        updatedAt: oldCheckin.updatedAt.toISOString(),
      },
      spiritually: oldCheckin.spiritually,
      marriageFamily: oldCheckin.marriageFamily,
      financially: oldCheckin.financially,
      pace: oldCheckin.pace,
      note: oldCheckin.note,
    }),
  });
  assert.deepEqual(await execute(sameValueCheckin), {
    status: "completed",
    affectedCount: 1,
    excludedCount: 0,
  });
  const [refreshedCheckin] = await db
    .select()
    .from(planterCheckins)
    .where(eq(planterCheckins.id, oldCheckin.id));
  assert.equal(refreshedCheckin?.answeredById, owner.id);
  assert.ok(refreshedCheckin!.updatedAt > oldCheckinTime);
  record(identities.saveCheckin, "execution");
  record(identities.saveCheckin, "idempotency");
  const staleCheckin = await seedEffect({
    churchId: plant.id,
    actorUserId: admin.id,
    actorSeat: "admin",
    capabilityIdentity: identities.saveCheckin,
    arguments: checkinArgumentsSchema.parse({
      weekStart: week,
      expected: null,
      spiritually: "steady",
      marriageFamily: "steady",
      financially: "steady",
      pace: "steady",
      note: null,
    }),
  });
  assert.deepEqual(await execute(staleCheckin), {
    status: "refused",
    excludedCount: 1,
  });
  record(identities.saveCheckin, "errors");

  const [outcomeCount] = await db
    .select({ count: sql<number>`count(*)::integer` })
    .from(evryExecutionOutcomes)
    .where(eq(evryExecutionOutcomes.churchId, plant.id));
  assert.equal(
    outcomeCount?.count,
    8,
    "replay/race/refusal/retry must not duplicate or falsely claim outcomes"
  );
  assert.equal(refreshes.length, 8, "only newly claimed effects refresh");
  assert.equal(
    refreshes.filter((paths) => paths.includes("/dashboard")).length,
    2,
    "each claimed phase transition invalidates the dashboard"
  );
  assert.equal(
    refreshes.every((paths) => paths.includes("/phase")),
    true,
    "every claimed Plant Intelligence effect reconciles /phase"
  );

  // Lossless read reconstruction beyond both the 80-item page and 100-item
  // public artifact boundaries. Every continuation is parsed through the real
  // command selector and every page passes the public artifact schema.
  const originalLargeBody = Array.from(
    { length: 110 },
    (_, index) => `${String(index).padStart(3, "0")}:${"x".repeat(443)}`
  ).join("");
  await db
    .update(plantInsights)
    .set({ title: "Stored local insight", body: originalLargeBody })
    .where(eq(plantInsights.id, insight.id));
  type AssessmentCursor = NonNullable<
    Parameters<typeof readPlantIntelligenceAssessmentForPlant>[0]["cursor"]
  >;
  const firstAssessmentPage = await readPlantIntelligenceAssessmentForPlant({
    plantId: plant.id,
    assessmentId: assessment.id,
    cursor: null,
  });
  const firstAssessmentCommand = continuationCommand(
    firstAssessmentPage,
    "show plant intelligence assessment"
  );
  assert.ok(firstAssessmentCommand);
  const firstAssessmentSelection = selectPlantIntelligenceEvryRead(
    firstAssessmentCommand
  );
  const staleAssessmentCursor = firstAssessmentSelection?.input
    .cursor as AssessmentCursor;
  const largeBody = `${originalLargeBody}mutation-between-pages`;
  await db
    .update(plantInsights)
    .set({ body: largeBody })
    .where(eq(plantInsights.id, insight.id));
  const refusedAssessmentContinuation =
    await readPlantIntelligenceAssessmentForPlant({
      plantId: plant.id,
      assessmentId: assessment.id,
      cursor: staleAssessmentCursor,
    });
  assert.equal(refusedAssessmentContinuation.items.length, 0);
  assert.equal(
    refusedAssessmentContinuation.exclusions[0]?.reason,
    "The stored assessment changed; start again"
  );
  const assessmentItems = new Set<string>();
  const assessmentValues = new Map<string, string>();
  const assessmentLinks = new Map<string, string>();
  let assessmentCursor: AssessmentCursor | null = null;
  for (;;) {
    const artifact = await readPlantIntelligenceAssessmentForPlant({
      plantId: plant.id,
      assessmentId: assessment.id,
      cursor: assessmentCursor,
    });
    evryPublicArtifactSchema.parse(artifact);
    appendUnique(
      assessmentItems,
      artifact.items.map(({ id }) => id)
    );
    for (const item of artifact.items) {
      if (item.sourceLink) assessmentLinks.set(item.id, item.sourceLink.href);
      const exact = item.facts.find(
        ({ label }) => label === "Exact stored text"
      );
      if (exact) assessmentValues.set(item.id, exact.value);
    }
    const command = continuationCommand(
      artifact,
      "show plant intelligence assessment"
    );
    if (!command) break;
    const selected = selectPlantIntelligenceEvryRead(command);
    assert.equal(selected?.readId, "plant-intelligence.assessment");
    assert.equal(selected?.input.assessmentId, assessment.id);
    assessmentCursor = selected?.input.cursor as AssessmentCursor;
  }
  const rebuiltBody = [...assessmentItems]
    .filter((id) => id.startsWith(`${insight.id}:body:`))
    .sort(
      (left, right) =>
        Number(left.split(":").at(-1)) - Number(right.split(":").at(-1))
    )
    .map((id) => assessmentValues.get(id))
    .join("");
  assert.equal(
    rebuiltBody,
    largeBody,
    "every exact stored body code unit must be reconstructed"
  );
  assert.ok(
    assessmentItems.has(`${insight.id}:article:${irregularWikiSlug}`),
    "the stored article source remains present in the lossless reconstruction"
  );
  assert.equal(
    assessmentLinks.get(`${insight.id}:article:${irregularWikiSlug}`),
    "/wiki/guides/100%25%20ready%20%231%3F"
  );

  const historyRows = Array.from({ length: 90 }, (_, index) => ({
    churchId: plant.id,
    fromPhase: index % 7,
    toPhase: (index + 1) % 7,
    initiatedById: owner.id,
    reason: `History ${index} ${"r".repeat(500)}`,
    kind: "transition" as const,
    factSnapshot: {},
    rubricVersion: ACTIVE_RUBRIC.version,
    createdAt: new Date(Date.now() + index * 1_000),
  }));
  const insertedHistory = await db
    .insert(phaseTransitions)
    .values(historyRows)
    .returning({ id: phaseTransitions.id });
  type HistoryCursor = NonNullable<
    Parameters<typeof readPlantIntelligenceDeclarationsForPlant>[0]["cursor"]
  >;
  const historyItems = new Set<string>();
  let historyCursor: HistoryCursor | null = null;
  for (;;) {
    const artifact = await readPlantIntelligenceDeclarationsForPlant({
      plantId: plant.id,
      cursor: historyCursor,
    });
    evryPublicArtifactSchema.parse(artifact);
    appendUnique(
      historyItems,
      artifact.items.map(({ id }) => id)
    );
    const command = continuationCommand(
      artifact,
      "show plant intelligence phase history"
    );
    if (!command) break;
    const selected = selectPlantIntelligenceEvryRead(command);
    assert.equal(selected?.readId, "plant-intelligence.declarations");
    historyCursor = selected?.input.cursor as HistoryCursor;
  }
  for (const row of insertedHistory)
    assert.ok(
      historyItems.has(`${row.id}:summary`),
      `missing phase history ${row.id}`
    );

  type SignalCursor = NonNullable<
    Parameters<typeof readPlantIntelligenceSignalsForPlant>[0]["cursor"]
  >;
  const firstSignalPage = await readPlantIntelligenceSignalsForPlant({
    plantId: plant.id,
    cursor: null,
  });
  const firstSignalCommand = continuationCommand(
    firstSignalPage,
    "show plant intelligence signals"
  );
  assert.ok(firstSignalCommand);
  const staleSignalCursor = selectPlantIntelligenceEvryRead(firstSignalCommand)
    ?.input.cursor as SignalCursor;
  await db
    .update(phaseTransitions)
    .set({ toPhase: 6 })
    .where(eq(phaseTransitions.id, insertedHistory[0]!.id));
  const refusedSignalContinuation = await readPlantIntelligenceSignalsForPlant({
    plantId: plant.id,
    cursor: staleSignalCursor,
  });
  assert.equal(refusedSignalContinuation.items.length, 0);
  assert.equal(
    refusedSignalContinuation.exclusions[0]?.reason,
    "The stored signal page changed; start again"
  );
  const signalItems = new Set<string>();
  let signalCursor: SignalCursor | null = null;
  for (;;) {
    const artifact = await readPlantIntelligenceSignalsForPlant({
      plantId: plant.id,
      cursor: signalCursor,
    });
    evryPublicArtifactSchema.parse(artifact);
    appendUnique(
      signalItems,
      artifact.items.map(({ id }) => id)
    );
    const command = continuationCommand(
      artifact,
      "show plant intelligence signals"
    );
    if (!command) break;
    const selected = selectPlantIntelligenceEvryRead(command);
    assert.equal(selected?.readId, "plant-intelligence.signals");
    signalCursor = selected?.input.cursor as SignalCursor;
  }
  for (const row of insertedHistory)
    assert.ok(
      signalItems.has(`milestone:${row.id}`),
      `missing stored signal milestone ${row.id}`
    );

  const feedbackInsights = await db
    .insert(plantInsights)
    .values(
      Array.from({ length: 90 }, (_, index) => ({
        assessmentId: assessment.id,
        churchId: plant.id,
        audience: "planter" as const,
        category: "phase_progress",
        severity: "info" as const,
        title: `Feedback insight ${index}`,
        body: "Stored",
        rank: index + 2,
      }))
    )
    .returning({ id: plantInsights.id });
  const feedbackRows = await db
    .insert(insightFeedback)
    .values(
      feedbackInsights.map((row, index) => ({
        insightId: row.id,
        assessmentId: assessment.id,
        churchId: plant.id,
        userId: member.id,
        rubricVersion: assessment.rubricVersion,
        rating: index % 2 === 0 ? ("useful" as const) : ("not_useful" as const),
        comment: `Feedback ${index} ${"c".repeat(500)}`,
      }))
    )
    .returning({ id: insightFeedback.id });
  type FeedbackCursor = NonNullable<
    Parameters<typeof readPlantIntelligenceFeedbackForPlant>[0]["cursor"]
  >;
  const firstFeedbackPage = await readPlantIntelligenceFeedbackForPlant({
    plantId: plant.id,
    userId: member.id,
    cursor: null,
  });
  const firstFeedbackCommand = continuationCommand(
    firstFeedbackPage,
    "show plant intelligence feedback"
  );
  assert.ok(firstFeedbackCommand);
  const staleFeedbackCursor = selectPlantIntelligenceEvryRead(
    firstFeedbackCommand
  )?.input.cursor as FeedbackCursor;
  await db
    .update(insightFeedback)
    .set({ comment: "Feedback source mutated between pages" })
    .where(eq(insightFeedback.id, feedbackRows[0]!.id));
  const refusedFeedbackContinuation =
    await readPlantIntelligenceFeedbackForPlant({
      plantId: plant.id,
      userId: member.id,
      cursor: staleFeedbackCursor,
    });
  assert.equal(refusedFeedbackContinuation.items.length, 0);
  assert.equal(
    refusedFeedbackContinuation.exclusions[0]?.reason,
    "The stored feedback changed; start again"
  );
  const feedbackItems = new Set<string>();
  let feedbackCursor: FeedbackCursor | null = null;
  for (;;) {
    const artifact = await readPlantIntelligenceFeedbackForPlant({
      plantId: plant.id,
      userId: member.id,
      cursor: feedbackCursor,
    });
    evryPublicArtifactSchema.parse(artifact);
    appendUnique(
      feedbackItems,
      artifact.items.map(({ id }) => id)
    );
    const command = continuationCommand(
      artifact,
      "show plant intelligence feedback"
    );
    if (!command) break;
    const selected = selectPlantIntelligenceEvryRead(command);
    assert.equal(selected?.readId, "plant-intelligence.feedback");
    feedbackCursor = selected?.input.cursor as FeedbackCursor;
  }
  for (const row of feedbackRows)
    assert.ok(
      feedbackItems.has(`${row.id}:summary`),
      `missing stored feedback ${row.id}`
    );

  const productionProof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--import",
      "./scripts/live-db-endpoint.ts",
      path.join(
        process.cwd(),
        "src/lib/evry/capabilities/plant-intelligence/production-lifecycle-live-proof.ts"
      ),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        EVRY_PI_PROOF_PLANT_ID: plant.id,
        EVRY_PI_PROOF_ACTOR_ID: owner.id,
      },
      timeout: 180_000,
    }
  );
  assert.equal(
    productionProof.status,
    0,
    `Plant Intelligence production lifecycle failed\nstdout:\n${productionProof.stdout}\nstderr:\n${productionProof.stderr}`
  );
  assert.match(
    productionProof.stdout,
    /Plant Intelligence production lifecycle proof passed/
  );
  const readOutcomes = /^EVRY_PLANT_INTELLIGENCE_READ_OUTCOMES=(.+)$/m.exec(
    productionProof.stdout
  )?.[1];
  assert.ok(readOutcomes);
  const parsedReadOutcomes = JSON.parse(readOutcomes) as unknown;
  assert.ok(Array.isArray(parsedReadOutcomes));
  for (const outcome of parsedReadOutcomes) {
    assert.equal(typeof outcome, "string");
    effectOutcomes.add(outcome as string);
  }

  assert.equal(effectOutcomes.size, 33);
  console.log("Plant Intelligence effect live proof passed");
  console.log(
    `EVRY_PLANT_INTELLIGENCE_EFFECT_OUTCOMES=${JSON.stringify([...effectOutcomes].sort())}`
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
