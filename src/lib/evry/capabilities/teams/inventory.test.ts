import assert from "node:assert/strict";
import { test } from "node:test";

import { generateTeamsCapabilityInventory } from "../../../../../ops/evry/teams-inventory";
import { EVRY_CAPABILITY_EVAL_LAYERS } from "@/lib/evry/evals/contracts";
import { EVRY_CAPABILITY_EVAL_FIXTURES } from "@/lib/evry/evals/registry";
import generated from "./inventory.generated.json";

test("generated Teams inventory is current, closed, and confirmation-complete", () => {
  const actual = generateTeamsCapabilityInventory(process.cwd());
  assert.deepEqual(actual, generated);
  assert.equal(actual.summary.actions, 20);
  assert.equal(actual.summary.routes, 7);
  assert.equal(actual.summary.rscOperations, 19);
  assert.equal(actual.summary.unclassified, 0);
  const supported = actual.entries.filter(
    ({ classification }) => classification.state === "supported"
  );
  const claimed = actual.capabilities.flatMap(
    ({ surfaceIdentities }) => surfaceIdentities
  );
  assert.deepEqual(
    claimed.toSorted(),
    supported.map(({ identity }) => identity).toSorted()
  );
  assert.equal(new Set(claimed).size, claimed.length);
  for (const capability of actual.capabilities) {
    assert.deepEqual(capability.fixtureClasses, [
      "selection",
      "arguments",
      "confirmation",
      "execution",
      "idempotency",
      "failure",
    ]);
    assert.equal(
      capability.confirmation,
      capability.operationKind === "read" ? "not_required" : "required"
    );
    const fixture = EVRY_CAPABILITY_EVAL_FIXTURES.find(
      ({ capabilityIdentity }) => capabilityIdentity === capability.identity
    );
    assert.ok(
      fixture,
      `missing executable eval fixture for ${capability.identity}`
    );
    for (const layer of EVRY_CAPABILITY_EVAL_LAYERS) {
      const live =
        capability.operationKind === "effect" &&
        (layer === "execution" ||
          layer === "idempotency" ||
          layer === "errors");
      assert.deepEqual(fixture.cases[layer], [
        {
          id: `${capability.identity}:${layer}`,
          proofId: live ? "teams-effect-live" : "teams-capability-contract",
          testName: live
            ? `${capability.identity}:${layer}:live`
            : `${capability.identity}:${layer}`,
        },
      ]);
    }
  }
});

test("the responsibility route remains a Member read while first-view seeding is confirmed", () => {
  const route = generated.entries.find(
    ({ identity }) => identity === "route:/teams/[teamId]/responsibilities"
  );
  assert.equal(route?.capabilityIdentity, "teams.read.responsibilities");
  assert.equal(route?.operationKind, "read");
  assert.equal(route?.applicationCapability, "read");
  const seed = generated.entries.find(({ identity }) =>
    identity.includes("listResponsibilities:first-view-seed")
  );
  assert.equal(seed?.capabilityIdentity, "teams.responsibilities.initialize");
  assert.equal(seed?.operationKind, "effect");
  assert.equal(seed?.applicationCapability, "read");
  assert.equal(seed?.confirmation, "required");
});

test("person profile and meeting-create Teams reads remain inventoried", () => {
  const expected = new Map([
    [
      "rsc-operation:src/app/(dashboard)/people/[id]/teams/page.tsx → getPersonTeams",
      "teams.read.person-assignments",
    ],
    [
      "rsc-operation:src/app/(dashboard)/people/[id]/teams/page.tsx → getPersonTraining",
      "teams.read.person-training",
    ],
    [
      "rsc-operation:src/app/(dashboard)/meetings/new/page.tsx → listTeams",
      "teams.read.list",
    ],
  ]);
  for (const [identity, capabilityIdentity] of expected) {
    const entry = generated.entries.find(
      (candidate) => candidate.identity === identity
    );
    assert.equal(entry?.capabilityIdentity, capabilityIdentity);
    assert.equal(entry?.operationKind, "read");
    assert.equal(entry?.confirmation, "not_required");
  }
});
