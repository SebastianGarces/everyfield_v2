import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  evryActionPlans,
  evryActionPlanStates,
  evryConversationArtifacts,
  evryConversationMessages,
  evryConversationStates,
  persons,
  users,
} from "@/db/schema";
import {
  fingerprintEvryActionPlan,
  fingerprintEvryActionPlanIntent,
} from "@/lib/evry/plans/fingerprint";
import {
  MEETING_IDENTITY,
  PLAN_FIXTURE_REGISTRY,
  SEND_IDENTITY,
} from "@/lib/evry/plans/fixtures.test-helper";
import { mintEvryPlanRequestKey } from "@/lib/evry/plans/request-key";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans/schema";

import {
  evryConversationMessageIdSchema,
  evryConversationRequestKeySchema,
  evryConversationStateDocumentSchema,
  type EvryConversationId,
} from "./contract";
import {
  appendEvryConversationRecord,
  createEvryConversationRecord,
  EvryConversationIdempotencyError,
  findEvryConversationRecord,
} from "./repository";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — real Postgres is required";
const UNREACHABLE =
  "SKIPPED — LIVE_DB_TESTS=1 was set but Postgres was unreachable";
const WORKER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fresh-process-proof.ts"
);
const START = new Date("2026-08-20T12:00:00.000Z");
const LITERAL = "  Create café follow-up — keep these bytes.  ";

async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

function runWorker(
  mode: "create" | "resume" | "retry",
  environment: Readonly<Record<string, string>>
): string {
  const child = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--import",
      "./scripts/live-db-endpoint.ts",
      WORKER,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        ...environment,
        EVRY_CONVERSATION_PROOF_MODE: mode,
      },
      timeout: 30_000,
    }
  );
  assert.equal(
    child.status,
    0,
    `fresh-process ${mode} failed\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`
  );
  return child.stdout;
}

