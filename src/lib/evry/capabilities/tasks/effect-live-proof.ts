import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mock } from "node:test";

import { and, eq, inArray, sql } from "drizzle-orm";

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
  persons,
  phaseTransitions,
  sessions,
  taskDependencies,
  tasks,
  users,
} from "@/db/schema";
import { UnauthorizedError } from "@/lib/auth/unauthorized";
import type { EvryEffectInput } from "@/lib/evry/executor";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryPlanRequestKey } from "@/lib/evry/plans";
import {
  holdTaskStructureBarrier,
  waitForTaskStructureWaiters,
} from "@/lib/testing/postgres-transaction-barrier";

import { TASK_ACTION_CONTRACTS } from "./contracts";
import type { TaskEffectExport } from "./effect-contracts";
import type { ResolvedTaskEffect } from "./resolver";
import type { TaskEvryEffectSelection } from "./selection";
import type { EvryReadRegistration } from "@/lib/evry/reads/contract";

const SESSION_ID = "7".repeat(64);
const NOW = new Date("2026-08-29T12:00:00.000Z");
let phaseTransitionSequence = 0;
const SCRATCH = `__evry tasks proof ${randomUUID()}__`;
const READ_IDENTITIES = {
  detail: "tasks.read.detail",
  list: "tasks.read.list",
  planning: "tasks.read.planning-options",
  templates: "tasks.read.templates",
} as const;

type SessionUser = Readonly<{
  id: string;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  seat: "owner" | "admin" | "member" | null;
}>;

let sessionUser: SessionUser | null = null;

mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => {
      if (!sessionUser) throw new UnauthorizedError();
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
        .where(eq(sessions.id, SESSION_ID))
        .limit(1);
      if (!fresh || fresh.session.expiresAt <= new Date()) {
        throw new UnauthorizedError();
      }
      return fresh;
    },
  },
});

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function seedActor() {
  const [plant, foreignPlant] = await Promise.all([
    db
      .insert(churches)
      .values({ name: SCRATCH, currentPhase: 1 })
      .returning({ id: churches.id }),
    db
      .insert(churches)
      .values({ name: `${SCRATCH} foreign`, currentPhase: 1 })
      .returning({ id: churches.id }),
  ]).then(([local, foreign]) => [local[0]!, foreign[0]!] as const);
  const [actor, member, foreignUser] = await Promise.all([
    db
      .insert(users)
      .values({
        email: `${randomUUID()}@tasks.invalid`,
        passwordHash: "not-used",
        name: "Task Proof Owner",
        seat: "owner",
        churchId: plant.id,
      })
      .returning({ id: users.id }),
    db
      .insert(users)
      .values({
        email: `${randomUUID()}@tasks.invalid`,
        passwordHash: "not-used",
        name: "Task Proof Member",
        seat: "member",
        churchId: plant.id,
      })
      .returning({ id: users.id }),
    db
      .insert(users)
      .values({
        email: `${randomUUID()}@tasks.invalid`,
        passwordHash: "not-used",
        name: "Foreign Member",
        seat: "owner",
        churchId: foreignPlant.id,
      })
      .returning({ id: users.id }),
  ]).then(
    ([ownerRows, memberRows, foreignRows]) =>
      [ownerRows[0]!, memberRows[0]!, foreignRows[0]!] as const
  );
  await db.batch([
    db.insert(persons).values({
      churchId: plant.id,
      firstName: "Task",
      lastName: "Owner",
      status: "leader",
      userId: actor.id,
      createdBy: actor.id,
    }),
    db.insert(persons).values({
      churchId: plant.id,
      firstName: "Task",
      lastName: "Member",
      status: "core_group",
      userId: member.id,
      createdBy: actor.id,
    }),
    db.insert(persons).values({
      churchId: foreignPlant.id,
      firstName: "Foreign",
      lastName: "Person",
      status: "leader",
      userId: foreignUser.id,
      createdBy: foreignUser.id,
    }),
    db.insert(sessions).values({
      id: SESSION_ID,
      userId: actor.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      fresh: true,
    }),
  ]);
  sessionUser = {
    id: actor.id,
    churchId: plant.id,
    sendingChurchId: null,
    sendingNetworkId: null,
    seat: "owner",
  };
  return {
    plantId: plant.id,
    foreignPlantId: foreignPlant.id,
    actorId: actor.id,
    memberId: member.id,
    foreignUserId: foreignUser.id,
  };
}

async function seedTask(input: {
  plantId: string;
  actorId: string;
  assignedToId?: string | null;
  title?: string;
  description?: string | null;
  status?: "not_started" | "in_progress" | "blocked" | "complete";
  category?: "follow_up" | "general";
  parentTaskId?: string | null;
  dueDate?: string | null;
  relatedType?: "person" | null;
  relatedId?: string | null;
  isRecurring?: boolean;
  recurrenceRule?: Readonly<{
    interval: "weekly";
    endDate: string | null;
    seriesId?: string;
  }> | null;
}) {
  const [row] = await db
    .insert(tasks)
    .values({
      churchId: input.plantId,
      createdById: input.actorId,
      title: input.title ?? `Task ${randomUUID()}`,
      description: input.description ?? null,
      status: input.status ?? "not_started",
      completedAt: input.status === "complete" ? NOW : null,
      completedById: input.status === "complete" ? input.actorId : null,
      assignedToId: input.assignedToId ?? input.actorId,
      category: input.category ?? "general",
      parentTaskId: input.parentTaskId ?? null,
      dueDate: input.dueDate ?? null,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
      isRecurring: input.isRecurring ?? false,
      recurrenceRule: input.recurrenceRule ?? null,
    })
    .returning();
  return row!;
}

async function seedContact(plantId: string, actorId: string) {
  const [row] = await db
    .insert(persons)
    .values({
      churchId: plantId,
      firstName: "Ada",
      lastName: "Lovelace",
      status: "attendee",
      createdBy: actorId,
    })
    .returning({ id: persons.id });
  return row!;
}

