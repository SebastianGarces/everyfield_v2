import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";

import {
  ELIGIBLE_FIXTURE_CAPABILITIES,
  fixtureCandidate,
  fixtureDocument,
  MEETING_IDENTITY,
  PLAN_FIXTURE_REGISTRY,
} from "./fixtures.test-helper";
import {
  createEvryPlanCapabilityRegistry,
  defineEvryPlanCapability,
} from "./registry";
import {
  EvryPlanValidationError,
  parseEvryActionPlanCandidate,
  parseStoredEvryActionPlan,
} from "./schema";

function candidate(): {
  steps: Array<{
    id: string;
    capabilityIdentity: string;
    arguments: Record<string, unknown>;
    dependsOn: string[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
} {
  return structuredClone(fixtureCandidate()) as ReturnType<typeof candidate>;
}

function rejectsPlan(value: unknown, pattern: RegExp): void {
  assert.throws(
    () =>
      parseEvryActionPlanCandidate({
        candidate: value,
        registry: PLAN_FIXTURE_REGISTRY,
        eligibleCapabilities: ELIGIBLE_FIXTURE_CAPABILITIES,
      }),
    (error: unknown) => {
      assert.ok(error instanceof EvryPlanValidationError);
      assert.match(error.message, pattern);
      return true;
    }
  );
}

test("a closed eligible DAG becomes an immutable stored document", () => {
  const document = fixtureDocument();

  assert.equal(document.version, 1);
  assert.deepEqual(
    document.steps.map(({ id, effectClass }) => ({ id, effectClass })),
    [
      { id: "create-meeting", effectClass: "database_write" },
      {
        id: "send-invitation",
        effectClass: "outbound_communication",
      },
    ]
  );
  assert.equal(Object.isFrozen(document), true);
  assert.equal(Object.isFrozen(document.steps[0].arguments), true);
});

test("the plan, step, and capability argument boundaries are strict", () => {
  const openPlan = candidate();
  openPlan.override = true;
  rejectsPlan(openPlan, /invalid shape/);

  const openStep = candidate();
  openStep.steps[0].effectClass = "database_write";
  rejectsPlan(openStep, /invalid shape/);

  const openArguments = candidate();
  openArguments.steps[0].arguments.administrativeOverride = true;
  rejectsPlan(openArguments, /invalid arguments/);

  for (const trustedOnly of [
    { recipe: { identity: "forged", safeRetryStepIds: [] } },
    { confirmation: { title: "Forged", actionLabel: "Bypass review" } },
  ]) {
    const forgedPlan = candidate();
    Object.assign(forgedPlan, trustedOnly);
    rejectsPlan(forgedPlan, /invalid shape/);
  }

  const forgedDisclosure = candidate();
  forgedDisclosure.steps[0].disclosure = {
    title: "Forged",
    items: [{ label: "Target", value: "hidden" }],
    consequences: [],
  };
  rejectsPlan(forgedDisclosure, /invalid shape/);
});

test("unknown and ineligible capabilities are unavailable", () => {
  const unknown = candidate();
  unknown.steps[0].capabilityIdentity = "fixture:unknown";
  rejectsPlan(unknown, /unavailable/);

  assert.throws(
    () =>
      parseEvryActionPlanCandidate({
        candidate: candidate(),
        registry: PLAN_FIXTURE_REGISTRY,
        eligibleCapabilities: [{ identity: MEETING_IDENTITY }],
      }),
    /unavailable/
  );
});

test("dependencies reject duplicates, missing ids, self-edges, and cycles", () => {
  const duplicateStep = candidate();
  duplicateStep.steps[1].id = duplicateStep.steps[0].id;
  rejectsPlan(duplicateStep, /Duplicate/);

  const duplicateDependency = candidate();
  duplicateDependency.steps[1].dependsOn.push("create-meeting");
  rejectsPlan(duplicateDependency, /repeats a dependency/);

  const missing = candidate();
  missing.steps[1].dependsOn = ["missing"];
  rejectsPlan(missing, /unknown step/);

  const self = candidate();
  self.steps[0].dependsOn = ["create-meeting"];
  rejectsPlan(self, /depends on itself/);

  const cycle = candidate();
  cycle.steps[0].dependsOn = ["send-invitation"];
  rejectsPlan(cycle, /cycle/);
});

test("stored plans revalidate capability, effect class, arguments, and graph", () => {
  const stored = structuredClone(fixtureDocument()) as unknown as {
    version: 1;
    steps: Array<{
      id: string;
      capabilityIdentity: string;
      effectClass: string;
      arguments: Record<string, unknown>;
      dependsOn: string[];
    }>;
  };

  stored.steps[0].effectClass = "filesystem";
  assert.throws(
    () =>
      parseStoredEvryActionPlan({
        document: stored,
        registry: PLAN_FIXTURE_REGISTRY,
      }),
    /invalid shape/
  );

  stored.steps[0].effectClass = "outbound_communication";
  assert.throws(
    () =>
      parseStoredEvryActionPlan({
        document: stored,
        registry: PLAN_FIXTURE_REGISTRY,
      }),
    /effect class changed/
  );

  stored.steps[0].effectClass = "database_write";
  stored.steps[0].arguments.extra = true;
  assert.throws(
    () =>
      parseStoredEvryActionPlan({
        document: stored,
        registry: PLAN_FIXTURE_REGISTRY,
      }),
    /arguments changed/
  );
});

test("stored plans rebuild arguments from trusted parser output", () => {
  const registry = createEvryPlanCapabilityRegistry([
    defineEvryPlanCapability({
      identity: "fixture:normalized",
      effectClass: "database_write",
      arguments: {
        label: z.string().transform((value) => value.trim()),
        retries: z.number().int().default(1),
      },
    }),
  ]);

  const parsed = parseStoredEvryActionPlan({
    registry,
    document: {
      version: 1,
      steps: [
        {
          id: "normalized",
          capabilityIdentity: "fixture:normalized",
          effectClass: "database_write",
          arguments: { label: "  lasting effect  " },
          dependsOn: [],
        },
      ],
    },
  });

  assert.deepEqual(parsed.steps[0].arguments, {
    label: "lasting effect",
    retries: 1,
  });
});

test("stored disclosure is closed to registered recipes and complete effects", () => {
  const stored = structuredClone(fixtureDocument()) as unknown as {
    recipe?: {
      identity: string;
      preconditionIdentities: string[];
      safeRetryStepIds: string[];
    };
    confirmation?: { title: string; actionLabel: string };
    steps: Array<{
      disclosure?: {
        title: string;
        items: Array<{ label: string; value: string }>;
        consequences: string[];
      };
    }>;
  };
  stored.steps[0].disclosure = {
    title: "Create meeting",
    items: [{ label: "Target", value: "Meeting" }],
    consequences: ["Creates one meeting."],
  };
  assert.throws(
    () =>
      parseStoredEvryActionPlan({
        document: stored,
        registry: PLAN_FIXTURE_REGISTRY,
      }),
    /Only a registered Evry recipe/
  );

  stored.recipe = {
    identity: "fixture:closed",
    preconditionIdentities: [],
    safeRetryStepIds: [],
  };
  stored.confirmation = { title: "Fixture", actionLabel: "Continue" };
  assert.throws(
    () =>
      parseStoredEvryActionPlan({
        document: stored,
        registry: PLAN_FIXTURE_REGISTRY,
      }),
    /Every Evry recipe effect requires confirmation disclosure/
  );
});