test(
  "real persistence survives fresh Request processes without replay or tenant bleed",
  { skip },
  async (t: TestContext) => {
    if (!(await databaseReachable())) return t.skip(UNREACHABLE);

    const [plant, otherPlant] = await db
      .insert(churches)
      .values([
        { name: "__evry conversation proof__" },
        { name: "__evry conversation foreign proof__" },
      ])
      .returning({ id: churches.id });
    const [actor, otherActor, foreignActor] = await db
      .insert(users)
      .values([
        {
          email: `${randomUUID()}@conversation-proof.invalid`,
          passwordHash: "proof",
          name: "Conversation actor",
          seat: "owner",
          churchId: plant.id,
        },
        {
          email: `${randomUUID()}@conversation-proof.invalid`,
          passwordHash: "proof",
          name: "Other actor",
          seat: "admin",
          churchId: plant.id,
        },
        {
          email: `${randomUUID()}@conversation-proof.invalid`,
          passwordHash: "proof",
          name: "Foreign actor",
          seat: "owner",
          churchId: otherPlant.id,
        },
      ])
      .returning({ id: users.id });
    const [firstPerson, secondPerson] = await db
      .insert(persons)
      .values([
        {
          churchId: plant.id,
          firstName: "Alex",
          lastName: "Rivera",
          createdBy: actor.id,
        },
        {
          churchId: plant.id,
          firstName: "Sam",
          lastName: "Lee",
          createdBy: actor.id,
        },
      ])
      .returning({ id: persons.id });
    const document = parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: "create-meeting",
            capabilityIdentity: MEETING_IDENTITY,
            arguments: {
              startsAt: "2026-09-02T14:00:00-04:00",
              locationId: randomUUID(),
              targetId: firstPerson.id,
              reminderDays: 2,
            },
            dependsOn: [],
          },
          {
            id: "send-invitation",
            capabilityIdentity: SEND_IDENTITY,
            arguments: {
              recipientIds: [secondPerson.id],
              subject: "Vision Meeting",
              body: "Please join us.",
            },
            dependsOn: ["create-meeting"],
          },
        ],
      },
      registry: PLAN_FIXTURE_REGISTRY,
      eligibleCapabilities: [
        { identity: MEETING_IDENTITY },
        { identity: SEND_IDENTITY },
      ],
    });
    const planId = randomUUID();
    const expiresAt = new Date(START.valueOf() + 15 * 60 * 1_000);
    const planRequestKey = mintEvryPlanRequestKey();
    const fingerprint = fingerprintEvryActionPlan({
      actorUserId: actor.id,
      plantId: plant.id,
      document,
      expiresAt,
    });
    await db.batch([
      db.insert(evryActionPlans).values({
        id: planId,
        churchId: plant.id,
        actorUserId: actor.id,
        requestKey: planRequestKey,
        intentFingerprint: fingerprintEvryActionPlanIntent({
          actorUserId: actor.id,
          plantId: plant.id,
          document,
        }),
        fingerprint,
        document,
        createdAt: START,
        expiresAt,
      }),
      db.insert(evryActionPlanStates).values({
        planId,
        churchId: plant.id,
        status: "approved",
        version: 1,
        changedAt: START,
      }),
    ]);

    const createRequestKey = randomUUID();
    const clarificationRequestKey = randomUUID();
    const clarificationMessageId = randomUUID();
    const choiceRequestKey = randomUUID();
    const choiceMessageId = randomUUID();
    const choiceId = randomUUID();
    const confirmationRequestKey = randomUUID();
    const confirmationMessageId = randomUUID();
    const common = {
      EVRY_CONVERSATION_PROOF_PLANT_ID: plant.id,
      EVRY_CONVERSATION_PROOF_ACTOR_ID: actor.id,
      EVRY_CONVERSATION_PROOF_PLAN_ID: planId,
      EVRY_CONVERSATION_PROOF_PLAN_FINGERPRINT: fingerprint,
      EVRY_CONVERSATION_PROOF_PERSON_A_ID: firstPerson.id,
      EVRY_CONVERSATION_PROOF_PERSON_B_ID: secondPerson.id,
      EVRY_CONVERSATION_PROOF_CREATE_REQUEST_KEY: createRequestKey,
      EVRY_CONVERSATION_PROOF_CLARIFICATION_REQUEST_KEY:
        clarificationRequestKey,
      EVRY_CONVERSATION_PROOF_CLARIFICATION_MESSAGE_ID: clarificationMessageId,
      EVRY_CONVERSATION_PROOF_CHOICE_REQUEST_KEY: choiceRequestKey,
      EVRY_CONVERSATION_PROOF_CHOICE_MESSAGE_ID: choiceMessageId,
      EVRY_CONVERSATION_PROOF_CHOICE_ID: choiceId,
      EVRY_CONVERSATION_PROOF_CONFIRMATION_REQUEST_KEY: confirmationRequestKey,
      EVRY_CONVERSATION_PROOF_CONFIRMATION_MESSAGE_ID: confirmationMessageId,
    };
    const firstCreate = runWorker("create", common);
    const firstJson = firstCreate
      .trim()
      .split("\n")
      .find((line) => line.startsWith("{"));
    assert.ok(firstJson, firstCreate);
    const conversationId = JSON.parse(firstJson).conversationId as
      | EvryConversationId
      | undefined;
    assert.ok(conversationId);

    const replayCreate = runWorker("create", common);
    assert.match(replayCreate, new RegExp(conversationId));
    const continueRequestKey = randomUUID();
    const resumeEnvironment = {
      ...common,
      EVRY_CONVERSATION_PROOF_CONVERSATION_ID: conversationId,
      EVRY_CONVERSATION_PROOF_CONTINUE_REQUEST_KEY: continueRequestKey,
    };
    const resumed = runWorker("resume", resumeEnvironment);
    assert.match(resumed, /Evry fresh-process resume proof passed/);

    const stored = await findEvryConversationRecord({
      conversationId,
      actorUserId: actor.id,
      plantId: plant.id,
    });
    assert.ok(stored);
    assert.equal(stored.messages.length, 5);
    assert.equal(stored.messages[0]?.body, LITERAL);
    assert.equal(stored.messages[1]?.artifacts.length, 1);
    assert.equal(stored.messages[1]?.artifacts[0]?.kind, "clarification");
    assert.equal(stored.messages[3]?.artifacts[0]?.kind, "confirmation");
    assert.equal(
      stored.state.explicitChoices[0]?.selectedEntityId,
      secondPerson.id
    );
    const changedReferenceState = evryConversationStateDocumentSchema.parse({
      ...stored.state,
      explicitChoices: [],
    });
    await db
      .update(evryConversationStates)
      .set({ document: changedReferenceState })
      .where(eq(evryConversationStates.conversationId, conversationId));
    assert.match(
      runWorker("retry", resumeEnvironment),
      /Evry changed-state replay proof passed/
    );
    const afterChangedReplay = await findEvryConversationRecord({
      conversationId,
      actorUserId: actor.id,
      plantId: plant.id,
    });
    assert.ok(afterChangedReplay);
    assert.equal(afterChangedReplay.messages.length, 5);
    await db
      .update(evryConversationStates)
      .set({ document: stored.state })
      .where(eq(evryConversationStates.conversationId, conversationId));
    assert.equal(
      await findEvryConversationRecord({
        conversationId,
        actorUserId: otherActor.id,
        plantId: plant.id,
      }),
      null
    );
    assert.equal(
      await findEvryConversationRecord({
        conversationId,
        actorUserId: foreignActor.id,
        plantId: otherPlant.id,
      }),
      null
    );
    await assert.rejects(
      () =>
        createEvryConversationRecord({
          actorUserId: actor.id,
          plantId: plant.id,
          requestKey: evryConversationRequestKeySchema.parse(createRequestKey),
          body: "different bytes",
          pageContext: null,
          createdAt: START,
        }),
      EvryConversationIdempotencyError
    );
    await assert.rejects(
      () =>
        createEvryConversationRecord({
          actorUserId: actor.id,
          plantId: plant.id,
          requestKey: evryConversationRequestKeySchema.parse(createRequestKey),
          body: LITERAL,
          pageContext: null,
          createdAt: START,
        }),
      EvryConversationIdempotencyError
    );

    const concurrentRequestKey =
      evryConversationRequestKeySchema.parse(randomUUID());
    const concurrentInput = {
      conversationId,
      actorUserId: actor.id,
      plantId: plant.id,
      requestKey: concurrentRequestKey,
      expectedStateVersion: stored.stateVersion,
      state: stored.state,
      author: "user" as const,
      body: "same concurrent bytes",
      pageContext: null,
      relevanceKeys: [],
      deliveryStatus: "complete" as const,
      artifacts: [],
      idempotencyContext: { status: "none" as const },
      createdAt: new Date("2026-08-28T12:00:01.000Z"),
    };
    const [firstReplay, secondReplay] = await Promise.all([
      appendEvryConversationRecord({
        ...concurrentInput,
        messageId: evryConversationMessageIdSchema.parse(randomUUID()),
      }),
      appendEvryConversationRecord({
        ...concurrentInput,
        messageId: evryConversationMessageIdSchema.parse(randomUUID()),
      }),
    ]);
    assert.equal(firstReplay.messages.length, secondReplay.messages.length);
    assert.equal(
      firstReplay.messages.filter(
        ({ requestKey }) => requestKey === concurrentRequestKey
      ).length,
      1
    );

    const afterConcurrent = await findEvryConversationRecord({
      conversationId,
      actorUserId: actor.id,
      plantId: plant.id,
    });
    assert.ok(afterConcurrent);
    const validChoiceState = afterConcurrent.state;
    const exactChoice = validChoiceState.explicitChoices[0];
    assert.ok(exactChoice);
    await db
      .update(evryConversationStates)
      .set({
        document: {
          ...validChoiceState,
          explicitChoices: [
            { ...exactChoice, clarificationArtifactId: randomUUID() },
          ],
        },
      })
      .where(eq(evryConversationStates.conversationId, conversationId));
    await assert.rejects(
      () =>
        findEvryConversationRecord({
          conversationId,
          actorUserId: actor.id,
          plantId: plant.id,
        }),
      /Stored Evry conversation data is invalid/
    );
    await db
      .update(evryConversationStates)
      .set({ document: validChoiceState })
      .where(eq(evryConversationStates.conversationId, conversationId));

    const [counts] = await db
      .select({
        messages: sql<number>`count(distinct ${evryConversationMessages.id})`,
        artifacts: sql<number>`count(distinct ${evryConversationArtifacts.id})`,
      })
      .from(evryConversationMessages)
      .leftJoin(
        evryConversationArtifacts,
        and(
          eq(evryConversationArtifacts.messageId, evryConversationMessages.id),
          eq(
            evryConversationArtifacts.conversationId,
            evryConversationMessages.conversationId
          )
        )
      )
      .where(eq(evryConversationMessages.conversationId, conversationId));
    assert.deepEqual(
      {
        messages: Number(counts.messages),
        artifacts: Number(counts.artifacts),
      },
      { messages: 6, artifacts: 2 }
    );
  }
);
