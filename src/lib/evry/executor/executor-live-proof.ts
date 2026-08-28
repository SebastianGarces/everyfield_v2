import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  churches,
  evryActionPlans,
  evryActionPlanStates,
  evryExecutionAttempts,
  evryExecutionOutcomes,
  evryProductAuditEvents,
  sessions,
  users,
} from "@/db/schema";
import { UnauthorizedError } from "@/lib/auth/unauthorized";
import type { EvryEffectInput, EvryEffectResult } from "./registry";

type SessionUser = Readonly<{
  id: string;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  seat: "owner" | "admin" | "member" | null;
}>;

const EFFECT_IDENTITY =
  "action:src/app/(dashboard)/people/actions.ts → updatePersonAction";
const SCRATCH = "__evry executor live proof__";
const FIXTURE_SESSION_ID = "e".repeat(64);
let sessionUser: SessionUser | null = null;
let alternatePlantId: string | null = null;

mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => {
      if (!sessionUser) throw new Error("Unauthorized");
      return { user: sessionUser };
    },
    verifyFreshSession: async () => {
      if (!sessionUser) throw new UnauthorizedError();
      const [fresh] = await db
        .select({
          session: sessions,
          user: {
            id: users.id,
            churchId: users.churchId,
            sendingChurchId: users.sendingChurchId,
            sendingNetworkId: users.sendingNetworkId,
            seat: users.seat,
          },
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.id, FIXTURE_SESSION_ID))
        .limit(1);
      if (!fresh || fresh.session.expiresAt <= new Date()) {
        throw new UnauthorizedError();
      }
      return fresh;
    },
  },
});

interface EffectRow extends Record<string, unknown> {
  affected_count: number;
  excluded_count: number;
  claimed: boolean;
}

const throwAfterCommit = new Set<string>();
const thrown = new Set<string>();
const adapterCalls = new Map<string, number>();

async function executeFixtureEffect(
  input: EvryEffectInput
): Promise<EvryEffectResult> {
  const targetId = String(input.arguments.targetId);
  const expectedVersion = Number(input.arguments.expectedVersion);
  const behavior = String(input.arguments.behavior);
  adapterCalls.set(targetId, (adapterCalls.get(targetId) ?? 0) + 1);

  const existing = await db.execute<EffectRow>(sql`
    select affected_count, excluded_count, false as claimed
    from evry_executor_live_effects
    where effect_key = ${input.effectKey}
  `);
  if (existing.rows[0]) {
    return {
      status: "completed",
      affectedCount: existing.rows[0].affected_count,
      excludedCount: existing.rows[0].excluded_count,
    };
  }

  const [target] = await db
    .execute<{ version: number }>(
      sql`
    select version
    from evry_executor_live_targets
    where id = ${targetId} and version = ${expectedVersion}
  `
    )
    .then((result) => result.rows);
  if (!target) return { status: "refused", excludedCount: 1 };
  if (behavior === "fail") return { status: "failed", excludedCount: 1 };
  if (behavior === "retry") return { status: "retryable" };

  const claimed = await db.execute<EffectRow>(sql`
    insert into evry_executor_live_effects (
      effect_key, target_id, affected_count, excluded_count
    )
    select ${input.effectKey}, ${targetId}, 1, 0
    from evry_executor_live_targets
    where id = ${targetId} and version = ${expectedVersion}
    on conflict (effect_key) do nothing
    returning affected_count, excluded_count, true as claimed
  `);
  const committed =
    claimed.rows[0] ??
    (
      await db.execute<EffectRow>(sql`
        select affected_count, excluded_count, false as claimed
        from evry_executor_live_effects
        where effect_key = ${input.effectKey}
      `)
    ).rows[0];
  if (!committed) return { status: "refused", excludedCount: 1 };

  if (committed.claimed && behavior === "drop_actor_seat") {
    await db
      .update(users)
      .set({ seat: null })
      .where(eq(users.id, input.authorization.actor.userId));
  }
  if (committed.claimed && behavior === "move_actor_plant") {
    assert.ok(alternatePlantId);
    await db
      .update(users)
      .set({ churchId: alternatePlantId })
      .where(eq(users.id, input.authorization.actor.userId));
  }
  if (committed.claimed && behavior === "remove_actor_plant") {
    await db
      .update(users)
      .set({ churchId: null })
      .where(eq(users.id, input.authorization.actor.userId));
  }
  if (committed.claimed && behavior === "logout_actor") {
    await db.delete(sessions).where(eq(sessions.id, FIXTURE_SESSION_ID));
  }

  if (
    committed.claimed &&
    throwAfterCommit.has(targetId) &&
    !thrown.has(targetId)
  ) {
    thrown.add(targetId);
    throw new Error("fixture transport failed after effect commit");
  }
  return {
    status: "completed",
    affectedCount: committed.affected_count,
    excludedCount: committed.excluded_count,
  };
}

