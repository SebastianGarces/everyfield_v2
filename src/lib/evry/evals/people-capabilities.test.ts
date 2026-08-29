import assert from "node:assert/strict";
import { test } from "node:test";

import { PEOPLE_CORE_REVIEWS } from "@/lib/evry/capabilities/people/core";
import { PEOPLE_FILE_REVIEWS } from "@/lib/evry/capabilities/people/files";
import { HOUSEHOLD_REVIEWS } from "@/lib/evry/capabilities/people/households";
import generated from "@/lib/evry/capabilities/people/inventory.generated.json";
import { MILESTONE_REVIEWS } from "@/lib/evry/capabilities/people/milestones";
import { PEOPLE_EVRY_REVIEWS } from "@/lib/evry/capabilities/people/runtime";
import { TAXONOMY_REVIEWS } from "@/lib/evry/capabilities/people/taxonomies";
import {
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_PLAN_REGISTRY,
  PRODUCTION_EVRY_READ_REGISTRATIONS,
  productionEvryPlanTargetIsCurrent,
} from "@/lib/evry/capabilities/production";
import { evryCapabilityRegistrationFor } from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

import { EVRY_CAPABILITY_EVAL_LAYERS } from "./contracts";
import {
  assertPeopleCapabilityEvalRegistryComplete,
  PEOPLE_CAPABILITY_EVAL_FIXTURES,
} from "./people-capabilities";

const ACTOR = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;

const reviewIdentities = [
  ...PEOPLE_EVRY_REVIEWS,
  ...PEOPLE_CORE_REVIEWS,
  ...TAXONOMY_REVIEWS,
  ...HOUSEHOLD_REVIEWS,
  ...MILESTONE_REVIEWS,
  ...PEOPLE_FILE_REVIEWS,
].flatMap((review) =>
  review.source.kind === "generic"
    ? review.source.capabilityIdentities
    : [review.source.identity]
);

test("People eval fixtures are exactly generated and reject an incomplete registry", () => {
  assert.doesNotThrow(() => assertPeopleCapabilityEvalRegistryComplete());
  assert.equal(PEOPLE_CAPABILITY_EVAL_FIXTURES.length, 52);
  assert.throws(() =>
    assertPeopleCapabilityEvalRegistryComplete(
      PEOPLE_CAPABILITY_EVAL_FIXTURES.slice(1)
    )
  );
  const [first, ...rest] = PEOPLE_CAPABILITY_EVAL_FIXTURES;
  assert.ok(first);
  assert.throws(() =>
    assertPeopleCapabilityEvalRegistryComplete([
      {
        ...first,
        cases: { ...first.cases, selection: [] },
      },
      ...rest,
    ])
  );
});

for (const capability of generated.capabilities) {
  const identity = capability.identity;
  for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
    test(`${identity}:${layer}`, async () => {
      const authority = evryCapabilityRegistrationFor(identity);
      const execution =
        PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(identity);
      const plan = PRODUCTION_EVRY_PLAN_REGISTRY.registrationFor(identity);
      const reads = PRODUCTION_EVRY_READ_REGISTRATIONS.filter(
        (read) => read.capabilityIdentity === identity
      );
      const reviews = reviewIdentities.filter((value) => value === identity);

      assert.ok(authority);
      switch (layer) {
        case "policy":
          assert.equal(authority.parityCapability, "people");
          assert.equal(authority.operationKind, capability.operationKind);
          assert.deepEqual(
            [...authority.surfaceIdentities],
            capability.surfaceIdentities
          );
          break;
        case "selection":
          assert.equal(
            reads.length,
            capability.operationKind === "read" ? 1 : 0
          );
          assert.equal(
            Boolean(execution),
            capability.operationKind === "effect"
          );
          break;
        case "arguments":
          if (plan) {
            assert.equal(
              plan.argumentsSchema.safeParse({ unexpected: true }).success,
              false
            );
          } else {
            assert.equal(
              await reads[0]?.execute(
                { literalUserText: "", pageContext: null },
                { unexpected: true }
              ),
              null
            );
          }
          break;
        case "tenancy":
          assert.deepEqual(
            [...authority.surfaceIdentities],
            capability.surfaceIdentities
          );
          assert.ok(
            capability.surfaceIdentities.every((surface) => {
              const entry = generated.entries.find(
                ({ identity: entryIdentity }) => entryIdentity === surface
              );
              return (
                entry?.classification.state === "supported" &&
                entry.capabilityIdentity === identity
              );
            })
          );
          break;
        case "permission":
          assert.equal(
            authority.applicationCapability,
            capability.applicationCapability
          );
          break;
        case "confirmation":
          assert.equal(Boolean(plan), capability.confirmation === "required");
          assert.equal(
            reviews.length,
            capability.operationKind === "effect" ? 1 : 0
          );
          break;
        case "execution":
          assert.equal(
            typeof (execution?.executeIfCurrent ?? reads[0]?.execute),
            "function"
          );
          break;
        case "idempotency":
          if (execution) {
            assert.equal(
              execution.planCapability,
              PRODUCTION_EVRY_PLAN_REGISTRY.registrationFor(identity)
            );
          } else {
            assert.equal(reads.length, 1);
          }
          break;
        case "errors":
          if (plan) {
            assert.equal(
              await productionEvryPlanTargetIsCurrent({
                actor: ACTOR,
                step: {
                  id: "invalid",
                  capabilityIdentity: identity,
                  effectClass: plan.effectClass,
                  arguments: {},
                  dependsOn: [],
                },
              }),
              false
            );
          } else {
            assert.equal(
              await reads[0]?.execute(
                { literalUserText: "", pageContext: null },
                { unexpected: true }
              ),
              null
            );
          }
          break;
        case "ui_artifact":
          assert.equal(
            reviews.length,
            capability.operationKind === "effect" ? 1 : 0
          );
          assert.equal(
            reads.length,
            capability.operationKind === "read" ? 1 : 0
          );
          break;
      }
    });
  }
}
