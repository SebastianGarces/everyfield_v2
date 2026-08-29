import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mock } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

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
  tasks,
  users,
} from "@/db/schema";
import { UnauthorizedError } from "@/lib/auth/unauthorized";
import type { EvryEffectInput } from "@/lib/evry/executor";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryPlanRequestKey } from "@/lib/evry/plans";

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
  console.log(`PASS ${execution.capabilityIdentity}:tenancy`);

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
  const [resolver, plans, eligibility, audit, atomic, reads, artifacts] =
    await Promise.all([
      import("./resolver"),
      import("@/lib/evry/plans"),
      import("@/lib/evry/eligibility/capabilities"),
      import("@/lib/evry/audit/identity"),
      import("./atomic-effect"),
      import("./reads"),
      import("@/lib/evry/conversations/artifacts"),
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

  await runCompetingPlans({
    actor,
    resolve: resolver.resolveTaskEvryEffect,
    mintRequestKey: plans.mintEvryPlanRequestKey,
    authorize: eligibility.authorizeEvryEffectCapability,
    effectKey: audit.executionEffectKey,
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