async function setupDomain(): Promise<void> {
  await db.execute(sql`
    create table evry_executor_live_targets (
      id uuid primary key,
      version integer not null check (version >= 0)
    )
  `);
  await db.execute(sql`
    create table evry_executor_live_effects (
      effect_key varchar(64) primary key,
      target_id uuid not null references evry_executor_live_targets(id),
      affected_count integer not null,
      excluded_count integer not null
    )
  `);
}

async function seedActor(): Promise<SessionUser> {
  const [plant] = await db
    .insert(churches)
    .values({ name: SCRATCH })
    .returning({ id: churches.id });
  const [actor] = await db
    .insert(users)
    .values({
      email: `${randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: SCRATCH,
      seat: "owner",
      churchId: plant.id,
    })
    .returning({ id: users.id });
  await db.insert(sessions).values({
    id: FIXTURE_SESSION_ID,
    userId: actor.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
  });
  return {
    id: actor.id,
    churchId: plant.id,
    sendingChurchId: null,
    sendingNetworkId: null,
    seat: "owner",
  };
}

async function seedTargets(count: number): Promise<string[]> {
  const ids = Array.from({ length: count }, () => randomUUID());
  for (const id of ids) {
    await db.execute(
      sql`insert into evry_executor_live_targets (id, version) values (${id}::uuid, 1)`
    );
  }
  return ids;
}

type PlanModules = Readonly<{
  correlationForPlanRequest: typeof import("@/lib/evry/audit/identity").correlationForPlanRequest;
  planEventKey: typeof import("@/lib/evry/audit/identity").planEventKey;
  fingerprintEvryActionPlan: typeof import("@/lib/evry/plans").fingerprintEvryActionPlan;
  fingerprintEvryActionPlanIntent: typeof import("@/lib/evry/plans").fingerprintEvryActionPlanIntent;
  mintEvryPlanRequestKey: typeof import("@/lib/evry/plans").mintEvryPlanRequestKey;
  confirmExactEvryActionPlan: typeof import("@/lib/evry/plans/repository").confirmExactEvryActionPlan;
}>;

async function seedApprovedPlan(
  modules: PlanModules,
  document: import("@/lib/evry/plans").EvryActionPlanDocument,
  ageMs = 0
) {
  assert.ok(sessionUser?.churchId);
  const id = randomUUID();
  const requestKey = modules.mintEvryPlanRequestKey();
  const createdAt = new Date(Date.now() - ageMs);
  const expiresAt = new Date(createdAt.getTime() + 15 * 60 * 1_000);
  const fingerprint = modules.fingerprintEvryActionPlan({
    actorUserId: sessionUser.id,
    plantId: sessionUser.churchId,
    expiresAt,
    document,
  });
  await db.batch([
    db.insert(evryActionPlans).values({
      id,
      churchId: sessionUser.churchId,
      actorUserId: sessionUser.id,
      requestKey,
      intentFingerprint: modules.fingerprintEvryActionPlanIntent({
        actorUserId: sessionUser.id,
        plantId: sessionUser.churchId,
        document,
      }),
      fingerprint,
      document,
      createdAt,
      expiresAt,
    }),
    db.insert(evryActionPlanStates).values({
      planId: id,
      churchId: sessionUser.churchId,
      status: "awaiting_confirmation",
      changedAt: createdAt,
    }),
    db.insert(evryProductAuditEvents).values({
      planId: id,
      churchId: sessionUser.churchId,
      actorUserId: sessionUser.id,
      planFingerprint: fingerprint,
      correlationId: modules.correlationForPlanRequest(requestKey),
      eventKey: modules.planEventKey(id, "plan_proposed"),
      eventType: "plan_proposed",
      occurredAt: createdAt,
    }),
  ]);
  const confirmation = await modules.confirmExactEvryActionPlan({
    planId: id,
    actorUserId: sessionUser.id,
    plantId: sessionUser.churchId,
    fingerprint,
    decidedAt: new Date(createdAt.getTime() + 1_000),
  });
  assert.equal(confirmation.status, "approved");
  return { id, fingerprint };
}

function request(plan: { id: string; fingerprint: string }): Request {
  return new Request(`http://localhost/api/evry/plans/${plan.id}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fingerprint: plan.fingerprint }),
  });
}

