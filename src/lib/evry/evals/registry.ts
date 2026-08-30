import {
  ADD_GUESTS_IDENTITY,
  CREATE_MEETING_IDENTITY,
  SEND_MESSAGE_IDENTITY,
} from "@/lib/evry/recipes/fixtures.test-helper";
import communicationInventory from "@/lib/evry/capabilities/communication/inventory.generated.json";
import launchInventory from "@/lib/evry/capabilities/launch/inventory.generated.json";
import { MEETINGS_CAPABILITY_EVAL_FIXTURES } from "@/lib/evry/capabilities/meetings/eval-fixtures";
import {
  TASK_CAPABILITY_EVAL_FIXTURES,
  TASK_EVAL_PROOFS,
} from "@/lib/evry/capabilities/tasks/eval-fixtures";

import {
  defineEvryCapabilityEvalFixture,
  defineEvryRecipeEvalFixture,
  EVRY_ABSOLUTE_SAFETY_GATES,
  type EvryCapabilityEvalFixture,
  type EvryCapabilityEvalLayer,
  type EvryEvalProof,
  type EvryRecipeEvalFixture,
} from "./contracts";
import {
  assertPeopleCapabilityEvalRegistryComplete,
  PEOPLE_CAPABILITY_EVAL_FIXTURES,
} from "./people-capabilities";

const MEETING_INVITATION_RECIPE_IDENTITY = "fixture:meeting.invitation";