async function fixtureFor(input: {
  actor: EvryPlantActor;
  memberId: string;
  exportName: TaskEffectExport;
}): Promise<TaskEvryEffectSelection> {
  const effect = (values: Readonly<Record<string, unknown>>) => ({
    kind: "effect" as const,
    exportName: input.exportName,
    values,
  });
  switch (input.exportName) {
    case "createTaskAction":
      return effect({ title: `Create ${randomUUID()}`, priority: "high" });
    case "quickAddTaskAction":
      return effect({
        title: `Quick ${randomUUID()}`,
        dueDate: "2026-09-10",
        priority: "urgent",
      });
    case "createAndAssignFollowUpAction": {
      const person = await seedContact(input.actor.plantId, input.actor.userId);
      return effect({
        personId: person.id,
        personName: "Ada Lovelace",
        assigneeId: input.memberId,
      });
    }
    case "importTaskTemplateAction":
      return effect({ templateKey: "discernment-and-preparation" });
    case "importPhaseTemplatesAction":
    case "dismissPhaseTemplatePromptAction": {
      const [transition] = await db
        .insert(phaseTransitions)
        .values({
          churchId: input.actor.plantId,
          fromPhase: 1,
          toPhase: 0,
          initiatedById: input.actor.userId,
          reason: "Task proof",
          kind: "transition",
          rubricVersion: "task-proof-v1",
          createdAt: new Date(NOW.getTime() + ++phaseTransitionSequence),
        })
        .returning({ id: phaseTransitions.id });
      return effect({
        transitionId: transition!.id,
        ...(input.exportName === "importPhaseTemplatesAction"
          ? { templateKeys: ["discernment-and-preparation"] }
          : {}),
      });
    }
    case "bulkCompleteTasksAction":
    case "bulkRescheduleTasksAction": {
      const rows = await Promise.all([
        seedTask({
          plantId: input.actor.plantId,
          actorId: input.actor.userId,
          dueDate: "2026-09-01",
        }),
        seedTask({
          plantId: input.actor.plantId,
          actorId: input.actor.userId,
          dueDate: "2026-09-02",
        }),
      ]);
      return effect({
        taskIds: rows.map(({ id }) => id),
        ...(input.exportName === "bulkRescheduleTasksAction"
          ? { dueDate: "2026-10-01" }
          : {}),
      });
    }
    case "handOffFollowUpsAction": {
      await seedTask({
        plantId: input.actor.plantId,
        actorId: input.actor.userId,
        assignedToId: input.actor.userId,
        category: "follow_up",
        dueDate: "2026-09-03",
      });
      return effect({
        fromAssigneeId: input.actor.userId,
        toAssigneeId: input.memberId,
      });
    }
    case "addSubtaskAction": {
      const parent = await seedTask({
        plantId: input.actor.plantId,
        actorId: input.actor.userId,
      });
      return effect({ parentTaskId: parent.id, title: "Checklist item" });
    }
    case "setSubtaskCompletionAction": {
      const parent = await seedTask({
        plantId: input.actor.plantId,
        actorId: input.actor.userId,
      });
      const child = await seedTask({
        plantId: input.actor.plantId,
        actorId: input.actor.userId,
        parentTaskId: parent.id,
      });
      return effect({ subtaskId: child.id, complete: true });
    }
    case "reopenTaskAction": {
      const task = await seedTask({
        plantId: input.actor.plantId,
        actorId: input.actor.userId,
        status: "complete",
        dueDate: "2026-09-04",
      });
      return effect({ taskId: task.id });
    }
    case "assignFollowUpAction": {
      const task = await seedTask({
        plantId: input.actor.plantId,
        actorId: input.actor.userId,
        category: "follow_up",
      });
      return effect({ taskId: task.id, assigneeId: input.memberId });
    }
    case "updateTaskAction": {
      const task = await seedTask({
        plantId: input.actor.plantId,
        actorId: input.actor.userId,
      });
      return effect({ taskId: task.id, title: "Updated exact title" });
    }
    case "updateTaskStatusAction": {
      const task = await seedTask({
        plantId: input.actor.plantId,
        actorId: input.actor.userId,
      });
      return effect({ taskId: task.id, status: "in_progress" });
    }
    case "completeTaskAction":
    case "deleteTaskAction": {
      const person =
        input.exportName === "completeTaskAction"
          ? await seedContact(input.actor.plantId, input.actor.userId)
          : null;
      const task = await seedTask({
        plantId: input.actor.plantId,
        actorId: input.actor.userId,
        dueDate: "2026-09-05",
        relatedType: person ? "person" : null,
        relatedId: person?.id ?? null,
      });
      if (input.exportName === "deleteTaskAction") {
        await seedTask({
          plantId: input.actor.plantId,
          actorId: input.actor.userId,
          parentTaskId: task.id,
          title: "Deleted with parent",
        });
      }
      return effect({ taskId: task.id });
    }
  }
}

async function seedExecution(input: {
  actor: EvryPlantActor;
  resolved: ResolvedTaskEffect;
}) {
  const planId = randomUUID();
  const attemptId = randomUUID();
  const confirmationId = randomUUID();
  const proposalEventId = randomUUID();
  const correlationId = randomUUID();
  const fingerprint = hash(`plan:${planId}`);
  const capabilityIdentity =
    TASK_ACTION_CONTRACTS[input.resolved.exportName].operationId;
  const createdAt = new Date();
  await db.batch([
    db.insert(evryActionPlans).values({
      id: planId,
      churchId: input.actor.plantId,
      actorUserId: input.actor.userId,
      requestKey: randomUUID(),
      intentFingerprint: hash(`intent:${planId}`),
      fingerprint,
      document: {
        version: 1,
        steps: [
          {
            id: capabilityIdentity,
            capabilityIdentity,
            arguments: input.resolved.arguments,
            dependsOn: [],
          },
        ],
      },
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 15 * 60 * 1_000),
    }),
    db.insert(evryActionPlanStates).values({
      planId,
      churchId: input.actor.plantId,
      status: "executing",
      changedAt: createdAt,
    }),
    db.insert(evryPlanConfirmations).values({
      id: confirmationId,
      planId,
      churchId: input.actor.plantId,
      actorUserId: input.actor.userId,
      planFingerprint: fingerprint,
      decidedAt: createdAt,
    }),
    db.insert(evryProductAuditEvents).values({
      id: proposalEventId,
      planId,
      churchId: input.actor.plantId,
      actorUserId: input.actor.userId,
      planFingerprint: fingerprint,
      correlationId,
      eventKey: hash(`proposal:${planId}`),
      eventType: "plan_proposed",
      occurredAt: createdAt,
    }),
    db.insert(evryExecutionAttempts).values({
      id: attemptId,
      planId,
      churchId: input.actor.plantId,
      actorUserId: input.actor.userId,
      planFingerprint: fingerprint,
      confirmationId,
      proposalEventId,
      correlationId,
      attemptKey: hash(`attempt:${planId}`),
      startedAt: createdAt,
    }),
  ]);
  return {
    attemptId,
    planId,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    fingerprint,
    correlationId,
    stepId: capabilityIdentity,
    capabilityIdentity,
  };
}

function staleArguments(resolved: ResolvedTaskEffect) {
  const args = structuredClone(resolved.arguments);
  if (args.taskWrites[0]?.before) {
    args.taskWrites[0].before.updatedAt = "2000-01-01T00:00:00.000Z";
  } else if (args.subjectTasks[0]) {
    args.subjectTasks[0].updatedAt = "2000-01-01T00:00:00.000Z";
  } else if (args.phaseTransition) {
    args.phaseTransition.expectedCreatedAt = "2000-01-01T00:00:00.000Z";
  } else if (args.taskWrites[0]) {
    args.taskWrites[0].after.createdById = randomUUID();
  }
  return args;
}