async function response(
  post: (
    request: Request,
    context: { params: Promise<{ planId: string }> }
  ) => Promise<Response>,
  plan: { id: string; fingerprint: string }
): Promise<{ status: number; body: Record<string, unknown> }> {
  const result = await post(request(plan), {
    params: Promise.resolve({ planId: plan.id }),
  });
  return {
    status: result.status,
    body: (await result.json()) as Record<string, unknown>,
  };
}

async function counts(planId: string) {
  const [attempts, outcomes, effectRows, [state]] = await Promise.all([
    db
      .select({ id: evryExecutionAttempts.id })
      .from(evryExecutionAttempts)
      .where(eq(evryExecutionAttempts.planId, planId)),
    db
      .select({
        subject: evryExecutionOutcomes.subject,
        stepId: evryExecutionOutcomes.stepId,
        status: evryExecutionOutcomes.status,
        resultCode: evryExecutionOutcomes.resultCode,
      })
      .from(evryExecutionOutcomes)
      .where(eq(evryExecutionOutcomes.planId, planId)),
    db.execute<{ count: number }>(sql`
      select count(*)::int as count
      from evry_executor_live_effects e
      join evry_execution_outcomes o on o.effect_key = e.effect_key
      where o.plan_id = ${planId}::uuid
    `),
    db
      .select({ status: evryActionPlanStates.status })
      .from(evryActionPlanStates)
      .where(eq(evryActionPlanStates.planId, planId)),
  ]);
  return {
    attempts: attempts.length,
    outcomes,
    effects: effectRows.rows[0]?.count ?? 0,
    state: state?.status,
  };
}

