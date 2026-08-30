import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import {
  evryExecutionEffectClaims,
  churches,
  launchEvents,
  launchMilestones,
  launchMilestoneTasks,
  launches,
  notifications,
  sendingChurches,
  sendingNetworks,
  tasks,
  users,
} from "@/db/schema";
import { createSession, generateSessionToken } from "@/lib/auth/session";
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
import {
  LAUNCH_MILESTONE_TEMPLATES,
  planMissingLaunchMilestoneSeedRows,
  seedLaunchMilestones,
} from "@/lib/launch/milestones";

import {
  LAUNCH_EFFECT_IDENTITIES,
  LAUNCH_EVRY_EXECUTION_REGISTRY,
  launchTaskArgumentsSchema,
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
const HTTP_PORT = 32_000 + (process.pid % 1_000);
const HTTP_ORIGIN = `http://127.0.0.1:${HTTP_PORT}`;
let server: ChildProcess | null = null;
let serverOutput = "";

/** Fixture-only owner writes used to create post-review drift. */
async function setLaunchLiveProofSendingChurch(
  churchId: string,
  sendingChurchId: string
): Promise<void> {
  await db.execute(
    sql`update "churches" set "sending_church_id" = ${sendingChurchId}::uuid where "id" = ${churchId}::uuid`
  );
}

async function renameLaunchLiveProofChurch(
  churchId: string,
  name: string
): Promise<void> {
  await db.execute(
    sql`update "churches" set "name" = ${name} where "id" = ${churchId}::uuid`
  );
}

async function startApplication(): Promise<void> {
  server = spawn(
    process.execPath,
    [
      "./node_modules/next/dist/bin/next",
      "dev",
      "--webpack",
      "-p",
      String(HTTP_PORT),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        NODE_OPTIONS: "--import=./scripts/live-next-db-endpoint.mjs",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const append = (chunk: Buffer) => {
    serverOutput = `${serverOutput}${chunk.toString("utf8")}`.slice(-20_000);
  };
  server.stdout?.on("data", append);
  server.stderr?.on("data", append);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Next server exited early\n${serverOutput}`);
    }
    try {
      await fetch(`${HTTP_ORIGIN}/api/evry/conversations`, {
        signal: AbortSignal.timeout(1_000),
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Next server did not become ready\n${serverOutput}`);
}

async function stopApplication(): Promise<void> {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => server?.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

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
  const sessionToken = generateSessionToken();
  await createSession(sessionToken, user.id, {
    userAgent: "evry-launch-production-live-proof",
  });
  return { plant, user, actor, sessionToken };
}

type LiveContext = Readonly<{
  plant: Awaited<ReturnType<typeof fixture>>["plant"];
  user: Awaited<ReturnType<typeof fixture>>["user"];
  actor: Readonly<{
    userId: string;
    plantId: string;
    seat: "owner" | "admin" | "member";
  }>;
  sessionToken: string;
}>;

type ExactPlanIdentity = Readonly<{ planId: string; fingerprint: string }>;

function confirmationPlan(value: unknown): ExactPlanIdentity | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    record.kind === "confirmation" &&
    record.plan &&
    typeof record.plan === "object"
  ) {
    const plan = record.plan as Record<string, unknown>;
    if (
      typeof plan.planId === "string" &&
      typeof plan.fingerprint === "string"
    ) {
      return { planId: plan.planId, fingerprint: plan.fingerprint };
    }
  }
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = confirmationPlan(item);
        if (found) return found;
      }
    } else {
      const found = confirmationPlan(nested);
      if (found) return found;
    }
  }
  return null;
}

