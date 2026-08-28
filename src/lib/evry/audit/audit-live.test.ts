import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  evryActionPlans,
  evryActionPlanStates,
  evryExecutionAttempts,
  evryExecutionOutcomes,
  evryProductAuditEvents,
  users,
} from "@/db/schema";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  fingerprintEvryActionPlan,
  fingerprintEvryActionPlanIntent,
} from "@/lib/evry/plans/fingerprint";
import {
  fixtureDocument,
  MEETING_IDENTITY,
  SEND_IDENTITY,
} from "@/lib/evry/plans/fixtures.test-helper";
import { confirmExactEvryActionPlan } from "@/lib/evry/plans/repository";
import { mintEvryPlanRequestKey } from "@/lib/evry/plans/request-key";
import {
  EVRY_PLAN_TTL_MS,
  type EvryActionPlanDocument,
} from "@/lib/evry/plans/schema";

import {
  correlationForPlanRequest,
  executionAttemptOutcomeKey,
  mintEvryAuditRequest,
  noopAttemptKey,
  noopEffectKey,
  noopOutcomeKey,
  planEventKey,
} from "./identity";
import {
  completeConfirmedNoop,
  findOwnEvryAuditProjection,
  recordEvryRequestAudit,
} from "./repository";
import {
  completeConfirmedNoopStatement,
  EVRY_AUDIT_NOOP_DOCUMENT,
} from "./statements";
import { readEvryRedactedTelemetry } from "./telemetry";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — real Postgres is required";
const UNREACHABLE =
  "SKIPPED — LIVE_DB_TESTS=1 was set but Postgres was unreachable";
const SCRATCH_NAME = "__evry audit live proof__";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