async function runEffect(input: {
  actor: EvryPlantActor;
  memberId: string;
  exportName: TaskEffectExport;
  resolve: typeof import("./resolver").resolveTaskEvryEffect;
  mintRequestKey: () => EvryPlanRequestKey;
  authorize: typeof import("@/lib/evry/eligibility/capabilities").authorizeEvryEffectCapability;
  effectKey: typeof import("@/lib/evry/audit/identity").executionEffectKey;
  execute: typeof import("./atomic-effect").executeTaskEffect;
}) {
  const selection = await fixtureFor(input);
  const resolved = await input.resolve({
    actor: input.actor,
    selection,
    pageContext: null,
    requestKey: input.mintRequestKey(),
    now: NOW,
  });
  assert.ok(resolved, `${input.exportName} did not resolve`);
  const execution = await seedExecution({ actor: input.actor, resolved });
  const authorization = await input.authorize(execution.capabilityIdentity);
  assert.ok(authorization);
  const effectKey = input.effectKey(
    execution.planId,
    execution.fingerprint,
    execution.stepId
  );
  const effectInput: EvryEffectInput = {
    authorization,
    execution,
    effectKey,
    arguments: resolved.arguments,
  };

  const tenantRefusal = await input.execute({
    ...effectInput,
    execution: { ...execution, plantId: randomUUID() },
  });
  assert.equal(tenantRefusal.status, "refused");
  console.log(`PASS ${execution.capabilityIdentity}:execution-tuple-tenancy`);

  const stale = await input.execute({
    ...effectInput,
    arguments: staleArguments(resolved),
  });
  assert.equal(
    stale.status,
    "refused",
    `${input.exportName} accepted stale state`
  );
  assert.equal(
    (
      await db
        .select({ id: evryExecutionOutcomes.id })
        .from(evryExecutionOutcomes)
        .where(eq(evryExecutionOutcomes.effectKey, effectKey))
    ).length,
    0
  );
  console.log(`PASS ${execution.capabilityIdentity}:errors`);

  const [first, concurrentRetry] = await Promise.all([
    input.execute(effectInput),
    input.execute(effectInput),
  ]);
  assert.equal(
    first.status,
    "completed",
    `${input.exportName} did not execute`
  );
  assert.deepEqual(
    concurrentRetry,
    first,
    `${input.exportName} concurrent retry diverged`
  );
  const replay = await input.execute(effectInput);
  assert.deepEqual(
    replay,
    first,
    `${input.exportName} response-loss replay diverged`
  );
  assert.equal(
    (
      await db
        .select({ id: evryExecutionOutcomes.id })
        .from(evryExecutionOutcomes)
        .where(eq(evryExecutionOutcomes.effectKey, effectKey))
    ).length,
    1
  );
  const completion = resolved.arguments.completionEffects;
  if (completion.materialStamp) {
    const [plant] = await db
      .select({
        lastMaterialEventAt: churches.lastMaterialEventAt,
        updatedAt: churches.updatedAt,
      })
      .from(churches)
      .where(eq(churches.id, input.actor.plantId));
    assert.equal(
      plant?.lastMaterialEventAt?.toISOString(),
      completion.materialStamp.nextLastMaterialEventAt
    );
    assert.equal(
      plant?.updatedAt.toISOString(),
      completion.materialStamp.nextChurchUpdatedAt
    );
  }
  for (const contact of completion.contactLogs) {
    if (contact.kind !== "create") continue;
    const [row] = await db
      .select({
        communicationId: communications.id,
        subject: communications.subject,
        body: communications.body,
        status: communications.status,
        recipientId: communicationRecipients.id,
        externalId: communicationRecipients.externalId,
      })
      .from(communications)
      .innerJoin(
        communicationRecipients,
        eq(communicationRecipients.communicationId, communications.id)
      )
      .where(eq(communications.id, contact.communicationId));
    assert.deepEqual(row, {
      communicationId: contact.communicationId,
      subject: contact.subject,
      body: contact.body,
      status: "logged",
      recipientId: contact.recipientId,
      externalId: `task:${contact.taskId}`,
    });
  }
  console.log(`PASS ${execution.capabilityIdentity}:execution`);
  console.log(`PASS ${execution.capabilityIdentity}:idempotency`);
}

function foreignSelection(input: {
  exportName: TaskEffectExport;
  foreignTaskId: string;
  foreignUserId: string;
  foreignPersonId: string;
  foreignTransitionId: string;
  localUserId: string;
}): TaskEvryEffectSelection | null {
  const effect = (values: Readonly<Record<string, unknown>>) => ({
    kind: "effect" as const,
    exportName: input.exportName,
    values,
  });
  switch (input.exportName) {
    case "createTaskAction":
      return effect({
        title: "Foreign assignee",
        assignedToId: input.foreignUserId,
      });
    case "quickAddTaskAction":
    case "importTaskTemplateAction":
      return null;
    case "createAndAssignFollowUpAction":
      return effect({
        personId: input.foreignPersonId,
        personName: "Unavailable person",
        assigneeId: input.localUserId,
      });
    case "importPhaseTemplatesAction":
      return effect({
        transitionId: input.foreignTransitionId,
        templateKeys: ["discernment-and-preparation"],
      });
    case "dismissPhaseTemplatePromptAction":
      return effect({ transitionId: input.foreignTransitionId });
    case "bulkCompleteTasksAction":
      return effect({ taskIds: [input.foreignTaskId] });
    case "bulkRescheduleTasksAction":
      return effect({ taskIds: [input.foreignTaskId], dueDate: "2026-10-01" });
    case "handOffFollowUpsAction":
      return effect({
        fromAssigneeId: input.foreignUserId,
        toAssigneeId: input.localUserId,
      });
    case "addSubtaskAction":
      return effect({
        parentTaskId: input.foreignTaskId,
        title: "Unavailable parent",
      });
    case "setSubtaskCompletionAction":
      return effect({ subtaskId: input.foreignTaskId, complete: true });
    case "assignFollowUpAction":
      return effect({
        taskId: input.foreignTaskId,
        assigneeId: input.localUserId,
      });
    case "updateTaskAction":
      return effect({ taskId: input.foreignTaskId, title: "Unavailable task" });
    case "updateTaskStatusAction":
      return effect({ taskId: input.foreignTaskId, status: "in_progress" });
    case "completeTaskAction":
    case "deleteTaskAction":
    case "reopenTaskAction":
      return effect({ taskId: input.foreignTaskId });
  }
}

async function durableCounts() {
  const [taskCount, outcomeCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(tasks),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(evryExecutionOutcomes),
  ]);
  return {
    tasks: taskCount[0]?.count ?? 0,
    outcomes: outcomeCount[0]?.count ?? 0,
  };
}