async function applicationJson(input: {
  context: LiveContext;
  path: string;
  body: unknown;
}): Promise<{ response: Response; value: unknown }> {
  const response = await fetch(`${HTTP_ORIGIN}${input.path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `session=${input.context.sessionToken}`,
      origin: HTTP_ORIGIN,
    },
    body: JSON.stringify(input.body),
    redirect: "manual",
  });
  const body = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error(
      `Production route ${input.path} returned ${response.status} ${response.headers.get("location") ?? ""}: ${JSON.stringify(body)}\n${serverOutput}`
    );
  }
  return { response, value };
}

async function conversationThroughProduction(
  context: LiveContext,
  message: string
): Promise<unknown> {
  const proposal = await applicationJson({
    context,
    path: "/api/evry/conversations",
    body: { requestKey: crypto.randomUUID(), message, pageContext: null },
  });
  assert.equal(
    proposal.response.status,
    201,
    `${JSON.stringify(proposal.value)}\n${serverOutput}`
  );
  return proposal.value;
}

function artifactByKind(
  value: unknown,
  kind: string,
  title: string
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.kind === kind && record.title === title) return record;
  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = artifactByKind(item, kind, title);
        if (found) return found;
      }
    } else {
      const found = artifactByKind(nested, kind, title);
      if (found) return found;
    }
  }
  return null;
}

function readArtifact(value: unknown, title: string) {
  const artifact = artifactByKind(value, "read", title);
  assert.ok(artifact, `production continuation returned no ${title} artifact`);
  assert.ok(Array.isArray(artifact.items));
  assert.ok(Array.isArray(artifact.exclusions));
  return {
    items: artifact.items as readonly Record<string, unknown>[],
    exclusions: artifact.exclusions as readonly Record<string, unknown>[],
  };
}

async function prepareThroughProduction(
  context: LiveContext,
  message: string
): Promise<{
  plan: ExactPlanIdentity;
  execute(): Promise<Record<string, unknown>>;
}> {
  const proposal = await conversationThroughProduction(context, message);
  const plan = confirmationPlan(proposal);
  assert.ok(
    plan,
    `production continuation returned no confirmation: ${JSON.stringify(proposal)}`
  );
  const confirmation = await applicationJson({
    context,
    path: `/api/evry/plans/${plan.planId}/confirm`,
    body: { fingerprint: plan.fingerprint },
  });
  assert.equal(
    confirmation.response.status,
    200,
    JSON.stringify(confirmation.value)
  );
  return {
    plan,
    async execute() {
      const executed = await applicationJson({
        context,
        path: `/api/evry/plans/${plan.planId}/execute`,
        body: { fingerprint: plan.fingerprint },
      });
      return {
        httpStatus: executed.response.status,
        ...(executed.value as Record<string, unknown>),
      };
    },
  };
}

async function applyThroughProduction(context: LiveContext, message: string) {
  const prepared = await prepareThroughProduction(context, message);
  const result = await prepared.execute();
  return { ...prepared, result, replay: prepared.execute };
}

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
    async execute() {
      const recovered = execution.reconcileClaimed
        ? await execution.reconcileClaimed({
            effectKey,
            execution: effect.execution,
            arguments: effect.arguments,
          })
        : null;
      return recovered ?? execution.executeIfCurrent(effect);
    },
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
  await startApplication();
  try {
    const production = await fixture("production-runtime");
    const [sendingChurch] = await db
      .insert(sendingChurches)
      .values({ name: `${SCRATCH} oversight` })
      .returning({ id: sendingChurches.id });
    assert.ok(sendingChurch);
    await setLaunchLiveProofSendingChurch(
      production.plant.churchId,
      sendingChurch.id
    );
    const [oversight] = await db
      .insert(users)
      .values({
        email: `${crypto.randomUUID()}@scratch.invalid`,
        passwordHash: "scratch",
        name: `${SCRATCH} oversight`,
        seat: "admin",
        sendingChurchId: sendingChurch.id,
      })
      .returning({ id: users.id });
    assert.ok(oversight);

    const today = toCalendarDate(new Date(), "UTC");
    const scheduled = await applyThroughProduction(
      production,
      `schedule launch for ${today} | Exact production path`
    );
    assert.equal(
      scheduled.result.status,
      "completed",
      `${JSON.stringify(scheduled.result)}\n${serverOutput}`
    );
    assert.equal((await scheduled.replay()).status, "completed");
    const [productionLaunch] = await db
      .select()
      .from(launches)
      .where(eq(launches.churchId, production.plant.churchId));
    assert.ok(productionLaunch);
    const [productionTask] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.churchId, production.plant.churchId))
      .limit(1);
    assert.ok(productionTask);
    const taskCompletion = await applyThroughProduction(
      production,
      `mark launch task ${productionTask.id} complete`
    );
    assert.equal(
      taskCompletion.result.status,
      "completed",
      `${JSON.stringify(taskCompletion.result)}\n${serverOutput}`
    );
    assert.equal((await taskCompletion.replay()).status, "completed");

    const [productionMilestone] = await db
      .select({ id: launchMilestones.id })
      .from(launchMilestones)
      .where(eq(launchMilestones.launchId, productionLaunch.id))
      .limit(1);
    assert.ok(productionMilestone);
    const productionLinks = await db
      .select({ taskId: launchMilestoneTasks.taskId })
      .from(launchMilestoneTasks)
      .where(eq(launchMilestoneTasks.milestoneId, productionMilestone.id));
    await db
      .update(tasks)
      .set({ status: "complete", updatedAt: new Date() })
      .where(
        inArray(
          tasks.id,
          productionLinks.map(({ taskId }) => taskId)
        )
      );
    const milestoneCompletion = await applyThroughProduction(
      production,
      `complete launch milestone ${productionMilestone.id}`
    );
    assert.equal(milestoneCompletion.result.status, "completed");
    assert.equal((await milestoneCompletion.replay()).status, "completed");
    const milestoneReopen = await applyThroughProduction(
      production,
      `reopen launch milestone ${productionMilestone.id}`
    );
    assert.equal(milestoneReopen.result.status, "completed");
    assert.equal((await milestoneReopen.replay()).status, "completed");

    const recorded = await applyThroughProduction(
      production,
      "record launch outcome|attendance=123|decisions=7|notes=Production proof|capture=null"
    );
    assert.equal(recorded.result.status, "completed");
    assert.equal((await recorded.replay()).status, "completed");
    const corrected = await applyThroughProduction(
      production,
      'correct launch outcome|attendance=124|decisions=8|notes="null"|capture=NULL'
    );
    assert.equal(corrected.result.status, "completed");
    assert.equal((await corrected.replay()).status, "completed");
    const [literalOutcome] = await db
      .select({
        notes: launches.outcomeNotes,
        capture: launches.captureTheDay,
      })
      .from(launches)
      .where(eq(launches.id, productionLaunch.id));
    assert.deepEqual(literalOutcome, { notes: "null", capture: "NULL" });

    const journalRows = Array.from({ length: 205 }, (_, index) => ({
      id: crypto.randomUUID(),
      launchId: productionLaunch.id,
      churchId: production.plant.churchId,
      event: "moved" as const,
      previousTargetDate: today,
      targetDate: today,
      previousStatus: "scheduled" as const,
      status: "scheduled" as const,
      note: `Cursor proof ${index}`,
      actorUserId: production.user.id,
      createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, index)),
    }));
    await db.insert(launchEvents).values(journalRows);
    const mutableHistoryPage = readArtifact(
      await conversationThroughProduction(production, "show launch history"),
      "Launch history"
    );
    const mutableCursorReason = mutableHistoryPage.exclusions.find(
      ({ reason }) =>
        typeof reason === "string" &&
        reason.startsWith("Older history available after cursor ")
    )?.reason;
    if (typeof mutableCursorReason !== "string") {
      throw new Error(
        "Launch history did not disclose its continuation cursor"
      );
    }
    const mutableCursor = mutableCursorReason.slice(
      "Older history available after cursor ".length
    );
    assert.equal(
      (
        await applyThroughProduction(
          production,
          `complete launch milestone ${productionMilestone.id}`
        )
      ).result.status,
      "completed"
    );
    const staleHistoryPage = readArtifact(
      await conversationThroughProduction(
        production,
        `show launch history after ${mutableCursor}`
      ),
      "Launch history"
    );
    assert.equal(staleHistoryPage.items.length, 0);
    assert.deepEqual(staleHistoryPage.exclusions, [
      {
        reason: "Launch history changed; restart without a cursor",
        count: 1,
      },
    ]);

    const seenJournalIds = new Set<string>();
    let journalMessage = "show launch history";
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const page = readArtifact(
        await conversationThroughProduction(production, journalMessage),
        "Launch history"
      );
      for (const item of page.items) {
        assert.equal(typeof item.id, "string");
        assert.equal(seenJournalIds.has(item.id as string), false);
        seenJournalIds.add(item.id as string);
      }
      const cursorReason = page.exclusions.find(
        ({ reason }) =>
          typeof reason === "string" &&
          reason.startsWith("Older history available after cursor ")
      )?.reason;
      if (typeof cursorReason !== "string") break;
      const cursor = cursorReason.slice(
        "Older history available after cursor ".length
      );
      assert.match(cursor, /^[A-Za-z0-9_-]+$/);
      journalMessage = `show launch history after ${cursor}`;
    }
    assert.equal(
      journalRows.every(({ id }) => seenJournalIds.has(`journal:${id}`)),
      true,
      "production journal cursor omitted older launch history"
    );

    for (const identity of identities) mark(identity);

    const crash = await fixture("production-crash-replay");
    const crashPlan = await prepareThroughProduction(
      crash,
      `schedule launch for ${today} | Crash after exact claim`
    );
    await db.execute(sql`
      create function evry_launch_seed_crash_once() returns trigger
      language plpgsql as $$ begin
        raise exception 'injected post-claim crash';
      end $$
    `);
    await db.execute(sql`
      create trigger evry_launch_seed_crash_once
      before insert on launch_milestones
      for each row execute function evry_launch_seed_crash_once()
    `);
    const interrupted = await crashPlan.execute();
    assert.equal(interrupted.status, "retryable");
    assert.equal(interrupted.httpStatus, 503);
    assert.equal(
      (
        await db
          .select()
          .from(evryExecutionEffectClaims)
          .where(eq(evryExecutionEffectClaims.planId, crashPlan.plan.planId))
      ).length,
      1
    );
    assert.equal(
      (
        await db
          .select()
          .from(launches)
          .where(eq(launches.churchId, crash.plant.churchId))
      ).length,
      1
    );
    assert.equal(
      (
        await db
          .select()
          .from(launchMilestones)
          .where(eq(launchMilestones.churchId, crash.plant.churchId))
      ).length,
      0
    );
    await db.execute(
      sql`drop trigger evry_launch_seed_crash_once on launch_milestones`
    );
    await db.execute(sql`drop function evry_launch_seed_crash_once()`);
    assert.equal((await crashPlan.execute()).status, "completed");
    assert.equal(
      (
        await db
          .select()
          .from(launchMilestones)
          .where(eq(launchMilestones.churchId, crash.plant.churchId))
      ).length,
      LAUNCH_MILESTONE_TEMPLATES.length
    );

    const dualTenant = await fixture("production-dual-tenancy");
    const dualArguments = await resolveLaunchEvryArguments(dualTenant.actor, {
      kind: "schedule",
      targetDate: today,
      postpone: false,
      note: "Dual-tenancy refusal proof",
    });
    assert.ok(dualArguments);
    const directDualPlan = await prepare(
      dualTenant,
      LAUNCH_EFFECT_IDENTITIES.schedule,
      dualArguments
    );
    const routedDualPlan = await prepareThroughProduction(
      dualTenant,
      `schedule launch for ${today} | Dual-tenancy refusal proof`
    );
    const [dualSendingChurch] = await db
      .insert(sendingChurches)
      .values({ name: `${SCRATCH} dual sending church` })
      .returning({ id: sendingChurches.id });
    const [dualSendingNetwork] = await db
      .insert(sendingNetworks)
      .values({ name: `${SCRATCH} dual sending network` })
      .returning({ id: sendingNetworks.id });
    assert.ok(dualSendingChurch && dualSendingNetwork);
    await db
      .update(users)
      .set({
        sendingChurchId: dualSendingChurch.id,
        sendingNetworkId: dualSendingNetwork.id,
      })
      .where(eq(users.id, dualTenant.user.id));
    assert.equal((await directDualPlan.execute()).status, "refused");
    const routedDualRefusal = await routedDualPlan.execute();
    assert.equal(routedDualRefusal.status, "unavailable");
    assert.equal(routedDualRefusal.httpStatus, 404);
    assert.equal(
      (
        await db
          .select()
          .from(launches)
          .where(eq(launches.churchId, dualTenant.plant.churchId))
      ).length,
      0
    );

    const demotion = await fixture("production-demotion");
    assert.equal(
      (
        await applyThroughProduction(
          demotion,
          `schedule launch for ${today} | Demotion proof`
        )
      ).result.status,
      "completed"
    );
    const [demotionTask] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.churchId, demotion.plant.churchId))
      .limit(1);
    assert.ok(demotionTask);
    const demotionPlan = await prepareThroughProduction(
      demotion,
      `mark launch task ${demotionTask.id} complete`
    );
    await db
      .update(users)
      .set({ seat: "member" })
      .where(eq(users.id, demotion.user.id));
    const demoted = await demotionPlan.execute();
    assert.equal(demoted.status, "refused");
    assert.equal(demoted.httpStatus, 409);
    const [stillOpen] = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, demotionTask.id));
    assert.equal(stillOpen?.status, "not_started");

    const scheduleSourceRace = await fixture("production-source-lock-race");
    const scheduleSourceRacePlan = await prepareThroughProduction(
      scheduleSourceRace,
      `schedule launch for ${today} | Atomic source race`
    );
    await db.execute(sql`
      create function evry_launch_source_race_pause() returns trigger
      language plpgsql as $$ begin
        perform pg_sleep(2);
        return new;
      end $$
    `);
    await db.execute(sql`
      create trigger evry_launch_source_race_pause
      before update of name on churches
      for each row execute function evry_launch_source_race_pause()
    `);
    const scheduleSourceDrift = renameLaunchLiveProofChurch(
      scheduleSourceRace.plant.churchId,
      `${SCRATCH} source changed inside claim race`
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const racedSchedule = await scheduleSourceRacePlan.execute();
    await scheduleSourceDrift;
    assert.equal(racedSchedule.status, "refused");
    assert.equal(racedSchedule.httpStatus, 409);
    assert.equal(
      (
        await db
          .select()
          .from(evryExecutionEffectClaims)
          .where(
            eq(
              evryExecutionEffectClaims.planId,
              scheduleSourceRacePlan.plan.planId
            )
          )
      ).length,
      0
    );
    assert.equal(
      (
        await db
          .select()
          .from(launches)
          .where(eq(launches.churchId, scheduleSourceRace.plant.churchId))
      ).length,
      0
    );
    await db.execute(
      sql`drop trigger evry_launch_source_race_pause on churches`
    );
    await db.execute(sql`drop function evry_launch_source_race_pause()`);

    const copyDrift = await fixture("production-copy-drift");
    const copyDriftPlan = await prepareThroughProduction(
      copyDrift,
      `schedule launch for ${today} | Reviewed original plant name`
    );
    await renameLaunchLiveProofChurch(
      copyDrift.plant.churchId,
      `${SCRATCH} changed after review`
    );
    const staleCopy = await copyDriftPlan.execute();
    assert.equal(staleCopy.status, "refused");
    assert.equal(staleCopy.httpStatus, 409);

    const audienceDrift = await fixture("production-audience-drift");
    const [audienceSendingChurch] = await db
      .insert(sendingChurches)
      .values({ name: `${SCRATCH} audience oversight` })
      .returning({ id: sendingChurches.id });
    assert.ok(audienceSendingChurch);
    await setLaunchLiveProofSendingChurch(
      audienceDrift.plant.churchId,
      audienceSendingChurch.id
    );
    await db.insert(users).values({
      email: `${crypto.randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: `${SCRATCH} reviewed recipient`,
      seat: "admin",
      sendingChurchId: audienceSendingChurch.id,
    });
    const audienceDriftPlan = await prepareThroughProduction(
      audienceDrift,
      `schedule launch for ${today} | Exact reviewed audience`
    );
    await db.insert(users).values({
      email: `${crypto.randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: `${SCRATCH} late recipient`,
      seat: "admin",
      sendingChurchId: audienceSendingChurch.id,
    });
    const staleAudience = await audienceDriftPlan.execute();
    assert.equal(staleAudience.status, "refused");
    assert.equal(staleAudience.httpStatus, 409);

    const templateDrift = await fixture("production-template-drift");
    assert.equal(
      (
        await applyThroughProduction(
          templateDrift,
          `schedule launch for ${today} | Initial exact template`
        )
      ).result.status,
      "completed"
    );
    const [templateLaunch] = await db
      .select({ id: launches.id })
      .from(launches)
      .where(eq(launches.churchId, templateDrift.plant.churchId));
    assert.ok(templateLaunch);
    const [templateMilestone] = await db
      .select({ id: launchMilestones.id })
      .from(launchMilestones)
      .where(eq(launchMilestones.churchId, templateDrift.plant.churchId))
      .limit(1);
    assert.ok(templateMilestone);
    const removedTemplateTasks = await db
      .select({ id: launchMilestoneTasks.taskId })
      .from(launchMilestoneTasks)
      .where(eq(launchMilestoneTasks.milestoneId, templateMilestone.id));
    await db
      .delete(launchMilestones)
      .where(eq(launchMilestones.id, templateMilestone.id));
    if (removedTemplateTasks.length > 0) {
      await db.delete(tasks).where(
        inArray(
          tasks.id,
          removedTemplateTasks.map(({ id }) => id)
        )
      );
    }
    const movedDate = new Date(Date.now() + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const templateDriftPlan = await prepareThroughProduction(
      templateDrift,
      `postpone launch to ${movedDate} | Reviewed missing readiness row`
    );
    const missingRows = await planMissingLaunchMilestoneSeedRows({
      launchId: templateLaunch.id,
      churchId: templateDrift.plant.churchId,
    });
    assert.equal(missingRows.length > 0, true);
    await seedLaunchMilestones({
      launchId: templateLaunch.id,
      churchId: templateDrift.plant.churchId,
      actorUserId: templateDrift.user.id,
      rows: missingRows.map((row) => ({
        ...row,
        title: `${row.title} (changed after review)`,
      })),
    });
    const staleTemplate = await templateDriftPlan.execute();
    assert.equal(staleTemplate.status, "refused");
    assert.equal(staleTemplate.httpStatus, 409);

    const recurring = await fixture("production-recurring-replay");
    assert.equal(
      (
        await applyThroughProduction(
          recurring,
          `schedule launch for ${today} | Recurring production proof`
        )
      ).result.status,
      "completed"
    );
    const [recurringParent] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.churchId, recurring.plant.churchId))
      .limit(1);
    assert.ok(recurringParent);
    const recurringDueDate = new Date(Date.now() + 4 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await db
      .update(tasks)
      .set({
        assignedToId: recurring.user.id,
        dueDate: recurringDueDate,
        isRecurring: true,
        recurrenceRule: { interval: "weekly", endDate: null },
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, recurringParent.id));
    const childId = crypto.randomUUID();
    await db.insert(tasks).values({
      id: childId,
      churchId: recurring.plant.churchId,
      title: "Exact recurring checklist item",
      status: "complete",
      priority: "high",
      dueTime: "15:30:00",
      assignedToId: recurring.user.id,
      category: "launch_prep",
      parentTaskId: recurringParent.id,
      createdById: recurring.user.id,
    });
    const staleRecurringSourcePlan = await prepareThroughProduction(
      recurring,
      `mark launch task ${recurringParent.id} complete`
    );
    await db.execute(sql`
      create function evry_launch_child_race_pause() returns trigger
      language plpgsql as $$ begin
        perform pg_sleep(2);
        return new;
      end $$
    `);
    await db.execute(sql`
      create trigger evry_launch_child_race_pause
      before update of title on tasks
      for each row execute function evry_launch_child_race_pause()
    `);
    const childSourceDrift = (async () => {
      await db
        .update(tasks)
        .set({ title: "Changed while the exact claim waited" })
        .where(eq(tasks.id, childId));
    })();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const racedRecurringSource = await staleRecurringSourcePlan.execute();
    await childSourceDrift;
    assert.equal(racedRecurringSource.status, "refused");
    assert.equal(racedRecurringSource.httpStatus, 409);
    assert.equal(
      (
        await db
          .select()
          .from(evryExecutionEffectClaims)
          .where(
            eq(
              evryExecutionEffectClaims.planId,
              staleRecurringSourcePlan.plan.planId
            )
          )
      ).length,
      0
    );
    const [unclaimedParent] = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, recurringParent.id));
    assert.equal(unclaimedParent?.status, "not_started");
    await db.execute(sql`drop trigger evry_launch_child_race_pause on tasks`);
    await db.execute(sql`drop function evry_launch_child_race_pause()`);
    await db
      .update(tasks)
      .set({ title: "Exact recurring checklist item" })
      .where(eq(tasks.id, childId));
    const recurringPlan = await prepareThroughProduction(
      recurring,
      `mark launch task ${recurringParent.id} complete`
    );
    await db.execute(sql`
      create function evry_launch_task_effect_crash_once() returns trigger
      language plpgsql as $$ begin
        raise exception 'injected downstream task effect crash';
      end $$
    `);
    await db.execute(sql`
      create trigger evry_launch_task_effect_crash_once
      before update on churches
      for each row execute function evry_launch_task_effect_crash_once()
    `);
    const interruptedTask = await recurringPlan.execute();
    assert.equal(interruptedTask.status, "retryable");
    assert.equal(interruptedTask.httpStatus, 503);
    const [durableCompletion] = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, recurringParent.id));
    assert.equal(durableCompletion?.status, "complete");
    await db.execute(
      sql`drop trigger evry_launch_task_effect_crash_once on churches`
    );
    await db.execute(sql`drop function evry_launch_task_effect_crash_once()`);
    const recoveredTasks = await Promise.all(
      Array.from({ length: 8 }, () => recurringPlan.execute())
    );
    assert.deepEqual(
      recoveredTasks.map(({ status }) => status),
      Array.from({ length: 8 }, () => "completed")
    );
    const openSeries = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, recurring.plant.churchId),
          eq(tasks.isRecurring, true),
          sql`${tasks.status} <> 'complete'`,
          sql`${tasks.recurrenceRule} ->> 'seriesId' is not null`
        )
      );
    assert.equal(openSeries.length, 1);
    const successor = openSeries[0]!;
    const successorChildren = await db
      .select()
      .from(tasks)
      .where(eq(tasks.parentTaskId, successor.id));
    assert.equal(successorChildren.length, 1);
    assert.equal(successorChildren[0]?.title, "Exact recurring checklist item");
    assert.equal(successorChildren[0]?.status, "not_started");
    await assert.rejects(
      db
        .update(tasks)
        .set({ status: "not_started" })
        .where(eq(tasks.id, recurringParent.id)),
      (error) =>
        isUniqueViolation(error, "tasks_open_recurrence_series_unique_idx")
    );
    assert.equal(
      (
        await db
          .select()
          .from(notifications)
          .where(eq(notifications.entityId, successor.id))
      ).length,
      2
    );
    const [dirtiedPlant] = await db
      .select({ at: churches.lastMaterialEventAt })
      .from(churches)
      .where(eq(churches.id, recurring.plant.churchId));
    assert.ok(dirtiedPlant?.at);

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
        LAUNCH_EVRY_EXECUTION_REGISTRY.registrationFor(
          "launch.outcome.unknown"
        ),
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
        (await setLaunchDate(drift.user, drift.plant.churchId, tomorrow))
          .status,
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
      const permissionArgs = await resolveLaunchEvryArguments(
        permission.actor,
        {
          kind: "schedule",
          targetDate: today,
          postpone: false,
          note: null,
        }
      );
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
      const firstSchedule = await applyThroughProduction(
        lateReplay,
        `schedule launch for ${today} | response may be lost`
      );
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
      const recurringReview = launchTaskArgumentsSchema.parse(
        await resolveLaunchEvryArguments(recurringTask.actor, {
          kind: "set_task_completion",
          taskId: recurringCandidate.id,
          complete: true,
        })
      );
      assert.equal(
        recurringReview.completion?.recurrence?.disposition,
        "create"
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
  } finally {
    await stopApplication();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
