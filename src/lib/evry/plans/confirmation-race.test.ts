import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  evryActionPlans,
  evryActionPlanStates,
  evryPlanConfirmations,
  evryProductAuditEvents,
  users,
} from "@/db/schema";
import {
  correlationForPlanRequest,
  planEventKey,
} from "@/lib/evry/audit/identity";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

import {
  fingerprintEvryActionPlan,
  fingerprintEvryActionPlanIntent,
} from "./fingerprint";
import {
  ELIGIBLE_FIXTURE_CAPABILITIES,
  fixtureCandidate,
  fixtureDocument,
  PLAN_FIXTURE_REGISTRY,
} from "./fixtures.test-helper";
import { validateStoredEvryActionPlan } from "./integrity";
import {
  confirmExactEvryActionPlan,
  findExactEvryActionPlan,
  type StoredEvryActionPlan,
} from "./repository";
import { mintEvryPlanRequestKey, type EvryPlanRequestKey } from "./request-key";
import {
  EVRY_PLAN_TTL_MS,
  parseEvryActionPlanCandidate,
  type EvryActionPlanDocument,
} from "./schema";
import {
  confirmEvryActionPlan,
  createEvryActionPlan,
  reviseEvryActionPlan,
} from "./service";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — real Postgres concurrency is required";
const UNREACHABLE =
  "SKIPPED — LIVE_DB_TESTS=1 was set but Postgres was unreachable, so the CAS races did NOT run";
const SCRATCH_NAME = "__evry action plan race scratch__";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

interface Fixture {
  actor: EvryPlantActor;
  otherActorUserId: string;
  otherPlantId: string;
}

async function seedActors(): Promise<Fixture> {
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

  // The test cannot mint the module-private brand. Its database fixture is the
  // evidence behind these exact ids; production only obtains this through auth.
  const plantActor = {
    userId: actor.id,
    plantId: plant.id,
    seat: "owner",
  } as unknown as EvryPlantActor;
  return {
    actor: plantActor,
    otherActorUserId: otherActor.id,
    otherPlantId: otherPlant.id,
  };
}

const ACTION_POLICY = {
  classification: "application_action",
  continuation: {
    kind: "application_action",
    literalUserText: "Create the exact fixture effects.",
  },
} as const;

function documentWithBody(body: string): EvryActionPlanDocument {
  const candidate = structuredClone(fixtureCandidate()) as {
    steps: Array<{ arguments: Record<string, unknown> }>;
  };
  candidate.steps[1].arguments.body = body;
  return parseEvryActionPlanCandidate({
    candidate,
    registry: PLAN_FIXTURE_REGISTRY,
    eligibleCapabilities: ELIGIBLE_FIXTURE_CAPABILITIES,
  });
}

async function insertFixturePlan(input: {
  actor: EvryPlantActor;
  document: EvryActionPlanDocument;
  createdAt: Date;
  requestKey?: EvryPlanRequestKey;
}): Promise<StoredEvryActionPlan> {
  const id = randomUUID();
  const expiresAt = new Date(input.createdAt.getTime() + EVRY_PLAN_TTL_MS);
  const fingerprint = fingerprintEvryActionPlan({
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    expiresAt,
    document: input.document,
  });
  const requestKey = input.requestKey ?? mintEvryPlanRequestKey();
  const intentFingerprint = fingerprintEvryActionPlanIntent({
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    document: input.document,
  });
  const [[plan], [state]] = await db.batch([
    db
      .insert(evryActionPlans)
      .values({
        id,
        churchId: input.actor.plantId,
        actorUserId: input.actor.userId,
        requestKey,
        intentFingerprint,
        fingerprint,
        document: input.document,
        createdAt: input.createdAt,
        expiresAt,
      })
      .returning(),
    db
      .insert(evryActionPlanStates)
      .values({
        planId: id,
        churchId: input.actor.plantId,
        status: "awaiting_confirmation",
        changedAt: input.createdAt,
      })
      .returning(),
    db.insert(evryProductAuditEvents).values({
      planId: id,
      churchId: input.actor.plantId,
      actorUserId: input.actor.userId,
      planFingerprint: fingerprint,
      correlationId: correlationForPlanRequest(requestKey),
      eventKey: planEventKey(id, "plan_proposed"),
      eventType: "plan_proposed",
      occurredAt: input.createdAt,
    }),
  ]);
  return {
    id: plan.id,
    actorUserId: plan.actorUserId,
    plantId: plan.churchId,
    requestKey: plan.requestKey as EvryPlanRequestKey,
    intentFingerprint: plan.intentFingerprint,
    fingerprint: plan.fingerprint,
    document: plan.document,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    supersedesPlanId: plan.supersedesPlanId,
    status: state.status,
    stateVersion: state.version,
    stateChangedAt: state.changedAt,
  };
}