async function runForeignEffectTenancy(input: {
  actor: EvryPlantActor;
  memberId: string;
  foreignPlantId: string;
  foreignTaskId: string;
  foreignUserId: string;
  foreignPersonId: string;
  foreignTransitionId: string;
  exportName: TaskEffectExport;
  resolve: typeof import("./resolver").resolveTaskEvryEffect;
  mintRequestKey: () => EvryPlanRequestKey;
  authorize: typeof import("@/lib/evry/eligibility/capabilities").authorizeEvryEffectCapability;
  effectKey: typeof import("@/lib/evry/audit/identity").executionEffectKey;
  current: typeof import("./atomic-effect").taskEffectArgumentsAreCurrent;
  execute: typeof import("./atomic-effect").executeTaskEffect;
}) {
  const selection = foreignSelection({
    exportName: input.exportName,
    foreignTaskId: input.foreignTaskId,
    foreignUserId: input.foreignUserId,
    foreignPersonId: input.foreignPersonId,
    foreignTransitionId: input.foreignTransitionId,
    localUserId: input.memberId,
  });
  if (selection) {
    const before = await durableCounts();
    const result = await input.resolve({
      actor: input.actor,
      selection,
      pageContext: null,
      requestKey: input.mintRequestKey(),
      now: NOW,
    });
    assert.equal(result, null, `${input.exportName} exposed a foreign source`);
    assert.deepEqual(await durableCounts(), before);
    console.log(
      `PASS ${TASK_ACTION_CONTRACTS[input.exportName].operationId}:tenancy`
    );
    return;
  }

  const localSelection = await fixtureFor(input);
  const resolved = await input.resolve({
    actor: input.actor,
    selection: localSelection,
    pageContext: null,
    requestKey: input.mintRequestKey(),
    now: NOW,
  });
  assert.ok(resolved);
  const execution = await seedExecution({ actor: input.actor, resolved });
  assert.equal(
    await input.current({
      actorUserId: input.actor.userId,
      plantId: input.actor.plantId,
      exportName: input.exportName,
      args: resolved.arguments,
    }),
    true
  );
  const collisionId = resolved.arguments.taskWrites[0]?.taskId;
  assert.ok(collisionId);
  await db.insert(tasks).values({
    id: collisionId,
    churchId: input.foreignPlantId,
    createdById: input.foreignUserId,
    assignedToId: input.foreignUserId,
    title: "Foreign ID collision",
  });
  assert.equal(
    await input.current({
      actorUserId: input.actor.userId,
      plantId: input.actor.plantId,
      exportName: input.exportName,
      args: resolved.arguments,
    }),
    false
  );
  const authorization = await input.authorize(execution.capabilityIdentity);
  assert.ok(authorization);
  const effectKey = input.effectKey(
    execution.planId,
    execution.fingerprint,
    execution.stepId
  );
  const before = await durableCounts();
  assert.deepEqual(
    await input.execute({
      authorization,
      execution,
      effectKey,
      arguments: resolved.arguments,
    }),
    { status: "refused", excludedCount: 1 }
  );
  assert.deepEqual(await durableCounts(), before);
  assert.equal(
    (
      await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            inArray(
              tasks.id,
              resolved.arguments.taskWrites.map(({ taskId }) => taskId)
            ),
            eq(tasks.churchId, input.actor.plantId)
          )
        )
    ).length,
    0
  );
  console.log(
    `PASS ${TASK_ACTION_CONTRACTS[input.exportName].operationId}:tenancy`
  );
}

async function preparedEffect(input: {
  actor: EvryPlantActor;
  resolved: ResolvedTaskEffect;
  authorize: typeof import("@/lib/evry/eligibility/capabilities").authorizeEvryEffectCapability;
  effectKey: typeof import("@/lib/evry/audit/identity").executionEffectKey;
}) {
  const execution = await seedExecution({
    actor: input.actor,
    resolved: input.resolved,
  });
  const authorization = await input.authorize(execution.capabilityIdentity);
  assert.ok(authorization);
  const effectKey = input.effectKey(
    execution.planId,
    execution.fingerprint,
    execution.stepId
  );
  return {
    effectKey,
    input: {
      authorization,
      execution,
      effectKey,
      arguments: input.resolved.arguments,
    } satisfies EvryEffectInput,
  };
}

async function outcomeCount(effectKeys: readonly string[]) {
  if (effectKeys.length === 0) return 0;
  return (
    await db
      .select({ id: evryExecutionOutcomes.id })
      .from(evryExecutionOutcomes)
      .where(inArray(evryExecutionOutcomes.effectKey, [...effectKeys]))
  ).length;
}

async function assertValidPlantStructure(plantId: string) {
  const result = await db.execute<{ invalid: number }>(sql`
    select count(*)::int as invalid
    from tasks child
    left join tasks parent
      on parent.id = child.parent_task_id
     and parent.church_id = child.church_id
    where child.church_id = ${plantId}::uuid
      and child.deleted_at is null
      and child.parent_task_id is not null
      and (
        parent.id is null
        or parent.deleted_at is not null
        or parent.parent_task_id is not null
      )
  `);
  assert.equal(result.rows[0]?.invalid ?? 0, 0);
}

async function runCompetingPlans(input: {
  actor: EvryPlantActor;
  resolve: typeof import("./resolver").resolveTaskEvryEffect;
  mintRequestKey: () => EvryPlanRequestKey;
  authorize: typeof import("@/lib/evry/eligibility/capabilities").authorizeEvryEffectCapability;
  effectKey: typeof import("@/lib/evry/audit/identity").executionEffectKey;
  execute: typeof import("./atomic-effect").executeTaskEffect;
}) {
  const person = await seedContact(input.actor.plantId, input.actor.userId);
  const task = await seedTask({
    plantId: input.actor.plantId,
    actorId: input.actor.userId,
    title: `Competing completion ${randomUUID()}`,
    relatedType: "person",
    relatedId: person.id,
  });
  const selection: TaskEvryEffectSelection = {
    kind: "effect",
    exportName: "completeTaskAction",
    values: { taskId: task.id },
  };
  const [left, right] = await Promise.all([
    input.resolve({
      actor: input.actor,
      selection,
      pageContext: null,
      requestKey: input.mintRequestKey(),
      now: NOW,
    }),
    input.resolve({
      actor: input.actor,
      selection,
      pageContext: null,
      requestKey: input.mintRequestKey(),
      now: NOW,
    }),
  ]);
  assert.ok(left && right);
  const [leftExecution, rightExecution] = await Promise.all([
    seedExecution({ actor: input.actor, resolved: left }),
    seedExecution({ actor: input.actor, resolved: right }),
  ]);
  const authorization = await input.authorize(
    TASK_ACTION_CONTRACTS.completeTaskAction.operationId
  );
  assert.ok(authorization);
  const execute = (
    resolved: ResolvedTaskEffect,
    execution: typeof leftExecution
  ) =>
    input.execute({
      authorization,
      execution,
      effectKey: input.effectKey(
        execution.planId,
        execution.fingerprint,
        execution.stepId
      ),
      arguments: resolved.arguments,
    });
  const outcomes = await Promise.all([
    execute(left, leftExecution),
    execute(right, rightExecution),
  ]);
  assert.deepEqual(outcomes.map(({ status }) => status).toSorted(), [
    "completed",
    "refused",
  ]);
  const logged = await db
    .select({ id: communicationRecipients.id })
    .from(communicationRecipients)
    .where(
      and(
        eq(communicationRecipients.churchId, input.actor.plantId),
        eq(communicationRecipients.externalId, `task:${task.id}`)
      )
    );
  assert.equal(logged.length, 1);
  console.log("PASS tasks:competing-confirmed-plans");
}

