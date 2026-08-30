import assert from "node:assert/strict";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  launchEvents,
  launchMilestones,
  launchMilestoneTasks,
  launches,
  tasks,
  users,
} from "@/db/schema";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { toCalendarDate } from "@/lib/datetime";
import { evryCapabilityRegistrationFor } from "@/lib/evry/eligibility/capabilities";
import {
  executionEffectKey,
  type EvryAuditKey,
} from "@/lib/evry/audit/identity";
import { startOrResumeEvryExecution } from "@/lib/evry/executor/repository";
import type { EvryEffectInput } from "@/lib/evry/executor";
import {
  mintEvryPlanRequestKey,
  parseEvryActionPlanCandidate,
} from "@/lib/evry/plans";
import {
  confirmExactEvryActionPlan,
  createEvryActionPlanRecord,
} from "@/lib/evry/plans/repository";
import { createScratchPlant } from "@/lib/testing/ministry-teams-scratch";
import { setLaunchDate } from "@/lib/launch/service";
import { updateLaunchOutcome } from "@/lib/launch/outcome";
import { LAUNCH_MILESTONE_TEMPLATES } from "@/lib/launch/milestones";

import {
  LAUNCH_EFFECT_IDENTITIES,
  LAUNCH_EVRY_EXECUTION_REGISTRY,
  resolveLaunchEvryArguments,
  type LaunchEvryEffectSelection,
} from "./effects";
import {
  LAUNCH_READ_IDENTITIES,
  readLaunchJournalForPlant,
  readLaunchReadinessForPlant,
  readLaunchStatusForPlant,
} from "./reads";

const SCRATCH = "__evry launch effect proof__";
const identities = Object.values(LAUNCH_EFFECT_IDENTITIES);
const outcomes = new Set<string>();

async function fixture(suffix: string) {
  const plant = await createScratchPlant(`${SCRATCH} ${suffix}`);
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, plant.actorId))
    .limit(1);
  assert.ok(user);
  const actor = {
    userId: user.id,
    plantId: plant.churchId,
    seat: "owner" as const,
  };
  return { plant, user, actor };
}

type LiveContext = Readonly<{
  plant: Awaited<ReturnType<typeof fixture>>["plant"];
  user: Awaited<ReturnType<typeof fixture>>["user"];
  actor: Readonly<{
    userId: string;
    plantId: string;
    seat: "owner" | "admin" | "member";
  }>;
}>;

async function apply(
  context: LiveContext,
  selection: LaunchEvryEffectSelection
) {
  const args = await resolveLaunchEvryArguments(context.actor, selection);
  assert.ok(args, `resolver refused ${selection.kind}`);
  const identity =
    selection.kind === "schedule"
      ? LAUNCH_EFFECT_IDENTITIES.schedule
      : selection.kind === "complete_milestone"
        ? LAUNCH_EFFECT_IDENTITIES.completeMilestone
        : selection.kind === "reopen_milestone"
          ? LAUNCH_EFFECT_IDENTITIES.reopenMilestone
          : selection.kind === "set_task_completion"
            ? LAUNCH_EFFECT_IDENTITIES.setTaskCompletion
            : selection.kind === "record_outcome"
              ? LAUNCH_EFFECT_IDENTITIES.recordOutcome
              : LAUNCH_EFFECT_IDENTITIES.correctOutcome;
  const prepared = await prepare(context, identity, args);
  return { args, result: await prepared.execute(), replay: prepared.execute };
}

