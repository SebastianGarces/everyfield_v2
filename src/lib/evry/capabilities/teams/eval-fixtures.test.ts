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
import { executeTeamsEffect } from "./atomic-effect";
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
  arguments_: Record<string, unknown>
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
      plantId: FOREIGN_PLANT,
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
      capability.operationKind === "read" ? "read" : "teams.write"
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
      capability.operationKind === "read"
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