export const EVRY_EVAL_PROOFS: readonly EvryEvalProof[] = Object.freeze([
  ...TASK_EVAL_PROOFS,
  {
    id: "eval-contracts",
    testFile: "src/lib/evry/evals/contracts.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
  {
    id: "benchmark-integrity",
    testFile: "src/lib/evry/evals/benchmark.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
  {
    id: "policy-fixture-contract",
    testFile: "src/lib/evry/evals/policy/fixtures.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
  {
    id: "candidate-selection",
    testFile: "src/lib/evry/models/selection.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
  {
    id: "reference-capability-contract",
    testFile: "src/lib/evry/evals/reference-capabilities.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
  {
    id: "communication-capability-contract",
    testFile: "src/lib/evry/capabilities/communication/eval-fixtures.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
  {
    id: "people-capability-contract",
    testFile: "src/lib/evry/evals/people-capabilities.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
  {
    id: "meetings-capability-contract",
    testFile: "src/lib/evry/capabilities/meetings/effect-contracts.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
  {
    id: "communication-effect-live",
    testFile: "src/lib/communication/evry-effect-live.test.ts",
    lane: "live_database",
    safetyGates: [],
  },
  {
    id: "people-capability-live-outcomes",
    testFile: "src/lib/people/evry-effect-live.test.ts",
    lane: "live_database",
    safetyGates: ["cross_tenant_access"],
  },
  {
    id: "meetings-selection",
    testFile: "src/lib/evry/capabilities/meetings/selection.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
  {
    id: "launch-capability-contract",
    testFile: "src/lib/evry/capabilities/launch/eval-fixtures.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
  {
    id: "launch-capability-live",
    testFile: "src/lib/evry/capabilities/launch/effect-live.test.ts",
    lane: "live_database",
    safetyGates: [],
  },
  {
    id: "meetings-read-live",
    testFile: "src/lib/evry/capabilities/meetings/read-live.test.ts",
    lane: "live_database",
    safetyGates: ["cross_tenant_access"],
  },
  {
    id: "meetings-effect-live",
    testFile: "src/lib/evry/capabilities/meetings/effect-live.test.ts",
    lane: "live_database",
    safetyGates: ["cross_tenant_access", "unconfirmed_effect"],
  },
  {
    id: "candidate-plan-probe-contract",
    testFile: "src/lib/evry/evals/plan-probe.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
  {
    id: "policy-boundary",
    testFile: "src/lib/evry/policy/core.test.ts",
    lane: "deterministic",
    safetyGates: ["prohibited_tool_access"],
  },
  {
    id: "capability-selection",
    testFile: "src/app/api/evry/requests/route.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
  {
    id: "plan-arguments",
    testFile: "src/lib/evry/plans/schema.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
  {
    id: "tenant-and-permission",
    testFile: "src/lib/evry/eligibility/eligibility.test.ts",
    lane: "deterministic",
    safetyGates: ["cross_tenant_access"],
  },
  {
    id: "exact-plan-confirmation",
    testFile: "src/lib/evry/plans/confirmation-race.test.ts",
    lane: "live_database",
    safetyGates: ["plan_approval_mismatch"],
  },
  {
    id: "executor-live",
    testFile: "src/lib/evry/executor/executor-live.test.ts",
    lane: "live_database",
    safetyGates: [],
  },
  {
    id: "executor-core",
    testFile: "src/lib/evry/executor/core.test.ts",
    lane: "deterministic",
    safetyGates: ["unconfirmed_effect"],
  },
  {
    id: "request-ui-artifact",
    testFile: "src/app/api/evry/requests/route.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
  {
    id: "recipe-end-to-end",
    testFile: "src/lib/evry/recipes/recipe-live.test.ts",
    lane: "live_database",
    safetyGates: [],
  },
  {
    id: "recipe-partial-failure",
    testFile: "src/lib/evry/recipes/runner.test.ts",
    lane: "deterministic",
    safetyGates: [],
  },
]);

function proofCase(identity: string, layer: string) {
  return Object.freeze({
    id: `${identity}:${layer}`,
    proofId: "reference-capability-contract",
    testName: `${identity}:${layer}`,
  });
}

function capabilityFixture(
  capabilityIdentity: string
): EvryCapabilityEvalFixture {
  return defineEvryCapabilityEvalFixture({
    capabilityIdentity,
    cases: {
      policy: [proofCase(capabilityIdentity, "policy")],
      selection: [proofCase(capabilityIdentity, "selection")],
      arguments: [proofCase(capabilityIdentity, "arguments")],
      tenancy: [proofCase(capabilityIdentity, "tenancy")],
      permission: [proofCase(capabilityIdentity, "permission")],
      confirmation: [proofCase(capabilityIdentity, "confirmation")],
      execution: [proofCase(capabilityIdentity, "execution")],
      idempotency: [proofCase(capabilityIdentity, "idempotency")],
      errors: [proofCase(capabilityIdentity, "errors")],
      ui_artifact: [proofCase(capabilityIdentity, "ui_artifact")],
    },
  });
}

const COMMUNICATION_LIVE_EFFECT_LAYERS = new Set<EvryCapabilityEvalLayer>([
  "execution",
  "idempotency",
  "errors",
]);

function communicationProofCase(
  identity: string,
  operationKind: "read" | "effect",
  layer: EvryCapabilityEvalLayer
) {
  const live =
    operationKind === "effect" && COMMUNICATION_LIVE_EFFECT_LAYERS.has(layer);
  return Object.freeze({
    id: `${identity}:${layer}`,
    proofId: live
      ? "communication-effect-live"
      : "communication-capability-contract",
    testName: live ? `${identity}:${layer}:live` : `${identity}:${layer}`,
  });
}

function communicationCapabilityFixture(
  capabilityIdentity: string,
  operationKind: string
): EvryCapabilityEvalFixture {
  if (operationKind !== "read" && operationKind !== "effect") {
    throw new Error(
      `Communication capability ${capabilityIdentity} has an invalid operation kind`
    );
  }
  const evalCase = (layer: EvryCapabilityEvalLayer) => [
    communicationProofCase(capabilityIdentity, operationKind, layer),
  ];
  return defineEvryCapabilityEvalFixture({
    capabilityIdentity,
    cases: {
      policy: evalCase("policy"),
      selection: evalCase("selection"),
      arguments: evalCase("arguments"),
      tenancy: evalCase("tenancy"),
      permission: evalCase("permission"),
      confirmation: evalCase("confirmation"),
      execution: evalCase("execution"),
      idempotency: evalCase("idempotency"),
      errors: evalCase("errors"),
      ui_artifact: evalCase("ui_artifact"),
    },
  });
}

function launchCapabilityFixture(
  capabilityIdentity: string,
  operationKind: string
): EvryCapabilityEvalFixture {
  if (operationKind !== "read" && operationKind !== "effect") {
    throw new Error(
      `Launch capability ${capabilityIdentity} has an invalid operation kind`
    );
  }
  const evalCase = (layer: EvryCapabilityEvalLayer) => {
    // The opt-in PostgreSQL proof executes exact reviewed effects through the
    // production registry. Launch read adapter DB parity is also checked there,
    // but it is not mislabeled as an authenticated registered-read outcome.
    const live =
      operationKind === "effect" && COMMUNICATION_LIVE_EFFECT_LAYERS.has(layer);
    return [
      {
        id: `${capabilityIdentity}:${layer}`,
        proofId: live ? "launch-capability-live" : "launch-capability-contract",
        testName: live
          ? `${capabilityIdentity}:${layer}:live`
          : `${capabilityIdentity}:${layer}`,
      },
    ];
  };
  return defineEvryCapabilityEvalFixture({
    capabilityIdentity,
    cases: {
      policy: evalCase("policy"),
      selection: evalCase("selection"),
      arguments: evalCase("arguments"),
      tenancy: evalCase("tenancy"),
      permission: evalCase("permission"),
      confirmation: evalCase("confirmation"),
      execution: evalCase("execution"),
      idempotency: evalCase("idempotency"),
      errors: evalCase("errors"),
      ui_artifact: evalCase("ui_artifact"),
    },
  });
}

/**
 * Only concrete effect registrations exercised by the reference recipe enter
 * this release corpus. Each slot names its own node:test outcome; shared live
 * framework proofs remain additional release gates, not stand-ins for rows.
 */
export const EVRY_CAPABILITY_EVAL_FIXTURES = Object.freeze([
  ...[CREATE_MEETING_IDENTITY, ADD_GUESTS_IDENTITY, SEND_MESSAGE_IDENTITY]
    .filter(
      (identity) =>
        !communicationInventory.capabilities.some(
          (capability) => capability.identity === identity
        ) &&
        !MEETINGS_CAPABILITY_EVAL_FIXTURES.some(
          (fixture) => fixture.capabilityIdentity === identity
        )
    )
    .map(capabilityFixture),
  ...communicationInventory.capabilities.map(({ identity, operationKind }) =>
    communicationCapabilityFixture(identity, operationKind)
  ),
  ...launchInventory.capabilities.map(({ identity, operationKind }) =>
    launchCapabilityFixture(identity, operationKind)
  ),
  ...MEETINGS_CAPABILITY_EVAL_FIXTURES,
  ...PEOPLE_CAPABILITY_EVAL_FIXTURES,
  ...TASK_CAPABILITY_EVAL_FIXTURES,
]);

export const EVRY_RECIPE_EVAL_FIXTURES: readonly EvryRecipeEvalFixture[] =
  Object.freeze([
    defineEvryRecipeEvalFixture({
      recipeIdentity: MEETING_INVITATION_RECIPE_IDENTITY,
      cases: {
        end_to_end: [
          {
            id: `${MEETING_INVITATION_RECIPE_IDENTITY}:end_to_end`,
            proofId: "recipe-end-to-end",
          },
        ],
        partial_failure: [
          {
            id: `${MEETING_INVITATION_RECIPE_IDENTITY}:partial_failure`,
            proofId: "recipe-partial-failure",
          },
        ],
      },
    }),
  ]);

function assertUnique(values: readonly string[], subject: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Duplicate Evry ${subject} eval fixture`);
  }
}

export function assertEvryEvalRegistryComplete(): void {
  assertPeopleCapabilityEvalRegistryComplete();
  assertUnique(
    EVRY_EVAL_PROOFS.map(({ id }) => id),
    "proof"
  );
  const proofIds = new Set(EVRY_EVAL_PROOFS.map(({ id }) => id));
  const safetyGates = new Set(
    EVRY_EVAL_PROOFS.flatMap(({ safetyGates: gates }) => gates)
  );
  for (const gate of EVRY_ABSOLUTE_SAFETY_GATES) {
    if (!safetyGates.has(gate)) {
      throw new Error(`Evry safety gate ${gate} has no executable proof`);
    }
  }
  assertUnique(
    EVRY_CAPABILITY_EVAL_FIXTURES.map(({ capabilityIdentity }) =>
      capabilityIdentity.toString()
    ),
    "capability"
  );
  assertUnique(
    EVRY_RECIPE_EVAL_FIXTURES.map(({ recipeIdentity }) => recipeIdentity),
    "recipe"
  );
  for (const fixture of EVRY_CAPABILITY_EVAL_FIXTURES) {
    defineEvryCapabilityEvalFixture(fixture);
    for (const cases of Object.values(fixture.cases)) {
      for (const evalCase of cases) {
        if (!proofIds.has(evalCase.proofId)) {
          throw new Error(`Unknown Evry eval proof ${evalCase.proofId}`);
        }
      }
    }
  }
  for (const fixture of EVRY_RECIPE_EVAL_FIXTURES) {
    defineEvryRecipeEvalFixture(fixture);
    for (const cases of Object.values(fixture.cases)) {
      for (const evalCase of cases) {
        if (!proofIds.has(evalCase.proofId)) {
          throw new Error(`Unknown Evry eval proof ${evalCase.proofId}`);
        }
      }
    }
  }
}