async function prepare(
  context: LiveContext,
  identity: string,
  args: Record<string, unknown>
) {
  const stepId = `launch-${crypto.randomUUID()}`;
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: stepId,
          capabilityIdentity: identity,
          arguments: args,
          dependsOn: [],
        },
      ],
    },
    registry: LAUNCH_EVRY_EXECUTION_REGISTRY.planRegistry,
    eligibleCapabilities: [{ identity }],
  });
  const plan = await createEvryActionPlanRecord({
    actorUserId: context.actor.userId,
    plantId: context.actor.plantId,
    requestKey: mintEvryPlanRequestKey(),
    document,
  });
  const confirmation = await confirmExactEvryActionPlan({
    planId: plan.id,
    actorUserId: context.actor.userId,
    plantId: context.actor.plantId,
    fingerprint: plan.fingerprint,
    decidedAt: new Date(),
  });
  assert.ok(
    confirmation.status === "approved" ||
      confirmation.status === "already_approved"
  );
  const snapshot = await startOrResumeEvryExecution({
    planId: plan.id,
    actorUserId: context.actor.userId,
    plantId: context.actor.plantId,
    fingerprint: plan.fingerprint,
    startedAt: new Date(),
  });
  assert.ok(snapshot);
  const registration = evryCapabilityRegistrationFor(identity);
  const execution = LAUNCH_EVRY_EXECUTION_REGISTRY.registrationFor(identity);
  assert.ok(
    registration?.operationKind === "effect" && execution,
    `missing production registration for ${identity}`
  );
  const effectKey = executionEffectKey(
    plan.id,
    plan.fingerprint,
    stepId
  ) as EvryAuditKey;
  const effect = {
    authorization: { actor: context.actor, registration },
    effectKey,
    execution: {
      attemptId: snapshot.attempt.id,
      planId: plan.id,
      actorUserId: context.actor.userId,
      plantId: context.actor.plantId,
      fingerprint: plan.fingerprint,
      correlationId: snapshot.attempt.correlationId,
      stepId,
      capabilityIdentity: identity,
    },
    arguments: args,
  } as unknown as EvryEffectInput;
  return {
    effect,
    execute: () => execution.executeIfCurrent(effect),
  };
}

function mark(identity: string) {
  for (const layer of ["execution", "idempotency", "errors"]) {
    outcomes.add(`${identity}:${layer}`);
  }
}

async function assertClosedFailure(
  context: LiveContext,
  identity: string,
  validArguments: Record<string, unknown>
) {
  const prepared = await prepare(context, identity, validArguments);
  const registration = LAUNCH_EVRY_EXECUTION_REGISTRY.registrationFor(identity);
  assert.ok(registration);
  const result = await registration.executeIfCurrent({
    ...prepared.effect,
    arguments: { forged: true },
  });
  assert.equal(
    result.status,
    "refused",
    `${identity} accepted forged arguments`
  );
}