function errorText(error: unknown): string {
  const outer = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : null;
  return `${outer} ${cause instanceof Error ? cause.message : ""}`;
}

test(
  "the public creator owns time and Postgres refuses a forged lifetime",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    const fixture = await seedActors();

    const requestKey = mintEvryPlanRequestKey();
    const creation = {
      actor: fixture.actor,
      policy: ACTION_POLICY,
      candidate: fixtureCandidate(),
      requestKey,
      registry: PLAN_FIXTURE_REGISTRY,
      eligibleCapabilities: ELIGIBLE_FIXTURE_CAPABILITIES,
    };
    const [created, replay] = await Promise.all([
      createEvryActionPlan(creation),
      createEvryActionPlan(creation),
    ]);
    assert.equal(replay.id, created.id);
    assert.equal(replay.requestKey, requestKey);
    assert.equal(
      created.expiresAt.getTime() - created.createdAt.getTime(),
      EVRY_PLAN_TTL_MS
    );

    const intentionalLaterPlan = await createEvryActionPlan({
      ...creation,
      requestKey: mintEvryPlanRequestKey(),
    });
    assert.notEqual(intentionalLaterPlan.id, created.id);

    const changedCandidate = structuredClone(fixtureCandidate()) as {
      steps: Array<{ arguments: Record<string, unknown> }>;
    };
    changedCandidate.steps[1].arguments.body = "Different request bytes.";
    await assert.rejects(
      () =>
        createEvryActionPlan({
          ...creation,
          candidate: changedCandidate,
        }),
      (error: unknown) => {
        assert.match(
          errorText(error),
          /evry_action_plans_actor_request_unique_idx/
        );
        return true;
      }
    );

    const forgedCreatedAt = new Date();
    await assert.rejects(
      () =>
        db.insert(evryActionPlans).values({
          churchId: fixture.actor.plantId,
          actorUserId: fixture.actor.userId,
          requestKey: mintEvryPlanRequestKey(),
          intentFingerprint: fingerprintEvryActionPlanIntent({
            actorUserId: fixture.actor.userId,
            plantId: fixture.actor.plantId,
            document: fixtureDocument(),
          }),
          fingerprint: "f".repeat(64),
          document: fixtureDocument(),
          createdAt: forgedCreatedAt,
          expiresAt: new Date(forgedCreatedAt.getTime() + EVRY_PLAN_TTL_MS + 1),
        }),
      (error: unknown) => {
        assert.match(errorText(error), /evry_action_plans_expiration_check/);
        return true;
      }
    );
  }
);