function key(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

function errorText(error: unknown): string {
  const outer = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : null;
  return `${outer} ${cause instanceof Error ? cause.message : ""}`;
}

async function seedActor(): Promise<{
  actor: EvryPlantActor;
  otherActorId: string;
  otherPlantId: string;
}> {
  const [plant, otherPlant] = await db
    .insert(churches)
    .values([{ name: SCRATCH_NAME }, { name: SCRATCH_NAME }])
    .returning({ id: churches.id });
  const [actor, otherActor] = await db
    .insert(users)
    .values([
      {
        email: `${randomUUID()}@scratch.invalid`,
        passwordHash: "scratch",
        name: SCRATCH_NAME,
        seat: "owner",
        churchId: plant.id,
      },
      {
        email: `${randomUUID()}@scratch.invalid`,
        passwordHash: "scratch",
        name: SCRATCH_NAME,
        seat: "admin",
        churchId: plant.id,
      },
    ])
    .returning({ id: users.id });

  return {
    actor: {
      userId: actor.id,
      plantId: plant.id,
      seat: "owner",
    } as unknown as EvryPlantActor,
    otherActorId: otherActor.id,
    otherPlantId: otherPlant.id,
  };
}

async function seedApprovedPlan(
  actor: EvryPlantActor,
  document: EvryActionPlanDocument = fixtureDocument()
) {
  const id = randomUUID();
  const requestKey = mintEvryPlanRequestKey();
  const createdAt = new Date(Date.now() - 5_000);
  const expiresAt = new Date(createdAt.getTime() + EVRY_PLAN_TTL_MS);
  const fingerprint = fingerprintEvryActionPlan({
    actorUserId: actor.userId,
    plantId: actor.plantId,
    expiresAt,
    document,
  });

  await db.batch([
    db.insert(evryActionPlans).values({
      id,
      churchId: actor.plantId,
      actorUserId: actor.userId,
      requestKey,
      intentFingerprint: fingerprintEvryActionPlanIntent({
        actorUserId: actor.userId,
        plantId: actor.plantId,
        document,
      }),
      fingerprint,
      document,
      createdAt,
      expiresAt,
    }),
    db.insert(evryActionPlanStates).values({
      planId: id,
      churchId: actor.plantId,
      status: "awaiting_confirmation",
      changedAt: createdAt,
    }),
    db.insert(evryProductAuditEvents).values({
      planId: id,
      churchId: actor.plantId,
      actorUserId: actor.userId,
      planFingerprint: fingerprint,
      correlationId: correlationForPlanRequest(requestKey),
      eventKey: planEventKey(id, "plan_proposed"),
      eventType: "plan_proposed",
      occurredAt: createdAt,
    }),
  ]);

  const decidedAt = new Date(createdAt.getTime() + 1_000);
  const confirmation = await confirmExactEvryActionPlan({
    planId: id,
    actorUserId: actor.userId,
    plantId: actor.plantId,
    fingerprint,
    decidedAt,
  });
  assert.equal(confirmation.status, "approved");
  if (!("confirmationId" in confirmation)) {
    throw new Error("fixture approval did not create confirmation evidence");
  }
  const [proposal] = await db
    .select({ id: evryProductAuditEvents.id })
    .from(evryProductAuditEvents)
    .where(
      and(
        eq(evryProductAuditEvents.planId, id),
        eq(evryProductAuditEvents.eventType, "plan_proposed")
      )
    );
  assert.ok(proposal);

  return {
    id,
    fingerprint,
    correlationId: correlationForPlanRequest(requestKey),
    confirmationId: confirmation.confirmationId,
    proposalEventId: proposal.id,
    occurredAt: new Date(decidedAt.getTime() + 1_000),
  };
}

test(
  "append-only audit reconstructs completed and partial plans and rolls effects back with outcomes",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    const fixture = await seedActor();

    for (const result of [
      {
        eventType: "request_read_completed",
        resultCode: "read_completed",
      },
      { eventType: "request_refused", resultCode: "policy_refused" },
      { eventType: "request_failed", resultCode: "request_failed" },
    ] as const) {
      await recordEvryRequestAudit({
        actor: fixture.actor,
        request: mintEvryAuditRequest(),
        result,
      });
    }
    const requestFacts = await db
      .select({
        planId: evryProductAuditEvents.planId,
        planFingerprint: evryProductAuditEvents.planFingerprint,
        actorUserId: evryProductAuditEvents.actorUserId,
        churchId: evryProductAuditEvents.churchId,
        eventType: evryProductAuditEvents.eventType,
        resultCode: evryProductAuditEvents.resultCode,
      })
      .from(evryProductAuditEvents)
      .where(
        and(
          eq(evryProductAuditEvents.actorUserId, fixture.actor.userId),
          eq(evryProductAuditEvents.churchId, fixture.actor.plantId),
          sql`${evryProductAuditEvents.planId} is null`
        )
      );
    assert.deepEqual(
      requestFacts
        .map(({ eventType, resultCode }) => `${eventType}:${resultCode}`)
        .sort(),
      [
        "request_failed:request_failed",
        "request_read_completed:read_completed",
        "request_refused:policy_refused",
      ].sort()
    );
    assert.equal(
      requestFacts.every(
        ({ planId, planFingerprint, actorUserId, churchId }) =>
          planId === null &&
          planFingerprint === null &&
          actorUserId === fixture.actor.userId &&
          churchId === fixture.actor.plantId
      ),
      true
    );
    await assert.rejects(
      () =>
        db.insert(evryProductAuditEvents).values({
          churchId: fixture.actor.plantId,
          actorUserId: fixture.actor.userId,
          correlationId: randomUUID(),
          eventKey: key("invalid request event pairing"),
          eventType: "request_refused",
          resultCode: "read_completed",
          occurredAt: new Date(),
        }),
      (error: unknown) => {
        assert.match(errorText(error), /evry_product_audit_events_shape_check/);
        return true;
      }
    );

    const completedPlan = await seedApprovedPlan(
      fixture.actor,
      EVRY_AUDIT_NOOP_DOCUMENT
    );
    const completionRace = await Promise.all([
      completeConfirmedNoop({
        actor: fixture.actor,
        planId: completedPlan.id,
        fingerprint: completedPlan.fingerprint,
      }),
      completeConfirmedNoop({
        actor: fixture.actor,
        planId: completedPlan.id,
        fingerprint: completedPlan.fingerprint,
      }),
    ]);
    assert.deepEqual(completionRace.map(({ status }) => status).sort(), [
      "already_completed",
      "completed",
    ]);

    const completed = await findOwnEvryAuditProjection({
      planId: completedPlan.id,
      actorUserId: fixture.actor.userId,
      plantId: fixture.actor.plantId,
    });
    assert.ok(completed);
    assert.equal(completed.status, "completed");
    assert.deepEqual(
      completed.events.map(({ type }) => type),
      ["plan_proposed", "plan_approved"]
    );
    assert.equal(completed.attempts.length, 1);
    assert.deepEqual(completed.attempts[0].outcomes, [
      {
        subject: "step",
        stepId: "audit_noop",
        capabilityIdentity: "fixture:evry.audit.noop",
        status: "completed",
        resultCode: "effect_completed",
        affectedCount: 0,
        excludedCount: 0,
        occurredAt: completed.attempts[0].startedAt,
      },
      {
        subject: "attempt",
        stepId: null,
        capabilityIdentity: null,
        status: "completed",
        resultCode: "execution_completed",
        affectedCount: 0,
        excludedCount: 0,
        occurredAt: new Date(
          new Date(completed.attempts[0].startedAt).getTime() + 1
        ).toISOString(),
      },
    ]);

    const redacted = await readEvryRedactedTelemetry(
      completedPlan.correlationId
    );
    assert.deepEqual(
      redacted.map(({ recordKind }) => recordKind),
      [
        "audit_event",
        "audit_event",
        "execution_attempt",
        "execution_outcome",
        "execution_outcome",
      ]
    );
    assert.equal(
      redacted.some((record) =>
        Object.keys(record).some((field) =>
          /actor|church|plant|plan|fingerprint|attemptId|outcomeId/.test(field)
        )
      ),
      false
    );

    assert.equal(
      await findOwnEvryAuditProjection({
        planId: completedPlan.id,
        actorUserId: fixture.otherActorId,
        plantId: fixture.actor.plantId,
      }),
      null
    );
    assert.equal(
      await findOwnEvryAuditProjection({
        planId: completedPlan.id,
        actorUserId: fixture.actor.userId,
        plantId: fixture.otherPlantId,
      }),
      null
    );

    const ordinaryPlan = await seedApprovedPlan(fixture.actor);
    assert.deepEqual(
      await completeConfirmedNoop({
        actor: fixture.actor,
        planId: ordinaryPlan.id,
        fingerprint: ordinaryPlan.fingerprint,
      }),
      { status: "unavailable" }
    );
    const [ordinaryState] = await db
      .select({ status: evryActionPlanStates.status })
      .from(evryActionPlanStates)
      .where(eq(evryActionPlanStates.planId, ordinaryPlan.id));
    assert.equal(ordinaryState.status, "approved");

    const rolledBackPlan = await seedApprovedPlan(
      fixture.actor,
      EVRY_AUDIT_NOOP_DOCUMENT
    );
    await assert.rejects(
      () =>
        db.execute(
          completeConfirmedNoopStatement({
            planId: rolledBackPlan.id,
            actorUserId: fixture.actor.userId,
            plantId: fixture.actor.plantId,
            fingerprint: rolledBackPlan.fingerprint,
            attemptId: randomUUID(),
            attemptKey: noopAttemptKey(rolledBackPlan.id),
            outcomeKey: noopOutcomeKey(rolledBackPlan.id),
            attemptOutcomeKey: executionAttemptOutcomeKey(
              rolledBackPlan.id,
              rolledBackPlan.fingerprint
            ),
            // A completed effect already owns this key. The unique refusal must
            // roll back this other plan's state change and attempt together.
            effectKey: noopEffectKey(completedPlan.id),
            occurredAt: rolledBackPlan.occurredAt,
          })
        ),
      (error: unknown) => {
        assert.match(
          errorText(error),
          /evry_execution_outcomes_effect_unique_idx/
        );
        return true;
      }
    );
    const [rolledBackState] = await db
      .select({ status: evryActionPlanStates.status })
      .from(evryActionPlanStates)
      .where(eq(evryActionPlanStates.planId, rolledBackPlan.id));
    assert.equal(rolledBackState.status, "approved");
    const [{ rolledBackAttempts }] = await db
      .select({ rolledBackAttempts: sql<number>`count(*)::int` })
      .from(evryExecutionAttempts)
      .where(eq(evryExecutionAttempts.planId, rolledBackPlan.id));
    assert.equal(rolledBackAttempts, 0);

    const partialPlan = await seedApprovedPlan(fixture.actor);
    const partialAttemptId = randomUUID();
    await db.batch([
      db
        .update(evryActionPlanStates)
        .set({
          status: "partially_failed",
          version: sql`${evryActionPlanStates.version} + 1`,
          changedAt: partialPlan.occurredAt,
        })
        .where(eq(evryActionPlanStates.planId, partialPlan.id)),
      db.insert(evryExecutionAttempts).values({
        id: partialAttemptId,
        planId: partialPlan.id,
        churchId: fixture.actor.plantId,
        actorUserId: fixture.actor.userId,
        planFingerprint: partialPlan.fingerprint,
        confirmationId: partialPlan.confirmationId,
        proposalEventId: partialPlan.proposalEventId,
        proposalEventType: "plan_proposed",
        correlationId: partialPlan.correlationId,
        attemptKey: key(`partial-attempt:${partialPlan.id}`),
        startedAt: partialPlan.occurredAt,
      }),
      db.insert(evryExecutionOutcomes).values([
        {
          attemptId: partialAttemptId,
          planId: partialPlan.id,
          churchId: fixture.actor.plantId,
          actorUserId: fixture.actor.userId,
          planFingerprint: partialPlan.fingerprint,
          correlationId: partialPlan.correlationId,
          outcomeKey: key(`partial-step-ok:${partialPlan.id}`),
          effectKey: key(`partial-effect:${partialPlan.id}`),
          subject: "step",
          stepId: "create-meeting",
          capabilityIdentity: MEETING_IDENTITY,
          status: "completed",
          resultCode: "effect_completed",
          affectedCount: 1,
          excludedCount: 2,
          occurredAt: partialPlan.occurredAt,
        },
        {
          attemptId: partialAttemptId,
          planId: partialPlan.id,
          churchId: fixture.actor.plantId,
          actorUserId: fixture.actor.userId,
          planFingerprint: partialPlan.fingerprint,
          correlationId: partialPlan.correlationId,
          outcomeKey: key(`partial-step-failed:${partialPlan.id}`),
          subject: "step",
          stepId: "send-invitation",
          capabilityIdentity: SEND_IDENTITY,
          status: "failed",
          resultCode: "effect_failed",
          affectedCount: 0,
          excludedCount: 1,
          occurredAt: new Date(partialPlan.occurredAt.getTime() + 1),
        },
        {
          attemptId: partialAttemptId,
          planId: partialPlan.id,
          churchId: fixture.actor.plantId,
          actorUserId: fixture.actor.userId,
          planFingerprint: partialPlan.fingerprint,
          correlationId: partialPlan.correlationId,
          outcomeKey: key(`partial-result:${partialPlan.id}`),
          subject: "attempt",
          status: "partially_failed",
          resultCode: "effect_failed",
          affectedCount: 0,
          excludedCount: 0,
          occurredAt: new Date(partialPlan.occurredAt.getTime() + 2),
        },
      ]),
    ]);

    await assert.rejects(
      () =>
        db.insert(evryExecutionOutcomes).values({
          attemptId: partialAttemptId,
          planId: partialPlan.id,
          churchId: fixture.actor.plantId,
          actorUserId: fixture.actor.userId,
          planFingerprint: partialPlan.fingerprint,
          correlationId: partialPlan.correlationId,
          outcomeKey: key(`unapproved-step:${partialPlan.id}`),
          subject: "step",
          stepId: "not-approved",
          capabilityIdentity: "fixture:not-approved",
          status: "failed",
          resultCode: "effect_failed",
          occurredAt: new Date(partialPlan.occurredAt.getTime() + 3),
        }),
      (error: unknown) => {
        assert.match(errorText(error), /exact approved plan step/);
        return true;
      }
    );

    const partial = await findOwnEvryAuditProjection({
      planId: partialPlan.id,
      actorUserId: fixture.actor.userId,
      plantId: fixture.actor.plantId,
    });
    assert.ok(partial);
    assert.equal(partial.status, "partially_failed");
    assert.deepEqual(
      partial.attempts[0].outcomes.map(({ stepId, status }) => [
        stepId,
        status,
      ]),
      [
        ["create-meeting", "completed"],
        ["send-invitation", "failed"],
        [null, "partially_failed"],
      ]
    );
    assert.deepEqual(
      partial.attempts[0].outcomes.map(
        ({ capabilityIdentity }) => capabilityIdentity
      ),
      [MEETING_IDENTITY, SEND_IDENTITY, null]
    );

    await assert.rejects(
      () =>
        db.insert(evryExecutionAttempts).values({
          planId: partialPlan.id,
          churchId: fixture.otherPlantId,
          actorUserId: fixture.actor.userId,
          planFingerprint: partialPlan.fingerprint,
          confirmationId: partialPlan.confirmationId,
          proposalEventId: partialPlan.proposalEventId,
          proposalEventType: "plan_proposed",
          correlationId: partialPlan.correlationId,
          attemptKey: key(`foreign:${partialPlan.id}`),
          startedAt: partialPlan.occurredAt,
        }),
      (error: unknown) => {
        assert.match(errorText(error), /evry_execution_attempts_exact_plan_fk/);
        return true;
      }
    );

    for (const mutation of [
      db
        .update(evryProductAuditEvents)
        .set({ occurredAt: new Date() })
        .where(eq(evryProductAuditEvents.planId, completedPlan.id)),
      db
        .delete(evryExecutionAttempts)
        .where(eq(evryExecutionAttempts.planId, completedPlan.id)),
      db
        .update(evryExecutionOutcomes)
        .set({ affectedCount: 99 })
        .where(eq(evryExecutionOutcomes.planId, completedPlan.id)),
    ]) {
      await assert.rejects(
        () => mutation,
        (error: unknown) => {
          assert.match(errorText(error), /immutable Evry row/);
          return true;
        }
      );
    }
    await assert.rejects(
      () => db.execute(sql`truncate table evry_execution_outcomes`),
      (error: unknown) => {
        assert.match(errorText(error), /immutable Evry row/);
        return true;
      }
    );
    await assert.rejects(
      () => db.execute(sql`truncate table evry_action_plans cascade`),
      (error: unknown) => {
        assert.match(errorText(error), /immutable Evry row/);
        return true;
      }
    );

    const telemetry = await db.execute(
      sql`select * from evry_redacted_telemetry`
    );
    assert.ok(telemetry.rows.length > 0);
    assert.deepEqual(Object.keys(telemetry.rows[0]).sort(), [
      "affected_count",
      "capability_identity",
      "correlation_id",
      "event_name",
      "excluded_count",
      "occurred_at",
      "record_kind",
      "result_code",
      "status",
    ]);
    assert.equal(
      telemetry.rows.some((row) =>
        Object.keys(row).some((column) =>
          /actor|church|fingerprint|plan_id|attempt_id|outcome_id/.test(column)
        )
      ),
      false
    );
  }
);
