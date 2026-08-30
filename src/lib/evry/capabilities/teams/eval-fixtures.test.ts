import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

import teamsInventory from "./inventory.generated.json";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import {
  eligibleEvryCapabilitiesFor,
  evryCapabilityRegistrationFor,
  type EvryEffectCapabilityAuthorization,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryEffectInput } from "@/lib/evry/executor";
import {
  EVRY_CAPABILITY_EVAL_LAYERS,
  type EvryCapabilityEvalLayer,
} from "@/lib/evry/evals/contracts";
import { TEAMS_CAPABILITY_REGISTRATIONS } from "./registrations";
import { TEAMS_EVAL_FIXTURES } from "./eval-fixtures";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";
import { parseTeamsEffectArguments } from "./effect-contracts";
import {
  executeTeamsEffect,
  reconcileClaimedTeamsEffect,
} from "./atomic-effect";
import {
  TEAMS_EXECUTION_REGISTRY,
  TEAMS_PLAN_REGISTRY,
  TEAMS_REVIEW_REGISTRY,
} from "./runtime";
import { selectTeamsEvryRequest, TEAMS_EFFECT_COMMANDS } from "./selection";

const ACTOR = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const MEMBER_ACTOR = { ...ACTOR, seat: "member" } as unknown as EvryPlantActor;
const FOREIGN_PLANT = "20000000-0000-4000-8000-000000000099";

type ReadOutcome = Readonly<{
  arguments: boolean;
  tenancy: boolean;
  confirmation: boolean;
  execution: boolean;
  idempotency: boolean;
  errors: boolean;
  uiArtifact: boolean;
}>;

let cachedReadOutcomes: Readonly<Record<string, ReadOutcome>> | null = null;

