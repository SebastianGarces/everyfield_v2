import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  feedback,
  notificationPreferences,
  notifications,
  users,
} from "@/db/schema";
import {
  evryCapabilityRegistrationFor,
  eligibleEvryCapabilitiesFor,
  type EvryEffectCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { createEvryExecutor } from "@/lib/evry/executor/core";
import {
  findEvryExecutionSnapshot,
  finishEvryExecution,
  recordEvryStepOutcome,
  revalidateEvryExecutionStep,
  startOrResumeEvryExecution,
} from "@/lib/evry/executor/repository";
import {
  confirmExactEvryActionPlan,
  createEvryActionPlanRecord,
  findExactEvryActionPlan,
} from "@/lib/evry/plans/repository";
import {
  deriveEvryPlanRequestKey,
  parseEvryActionPlanCandidate,
} from "@/lib/evry/plans";
import { createEvryExecutionCapabilityRegistry } from "@/lib/evry/executor";
import {
  getDashboardMetrics,
  getRecentActivity,
} from "@/lib/dashboard/service";
import {
  loadNotificationFeedScreen,
  loadUnreadBadgeCount,
  notificationViewer,
} from "@/lib/notifications/feed";

import {
  MARK_ALL_NOTIFICATIONS_IDENTITY,
  MARK_ONE_NOTIFICATION_IDENTITY,
  SUBMIT_FEEDBACK_IDENTITY,
  createMarkAllNotificationsExecution,
  createMarkOneNotificationExecution,
  createSubmitFeedbackExecution,
  feedbackArgumentsSchema,
  loadEvryUnreadNotificationSnapshot,
  markAllArgumentsSchema,
  markOneArgumentsSchema,
} from "./effects";

const proofOutcomes = new Set<string>();
const bridgeCalls: string[] = [];
let beforeNotificationClaim: (() => Promise<void>) | null = null;

const notificationExecutionDependencies = {
  async beforeClaim() {
    const hook = beforeNotificationClaim;
    beforeNotificationClaim = null;
    await hook?.();
  },
};

const registry = createEvryExecutionCapabilityRegistry([
  createMarkOneNotificationExecution(notificationExecutionDependencies),
  createMarkAllNotificationsExecution(notificationExecutionDependencies),
  createSubmitFeedbackExecution((row) => {
    bridgeCalls.push(row.id);
    if (row.description === "bridge failure") {
      throw new Error("forced bridge scheduling failure");
    }
  }),
]);

function actor(churchId: string, userId: string) {
  return {
    plantId: churchId,
    userId,
    seat: "owner",
  } as unknown as EvryPlantActor;
}

function authorizationFor(actor_: EvryPlantActor, identity: string) {
  const registration = evryCapabilityRegistrationFor(identity);
  assert.ok(registration?.operationKind === "effect");
  return {
    actor: actor_,
    registration,
  } as unknown as EvryEffectCapabilityAuthorization;
}

const executor = createEvryExecutor({
  authorizeCapability: async (identity) => {
    if (!currentActor) return null;
    return authorizationFor(currentActor, identity);
  },
  findExactPlan: findExactEvryActionPlan,
  findSnapshot: findEvryExecutionSnapshot,
  startOrResume: startOrResumeEvryExecution,
  revalidateStep: revalidateEvryExecutionStep,
  recordStep: recordEvryStepOutcome,
  finish: finishEvryExecution,
  expirePlan: confirmExactEvryActionPlan,
  now: () => new Date(),
});

let currentActor: EvryPlantActor | null = null;

async function approvedPlan(input: {
  actor: EvryPlantActor;
  identity: string;
  stepId: string;
  arguments: Record<string, unknown>;
}) {
  const requestKey = deriveEvryPlanRequestKey(`live-${input.stepId}`, [
    input.actor.userId,
    input.actor.plantId,
    randomUUID(),
  ]);
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: input.stepId,
          capabilityIdentity: input.identity,
          arguments: input.arguments,
          dependsOn: [],
        },
      ],
    },
    registry: registry.planRegistry,
    eligibleCapabilities: eligibleEvryCapabilitiesFor(input.actor),
  });
  const plan = await createEvryActionPlanRecord({
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    requestKey,
    document,
  });
  const confirmation = await confirmExactEvryActionPlan({
    planId: plan.id,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    fingerprint: plan.fingerprint,
    decidedAt: new Date(),
  });
  assert.ok(
    confirmation.status === "approved" ||
      confirmation.status === "already_approved"
  );
  return plan;
}