async function domainEffectCount(targetId: string): Promise<number> {
  const result = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from evry_executor_live_effects
    where target_id = ${targetId}::uuid
  `);
  return result.rows[0]?.count ?? 0;
}

async function main(): Promise<void> {
  await setupDomain();
  sessionUser = await seedActor();
  const [alternatePlant] = await db
    .insert(churches)
    .values({ name: `${SCRATCH} alternate` })
    .returning({ id: churches.id });
  assert.ok(alternatePlant);
  alternatePlantId = alternatePlant.id;

  const auditIdentity = await import("@/lib/evry/audit/identity");
  const plans = await import("@/lib/evry/plans");
  const planRepository = await import("@/lib/evry/plans/repository");
  const executor = await import("@/lib/evry/executor");
  const route = await import("@/app/api/evry/plans/[planId]/execute/route");
  const modules: PlanModules = {
    correlationForPlanRequest: auditIdentity.correlationForPlanRequest,
    planEventKey: auditIdentity.planEventKey,
    fingerprintEvryActionPlan: plans.fingerprintEvryActionPlan,
    fingerprintEvryActionPlanIntent: plans.fingerprintEvryActionPlanIntent,
    mintEvryPlanRequestKey: plans.mintEvryPlanRequestKey,
    confirmExactEvryActionPlan: planRepository.confirmExactEvryActionPlan,
  };
  const planCapability = plans.defineEvryPlanCapability({
    identity: EFFECT_IDENTITY,
    effectClass: "database_write",
    arguments: {
      targetId: z.string().uuid(),
      expectedVersion: z.number().int().nonnegative(),
      behavior: z.enum([
        "complete",
        "fail",
        "retry",
        "throw_after_commit",
        "drop_actor_seat",
        "move_actor_plant",
        "remove_actor_plant",
        "logout_actor",
      ]),
    },
  });
  const registry = executor.createEvryExecutionCapabilityRegistry([
    executor.defineEvryExecutionCapability({
      planCapability,
      executeIfCurrent: executeFixtureEffect,
    }),
  ]);
  const post = route.createEvryPlanExecutePost({ registry });

  function document(
    steps: Array<{
      id: string;
      targetId: string;
      behavior:
        | "complete"
        | "fail"
        | "retry"
        | "throw_after_commit"
        | "drop_actor_seat"
        | "move_actor_plant"
        | "remove_actor_plant"
        | "logout_actor";
      dependsOn: string[];
    }>
  ) {
    return plans.parseEvryActionPlanCandidate({
      candidate: {
        steps: steps.map((step) => ({
          id: step.id,
          capabilityIdentity: EFFECT_IDENTITY,
          arguments: {
            targetId: step.targetId,
            expectedVersion: 1,
            behavior: step.behavior,
          },
          dependsOn: step.dependsOn,
        })),
      },
      registry: registry.planRegistry,
      eligibleCapabilities: [{ identity: EFFECT_IDENTITY }],
    });
  }

  const [completedTarget] = await seedTargets(1);
  const completedPlan = await seedApprovedPlan(
    modules,
    document([
      {
        id: "attempt",
        targetId: completedTarget,
        behavior: "complete",
        dependsOn: [],
      },
    ])
  );
  const doubleClick = await Promise.all([
    response(post, completedPlan),
    response(post, completedPlan),
  ]);
  assert.deepEqual(
    doubleClick.map(({ status }) => status),
    [200, 200]
  );
  assert.deepEqual(
    doubleClick.map(({ body }) => body.status),
    ["completed", "completed"]
  );
  let evidence = await counts(completedPlan.id);
  assert.equal(evidence.attempts, 1);
  assert.equal(evidence.effects, 1);
  assert.equal(evidence.state, "completed");
  assert.deepEqual(
    evidence.outcomes
      .map(({ subject, stepId, resultCode }) => [subject, stepId, resultCode])
      .sort(),
    [
      ["attempt", null, "execution_completed"],
      ["step", "attempt", "effect_completed"],
    ].sort()
  );
  assert.equal((await response(post, completedPlan)).body.status, "completed");
  assert.equal(adapterCalls.get(completedTarget), 2);

  const [crashTarget] = await seedTargets(1);
  throwAfterCommit.add(crashTarget);
  const crashPlan = await seedApprovedPlan(
    modules,
    document([
      {
        id: "crash",
        targetId: crashTarget,
        behavior: "throw_after_commit",
        dependsOn: [],
      },
    ])
  );
  assert.equal((await response(post, crashPlan)).status, 503);
  evidence = await counts(crashPlan.id);
  assert.equal(evidence.effects, 0);
  assert.equal(evidence.outcomes.length, 0);
  assert.equal(evidence.state, "executing");
  assert.equal(await domainEffectCount(crashTarget), 1);
  await db.execute(
    sql`update evry_executor_live_targets set version = 2 where id = ${crashTarget}::uuid`
  );
  assert.equal((await response(post, crashPlan)).status, 200);
  evidence = await counts(crashPlan.id);
  assert.equal(evidence.effects, 1);
  assert.equal(evidence.outcomes.length, 2);
  assert.equal(await domainEffectCount(crashTarget), 1);
  assert.equal(adapterCalls.get(crashTarget), 2);

  assert.ok(sessionUser.churchId);
  const originalPlantId = sessionUser.churchId;
  for (const authorityChange of [
    "logout_actor",
    "drop_actor_seat",
    "move_actor_plant",
    "remove_actor_plant",
  ] as const) {
    const [firstTarget, refusedTarget] = await seedTargets(2);
    const changedAuthorityPlan = await seedApprovedPlan(
      modules,
      document([
        {
          id: `${authorityChange}_first`,
          targetId: firstTarget,
          behavior: authorityChange,
          dependsOn: [],
        },
        {
          id: `${authorityChange}_second`,
          targetId: refusedTarget,
          behavior: "complete",
          dependsOn: [`${authorityChange}_first`],
        },
      ])
    );

    const changedAuthority = await response(post, changedAuthorityPlan);
    assert.equal(changedAuthority.status, 409);
    assert.deepEqual(
      z
        .object({ steps: z.array(z.object({ status: z.string() })) })
        .parse(changedAuthority.body)
        .steps.map(({ status }) => status),
      ["completed", "refused"]
    );
    evidence = await counts(changedAuthorityPlan.id);
    assert.equal(evidence.state, "partially_failed");
    assert.equal(evidence.attempts, 1);
    assert.equal(evidence.outcomes.length, 3);
    assert.equal(evidence.effects, 1);
    assert.equal(await domainEffectCount(firstTarget), 1);
    assert.equal(await domainEffectCount(refusedTarget), 0);
    assert.equal(adapterCalls.has(refusedTarget), false);

    await db
      .update(users)
      .set({ churchId: originalPlantId, seat: "owner" })
      .where(eq(users.id, sessionUser.id));
    await db
      .insert(sessions)
      .values({
        id: FIXTURE_SESSION_ID,
        userId: sessionUser.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      })
      .onConflictDoNothing();
  }

  const [firstTarget, failedTarget, skippedTarget] = await seedTargets(3);
  const partialPlan = await seedApprovedPlan(
    modules,
    document([
      {
        id: "first",
        targetId: firstTarget,
        behavior: "complete",
        dependsOn: [],
      },
      {
        id: "middle",
        targetId: failedTarget,
        behavior: "fail",
        dependsOn: [],
      },
      {
        id: "last",
        targetId: skippedTarget,
        behavior: "complete",
        dependsOn: ["middle", "first"],
      },
    ])
  );
  const partial = await response(post, partialPlan);
  assert.equal(partial.status, 409);
  const partialBody = z
    .object({ steps: z.array(z.object({ status: z.string() })) })
    .parse(partial.body);
  assert.deepEqual(
    partialBody.steps.map(({ status }) => status),
    ["completed", "failed", "skipped"]
  );
  evidence = await counts(partialPlan.id);
  assert.equal(evidence.state, "partially_failed");
  assert.equal(evidence.outcomes.length, 4);
  assert.equal(evidence.effects, 1);
  assert.equal(adapterCalls.has(skippedTarget), false);

  for (const lifecycle of ["cancel", "supersede"] as const) {
    const [targetId] = await seedTargets(1);
    const plan = await seedApprovedPlan(
      modules,
      document([
        {
          id: lifecycle,
          targetId,
          behavior: "complete",
          dependsOn: [],
        },
      ])
    );
    const lifecyclePromise: Promise<unknown> =
      lifecycle === "cancel"
        ? planRepository.cancelExactEvryActionPlan({
            planId: plan.id,
            actorUserId: sessionUser.id,
            plantId: sessionUser.churchId!,
            fingerprint: plan.fingerprint,
            cancelledAt: new Date(),
          })
        : planRepository.reviseExactEvryActionPlan({
            oldPlanId: plan.id,
            oldFingerprint: plan.fingerprint,
            actorUserId: sessionUser.id,
            plantId: sessionUser.churchId!,
            requestKey: plans.mintEvryPlanRequestKey(),
            replacementDocument: document([
              {
                id: "replacement",
                targetId,
                behavior: "complete",
                dependsOn: [],
              },
            ]),
          });
    const [executionResult, lifecycleResult]: [
      { status: number; body: Record<string, unknown> },
      unknown,
    ] = await Promise.all([response(post, plan), lifecyclePromise]);
    evidence = await counts(plan.id);
    const lifecycleWon =
      lifecycle === "cancel"
        ? lifecycleResult === true
        : typeof lifecycleResult === "object" &&
          lifecycleResult !== null &&
          "status" in lifecycleResult &&
          lifecycleResult.status === "revised";
    if (lifecycleWon) {
      assert.equal(executionResult.status, 404);
      assert.equal(evidence.attempts, 0);
      assert.equal(evidence.outcomes.length, 0);
      assert.equal(evidence.effects, 0);
    } else {
      assert.equal(executionResult.status, 200);
      assert.equal(evidence.attempts, 1);
      assert.equal(evidence.effects, 1);
    }
  }

  const [expiredTarget] = await seedTargets(1);
  const expiredPlan = await seedApprovedPlan(
    modules,
    document([
      {
        id: "expired",
        targetId: expiredTarget,
        behavior: "complete",
        dependsOn: [],
      },
    ]),
    16 * 60 * 1_000
  );
  const expired = await response(post, expiredPlan);
  assert.equal(expired.status, 409);
  assert.equal(expired.body.status, "expired");
  evidence = await counts(expiredPlan.id);
  assert.equal(evidence.state, "expired");
  assert.equal(evidence.attempts, 0);
  const [expiryAudit] = await db
    .select({ id: evryProductAuditEvents.id })
    .from(evryProductAuditEvents)
    .where(
      and(
        eq(evryProductAuditEvents.planId, expiredPlan.id),
        eq(evryProductAuditEvents.eventType, "plan_expired")
      )
    );
  assert.ok(expiryAudit);

  process.stdout.write("Evry executor live request proof passed\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