async function runStructuralSourceDrift(input: {
  actor: EvryPlantActor;
  resolve: typeof import("./resolver").resolveTaskEvryEffect;
  mintRequestKey: () => EvryPlanRequestKey;
  authorize: typeof import("@/lib/evry/eligibility/capabilities").authorizeEvryEffectCapability;
  effectKey: typeof import("@/lib/evry/audit/identity").executionEffectKey;
  current: typeof import("./atomic-effect").taskEffectArgumentsAreCurrent;
  execute: typeof import("./atomic-effect").executeTaskEffect;
}) {
  const prerequisite = await seedTask({
    plantId: input.actor.plantId,
    actorId: input.actor.userId,
    title: `Prerequisite ${randomUUID()}`,
  });
  const create = await input.resolve({
    actor: input.actor,
    selection: {
      kind: "effect",
      exportName: "createTaskAction",
      values: {
        title: `Dependent ${randomUUID()}`,
        prerequisiteTaskIds: [prerequisite.id],
      },
    },
    pageContext: null,
    requestKey: input.mintRequestKey(),
    now: NOW,
  });
  assert.ok(create);
  const createExecution = await seedExecution({
    actor: input.actor,
    resolved: create,
  });
  assert.equal(
    await input.current({
      actorUserId: input.actor.userId,
      plantId: input.actor.plantId,
      exportName: create.exportName,
      args: create.arguments,
    }),
    true
  );
  await db
    .update(tasks)
    .set({ deletedAt: new Date(NOW.getTime() + 1_000) })
    .where(eq(tasks.id, prerequisite.id));
  assert.equal(
    await input.current({
      actorUserId: input.actor.userId,
      plantId: input.actor.plantId,
      exportName: create.exportName,
      args: create.arguments,
    }),
    false
  );
  const createAuthorization = await input.authorize(
    createExecution.capabilityIdentity
  );
  assert.ok(createAuthorization);
  const createEffectKey = input.effectKey(
    createExecution.planId,
    createExecution.fingerprint,
    createExecution.stepId
  );
  assert.deepEqual(
    await input.execute({
      authorization: createAuthorization,
      execution: createExecution,
      effectKey: createEffectKey,
      arguments: create.arguments,
    }),
    { status: "refused", excludedCount: 1 }
  );
  assert.equal(
    (
      await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.id, create.arguments.taskWrites[0]!.taskId))
    ).length,
    0
  );
  assert.equal(
    (
      await db
        .select({ id: evryExecutionOutcomes.id })
        .from(evryExecutionOutcomes)
        .where(eq(evryExecutionOutcomes.effectKey, createEffectKey))
    ).length,
    0
  );

  const parent = await seedTask({
    plantId: input.actor.plantId,
    actorId: input.actor.userId,
    title: `Parent ${randomUUID()}`,
  });
  const target = await seedTask({
    plantId: input.actor.plantId,
    actorId: input.actor.userId,
    title: `Nesting target ${randomUUID()}`,
  });
  const update = await input.resolve({
    actor: input.actor,
    selection: {
      kind: "effect",
      exportName: "updateTaskAction",
      values: {
        taskId: target.id,
        title: "Nesting target changed",
        parentTaskId: parent.id,
      },
    },
    pageContext: null,
    requestKey: input.mintRequestKey(),
    now: NOW,
  });
  assert.ok(update);
  const updateExecution = await seedExecution({
    actor: input.actor,
    resolved: update,
  });
  assert.equal(
    await input.current({
      actorUserId: input.actor.userId,
      plantId: input.actor.plantId,
      exportName: update.exportName,
      args: update.arguments,
    }),
    true
  );
  await seedTask({
    plantId: input.actor.plantId,
    actorId: input.actor.userId,
    parentTaskId: target.id,
    title: "Concurrent child",
  });
  assert.equal(
    await input.current({
      actorUserId: input.actor.userId,
      plantId: input.actor.plantId,
      exportName: update.exportName,
      args: update.arguments,
    }),
    false
  );
  const updateAuthorization = await input.authorize(
    updateExecution.capabilityIdentity
  );
  assert.ok(updateAuthorization);
  const updateEffectKey = input.effectKey(
    updateExecution.planId,
    updateExecution.fingerprint,
    updateExecution.stepId
  );
  assert.deepEqual(
    await input.execute({
      authorization: updateAuthorization,
      execution: updateExecution,
      effectKey: updateEffectKey,
      arguments: update.arguments,
    }),
    { status: "refused", excludedCount: 1 }
  );
  const [unchanged] = await db
    .select({ title: tasks.title, parentTaskId: tasks.parentTaskId })
    .from(tasks)
    .where(eq(tasks.id, target.id));
  assert.deepEqual(unchanged, {
    title: target.title,
    parentTaskId: null,
  });
  assert.equal(
    (
      await db
        .select({ id: evryExecutionOutcomes.id })
        .from(evryExecutionOutcomes)
        .where(eq(evryExecutionOutcomes.effectKey, updateEffectKey))
    ).length,
    0
  );
  console.log("PASS tasks:structural-source-drift");
}

async function runRecurringChecklistSourceDrift(input: {
  actor: EvryPlantActor;
  resolve: typeof import("./resolver").resolveTaskEvryEffect;
  mintRequestKey: () => EvryPlanRequestKey;
  authorize: typeof import("@/lib/evry/eligibility/capabilities").authorizeEvryEffectCapability;
  effectKey: typeof import("@/lib/evry/audit/identity").executionEffectKey;
  current: typeof import("./atomic-effect").taskEffectArgumentsAreCurrent;
  execute: typeof import("./atomic-effect").executeTaskEffect;
}) {
  for (const drift of ["add", "delete", "edit"] as const) {
    const parent = await seedTask({
      plantId: input.actor.plantId,
      actorId: input.actor.userId,
      title: `Recurring ${drift} ${randomUUID()}`,
      dueDate: "2026-09-01",
      isRecurring: true,
      recurrenceRule: { interval: "weekly", endDate: null },
    });
    const child = await seedTask({
      plantId: input.actor.plantId,
      actorId: input.actor.userId,
      title: `Recurring checklist ${drift}`,
      parentTaskId: parent.id,
    });
    const resolved = await input.resolve({
      actor: input.actor,
      selection: {
        kind: "effect",
        exportName: "completeTaskAction",
        values: { taskId: parent.id },
      },
      pageContext: null,
      requestKey: input.mintRequestKey(),
      now: NOW,
    });
    assert.ok(resolved);
    assert.deepEqual(
      resolved.arguments.sourceTasks.map(({ id }) => id),
      [child.id]
    );
    assert.deepEqual(resolved.arguments.childSets, [
      { parentTaskId: parent.id, taskIds: [child.id] },
    ]);
    const prepared = await preparedEffect({
      actor: input.actor,
      resolved,
      authorize: input.authorize,
      effectKey: input.effectKey,
    });

    if (drift === "add") {
      await seedTask({
        plantId: input.actor.plantId,
        actorId: input.actor.userId,
        title: "Added after confirmation",
        parentTaskId: parent.id,
      });
    } else if (drift === "delete") {
      await db
        .update(tasks)
        .set({
          deletedAt: new Date(NOW.getTime() + 1_000),
          updatedAt: new Date(NOW.getTime() + 1_000),
        })
        .where(eq(tasks.id, child.id));
    } else {
      await db
        .update(tasks)
        .set({
          title: "Edited after confirmation",
          updatedAt: new Date(NOW.getTime() + 1_000),
        })
        .where(eq(tasks.id, child.id));
    }

    assert.equal(
      await input.current({
        actorUserId: input.actor.userId,
        plantId: input.actor.plantId,
        exportName: resolved.exportName,
        args: resolved.arguments,
      }),
      false
    );
    assert.deepEqual(await input.execute(prepared.input), {
      status: "refused",
      excludedCount: 1,
    });
    assert.equal(await outcomeCount([prepared.effectKey]), 0);
    const [unchanged] = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, parent.id));
    assert.equal(unchanged?.status, "not_started");
    const plannedCreateIds = resolved.arguments.taskWrites
      .filter(({ before }) => before === null)
      .map(({ taskId }) => taskId);
    assert.equal(
      plannedCreateIds.length === 0
        ? 0
        : (
            await db
              .select({ id: tasks.id })
              .from(tasks)
              .where(inArray(tasks.id, plannedCreateIds))
          ).length,
      0
    );
  }
  console.log("PASS tasks:recurring-checklist-source-drift");
}