function readOutcomes(): Readonly<Record<string, ReadOutcome>> {
  if (cachedReadOutcomes) return cachedReadOutcomes;
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      path.join(
        process.cwd(),
        "src/lib/evry/capabilities/teams/eval-read-proof.ts"
      ),
    ],
    { cwd: process.cwd(), encoding: "utf8", env: process.env, timeout: 60_000 }
  );
  assert.equal(
    proof.status,
    0,
    `Teams read proof failed\nerror: ${proof.error?.message ?? "none"}\nsignal: ${proof.signal ?? "none"}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
  );
  const encoded = /^EVRY_TEAMS_READ_OUTCOMES=(.+)$/m.exec(proof.stdout)?.[1];
  assert.ok(encoded, "Teams read proof returned no outcomes");
  cachedReadOutcomes = JSON.parse(encoded) as Readonly<
    Record<string, ReadOutcome>
  >;
  return cachedReadOutcomes;
}

const READ_SELECTIONS: Readonly<Record<string, string>> = {
  "teams.read.list": "list ministry teams",
  "teams.read.detail":
    "review ministry team 20000000-0000-4000-8000-000000000001",
  "teams.read.health": "review team health",
  "teams.read.training":
    "review ministry team 20000000-0000-4000-8000-000000000001 training",
  "teams.read.meetings":
    "review ministry team 20000000-0000-4000-8000-000000000001 meetings",
  "teams.read.responsibilities":
    "review ministry team 20000000-0000-4000-8000-000000000001 responsibilities",
  "teams.read.candidates": "search team candidates | Ada",
  "teams.read.person-assignments":
    "review ministry team assignments for person 40000000-0000-4000-8000-000000000001",
  "teams.read.person-training":
    "review ministry training for person 40000000-0000-4000-8000-000000000001",
};

function selectionFor(identity: string) {
  const read = READ_SELECTIONS[identity];
  if (read) return selectTeamsEvryRequest(read);
  const fixture = TEAMS_EVAL_FIXTURES.find(
    (candidate) => candidate.identity === identity
  );
  assert.ok(fixture);
  const command = Object.entries(TEAMS_EFFECT_COMMANDS).find(
    ([, operation]) => operation === fixture.operation
  )?.[0];
  assert.ok(command);
  return selectTeamsEvryRequest(`teams ${command}`);
}

function effectInput(
  identity: string,
  arguments_: Record<string, unknown>,
  executionPlantId: string = FOREIGN_PLANT
): EvryEffectInput {
  const registration = evryCapabilityRegistrationFor(identity);
  assert.ok(registration?.operationKind === "effect");
  return {
    authorization: {
      actor: ACTOR,
      registration,
    } as unknown as EvryEffectCapabilityAuthorization,
    effectKey: "teams-fixture-effect-key",
    execution: {
      attemptId: "30000000-0000-4000-8000-000000000001",
      planId: "40000000-0000-4000-8000-000000000001",
      actorUserId: ACTOR.userId,
      plantId: executionPlantId,
      fingerprint: "a".repeat(64),
      correlationId: "50000000-0000-4000-8000-000000000001",
      stepId: "teams-fixture-step",
      capabilityIdentity: identity,
    },
    arguments: arguments_,
  } as unknown as EvryEffectInput;
}

function confirmationFor(identity: string) {
  const fixture = TEAMS_EVAL_FIXTURES.find(
    (candidate) => candidate.identity === identity
  );
  assert.ok(fixture);
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: fixture.identity,
          capabilityIdentity: fixture.identity,
          arguments: fixture.arguments,
          dependsOn: [],
        },
      ],
    },
    registry: TEAMS_PLAN_REGISTRY,
    eligibleCapabilities: TEAMS_CAPABILITY_REGISTRATIONS,
  });
  return trustedReviewForEvryPlanDocument({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: "00000000-0000-4000-8000-000000000010",
      fingerprint: "0".repeat(64),
    }),
    document,
    reviewRegistry: TEAMS_REVIEW_REGISTRY,
  });
}

async function exercise(identity: string, layer: EvryCapabilityEvalLayer) {
  const capability = teamsInventory.capabilities.find(
    (candidate) => candidate.identity === identity
  );
  assert.ok(capability);
  const registration = evryCapabilityRegistrationFor(identity);
  assert.ok(registration);
  if (layer === "policy") {
    assert.equal(registration.parityCapability, "teams");
    assert.equal(
      registration.applicationCapability,
      capability.applicationCapability
    );
    return;
  }
  if (layer === "selection") {
    assert.ok(selectionFor(identity));
    assert.deepEqual(selectionFor(identity), selectionFor(identity));
    return;
  }
  if (layer === "permission") {
    assert.equal(
      eligibleEvryCapabilitiesFor(ACTOR).some(
        (candidate) => candidate.identity === identity
      ),
      true
    );
    assert.equal(
      eligibleEvryCapabilitiesFor(MEMBER_ACTOR).some(
        (candidate) => candidate.identity === identity
      ),
      capability.applicationCapability === "read"
    );
    return;
  }
  if (capability.operationKind === "read") {
    const outcome = readOutcomes()[identity];
    assert.ok(outcome);
    const key = layer === "ui_artifact" ? "uiArtifact" : layer;
    assert.equal(outcome[key as keyof ReadOutcome], true);
    if (layer === "confirmation")
      assert.equal(TEAMS_EXECUTION_REGISTRY.registrationFor(identity), null);
    return;
  }
  const fixture = TEAMS_EVAL_FIXTURES.find(
    (candidate) => candidate.identity === identity
  );
  assert.ok(fixture);
  if (layer === "arguments") {
    assert.deepEqual(
      parseTeamsEffectArguments(fixture.operation, fixture.arguments),
      fixture.arguments
    );
    assert.throws(() =>
      parseTeamsEffectArguments(fixture.operation, fixture.failureArguments)
    );
    return;
  }
  if (layer === "tenancy") {
    assert.deepEqual(
      await executeTeamsEffect(effectInput(identity, fixture.arguments)),
      { status: "refused", excludedCount: 1 }
    );
    return;
  }
  if (layer === "execution") {
    assert.ok(TEAMS_EXECUTION_REGISTRY.registrationFor(identity));
    return;
  }
  if (layer === "idempotency") {
    const input = effectInput(identity, fixture.arguments);
    assert.deepEqual(
      await executeTeamsEffect(input),
      await executeTeamsEffect(input)
    );
    return;
  }
  if (layer === "errors") {
    assert.throws(() =>
      parseTeamsEffectArguments(fixture.operation, fixture.failureArguments)
    );
    return;
  }
  assert.ok(confirmationFor(identity));
}

test("every Teams effect has argument, confirmation, execution, idempotency, and failure fixtures", () => {
  assert.equal(TEAMS_EVAL_FIXTURES.length, 19);
  for (const fixture of TEAMS_EVAL_FIXTURES) {
    assert.deepEqual(
      parseTeamsEffectArguments(fixture.operation, fixture.arguments),
      fixture.arguments
    );
    assert.throws(() =>
      parseTeamsEffectArguments(fixture.operation, fixture.failureArguments)
    );
    const document = parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: fixture.identity,
            capabilityIdentity: fixture.identity,
            arguments: fixture.arguments,
            dependsOn: [],
          },
        ],
      },
      registry: TEAMS_PLAN_REGISTRY,
      eligibleCapabilities: TEAMS_CAPABILITY_REGISTRATIONS,
    });
    const review = trustedReviewForEvryPlanDocument({
      plan: evryConversationPlanIdentitySchema.parse({
        planId: "00000000-0000-4000-8000-000000000010",
        fingerprint: "0".repeat(64),
      }),
      document,
      reviewRegistry: TEAMS_REVIEW_REGISTRY,
    });
    assert.ok(review, `confirmation: ${fixture.identity}`);
    assert.ok(
      TEAMS_EXECUTION_REGISTRY.registrationFor(fixture.identity),
      `execution: ${fixture.identity}`
    );
    assert.match(
      review.confirmation.steps[0]!.contentPreviews.map(
        ({ content }) => content
      ).join(""),
      /operation/
    );
  }
});

test("operation contracts reject a mutation from another Teams domain", () => {
  const fixture = TEAMS_EVAL_FIXTURES.find(
    ({ operation }) => operation === "createTeamAction"
  )!;
  assert.throws(() =>
    parseTeamsEffectArguments("createTeamAction", {
      ...fixture.arguments,
      mutations: [
        {
          table: "training_programs",
          id: "00000000-0000-4000-8000-000000000002",
          mode: "insert",
          before: null,
          after: {
            id: "00000000-0000-4000-8000-000000000002",
            church_id: "00000000-0000-4000-8000-000000000001",
          },
        },
      ],
      expected: [
        {
          table: "training_programs",
          id: "00000000-0000-4000-8000-000000000002",
          state: null,
        },
      ],
    })
  );
});

test("full literal meeting notification intent is disclosed while raw F11 rows stay outside the mutation contract", () => {
  const fixture = TEAMS_EVAL_FIXTURES.find(
    ({ operation }) => operation === "createMeetingAction"
  )!;
  const meetingId = fixture.arguments.mutations[0]!.id;
  const churchId = String(fixture.arguments.mutations[0]!.after!.church_id);
  const literal = {
    churchId,
    recipientUserId: "00000000-0000-4000-8000-000000000004",
    category: "meetings" as const,
    type: "meeting.scheduled",
    title: "Scheduled: Literal Team Meeting",
    body: "Literal Team Meeting is on Jan 2, 2030 at 1:00 PM.",
    entityType: "meeting" as const,
    entityId: meetingId,
    dedupeKey: `meeting.scheduled:${meetingId}`,
    scheduledFor: "2030-01-01T00:00:00.000Z",
  };
  const arguments_ = parseTeamsEffectArguments("createMeetingAction", {
    ...fixture.arguments,
    notificationIntents: [literal],
  });
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: fixture.identity,
          capabilityIdentity: fixture.identity,
          arguments: arguments_,
          dependsOn: [],
        },
      ],
    },
    registry: TEAMS_PLAN_REGISTRY,
    eligibleCapabilities: TEAMS_CAPABILITY_REGISTRATIONS,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: "00000000-0000-4000-8000-000000000010",
      fingerprint: "0".repeat(64),
    }),
    document,
    reviewRegistry: TEAMS_REVIEW_REGISTRY,
  });
  assert.ok(review);
  const preview = review.confirmation.steps[0]!.contentPreviews.map(
    ({ content }) => content
  ).join("");
  assert.equal(preview, JSON.stringify(arguments_));
  for (const value of [
    literal.category,
    literal.type,
    literal.title,
    literal.body,
    literal.entityType,
    literal.entityId,
    literal.dedupeKey,
    literal.scheduledFor,
    literal.recipientUserId,
  ]) {
    assert.ok(preview.includes(value), `preview binds ${value}`);
  }
  assert.throws(() =>
    parseTeamsEffectArguments("createMeetingAction", {
      ...arguments_,
      expected: [
        ...fixture.arguments.expected,
        {
          table: "notifications",
          id: "00000000-0000-4000-8000-000000000003",
          state: null,
        },
      ],
      mutations: [
        ...fixture.arguments.mutations,
        {
          table: "notifications",
          id: "00000000-0000-4000-8000-000000000003",
          mode: "insert",
          before: null,
          after: {
            id: "00000000-0000-4000-8000-000000000003",
            church_id: ACTOR.plantId,
          },
        },
      ],
    })
  );
});

test("deployment copy or dedupe drift refuses before the durable meeting claim", async () => {
  const fixture = TEAMS_EVAL_FIXTURES.find(
    ({ operation }) => operation === "createMeetingAction"
  )!;
  const meetingId = fixture.arguments.mutations[0]!.id;
  const intent = {
    churchId: ACTOR.plantId,
    recipientUserId: "30000000-0000-4000-8000-000000000004",
    category: "meetings" as const,
    type: "meeting.scheduled",
    title: "Scheduled: Confirmed Team Meeting",
    body: "Confirmed Team Meeting is on Jan 2, 2030 at 1:00 PM.",
    entityType: "meeting" as const,
    entityId: meetingId,
    dedupeKey: `meeting.scheduled:${meetingId}`,
    scheduledFor: "2030-01-01T00:00:00.000Z",
  };
  const arguments_ = parseTeamsEffectArguments("createMeetingAction", {
    ...fixture.arguments,
    mutations: fixture.arguments.mutations.map((mutation) => ({
      ...mutation,
      after: mutation.after
        ? { ...mutation.after, church_id: ACTOR.plantId }
        : null,
    })),
    notificationIntents: [intent],
  });
  const input = effectInput(fixture.identity, arguments_, ACTOR.plantId);
  for (const drift of [
    { title: "Scheduled: Changed After Confirmation" },
    { dedupeKey: `${intent.dedupeKey}:v2` },
  ]) {
    let durableCalls = 0;
    const result = await executeTeamsEffect(input, {
      findCompletedOutcome: async () => null,
      composeMeetingNotificationIntents: () => [
        {
          ...intent,
          ...drift,
          scheduledFor: new Date(intent.scheduledFor),
        },
      ],
      executeStatement: async () => {
        durableCalls += 1;
        return { status: "completed", affectedCount: 1, excludedCount: 0 };
      },
    });
    assert.deepEqual(result, { status: "refused", excludedCount: 1 });
    assert.equal(durableCalls, 0);
  }
});

test("unknown execution failures stay retryable while proved races and replays close", async () => {
  const fixture = TEAMS_EVAL_FIXTURES.find(
    ({ operation }) => operation === "createTeamAction"
  )!;
  const input = effectInput(fixture.identity, fixture.arguments, ACTOR.plantId);
  const transport = new Error("connection disappeared");
  assert.deepEqual(
    await executeTeamsEffect(input, {
      findCompletedOutcome: async () => null,
      executeStatement: async () => {
        throw transport;
      },
    }),
    { status: "retryable" }
  );

  let completedReads = 0;
  assert.deepEqual(
    await executeTeamsEffect(input, {
      findCompletedOutcome: async () =>
        ++completedReads === 1
          ? null
          : { status: "completed", affectedCount: 1, excludedCount: 0 },
      executeStatement: async () => {
        throw transport;
      },
    }),
    { status: "completed", affectedCount: 1, excludedCount: 0 }
  );

  let attempts = 0;
  assert.deepEqual(
    await executeTeamsEffect(input, {
      findCompletedOutcome: async () => null,
      executeStatement: async () => {
        attempts += 1;
        if (attempts === 1)
          throw Object.assign(new Error("serialization"), { code: "40001" });
        return { status: "refused", excludedCount: 1 };
      },
    }),
    { status: "refused", excludedCount: 1 }
  );
  assert.equal(attempts, 2);
});

test("a completed meeting effect remains retryable until confirmed F11 intents converge", async () => {
  const fixture = TEAMS_EVAL_FIXTURES.find(
    ({ operation }) => operation === "createMeetingAction"
  )!;
  const input = effectInput(fixture.identity, fixture.arguments, ACTOR.plantId);
  const syncCalls: string[] = [];
  const reconcile = async (churchId: string, meetingId: string) => {
    syncCalls.push(`${churchId}:${meetingId}`);
    throw new Error("best-effort F11 outage");
  };
  const completed = {
    status: "completed" as const,
    affectedCount: 1,
    excludedCount: 0,
  };

  assert.deepEqual(
    await executeTeamsEffect(input, {
      findCompletedOutcome: async () => null,
      executeStatement: async () => completed,
      composeMeetingNotificationIntents: () => [],
      reconcileMeetingNotifications: reconcile,
    }),
    { status: "retryable" },
    "a notification failure must prevent a terminal execution outcome"
  );
  assert.deepEqual(
    await executeTeamsEffect(input, {
      findCompletedOutcome: async () => completed,
      executeStatement: async () => {
        throw new Error("the durable statement must not repeat");
      },
      reconcileMeetingNotifications: reconcile,
    }),
    { status: "retryable" },
    "claim recovery must remain open while an owed notification still fails"
  );
  assert.deepEqual(syncCalls, [
    `${ACTOR.plantId}:00000000-0000-4000-8000-000000000002`,
    `${ACTOR.plantId}:00000000-0000-4000-8000-000000000002`,
  ]);
});

test("a durable Teams claim reconciles before current authority is consulted", async () => {
  const fixture = TEAMS_EVAL_FIXTURES.find(
    ({ operation }) => operation === "createMeetingAction"
  )!;
  const authorized = effectInput(
    fixture.identity,
    fixture.arguments,
    ACTOR.plantId
  );
  const claimed = {
    effectKey: authorized.effectKey,
    execution: authorized.execution,
    arguments: authorized.arguments,
  };
  const completed = {
    status: "completed" as const,
    affectedCount: 2,
    excludedCount: 0,
  };
  let reconciliations = 0;

  assert.deepEqual(
    await reconcileClaimedTeamsEffect(claimed, {
      findCompletedOutcome: async () => completed,
      reconcileMeetingNotifications: async () => {
        reconciliations += 1;
        return {
          considered: 0,
          recorded: 0,
          created: 0,
          skipped: 0,
          failed: 0,
          cancelled: 0,
          reason: null,
        };
      },
    }),
    completed
  );
  assert.equal(reconciliations, 1);
  assert.equal("authorization" in claimed, false);
  assert.deepEqual(
    await reconcileClaimedTeamsEffect(claimed, {
      findCompletedOutcome: async () => {
        throw new Error("claim store unavailable");
      },
    }),
    { status: "retryable" }
  );
});

test("a process interruption after the domain claim escapes before reconciliation or terminal step", async () => {
  const fixture = TEAMS_EVAL_FIXTURES.find(
    ({ operation }) => operation === "createMeetingAction"
  )!;
  const input = effectInput(fixture.identity, fixture.arguments, ACTOR.plantId);
  let reconciliations = 0;
  await assert.rejects(
    executeTeamsEffect(input, {
      findCompletedOutcome: async () => null,
      composeMeetingNotificationIntents: () => [],
      executeStatement: async () => ({
        status: "completed",
        affectedCount: 2,
        excludedCount: 0,
      }),
      afterDurableCommit: () => {
        throw new Error("simulated process interruption");
      },
      reconcileMeetingNotifications: async () => {
        reconciliations += 1;
        throw new Error("must remain unreachable");
      },
    }),
    /simulated process interruption/
  );
  assert.equal(reconciliations, 0);
});

test("a legal roster above two thousand rows compiles with bounded browser disclosure", () => {
  const rows = Array.from({ length: 2_001 }, (_, index) => {
    const id = `00000000-0000-4000-8000-${(index + 10).toString(16).padStart(12, "0")}`;
    return {
      table: "ministry_teams" as const,
      id,
      mode: "insert" as const,
      before: null,
      after: {
        id,
        church_id: "00000000-0000-4000-8000-000000000001",
        name: `Team ${index + 1}`,
      },
    };
  });
  const arguments_ = parseTeamsEffectArguments("initializeTeamsAction", {
    operation: "initializeTeamsAction",
    expected: rows.map(({ table, id }) => ({ table, id, state: null })),
    sets: [],
    mutations: rows,
    notificationIntents: [],
    disclosure: {
      title: "Initialize every legal team row",
      targets: [{ label: "Plant", value: "Exact plant", href: "/teams" }],
      counts: [{ label: "Teams", count: rows.length }],
      changes: [],
      consequences: ["Creates the exact confirmed set."],
      reversibility: "reversible",
      dateTime: null,
    },
  });
  assert.equal(arguments_.mutations.length, 2_001);
  const fixture = TEAMS_EVAL_FIXTURES.find(
    ({ operation }) => operation === "initializeTeamsAction"
  )!;
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: fixture.identity,
          capabilityIdentity: fixture.identity,
          arguments: arguments_,
          dependsOn: [],
        },
      ],
    },
    registry: TEAMS_PLAN_REGISTRY,
    eligibleCapabilities: TEAMS_CAPABILITY_REGISTRATIONS,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: "00000000-0000-4000-8000-000000000010",
      fingerprint: "0".repeat(64),
    }),
    document,
    reviewRegistry: TEAMS_REVIEW_REGISTRY,
  });
  assert.ok(review);
  const previews = review.confirmation.steps[0]!.contentPreviews;
  assert.ok(previews.length <= 64);
  assert.match(previews[0]!.label, /manifest/i);
  assert.match(previews[0]!.content, /"mutationRows":2001/);
  assert.match(previews[0]!.content, /"sha256":"[0-9a-f]{64}"/);
});

test("multi-row and giant-grapheme plans remain reviewable and lossless", () => {
  const fixture = TEAMS_EVAL_FIXTURES.find(
    ({ operation }) => operation === "assignMemberAction"
  )!;
  const personId = "00000000-0000-4000-8000-000000000003";
  const giant = `family ${"👨‍👩‍👧‍👦".repeat(2_000)} e${"\u0301".repeat(2_000)}`;
  const personBefore = {
    id: personId,
    church_id: "00000000-0000-4000-8000-000000000001",
    biography: giant,
  };
  const personAfter = { ...personBefore, status: "launch_team" };
  const arguments_ = parseTeamsEffectArguments("assignMemberAction", {
    ...fixture.arguments,
    expected: [
      ...fixture.arguments.expected,
      { table: "persons", id: personId, state: personBefore },
    ],
    mutations: [
      ...fixture.arguments.mutations,
      {
        table: "persons",
        id: personId,
        mode: "update",
        before: personBefore,
        after: personAfter,
      },
    ],
    disclosure: {
      ...fixture.arguments.disclosure,
      counts: [{ label: "Rows", count: 2 }],
      changes: [
        ...fixture.arguments.disclosure.changes,
        {
          label: "Person",
          before: JSON.stringify(personBefore),
          after: JSON.stringify(personAfter),
        },
      ],
    },
  });
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: fixture.identity,
          capabilityIdentity: fixture.identity,
          arguments: arguments_,
          dependsOn: [],
        },
      ],
    },
    registry: TEAMS_PLAN_REGISTRY,
    eligibleCapabilities: TEAMS_CAPABILITY_REGISTRATIONS,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: "00000000-0000-4000-8000-000000000010",
      fingerprint: "0".repeat(64),
    }),
    document,
    reviewRegistry: TEAMS_REVIEW_REGISTRY,
  });
  assert.ok(review);
  const step = review.confirmation.steps[0]!;
  assert.equal(step.effectKind, "bulk_change");
  assert.equal(step.beforeAfter[0]?.count, 2);
  assert.ok(
    step.contentPreviews.every(({ content }) => content.length <= 4_000)
  );
  assert.equal(
    step.contentPreviews.map(({ content }) => content).join(""),
    JSON.stringify(arguments_)
  );
});

for (const { identity } of teamsInventory.capabilities) {
  for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
    test(`${identity}:${layer}`, () => exercise(identity, layer));
  }
}
