import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import type { EvryReadCapabilityAuthorization } from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  fingerprintEvryActionPlan,
  type EvryActionPlanDocument,
} from "@/lib/evry/plans";
import { mintEvryPlanRequestKey } from "@/lib/evry/plans/request-key";
import type { EvryAllowedPolicyDecision } from "@/lib/evry/policy";
import { createEvryArtifactReviewRegistry } from "@/lib/evry/artifacts/trusted-plan-review";

import {
  createEvryRecipeCompiler,
  createEvryRecipePlanCreator,
  EvryRecipeCompilationError,
  storedDocumentMatchesEvryRecipe,
} from "./compiler";
import {
  createFixtureRecipeRegistry,
  createFixtureRecipeReviewRegistry,
  fixtureRecipeDefinition,
  FIXTURE_RECIPE_VALUES,
  FIXTURE_RESOLVED_PERSON_IDS,
  RECIPE_IDENTITY,
} from "./fixtures.test-helper";

test("one resolver-owned snapshot can bind nested exact step arguments", async () => {
  const definition = fixtureRecipeDefinition();
  const required = definition.requiredInputs as Array<Record<string, unknown>>;
  required.push({
    key: "resolved_invitation",
    schema: z.strictObject({
      meeting: z.strictObject({
        id: z.string().uuid(),
        startsAt: z.string().datetime({ offset: true }),
      }),
    }),
  });
  const [create] = definition.steps as Array<Record<string, unknown>>;
  create!.arguments = {
    meetingId: {
      kind: "input_path",
      inputKey: "resolved_invitation",
      path: ["meeting", "id"],
    },
    startsAt: {
      kind: "input_path",
      inputKey: "resolved_invitation",
      path: ["meeting", "startsAt"],
    },
  };
  const registry = createFixtureRecipeRegistry(undefined, [definition]);
  const compile = createEvryRecipeCompiler({
    async authorizeResolver() {
      return readAuthorization();
    },
  });
  const compiled = await compile({
    actor: ACTOR,
    registry,
    recipeIdentity: RECIPE_IDENTITY,
    inputValues: {
      ...FIXTURE_RECIPE_VALUES,
      resolved_invitation: {
        meeting: {
          id: FIXTURE_RECIPE_VALUES.meeting_id,
          startsAt: FIXTURE_RECIPE_VALUES.starts_at,
        },
      },
    },
    eligibleCapabilities: eligible(registry),
  });

  assert.deepEqual(compiled.document.steps[0]?.arguments, {
    meetingId: FIXTURE_RECIPE_VALUES.meeting_id,
    startsAt: FIXTURE_RECIPE_VALUES.starts_at,
  });
});

const ACTOR = {
  userId: "40000000-0000-4000-8000-000000000001",
  plantId: "50000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;

function readAuthorization(
  actor: EvryPlantActor = ACTOR
): EvryReadCapabilityAuthorization {
  return {
    actor,
    registration: {
      identity: "people.crm.people.load-more-people",
      parityCapability: "people.read",
      applicationCapability: "read",
    },
  } as unknown as EvryReadCapabilityAuthorization;
}

function golden(): unknown {
  return JSON.parse(
    readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "meeting-invitation.golden.json"
      ),
      "utf8"
    )
  );
}

function eligible(registry: ReturnType<typeof createFixtureRecipeRegistry>) {
  const definition = registry.registrationFor(RECIPE_IDENTITY);
  assert.ok(definition);
  return definition.eligibleCapabilities.map((identity) => ({ identity }));
}

test("authorized resolution and preconditions compile the immutable golden plan", async () => {
  const resolverValues: unknown[] = [];
  const preconditionValues: unknown[] = [];
  const authorized: string[] = [];
  const registry = createFixtureRecipeRegistry(undefined, undefined, {
    resolve(rawValue) {
      resolverValues.push(rawValue);
      return FIXTURE_RESOLVED_PERSON_IDS;
    },
    check(inputs) {
      preconditionValues.push(inputs.person_ids);
      return true;
    },
  });
  const compile = createEvryRecipeCompiler({
    async authorizeResolver(identity) {
      authorized.push(identity);
      return readAuthorization();
    },
  });

  const compiled = await compile({
    actor: ACTOR,
    registry,
    recipeIdentity: RECIPE_IDENTITY,
    inputValues: FIXTURE_RECIPE_VALUES,
    eligibleCapabilities: eligible(registry),
  });

  assert.deepEqual(compiled.document, golden());
  assert.deepEqual(resolverValues, ["Alex and Beth"]);
  assert.deepEqual(preconditionValues, [FIXTURE_RESOLVED_PERSON_IDS]);
  assert.equal(Object.isFrozen(preconditionValues[0]), true);
  assert.equal(authorized.length, 1);
  assert.equal(Object.isFrozen(compiled.document), true);
  assert.equal(Object.isFrozen(compiled.document.steps), true);
  assert.equal(
    Object.isFrozen(compiled.document.steps[0]?.disclosure?.items),
    true
  );

  const definition = registry.registrationFor(RECIPE_IDENTITY);
  assert.ok(definition);
  assert.equal(
    storedDocumentMatchesEvryRecipe({
      definition,
      document: compiled.document,
    }),
    true
  );
});