async function runLargeSourceHandoff(input: {
  actor: EvryPlantActor;
  memberId: string;
  resolve: typeof import("./resolver").resolveTaskEvryEffect;
  mintRequestKey: () => EvryPlanRequestKey;
  authorize: typeof import("@/lib/evry/eligibility/capabilities").authorizeEvryEffectCapability;
  effectKey: typeof import("@/lib/evry/audit/identity").executionEffectKey;
  execute: typeof import("./atomic-effect").executeTaskEffect;
}) {
  const rows = await db
    .insert(tasks)
    .values(
      Array.from({ length: 101 }, (_, index) => ({
        churchId: input.actor.plantId,
        createdById: input.actor.userId,
        assignedToId: input.actor.userId,
        category: "follow_up" as const,
        title: `${SCRATCH} large handoff ${index + 1}`,
      }))
    )
    .returning({ id: tasks.id });
  const resolved = await input.resolve({
    actor: input.actor,
    selection: {
      kind: "effect",
      exportName: "handOffFollowUpsAction",
      values: {
        fromAssigneeId: input.actor.userId,
        toAssigneeId: input.memberId,
      },
    },
    pageContext: null,
    requestKey: input.mintRequestKey(),
    now: NOW,
  });
  assert.ok(resolved);
  assert.equal(resolved.arguments.taskWrites.length, 101);
  assert.deepEqual(
    resolved.arguments.sourceAssertion.kind === "follow_up_owner"
      ? resolved.arguments.sourceAssertion.taskIds.toSorted()
      : [],
    rows.map(({ id }) => id).toSorted()
  );
  const execution = await seedExecution({ actor: input.actor, resolved });
  const authorization = await input.authorize(
    TASK_ACTION_CONTRACTS.handOffFollowUpsAction.operationId
  );
  assert.ok(authorization);
  const effectKey = input.effectKey(
    execution.planId,
    execution.fingerprint,
    execution.stepId
  );
  const execute = () =>
    input.execute({
      authorization,
      execution,
      effectKey,
      arguments: resolved.arguments,
    });
  assert.deepEqual(await execute(), {
    status: "completed",
    affectedCount: 101,
    excludedCount: 0,
  });
  assert.deepEqual(await execute(), {
    status: "completed",
    affectedCount: 101,
    excludedCount: 0,
  });
  const committed = await db
    .select({ id: tasks.id, assignedToId: tasks.assignedToId })
    .from(tasks)
    .where(
      inArray(
        tasks.id,
        rows.map(({ id }) => id)
      )
    );
  assert.equal(committed.length, 101);
  assert.equal(
    committed.every(({ assignedToId }) => assignedToId === input.memberId),
    true
  );
  console.log("PASS tasks:source-derived-handoff-above-bulk-cap");
}

async function runResolverShapedBulkReview(input: {
  actor: EvryPlantActor;
  resolve: typeof import("./resolver").resolveTaskEvryEffect;
  propose: typeof import("./runtime").proposeTaskEvryEffect;
  mintRequestKey: () => EvryPlanRequestKey;
}) {
  const rows = await db
    .insert(tasks)
    .values(
      Array.from({ length: 100 }, (_, index) => ({
        churchId: input.actor.plantId,
        createdById: input.actor.userId,
        assignedToId: input.actor.userId,
        title: `${SCRATCH} resolver review ${index + 1}`,
      }))
    )
    .returning({ id: tasks.id });
  const requestKey = input.mintRequestKey();
  const resolved = await input.resolve({
    actor: input.actor,
    selection: {
      kind: "effect",
      exportName: "bulkCompleteTasksAction",
      values: { taskIds: rows.map(({ id }) => id) },
    },
    pageContext: null,
    requestKey,
    now: NOW,
  });
  assert.ok(resolved);
  assert.equal(resolved.arguments.exclusions.length, 100);
  const proposal = await input.propose({
    actor: input.actor,
    resolved,
    requestKey,
  });
  assert.ok(proposal);
  assert.deepEqual(proposal.confirmation.steps[0]?.exclusions, [
    {
      reason:
        "This Task is not related to a person, so no contact-log entry applies.",
      count: 100,
    },
  ]);
  assert.equal(
    proposal.confirmation.steps[0]?.resolvedTargets.length,
    rows.length
  );
  const immutableEvidence = proposal.confirmation.steps[0]?.contentPreviews
    .map(({ content }) => content)
    .join("");
  for (const { id } of rows) assert.match(immutableEvidence ?? "", RegExp(id));
  console.log("PASS tasks:resolver-shaped-bulk-review");
}

