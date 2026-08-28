import { EVRY_SUPPORTED_CAPABILITIES } from "@/lib/evry/policy/inventory";

import {
  defineEvryCapabilityEvalFixture,
  defineEvryRecipeEvalFixture,
  EVRY_ABSOLUTE_SAFETY_GATES,
  type EvryCapabilityEvalFixture,
  type EvryEvalProof,
  type EvryRecipeEvalFixture,
} from "./contracts";

const MEETING_INVITATION_RECIPE_IDENTITY = "fixture:meeting.invitation";

export const EVRY_EVAL_PROOFS: readonly EvryEvalProof[] = Object.freeze([
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

const PROOF_BY_LAYER = Object.freeze({
  policy: "policy-boundary",
  selection: "capability-selection",
  arguments: "plan-arguments",
  tenancy: "tenant-and-permission",
  permission: "tenant-and-permission",
  confirmation: "exact-plan-confirmation",
  execution: "executor-live",
  idempotency: "executor-core",
  errors: "executor-core",
  ui_artifact: "request-ui-artifact",
} as const);

function proofCase(identity: string, layer: keyof typeof PROOF_BY_LAYER) {
  return Object.freeze({
    id: `${identity}:${layer}`,
    proofId: PROOF_BY_LAYER[layer],
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

/**
 * The generated parity registry is the source of capability-family identities.
 * Every slot points to an executable shared-boundary proof above. The runner
 * executes those files and rejects failures or skips before any provider call.
 */
export const EVRY_CAPABILITY_EVAL_FIXTURES = Object.freeze(
  EVRY_SUPPORTED_CAPABILITIES.map(capabilityFixture)
);

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