async function execute(
  plan: Awaited<ReturnType<typeof approvedPlan>>,
  actor_: EvryPlantActor
) {
  currentActor = actor_;
  return executor({
    actor: actor_,
    planId: plan.id,
    fingerprint: plan.fingerprint,
    registry,
  });
}

async function main() {
  const [plant, foreignPlant] = await Promise.all([
    db
      .insert(churches)
      .values({ name: "__Platform proof__" })
      .returning()
      .then(([row]) => row),
    db
      .insert(churches)
      .values({ name: "__Foreign platform proof__" })
      .returning()
      .then(([row]) => row),
  ]);
  assert.ok(plant && foreignPlant);
  const [owner, foreignOwner] = await Promise.all([
    db
      .insert(users)
      .values({
        email: `${randomUUID()}@scratch.invalid`,
        passwordHash: "scratch",
        name: "Platform owner",
        churchId: plant.id,
        seat: "owner",
      })
      .returning()
      .then(([row]) => row),
    db
      .insert(users)
      .values({
        email: `${randomUUID()}@scratch.invalid`,
        passwordHash: "scratch",
        name: "Foreign owner",
        churchId: foreignPlant.id,
        seat: "owner",
      })
      .returning()
      .then(([row]) => row),
  ]);
  assert.ok(owner && foreignOwner);
  const plantActor = actor(plant.id, owner.id);
  const now = new Date();
  const visible = await db
    .insert(notifications)
    .values({
      churchId: plant.id,
      recipientUserId: owner.id,
      category: "meetings",
      type: "meeting.reminder",
      title: "Visible",
      body: "Visible body",
      scheduledFor: new Date(now.getTime() - 1_000),
    })
    .returning()
    .then(([row]) => row);
  const foreign = await db
    .insert(notifications)
    .values({
      churchId: foreignPlant.id,
      recipientUserId: foreignOwner.id,
      category: "meetings",
      type: "meeting.reminder",
      title: "Foreign",
      body: "Foreign body",
      scheduledFor: new Date(now.getTime() - 1_000),
    })
    .returning()
    .then(([row]) => row);
  assert.ok(visible && foreign);
  const ownerViewer = notificationViewer({ user: owner });
  assert.ok(ownerViewer);
  assert.equal(await loadUnreadBadgeCount(ownerViewer), 1);
  assert.deepEqual(
    (await loadNotificationFeedScreen(ownerViewer, { now })).rows.map(
      ({ id }) => id
    ),
    [visible.id]
  );
  assert.deepEqual(await getDashboardMetrics(plant.id, owner.id), {
    coreGroupSize: 0,
    totalPeople: 0,
    overdueTasks: 0,
    visionMeetingsHeld: 0,
  });
  assert.deepEqual(await getRecentActivity(plant.id), []);
  assert.equal(
    (
      await loadEvryUnreadNotificationSnapshot({
        actor: plantActor,
        notificationId: foreign.id,
        now,
      })
    ).notifications.length,
    0
  );

  const oneSnapshot = await loadEvryUnreadNotificationSnapshot({
    actor: plantActor,
    notificationId: visible.id,
    now,
  });
  const onePlan = await approvedPlan({
    actor: plantActor,
    identity: MARK_ONE_NOTIFICATION_IDENTITY,
    stepId: "mark-one",
    arguments: markOneArgumentsSchema.parse({
      notification: oneSnapshot.notifications[0],
      visibility: oneSnapshot.visibility,
    }),
  });
  const one = await execute(onePlan, plantActor);
  assert.equal(one.status, "completed");
  assert.equal(one.steps[0]?.affectedCount, 1);
  proofOutcomes.add(`${MARK_ONE_NOTIFICATION_IDENTITY}:execution`);
  assert.deepEqual(await execute(onePlan, plantActor), one);
  proofOutcomes.add(`${MARK_ONE_NOTIFICATION_IDENTITY}:idempotency`);

  const stale = await db
    .insert(notifications)
    .values({
      churchId: plant.id,
      recipientUserId: owner.id,
      category: "tasks",
      type: "task.assigned",
      title: "Before drift",
      body: "Exact body",
      scheduledFor: new Date(now.getTime() - 1_000),
    })
    .returning()
    .then(([row]) => row);
  assert.ok(stale);
  const staleSnapshot = await loadEvryUnreadNotificationSnapshot({
    actor: plantActor,
    notificationId: stale.id,
    now,
  });
  const stalePlan = await approvedPlan({
    actor: plantActor,
    identity: MARK_ONE_NOTIFICATION_IDENTITY,
    stepId: "mark-stale",
    arguments: markOneArgumentsSchema.parse({
      notification: staleSnapshot.notifications[0],
      visibility: staleSnapshot.visibility,
    }),
  });
  await db
    .update(notifications)
    .set({ title: "After drift", updatedAt: new Date() })
    .where(eq(notifications.id, stale.id));
  assert.equal((await execute(stalePlan, plantActor)).status, "refused");
  assert.equal(
    await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.id, stale.id))
      .then(([row]) => row?.readAt),
    null
  );
  proofOutcomes.add(`${MARK_ONE_NOTIFICATION_IDENTITY}:errors`);

  await db.insert(notificationPreferences).values({
    userId: owner.id,
    category: "teams",
    channel: "in_app",
    enabled: false,
    intent: "chosen",
  });
  const bulkRows = Array.from({ length: 35 }, (_, index) => ({
    churchId: plant.id,
    recipientUserId: owner.id,
    category: "tasks" as const,
    type: "task.assigned",
    title: `Bulk ${index}`,
    body: `Body ${index}`,
    scheduledFor: new Date(now.getTime() - 1_000),
  }));
  const notificationValues: (typeof notifications.$inferInsert)[] = [
    ...bulkRows,
    {
      churchId: plant.id,
      recipientUserId: owner.id,
      category: "teams",
      type: "person.hidden",
      title: "Hidden by preference",
      body: "Keep unread",
      scheduledFor: new Date(now.getTime() - 1_000),
    },
    {
      churchId: plant.id,
      recipientUserId: owner.id,
      category: "tasks",
      type: "task.future",
      title: "Future",
      body: "Keep unread",
      scheduledFor: new Date(now.getTime() + 86_400_000),
    },
  ];
  await db.insert(notifications).values(notificationValues);
  const allSnapshot = await loadEvryUnreadNotificationSnapshot({
    actor: plantActor,
    now: new Date(),
  });
  assert.ok(
    allSnapshot.notifications.length > 30,
    "bulk proof crosses feed page size"
  );
  const allPlan = await approvedPlan({
    actor: plantActor,
    identity: MARK_ALL_NOTIFICATIONS_IDENTITY,
    stepId: "mark-all",
    arguments: markAllArgumentsSchema.parse(allSnapshot),
  });
  const [allLeft, allRight] = await Promise.all([
    execute(allPlan, plantActor),
    execute(allPlan, plantActor),
  ]);
  assert.equal(allLeft.status, "completed");
  assert.equal(allRight.status, "completed");
  assert.equal(
    allLeft.steps[0]?.affectedCount,
    allSnapshot.notifications.length
  );
  assert.equal(
    allRight.steps[0]?.affectedCount,
    allSnapshot.notifications.length
  );
  proofOutcomes.add(`${MARK_ALL_NOTIFICATIONS_IDENTITY}:execution`);
  proofOutcomes.add(`${MARK_ALL_NOTIFICATIONS_IDENTITY}:idempotency`);
  const stillUnread = await db
    .select({ title: notifications.title })
    .from(notifications)
    .where(
      and(eq(notifications.churchId, plant.id), isNull(notifications.readAt))
    );
  assert.deepEqual(stillUnread.map(({ title }) => title).toSorted(), [
    "Future",
    "Hidden by preference",
  ]);

  const preferenceRace = await db
    .insert(notifications)
    .values({
      churchId: plant.id,
      recipientUserId: owner.id,
      category: "phase",
      type: "phase.race",
      title: "Preference race",
      body: "Keep unread after the confirmed allow-list changes",
      scheduledFor: new Date(now.getTime() - 1_000),
    })
    .returning()
    .then(([row]) => row);
  assert.ok(preferenceRace);
  const raceSnapshot = await loadEvryUnreadNotificationSnapshot({
    actor: plantActor,
    now: new Date(),
  });
  assert.deepEqual(
    raceSnapshot.notifications.map(({ id }) => id),
    [preferenceRace.id]
  );
  const racePlan = await approvedPlan({
    actor: plantActor,
    identity: MARK_ALL_NOTIFICATIONS_IDENTITY,
    stepId: "preference-race",
    arguments: markAllArgumentsSchema.parse(raceSnapshot),
  });
  beforeNotificationClaim = async () => {
    await db.insert(notificationPreferences).values({
      userId: owner.id,
      category: "phase",
      channel: "in_app",
      enabled: false,
      intent: "chosen",
    });
  };
  assert.equal((await execute(racePlan, plantActor)).status, "refused");
  assert.equal(
    await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.id, preferenceRace.id))
      .then(([row]) => row?.readAt),
    null
  );

  const seatRace = await db
    .insert(notifications)
    .values({
      churchId: plant.id,
      recipientUserId: owner.id,
      category: "communication",
      type: "communication.seat-race",
      title: "Seat race",
      body: "Keep unread after the actor loses the plant seat",
      scheduledFor: new Date(now.getTime() - 1_000),
    })
    .returning()
    .then(([row]) => row);
  assert.ok(seatRace);
  const seatRaceSnapshot = await loadEvryUnreadNotificationSnapshot({
    actor: plantActor,
    notificationId: seatRace.id,
    now: new Date(),
  });
  const seatRacePlan = await approvedPlan({
    actor: plantActor,
    identity: MARK_ONE_NOTIFICATION_IDENTITY,
    stepId: "seat-race",
    arguments: markOneArgumentsSchema.parse({
      notification: seatRaceSnapshot.notifications[0],
      visibility: seatRaceSnapshot.visibility,
    }),
  });
  beforeNotificationClaim = async () => {
    await db.update(users).set({ seat: null }).where(eq(users.id, owner.id));
  };
  assert.equal((await execute(seatRacePlan, plantActor)).status, "refused");
  assert.equal(
    await db
      .select({ readAt: notifications.readAt })
      .from(notifications)
      .where(eq(notifications.id, seatRace.id))
      .then(([row]) => row?.readAt),
    null
  );
  await db.update(users).set({ seat: "owner" }).where(eq(users.id, owner.id));
  proofOutcomes.add(`${MARK_ALL_NOTIFICATIONS_IDENTITY}:errors`);

  const feedbackId = randomUUID();
  const feedbackPlan = await approvedPlan({
    actor: plantActor,
    identity: SUBMIT_FEEDBACK_IDENTITY,
    stepId: "submit-feedback",
    arguments: feedbackArgumentsSchema.parse({
      feedbackId,
      category: "bug",
      description: "literal feedback",
      pageUrl: "/notifications",
    }),
  });
  const feedbackResult = await execute(feedbackPlan, plantActor);
  assert.equal(feedbackResult.status, "completed");
  const [storedFeedback] = await db
    .select()
    .from(feedback)
    .where(eq(feedback.id, feedbackId));
  assert.equal(storedFeedback?.description, "literal feedback");
  assert.equal(storedFeedback?.churchId, plant.id);
  assert.equal(storedFeedback?.userId, owner.id);
  assert.deepEqual(bridgeCalls, [feedbackId]);
  proofOutcomes.add(`${SUBMIT_FEEDBACK_IDENTITY}:execution`);
  assert.deepEqual(await execute(feedbackPlan, plantActor), feedbackResult);
  assert.deepEqual(bridgeCalls, [feedbackId]);
  proofOutcomes.add(`${SUBMIT_FEEDBACK_IDENTITY}:idempotency`);

  const bridgeFailureId = randomUUID();
  const bridgeFailurePlan = await approvedPlan({
    actor: plantActor,
    identity: SUBMIT_FEEDBACK_IDENTITY,
    stepId: "bridge-failure",
    arguments: feedbackArgumentsSchema.parse({
      feedbackId: bridgeFailureId,
      category: "bug",
      description: "bridge failure",
      pageUrl: null,
    }),
  });
  assert.equal(
    (await execute(bridgeFailurePlan, plantActor)).status,
    "completed"
  );
  assert.ok(
    await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(eq(feedback.id, bridgeFailureId))
      .then(([row]) => row)
  );
  proofOutcomes.add(`${SUBMIT_FEEDBACK_IDENTITY}:errors`);

  assert.equal(proofOutcomes.size, 9);
  process.stdout.write("Platform effect live proof passed\n");
  process.stdout.write(
    `EVRY_PLATFORM_EFFECT_OUTCOMES=${JSON.stringify([...proofOutcomes].toSorted())}\n`
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