async function main() {
  // Evry audit/plan rows are intentionally immutable, so this isolated
  // per-suite database is the cleanup boundary. The live lane recreates it
  // from the migration template before every run.
  {
    const context = await fixture("lifecycle");
    assert.equal(holdsSeatFor(context.user, "launch.schedule"), true);
    const today = toCalendarDate(new Date(), "UTC");

    const scheduled = await apply(context, {
      kind: "schedule",
      targetDate: today,
      postpone: false,
      note: "Exact reviewed launch date",
    });
    assert.equal(scheduled.result.status, "completed");
    const replaySchedule = await scheduled.replay();
    assert.equal(replaySchedule.status, "completed");
    assert.equal(
      (
        await db
          .select()
          .from(launches)
          .where(eq(launches.churchId, context.plant.churchId))
      ).length,
      1
    );
    assert.equal(
      (
        await db
          .select()
          .from(launchEvents)
          .where(eq(launchEvents.churchId, context.plant.churchId))
      ).length,
      1
    );
    await assertClosedFailure(
      context,
      LAUNCH_EFFECT_IDENTITIES.schedule,
      scheduled.args
    );
    mark(LAUNCH_EFFECT_IDENTITIES.schedule);

    const [launch] = await db
      .select()
      .from(launches)
      .where(eq(launches.churchId, context.plant.churchId));
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.churchId, context.plant.churchId))
      .limit(1);
    assert.ok(launch && task);
    const taskApplied = await apply(context, {
      kind: "set_task_completion",
      taskId: task.id,
      complete: true,
    });
    assert.equal(taskApplied.result.status, "completed");
    assert.equal(
      await resolveLaunchEvryArguments(context.actor, {
        kind: "set_task_completion",
        taskId: task.id,
        complete: true,
      }),
      null
    );
    assert.equal((await taskApplied.replay()).status, "completed");
    await assertClosedFailure(
      context,
      LAUNCH_EFFECT_IDENTITIES.setTaskCompletion,
      taskApplied.args
    );
    mark(LAUNCH_EFFECT_IDENTITIES.setTaskCompletion);

    const [milestone] = await db
      .select({ id: launchMilestones.id })
      .from(launchMilestones)
      .where(eq(launchMilestones.launchId, launch.id))
      .limit(1);
    assert.ok(milestone);
    const linked = await db
      .select({ taskId: launchMilestoneTasks.taskId })
      .from(launchMilestoneTasks)
      .where(eq(launchMilestoneTasks.milestoneId, milestone.id));
    await db
      .update(tasks)
      .set({ status: "complete", updatedAt: new Date() })
      .where(
        and(
          eq(tasks.churchId, context.plant.churchId),
          inArray(
            tasks.id,
            linked.map(({ taskId }) => taskId)
          )
        )
      );
    const completed = await apply(context, {
      kind: "complete_milestone",
      milestoneId: milestone.id,
    });
    assert.equal(completed.result.status, "completed");
    assert.equal(
      await resolveLaunchEvryArguments(context.actor, {
        kind: "complete_milestone",
        milestoneId: milestone.id,
      }),
      null
    );
    assert.equal((await completed.replay()).status, "completed");
    await assertClosedFailure(
      context,
      LAUNCH_EFFECT_IDENTITIES.completeMilestone,
      completed.args
    );
    mark(LAUNCH_EFFECT_IDENTITIES.completeMilestone);

    const reopened = await apply(context, {
      kind: "reopen_milestone",
      milestoneId: milestone.id,
    });
    assert.equal(reopened.result.status, "completed");
    assert.equal((await reopened.replay()).status, "completed");
    await assertClosedFailure(
      context,
      LAUNCH_EFFECT_IDENTITIES.reopenMilestone,
      reopened.args
    );
    mark(LAUNCH_EFFECT_IDENTITIES.reopenMilestone);

    const recorded = await apply(context, {
      kind: "record_outcome",
      outcome: {
        attendanceCount: 123,
        decisionsCount: 7,
        outcomeNotes: "Launch completed",
        captureTheDay: "Photo journal",
      },
    });
    assert.equal(recorded.result.status, "completed");
    assert.equal(
      await resolveLaunchEvryArguments(context.actor, {
        kind: "record_outcome",
        outcome: {
          attendanceCount: 123,
          decisionsCount: 7,
          outcomeNotes: "Launch completed",
          captureTheDay: "Photo journal",
        },
      }),
      null
    );
    assert.equal(
      await resolveLaunchEvryArguments(context.actor, {
        kind: "schedule",
        targetDate: today,
        postpone: false,
        note: null,
      }),
      null
    );
    assert.equal((await recorded.replay()).status, "completed");
    await assertClosedFailure(
      context,
      LAUNCH_EFFECT_IDENTITIES.recordOutcome,
      recorded.args
    );
    mark(LAUNCH_EFFECT_IDENTITIES.recordOutcome);

    const corrected = await apply(context, {
      kind: "correct_outcome",
      outcome: {
        attendanceCount: 124,
        decisionsCount: 8,
        outcomeNotes: "Corrected exact count",
        captureTheDay: "Photo journal",
      },
    });
    assert.equal(corrected.result.status, "completed");
    assert.equal((await corrected.replay()).status, "completed");
    assert.equal(
      LAUNCH_EVRY_EXECUTION_REGISTRY.registrationFor("launch.outcome.unknown"),
      null,
      "an unregistered identity reached the execution registry"
    );
    await assertClosedFailure(
      context,
      LAUNCH_EFFECT_IDENTITIES.correctOutcome,
      corrected.args
    );
    mark(LAUNCH_EFFECT_IDENTITIES.correctOutcome);

    const readPairs = [
      {
        identity: LAUNCH_READ_IDENTITIES.status,
        read: () => readLaunchStatusForPlant(context.plant.churchId),
      },
      {
        identity: LAUNCH_READ_IDENTITIES.readiness,
        read: () => readLaunchReadinessForPlant(context.plant.churchId),
      },
      {
        identity: LAUNCH_READ_IDENTITIES.journal,
        read: () => readLaunchJournalForPlant(context.plant.churchId, 100),
      },
    ] as const;
    for (const read of readPairs) {
      const first = await read.read();
      const replay = await read.read();
      assert.deepEqual(replay, first, `${read.identity} was not idempotent`);
      assert.ok(
        first.items.length > 0,
        `${read.identity} returned no fixture data`
      );
    }

    const empty = await fixture("empty-read");
    const emptyArtifacts = await Promise.all([
      readLaunchStatusForPlant(empty.plant.churchId),
      readLaunchReadinessForPlant(empty.plant.churchId),
      readLaunchJournalForPlant(empty.plant.churchId, 100),
    ]);
    assert.equal(emptyArtifacts[0].items[0]?.id, "launch:planning");
    assert.equal(emptyArtifacts[1].items.length, 0);
    assert.equal(emptyArtifacts[2].items.length, 0);
    assert.equal(
      JSON.stringify(emptyArtifacts).includes(launch.id),
      false,
      "plant-scoped read disclosed another plant's Launch record"
    );

    const drift = await fixture("drift");
    const initialArgs = await resolveLaunchEvryArguments(drift.actor, {
      kind: "schedule",
      targetDate: today,
      postpone: false,
      note: "Reviewed Evry note",
    });
    assert.ok(initialArgs);
    const driftExecution = await prepare(
      drift,
      LAUNCH_EFFECT_IDENTITIES.schedule,
      initialArgs
    );
    assert.equal(
      (
        await setLaunchDate(drift.user, drift.plant.churchId, today, {
          note: "Reviewed Evry note",
        })
      ).status,
      "changed"
    );
    const tomorrow = new Date(Date.now() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    assert.equal(
      (await setLaunchDate(drift.user, drift.plant.churchId, tomorrow)).status,
      "changed"
    );
    assert.equal(
      (await driftExecution.execute()).status,
      "refused",
      "a matching historical event masked the launch's newer target"
    );

    const outcomeDrift = await fixture("outcome-drift");
    assert.equal(
      (
        await apply(outcomeDrift, {
          kind: "schedule",
          targetDate: today,
          postpone: false,
          note: null,
        })
      ).result.status,
      "completed"
    );
    assert.equal(
      (
        await apply(outcomeDrift, {
          kind: "record_outcome",
          outcome: {
            attendanceCount: 20,
            decisionsCount: 2,
            outcomeNotes: "Initial",
            captureTheDay: null,
          },
        })
      ).result.status,
      "completed"
    );
    const correctionArgs = await resolveLaunchEvryArguments(
      outcomeDrift.actor,
      {
        kind: "correct_outcome",
        outcome: {
          attendanceCount: 21,
          decisionsCount: 2,
          outcomeNotes: "Reviewed correction",
          captureTheDay: null,
        },
      }
    );
    assert.ok(correctionArgs);
    const correctionExecution = await prepare(
      outcomeDrift,
      LAUNCH_EFFECT_IDENTITIES.correctOutcome,
      correctionArgs
    );
    assert.equal(
      (
        await updateLaunchOutcome(
          outcomeDrift.user,
          outcomeDrift.plant.churchId,
          {
            attendanceCount: 22,
            decisionsCount: 3,
            outcomeNotes: "Concurrent correction",
            captureTheDay: null,
          }
        )
      ).status,
      "updated"
    );
    assert.equal(
      (await correctionExecution.execute()).status,
      "refused",
      "outcome correction hid a source race as unchanged"
    );

    const foreign = await resolveLaunchEvryArguments(drift.actor, {
      kind: "complete_milestone",
      milestoneId: milestone.id,
    });
    assert.equal(
      foreign,
      null,
      "foreign milestone disclosed through resolution"
    );

    const permission = await fixture("permission");
    const permissionArgs = await resolveLaunchEvryArguments(permission.actor, {
      kind: "schedule",
      targetDate: today,
      postpone: false,
      note: null,
    });
    assert.ok(permissionArgs);
    const permissionExecution = await prepare(
      permission,
      LAUNCH_EFFECT_IDENTITIES.schedule,
      permissionArgs
    );
    assert.equal(
      await resolveLaunchEvryArguments(permission.actor, {
        kind: "schedule",
        targetDate: today,
        postpone: true,
        note: null,
      }),
      null,
      "postpone was offered before a launch date existed"
    );
    await db
      .update(users)
      .set({ seat: "member" })
      .where(eq(users.id, permission.user.id));
    const [member] = await db
      .select()
      .from(users)
      .where(eq(users.id, permission.user.id))
      .limit(1);
    assert.ok(member);
    assert.equal(holdsSeatFor(member, "launch.schedule"), false);
    assert.equal(holdsSeatFor(member, "launch.milestone"), true);
    const permissionResult = await permissionExecution.execute();
    assert.equal(permissionResult.status, "refused");
    assert.equal(
      (
        await db
          .select()
          .from(launches)
          .where(eq(launches.churchId, permission.plant.churchId))
      ).length,
      0
    );

    const race = await fixture("race");
    const raceArgs = await resolveLaunchEvryArguments(race.actor, {
      kind: "schedule",
      targetDate: today,
      postpone: false,
      note: "one",
    });
    assert.ok(raceArgs);
    const [leftExecution, rightExecution] = await Promise.all([
      prepare(race, LAUNCH_EFFECT_IDENTITIES.schedule, raceArgs),
      prepare(race, LAUNCH_EFFECT_IDENTITIES.schedule, raceArgs),
    ]);
    const [left, right] = await Promise.all([
      leftExecution.execute(),
      rightExecution.execute(),
    ]);
    assert.deepEqual([left.status, right.status].sort(), [
      "completed",
      "refused",
    ]);
    assert.equal(
      (
        await db
          .select()
          .from(launches)
          .where(eq(launches.churchId, race.plant.churchId))
      ).length,
      1
    );
    assert.equal(
      (
        await db
          .select()
          .from(launchEvents)
          .where(eq(launchEvents.churchId, race.plant.churchId))
      ).length,
      1
    );

    const sameKey = await fixture("same-key");
    const sameKeyArgs = await resolveLaunchEvryArguments(sameKey.actor, {
      kind: "schedule",
      targetDate: today,
      postpone: false,
      note: "one exact request",
    });
    assert.ok(sameKeyArgs);
    const sameKeyExecution = await prepare(
      sameKey,
      LAUNCH_EFFECT_IDENTITIES.schedule,
      sameKeyArgs
    );
    const sameKeyResults = await Promise.all([
      sameKeyExecution.execute(),
      sameKeyExecution.execute(),
    ]);
    assert.deepEqual(
      sameKeyResults.map(({ status }) => status),
      ["completed", "completed"]
    );
    assert.equal(
      (
        await db
          .select()
          .from(launchEvents)
          .where(eq(launchEvents.churchId, sameKey.plant.churchId))
      ).length,
      1,
      "a concurrent exact-key replay appended a second journal entry"
    );

    const reconcile = await fixture("reconcile-replay");
    const reconcileSchedule = await apply(reconcile, {
      kind: "schedule",
      targetDate: today,
      postpone: false,
      note: "durable date before readiness repair",
    });
    assert.equal(reconcileSchedule.result.status, "completed");
    const linkedTasks = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.churchId, reconcile.plant.churchId));
    await db
      .delete(launchMilestoneTasks)
      .where(eq(launchMilestoneTasks.churchId, reconcile.plant.churchId));
    if (linkedTasks.length > 0) {
      await db.delete(tasks).where(
        inArray(
          tasks.id,
          linkedTasks.map(({ id }) => id)
        )
      );
    }
    await db
      .delete(launchMilestones)
      .where(eq(launchMilestones.churchId, reconcile.plant.churchId));
    assert.equal((await reconcileSchedule.replay()).status, "completed");
    assert.equal(
      (
        await db
          .select()
          .from(launchMilestones)
          .where(eq(launchMilestones.churchId, reconcile.plant.churchId))
      ).length,
      LAUNCH_MILESTONE_TEMPLATES.length,
      "a completed exact-key replay did not repair missing readiness rows"
    );

    const lateReplay = await fixture("late-replay");
    const firstSchedule = await apply(lateReplay, {
      kind: "schedule",
      targetDate: today,
      postpone: false,
      note: "response may be lost",
    });
    assert.equal(firstSchedule.result.status, "completed");
    const laterDate = new Date(Date.now() + 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    assert.equal(
      (
        await setLaunchDate(
          lateReplay.user,
          lateReplay.plant.churchId,
          laterDate,
          { note: "later independent change" }
        )
      ).status,
      "changed"
    );
    assert.equal(
      (await firstSchedule.replay()).status,
      "completed",
      "exact outcome replay consulted the later mutable Launch row"
    );

    const recurringTask = await fixture("recurring-task");
    assert.equal(
      (
        await apply(recurringTask, {
          kind: "schedule",
          targetDate: today,
          postpone: false,
          note: null,
        })
      ).result.status,
      "completed"
    );
    const [recurringCandidate] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.churchId, recurringTask.plant.churchId))
      .limit(1);
    assert.ok(recurringCandidate);
    const reviewedTaskArgs = await resolveLaunchEvryArguments(
      recurringTask.actor,
      {
        kind: "set_task_completion",
        taskId: recurringCandidate.id,
        complete: true,
      }
    );
    assert.ok(reviewedTaskArgs);
    const recurringExecution = await prepare(
      recurringTask,
      LAUNCH_EFFECT_IDENTITIES.setTaskCompletion,
      reviewedTaskArgs
    );
    await db
      .update(tasks)
      .set({
        isRecurring: true,
        recurrenceRule: { interval: "weekly", endDate: null },
      })
      .where(eq(tasks.id, recurringCandidate.id));
    assert.equal(
      await resolveLaunchEvryArguments(recurringTask.actor, {
        kind: "set_task_completion",
        taskId: recurringCandidate.id,
        complete: true,
      }),
      null,
      "a recurring Launch task was offered as a one-record toggle"
    );
    assert.equal(
      (await recurringExecution.execute()).status,
      "refused",
      "recurrence drift could hide an unreviewed successor task"
    );
    assert.equal(
      (
        await db
          .select()
          .from(tasks)
          .where(eq(tasks.churchId, recurringTask.plant.churchId))
      ).filter(({ status }) => status === "complete").length,
      0
    );

    const memberTask = await fixture("member-task");
    assert.equal(
      (
        await apply(memberTask, {
          kind: "schedule",
          targetDate: today,
          postpone: false,
          note: null,
        })
      ).result.status,
      "completed"
    );
    const [memberLaunchTask] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.churchId, memberTask.plant.churchId))
      .limit(1);
    assert.ok(memberLaunchTask);
    await db
      .update(users)
      .set({ seat: "member" })
      .where(eq(users.id, memberTask.user.id));
    const memberContext = {
      ...memberTask,
      actor: { ...memberTask.actor, seat: "member" as const },
    };
    assert.equal(
      await resolveLaunchEvryArguments(memberContext.actor, {
        kind: "set_task_completion",
        taskId: memberLaunchTask.id,
        complete: true,
      }),
      null,
      "a Member was allowed to complete an unassigned Launch task"
    );
    await db
      .update(tasks)
      .set({ assignedToId: memberTask.user.id, updatedAt: new Date() })
      .where(eq(tasks.id, memberLaunchTask.id));
    assert.equal(
      (
        await apply(memberContext, {
          kind: "set_task_completion",
          taskId: memberLaunchTask.id,
          complete: true,
        })
      ).result.status,
      "completed",
      "normal assigned-task permission was not preserved for a Member"
    );

    assert.equal(outcomes.size, identities.length * 3);
    process.stdout.write(
      `EVRY_LAUNCH_EFFECT_OUTCOMES=${JSON.stringify([...outcomes].sort())}\n`
    );
    process.stdout.write("Launch effect live proof passed\n");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