async function runStructureBarrierRaces(input: {
  actor: EvryPlantActor;
  resolve: typeof import("./resolver").resolveTaskEvryEffect;
  mintRequestKey: () => EvryPlanRequestKey;
  authorize: typeof import("@/lib/evry/eligibility/capabilities").authorizeEvryEffectCapability;
  effectKey: typeof import("@/lib/evry/audit/identity").executionEffectKey;
  execute: typeof import("./atomic-effect").executeTaskEffect;
  createTask: typeof import("@/lib/tasks/service").createTask;
}) {
  const resolve = async (
    exportName: TaskEffectExport,
    values: Readonly<Record<string, unknown>>
  ) => {
    const resolved = await input.resolve({
      actor: input.actor,
      selection: { kind: "effect", exportName, values },
      pageContext: null,
      requestKey: input.mintRequestKey(),
      now: NOW,
    });
    assert.ok(resolved, `${exportName} did not resolve for barrier proof`);
    return resolved;
  };
  const prepare = (resolved: ResolvedTaskEffect) =>
    preparedEffect({
      actor: input.actor,
      resolved,
      authorize: input.authorize,
      effectKey: input.effectKey,
    });

  {
    const [taskA, taskB] = await Promise.all([
      seedTask({
        plantId: input.actor.plantId,
        actorId: input.actor.userId,
        title: `Cycle A ${randomUUID()}`,
      }),
      seedTask({
        plantId: input.actor.plantId,
        actorId: input.actor.userId,
        title: `Cycle B ${randomUUID()}`,
      }),
    ]);
    const [left, right] = await Promise.all([
      resolve("updateTaskAction", {
        taskId: taskA.id,
        prerequisiteTaskIds: [taskB.id],
      }),
      resolve("updateTaskAction", {
        taskId: taskB.id,
        prerequisiteTaskIds: [taskA.id],
      }),
    ]);
    const [preparedLeft, preparedRight] = await Promise.all([
      prepare(left),
      prepare(right),
    ]);
    const barrier = await holdTaskStructureBarrier(input.actor.plantId);
    const executions = [
      input.execute(preparedLeft.input),
      input.execute(preparedRight.input),
    ] as const;
    try {
      await waitForTaskStructureWaiters(2);
    } finally {
      await barrier.release();
    }
    const results = await Promise.all(executions);
    assert.deepEqual(results.map(({ status }) => status).toSorted(), [
      "completed",
      "refused",
    ]);
    const edges = await db
      .select({
        taskId: taskDependencies.taskId,
        prerequisiteTaskId: taskDependencies.prerequisiteTaskId,
      })
      .from(taskDependencies)
      .where(
        and(
          eq(taskDependencies.churchId, input.actor.plantId),
          inArray(taskDependencies.taskId, [taskA.id, taskB.id])
        )
      );
    assert.equal(edges.length, 1);
    assert.equal(
      await outcomeCount([preparedLeft.effectKey, preparedRight.effectKey]),
      1
    );
    console.log("PASS tasks:dependency-cycle-barrier");
  }

  {
    const [parent, target] = await Promise.all([
      seedTask({
        plantId: input.actor.plantId,
        actorId: input.actor.userId,
        title: `Reparent destination ${randomUUID()}`,
      }),
      seedTask({
        plantId: input.actor.plantId,
        actorId: input.actor.userId,
        title: `Reparent source ${randomUUID()}`,
      }),
    ]);
    const resolved = await resolve("updateTaskAction", {
      taskId: target.id,
      parentTaskId: parent.id,
    });
    const prepared = await prepare(resolved);
    const barrier = await holdTaskStructureBarrier(input.actor.plantId);
    const evryExecution = input.execute(prepared.input);
    const ownerExecution = input.createTask(
      input.actor.plantId,
      input.actor.userId,
      {
        title: "Concurrent owning-writer checklist item",
        status: "not_started",
        priority: "medium",
        parentTaskId: target.id,
      }
    );
    try {
      await waitForTaskStructureWaiters(2);
    } finally {
      await barrier.release();
    }
    const [evryResult, ownerResult] = await Promise.all([
      evryExecution,
      ownerExecution.then(
        (task) => ({ status: "completed" as const, task }),
        () => ({ status: "refused" as const, task: null })
      ),
    ]);
    assert.deepEqual([evryResult.status, ownerResult.status].toSorted(), [
      "completed",
      "refused",
    ]);
    assert.equal(
      await outcomeCount([prepared.effectKey]),
      evryResult.status === "completed" ? 1 : 0
    );
    await assertValidPlantStructure(input.actor.plantId);
    console.log("PASS tasks:reparent-child-barrier");
  }

  {
    const parent = await seedTask({
      plantId: input.actor.plantId,
      actorId: input.actor.userId,
      title: `Delete race parent ${randomUUID()}`,
    });
    const [remove, add] = await Promise.all([
      resolve("deleteTaskAction", { taskId: parent.id }),
      resolve("addSubtaskAction", {
        parentTaskId: parent.id,
        title: "Concurrent child",
      }),
    ]);
    const [preparedRemove, preparedAdd] = await Promise.all([
      prepare(remove),
      prepare(add),
    ]);
    const barrier = await holdTaskStructureBarrier(input.actor.plantId);
    const executions = [
      input.execute(preparedRemove.input),
      input.execute(preparedAdd.input),
    ] as const;
    try {
      await waitForTaskStructureWaiters(2);
    } finally {
      await barrier.release();
    }
    const results = await Promise.all(executions);
    assert.deepEqual(results.map(({ status }) => status).toSorted(), [
      "completed",
      "refused",
    ]);
    assert.equal(
      await outcomeCount([preparedRemove.effectKey, preparedAdd.effectKey]),
      1
    );
    await assertValidPlantStructure(input.actor.plantId);
    console.log("PASS tasks:delete-child-barrier");
  }
}

function readInput(identity: string, taskId: string) {
  switch (identity) {
    case READ_IDENTITIES.list:
      return { search: SCRATCH, includeCompleted: true };
    case READ_IDENTITIES.detail:
      return { taskId };
    case READ_IDENTITIES.planning:
      return { taskId };
    case READ_IDENTITIES.templates:
      return {};
    default:
      throw new Error(`No Task read fixture for ${identity}`);
  }
}

async function runReads(input: {
  registrations: readonly EvryReadRegistration[];
  store: typeof import("@/lib/evry/conversations/artifacts").storedEvryReadArtifactDocument;
  localTaskId: string;
  foreignTaskId: string;
  foreignTaskTitle: string;
  foreignUserId: string;
}) {
  for (const registration of input.registrations) {
    const invocation = {
      literalUserText: "Task read proof",
      pageContext: null,
    } as const;
    const args = readInput(registration.capabilityIdentity, input.localTaskId);
    const first = await registration.execute(invocation, args);
    assert.ok(first, `${registration.capabilityIdentity} did not execute`);
    assert.equal(first.kind, "read");
    input.store(first);
    console.log(`PASS ${registration.capabilityIdentity}:execution`);
    console.log(`PASS ${registration.capabilityIdentity}:ui_artifact`);

    const replay = await registration.execute(invocation, args);
    assert.deepEqual(replay, first);
    console.log(`PASS ${registration.capabilityIdentity}:idempotency`);

    assert.equal(
      await registration.execute(invocation, { ...args, genericUrl: "/admin" }),
      null
    );
    console.log(`PASS ${registration.capabilityIdentity}:errors`);

    const foreignAttempt =
      registration.capabilityIdentity === READ_IDENTITIES.detail
        ? await registration.execute(invocation, {
            taskId: input.foreignTaskId,
          })
        : first;
    assert.ok(foreignAttempt);
    const serialized = JSON.stringify(foreignAttempt);
    assert.doesNotMatch(serialized, new RegExp(input.foreignTaskTitle));
    assert.doesNotMatch(serialized, new RegExp(input.foreignUserId));
    console.log(`PASS ${registration.capabilityIdentity}:tenancy`);
  }
}

