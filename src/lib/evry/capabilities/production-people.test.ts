import assert from "node:assert/strict";
import { test } from "node:test";

import generated from "./people/inventory.generated.json";
import { PEOPLE_CORE_REVIEWS } from "./people/core";
import { PEOPLE_FILE_REVIEWS } from "./people/files";
import { HOUSEHOLD_REVIEWS } from "./people/households";
import { MILESTONE_REVIEWS } from "./people/milestones";
import { PEOPLE_EVRY_REVIEWS } from "./people/runtime";
import { TAXONOMY_REVIEWS } from "./people/taxonomies";
import {
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_PLAN_REGISTRY,
  PRODUCTION_EVRY_READ_REGISTRATIONS,
} from "./production";

test("production composes every generated People effect exactly once", () => {
  const effects = generated.capabilities
    .filter(({ operationKind }) => operationKind === "effect")
    .map(({ identity }) => identity);
  assert.equal(effects.length, 30);
  for (const identity of effects) {
    assert.ok(
      PRODUCTION_EVRY_PLAN_REGISTRY.registrationFor(identity),
      identity
    );
    assert.ok(
      PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(identity),
      identity
    );
  }
  const reviews = [
    ...PEOPLE_EVRY_REVIEWS,
    ...PEOPLE_CORE_REVIEWS,
    ...TAXONOMY_REVIEWS,
    ...HOUSEHOLD_REVIEWS,
    ...MILESTONE_REVIEWS,
    ...PEOPLE_FILE_REVIEWS,
  ];
  assert.equal(reviews.length, 30);
  const identities = reviews.flatMap((review) =>
    review.source.kind === "generic"
      ? review.source.capabilityIdentities
      : [review.source.identity]
  );
  assert.deepEqual(identities.toSorted(), effects.toSorted());
});

test("production composes every generated People read exactly once", () => {
  const reads = generated.capabilities
    .filter(({ operationKind }) => operationKind === "read")
    .map(({ identity }) => identity)
    .toSorted();
  assert.equal(reads.length, 22);
  const registrations = PRODUCTION_EVRY_READ_REGISTRATIONS.map(
    ({ capabilityIdentity }) => capabilityIdentity
  ).toSorted();
  assert.equal(new Set(registrations).size, registrations.length);
  assert.deepEqual(registrations, reads);
});