test("raw record-looking data cannot bypass the trusted resolver", async () => {
  const seen: unknown[] = [];
  const registry = createFixtureRecipeRegistry(undefined, undefined, {
    resolve(rawValue) {
      seen.push(rawValue);
      return FIXTURE_RESOLVED_PERSON_IDS;
    },
  });
  const compile = createEvryRecipeCompiler({
    async authorizeResolver() {
      return readAuthorization();
    },
  });
  const untrustedIds = ["90000000-0000-4000-8000-000000000001"];
  const compiled = await compile({
    actor: ACTOR,
    registry,
    recipeIdentity: RECIPE_IDENTITY,
    inputValues: { ...FIXTURE_RECIPE_VALUES, person_ids: untrustedIds },
    eligibleCapabilities: eligible(registry),
  });

  assert.deepEqual(seen, [untrustedIds]);
  assert.deepEqual(
    compiled.document.steps[1]?.arguments.personIds,
    FIXTURE_RESOLVED_PERSON_IDS
  );
  assert.notDeepEqual(
    compiled.document.steps[1]?.arguments.personIds,
    untrustedIds
  );
});

test("registered copy and retry policy are fingerprint-bound", async () => {
  const registry = createFixtureRecipeRegistry();
  const compile = createEvryRecipeCompiler({
    async authorizeResolver() {
      return readAuthorization();
    },
  });
  const compiled = await compile({
    actor: ACTOR,
    registry,
    recipeIdentity: RECIPE_IDENTITY,
    inputValues: FIXTURE_RECIPE_VALUES,
    eligibleCapabilities: eligible(registry),
  });
  const changed = structuredClone(compiled.document) as EvryActionPlanDocument;
  const mutable = changed as unknown as {
    steps: Array<{
      disclosure: { items: Array<{ value: string }> };
    }>;
  };
  mutable.steps[2]!.disclosure.items[0]!.value = "Someone else";

  const expiresAt = new Date("2026-09-01T12:15:00.000Z");
  const base = fingerprintEvryActionPlan({
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    expiresAt,
    document: compiled.document,
  });
  const changedFingerprint = fingerprintEvryActionPlan({
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    expiresAt,
    document: changed,
  });
  assert.notEqual(base, changedFingerprint);

  const definition = registry.registrationFor(RECIPE_IDENTITY);
  assert.ok(definition);
  assert.equal(
    storedDocumentMatchesEvryRecipe({ definition, document: changed }),
    false
  );
});

test("resolver authorization and planning preconditions fail before persistence", async (t) => {
  for (const failure of [
    "resolver",
    "resolver-scope",
    "precondition",
  ] as const) {
    await t.test(failure, async () => {
      const registry = createFixtureRecipeRegistry(
        undefined,
        undefined,
        failure === "precondition" ? { check: () => false } : undefined
      );
      const compile = createEvryRecipeCompiler({
        async authorizeResolver() {
          if (failure === "resolver") return null;
          if (failure === "resolver-scope") {
            return readAuthorization({
              ...ACTOR,
              plantId: "50000000-0000-4000-8000-000000000099",
            } as EvryPlantActor);
          }
          return readAuthorization();
        },
      });
      let persistenceCalls = 0;
      const create = createEvryRecipePlanCreator({
        compile,
        async persist() {
          persistenceCalls++;
          throw new Error("persistence must not be reached");
        },
      });
      const reviewRegistry = createFixtureRecipeReviewRegistry(registry);

      await assert.rejects(
        create({
          actor: ACTOR,
          policy: {
            classification: "application_action",
          } as EvryAllowedPolicyDecision & {
            classification: "application_action";
          },
          recipeIdentity: RECIPE_IDENTITY,
          inputValues: FIXTURE_RECIPE_VALUES,
          requestKey: mintEvryPlanRequestKey(),
          registry,
          reviewRegistry,
          eligibleCapabilities: eligible(registry),
        }),
        EvryRecipeCompilationError
      );
      assert.equal(persistenceCalls, 0);
    });
  }
});

test("a compiled recipe without a complete trusted review never reaches persistence", async () => {
  const registry = createFixtureRecipeRegistry();
  let persistenceCalls = 0;
  const create = createEvryRecipePlanCreator({
    compile: createEvryRecipeCompiler({
      async authorizeResolver() {
        return readAuthorization();
      },
    }),
    async persist() {
      persistenceCalls++;
      throw new Error("persistence must not be reached");
    },
  });
  await assert.rejects(
    create({
      actor: ACTOR,
      policy: {
        classification: "application_action",
        continuation: {
          kind: "application_action",
          literalUserText: "Create the fixture.",
        },
      },
      recipeIdentity: RECIPE_IDENTITY,
      inputValues: FIXTURE_RECIPE_VALUES,
      requestKey: mintEvryPlanRequestKey(),
      registry,
      reviewRegistry: createEvryArtifactReviewRegistry([]),
      eligibleCapabilities: eligible(registry),
    }),
    /no complete trusted review/
  );
  assert.equal(persistenceCalls, 0);
});

test("an ineligible recipe capability fails at the ordinary plan boundary", async () => {
  const registry = createFixtureRecipeRegistry();
  const compile = createEvryRecipeCompiler({
    async authorizeResolver() {
      return readAuthorization();
    },
  });
  await assert.rejects(
    compile({
      actor: ACTOR,
      registry,
      recipeIdentity: RECIPE_IDENTITY,
      inputValues: FIXTURE_RECIPE_VALUES,
      eligibleCapabilities: eligible(registry).slice(1),
    }),
    /capability is unavailable/
  );
});