async function main() {
  const seeded = await seedActor();
  const [
    resolver,
    plans,
    eligibility,
    audit,
    atomic,
    reads,
    artifacts,
    runtime,
    taskService,
  ] = await Promise.all([
    import("./resolver"),
    import("@/lib/evry/plans"),
    import("@/lib/evry/eligibility/capabilities"),
    import("@/lib/evry/audit/identity"),
    import("./atomic-effect"),
    import("./reads"),
    import("@/lib/evry/conversations/artifacts"),
    import("./runtime"),
    import("@/lib/tasks/service"),
  ]);
  const initial = await eligibility.authorizeEvryEffectCapability(
    TASK_ACTION_CONTRACTS.createTaskAction.operationId
  );
  assert.ok(initial);
  const actor = initial.actor;

  const foreignTaskTitle = `Foreign task ${randomUUID()}`;
  const [foreignTask] = await db
    .insert(tasks)
    .values({
      churchId: seeded.foreignPlantId,
      createdById: seeded.foreignUserId,
      assignedToId: seeded.foreignUserId,
      title: foreignTaskTitle,
    })
    .returning({ id: tasks.id });
  const [foreignPerson] = await db
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.churchId, seeded.foreignPlantId))
    .limit(1);
  assert.ok(foreignPerson);
  const [foreignTransition] = await db
    .insert(phaseTransitions)
    .values({
      churchId: seeded.foreignPlantId,
      fromPhase: 1,
      toPhase: 0,
      initiatedById: seeded.foreignUserId,
      reason: "Foreign Task proof",
      kind: "transition",
      rubricVersion: "task-proof-v1",
      createdAt: NOW,
    })
    .returning({ id: phaseTransitions.id });
  assert.ok(foreignTransition);
  const foreignResolution = await resolver.resolveTaskEvryEffect({
    actor,
    selection: {
      kind: "effect",
      exportName: "completeTaskAction",
      values: { taskId: foreignTask!.id },
    },
    pageContext: null,
    requestKey: plans.mintEvryPlanRequestKey(),
    now: NOW,
  });
  assert.equal(foreignResolution, null);
  console.log("PASS tasks:cross-plant-neutral-resolution");

  const localReadTask = await seedTask({
    plantId: actor.plantId,
    actorId: actor.userId,
    title: `${SCRATCH} ${"read target ".repeat(60)}`.slice(0, 500),
    description: `<p>${"Long durable Task description. ".repeat(50)}</p>`,
  });
  await runReads({
    registrations: reads.TASK_EVRY_READ_REGISTRATIONS,
    store: artifacts.storedEvryReadArtifactDocument,
    localTaskId: localReadTask.id,
    foreignTaskId: foreignTask!.id,
    foreignTaskTitle,
    foreignUserId: seeded.foreignUserId,
  });

  await db
    .update(users)
    .set({ seat: "member" })
    .where(eq(users.id, actor.userId));
  sessionUser = sessionUser ? { ...sessionUser, seat: "member" } : null;
  for (const registration of reads.TASK_EVRY_READ_REGISTRATIONS) {
    const result = await registration.execute(
      { literalUserText: "Task read permission proof", pageContext: null },
      readInput(registration.capabilityIdentity, localReadTask.id)
    );
    assert.equal(
      Boolean(result),
      registration.capabilityIdentity !== READ_IDENTITIES.planning &&
        registration.capabilityIdentity !== READ_IDENTITIES.templates,
      registration.capabilityIdentity
    );
    console.log(`PASS ${registration.capabilityIdentity}:permission`);
  }
  for (const [exportName, contract] of Object.entries(TASK_ACTION_CONTRACTS)) {
    if (contract.operationKind !== "effect") continue;
    const authorization = await eligibility.authorizeEvryEffectCapability(
      contract.operationId
    );
    const ownDuty = new Set<TaskEffectExport>([
      "addSubtaskAction",
      "bulkCompleteTasksAction",
      "completeTaskAction",
      "reopenTaskAction",
      "setSubtaskCompletionAction",
      "updateTaskStatusAction",
    ]).has(exportName as TaskEffectExport);
    assert.equal(Boolean(authorization), ownDuty, contract.operationId);
    console.log(`PASS ${contract.operationId}:permission`);
  }
  await db
    .update(users)
    .set({ seat: "owner" })
    .where(eq(users.id, actor.userId));
  sessionUser = sessionUser ? { ...sessionUser, seat: "owner" } : null;

  for (const [exportName, contract] of Object.entries(TASK_ACTION_CONTRACTS)) {
    if (contract.operationKind !== "effect") continue;
    await runForeignEffectTenancy({
      actor,
      memberId: seeded.memberId,
      foreignPlantId: seeded.foreignPlantId,
      foreignTaskId: foreignTask!.id,
      foreignUserId: seeded.foreignUserId,
      foreignPersonId: foreignPerson.id,
      foreignTransitionId: foreignTransition.id,
      exportName: exportName as TaskEffectExport,
      resolve: resolver.resolveTaskEvryEffect,
      mintRequestKey: plans.mintEvryPlanRequestKey,
      authorize: eligibility.authorizeEvryEffectCapability,
      effectKey: audit.executionEffectKey,
      current: atomic.taskEffectArgumentsAreCurrent,
      execute: atomic.executeTaskEffect,
    });
  }

  await runCompetingPlans({
    actor,
    resolve: resolver.resolveTaskEvryEffect,
    mintRequestKey: plans.mintEvryPlanRequestKey,
    authorize: eligibility.authorizeEvryEffectCapability,
    effectKey: audit.executionEffectKey,
    execute: atomic.executeTaskEffect,
  });
  await runStructuralSourceDrift({
    actor,
    resolve: resolver.resolveTaskEvryEffect,
    mintRequestKey: plans.mintEvryPlanRequestKey,
    authorize: eligibility.authorizeEvryEffectCapability,
    effectKey: audit.executionEffectKey,
    current: atomic.taskEffectArgumentsAreCurrent,
    execute: atomic.executeTaskEffect,
  });
  await runRecurringChecklistSourceDrift({
    actor,
    resolve: resolver.resolveTaskEvryEffect,
    mintRequestKey: plans.mintEvryPlanRequestKey,
    authorize: eligibility.authorizeEvryEffectCapability,
    effectKey: audit.executionEffectKey,
    current: atomic.taskEffectArgumentsAreCurrent,
    execute: atomic.executeTaskEffect,
  });
  await runLargeSourceHandoff({
    actor,
    memberId: seeded.memberId,
    resolve: resolver.resolveTaskEvryEffect,
    mintRequestKey: plans.mintEvryPlanRequestKey,
    authorize: eligibility.authorizeEvryEffectCapability,
    effectKey: audit.executionEffectKey,
    execute: atomic.executeTaskEffect,
  });
  await runResolverShapedBulkReview({
    actor,
    resolve: resolver.resolveTaskEvryEffect,
    propose: runtime.proposeTaskEvryEffect,
    mintRequestKey: plans.mintEvryPlanRequestKey,
  });
  await runStructureBarrierRaces({
    actor,
    resolve: resolver.resolveTaskEvryEffect,
    mintRequestKey: plans.mintEvryPlanRequestKey,
    authorize: eligibility.authorizeEvryEffectCapability,
    effectKey: audit.executionEffectKey,
    execute: atomic.executeTaskEffect,
    createTask: taskService.createTask,
  });

  for (const exportName of Object.keys(TASK_ACTION_CONTRACTS) as Array<
    keyof typeof TASK_ACTION_CONTRACTS
  >) {
    if (TASK_ACTION_CONTRACTS[exportName].operationKind !== "effect") continue;
    if (
      process.env.TASK_EFFECT_ONLY &&
      exportName !== process.env.TASK_EFFECT_ONLY
    ) {
      continue;
    }
    await runEffect({
      actor,
      memberId: seeded.memberId,
      exportName: exportName as TaskEffectExport,
      resolve: resolver.resolveTaskEvryEffect,
      mintRequestKey: plans.mintEvryPlanRequestKey,
      authorize: eligibility.authorizeEvryEffectCapability,
      effectKey: audit.executionEffectKey,
      execute: atomic.executeTaskEffect,
    });
  }

  const effectIdentities = Object.entries(TASK_ACTION_CONTRACTS)
    .filter(
      ([exportName, contract]) =>
        contract.operationKind === "effect" &&
        (!process.env.TASK_EFFECT_ONLY ||
          exportName === process.env.TASK_EFFECT_ONLY)
    )
    .map(([, { operationId }]) => operationId);
  const outcomes = await db
    .select({ capabilityIdentity: evryExecutionOutcomes.capabilityIdentity })
    .from(evryExecutionOutcomes)
    .where(inArray(evryExecutionOutcomes.capabilityIdentity, effectIdentities));
  for (const identity of effectIdentities) {
    assert.ok(
      outcomes.some(
        ({ capabilityIdentity }) => capabilityIdentity === identity
      ),
      `${identity} has no durable real outcome`
    );
  }
  console.log("Task atomic effect live proof passed");
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  }
);