test(
  "exact confirmation, expiry, and revision converge under concurrent requests",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);
    const fixture = await seedActors();

    const createdAt = new Date();
    const expiring = await insertFixturePlan({
      actor: fixture.actor,
      document: fixtureDocument(),
      createdAt,
    });
    const decidedAt = new Date(createdAt.getTime() + 60_000);
    const exact = {
      actor: fixture.actor,
      planId: expiring.id,
      fingerprint: expiring.fingerprint,
      decidedAt,
      registry: PLAN_FIXTURE_REGISTRY,
    };

    for (const nearMatch of [
      { actorUserId: fixture.otherActorUserId, plantId: fixture.actor.plantId },
      { actorUserId: fixture.actor.userId, plantId: fixture.otherPlantId },
    ]) {
      assert.deepEqual(
        await confirmExactEvryActionPlan({
          planId: expiring.id,
          fingerprint: expiring.fingerprint,
          decidedAt,
          ...nearMatch,
        }),
        { status: "unavailable" }
      );
    }
    assert.deepEqual(
      await confirmExactEvryActionPlan({
        planId: expiring.id,
        actorUserId: fixture.actor.userId,
        plantId: fixture.actor.plantId,
        fingerprint: "e".repeat(64),
        decidedAt,
      }),
      { status: "unavailable" }
    );

    // Integrity is read first. A direct tamper in the gap is refused by the
    // database trigger, so the subsequent exact confirmation still names the
    // bytes the person saw.
    const integrityRead = await findExactEvryActionPlan({
      planId: expiring.id,
      actorUserId: fixture.actor.userId,
      plantId: fixture.actor.plantId,
      fingerprint: expiring.fingerprint,
    });
    assert.ok(integrityRead);
    assert.equal(
      validateStoredEvryActionPlan(integrityRead, PLAN_FIXTURE_REGISTRY),
      true
    );
    await assert.rejects(
      () =>
        db
          .update(evryActionPlans)
          .set({ document: documentWithBody("tampered") })
          .where(eq(evryActionPlans.id, expiring.id)),
      (error: unknown) => {
        assert.match(errorText(error), /immutable Evry row/);
        return true;
      }
    );

    const confirmationRace = await Promise.all([
      confirmEvryActionPlan(exact),
      confirmEvryActionPlan(exact),
    ]);
    assert.deepEqual(confirmationRace.map((result) => result.status).sort(), [
      "already_approved",
      "approved",
    ]);
    const confirmationIds = confirmationRace.flatMap((result) =>
      "confirmationId" in result ? [result.confirmationId] : []
    );
    assert.equal(new Set(confirmationIds).size, 1);

    const beforeExpiry = await confirmEvryActionPlan({
      ...exact,
      decidedAt: new Date(expiring.expiresAt.getTime() - 1),
    });
    assert.equal(beforeExpiry.status, "already_approved");

    const atExpiry = await confirmEvryActionPlan({
      ...exact,
      decidedAt: expiring.expiresAt,
    });
    assert.deepEqual(atExpiry, { status: "expired" });
    const [expiredState] = await db
      .select({
        status: evryActionPlanStates.status,
        version: evryActionPlanStates.version,
      })
      .from(evryActionPlanStates)
      .where(eq(evryActionPlanStates.planId, expiring.id));
    assert.deepEqual(expiredState, { status: "expired", version: 2 });
    const [{ confirmationCount }] = await db
      .select({ confirmationCount: sql<number>`count(*)::int` })
      .from(evryPlanConfirmations)
      .where(eq(evryPlanConfirmations.planId, expiring.id));
    assert.equal(confirmationCount, 1);

    // A separate approved plan is revised twice concurrently. Server-owned
    // timestamps may differ, but canonical document identity makes one the
    // winner and the other an idempotent replay of that same edit.
    const revisable = await insertFixturePlan({
      actor: fixture.actor,
      document: documentWithBody("Original revision plan."),
      createdAt: new Date(createdAt.getTime() + 1),
    });
    const approval = await confirmEvryActionPlan({
      actor: fixture.actor,
      planId: revisable.id,
      fingerprint: revisable.fingerprint,
      decidedAt: new Date(revisable.createdAt.getTime() + 60_000),
      registry: PLAN_FIXTURE_REGISTRY,
    });
    assert.equal(approval.status, "approved");

    const revision = {
      actor: fixture.actor,
      oldPlanId: revisable.id,
      oldFingerprint: revisable.fingerprint,
      candidate: structuredClone(fixtureCandidate()),
      requestKey: mintEvryPlanRequestKey(),
      registry: PLAN_FIXTURE_REGISTRY,
      eligibleCapabilities: ELIGIBLE_FIXTURE_CAPABILITIES,
    };
    const revisionRace = await Promise.all([
      reviseEvryActionPlan(revision),
      reviseEvryActionPlan(revision),
    ]);
    assert.deepEqual(revisionRace.map((result) => result.status).sort(), [
      "already_revised",
      "revised",
    ]);
    const successors = revisionRace.flatMap((result) =>
      "planId" in result ? [result] : []
    );
    assert.equal(new Set(successors.map(({ planId }) => planId)).size, 1);
    assert.equal(
      new Set(successors.map(({ fingerprint }) => fingerprint)).size,
      1
    );

    const [successor] = await db
      .select({
        id: evryActionPlans.id,
        createdAt: evryActionPlans.createdAt,
        expiresAt: evryActionPlans.expiresAt,
        status: evryActionPlanStates.status,
      })
      .from(evryActionPlans)
      .innerJoin(
        evryActionPlanStates,
        eq(evryActionPlanStates.planId, evryActionPlans.id)
      )
      .where(
        and(
          eq(evryActionPlans.supersedesPlanId, revisable.id),
          eq(evryActionPlans.churchId, fixture.actor.plantId)
        )
      );
    assert.equal(successor.id, successors[0].planId);
    assert.equal(successor.status, "awaiting_confirmation");
    assert.equal(
      successor.expiresAt.getTime() - successor.createdAt.getTime(),
      EVRY_PLAN_TTL_MS
    );
    assert.deepEqual(
      await confirmEvryActionPlan({
        actor: fixture.actor,
        planId: revisable.id,
        fingerprint: revisable.fingerprint,
        decidedAt: new Date(revisable.createdAt.getTime() + 2 * 60_000),
        registry: PLAN_FIXTURE_REGISTRY,
      }),
      { status: "not_confirmable" }
    );
    const [{ replacementConfirmationCount }] = await db
      .select({ replacementConfirmationCount: sql<number>`count(*)::int` })
      .from(evryPlanConfirmations)
      .where(eq(evryPlanConfirmations.planId, successor.id));
    assert.equal(replacementConfirmationCount, 0);
  }
);
