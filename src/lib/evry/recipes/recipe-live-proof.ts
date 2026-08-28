import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mock } from "node:test";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  evryActionPlans,
  evryActionPlanStates,
  evryPlanConfirmations,
  persons,
  users,
} from "@/db/schema";
import type { EvryRequestClassifier } from "@/app/api/evry/requests/route";

type SessionUser = Readonly<{
  id: string;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  seat: "owner" | "admin" | "member" | null;
}>;

const SCRATCH = "__evry recipe live request proof__";
const RECIPE_IDENTITY = "fixture:meeting.invitation";
const FIXTURE_RESOLVED_PERSON_IDS = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
] as const;
const FIXTURE_RECIPE_VALUES = Object.freeze({
  meeting_id: "10000000-0000-4000-8000-000000000001",
  starts_at: "2026-09-02T14:00:00-04:00",
  person_ids: "Alex and Beth",
  recipient_ids: ["30000000-0000-4000-8000-000000000001"],
  subject: "Vision Meeting",
  body: "Please join us.",
});
let sessionUser: SessionUser | null = null;
let sessionChecks = 0;

mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => {
      sessionChecks++;
      if (!sessionUser) throw new Error("Unauthorized");
      return { user: sessionUser };
    },
    verifyFreshSession: async () => {
      throw new Error("recipe planning must not use effect authorization");
    },
  },
});

async function seedActorAndPeople(): Promise<void> {
  const [plant] = await db
    .insert(churches)
    .values({ name: SCRATCH })
    .returning({ id: churches.id });
  const [actor] = await db
    .insert(users)
    .values({
      email: `${randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: SCRATCH,
      seat: "owner",
      churchId: plant.id,
    })
    .returning({ id: users.id });
  await db.insert(persons).values([
    {
      id: FIXTURE_RESOLVED_PERSON_IDS[0],
      churchId: plant.id,
      firstName: "Alex",
      lastName: "Example",
      createdBy: actor.id,
    },
    {
      id: FIXTURE_RESOLVED_PERSON_IDS[1],
      churchId: plant.id,
      firstName: "Beth",
      lastName: "Example",
      createdBy: actor.id,
    },
  ]);
  sessionUser = {
    id: actor.id,
    churchId: plant.id,
    sendingChurchId: null,
    sendingNetworkId: null,
    seat: "owner",
  };
}

async function planCount(): Promise<number> {
  assert.ok(sessionUser?.churchId);
  return db
    .select({ id: evryActionPlans.id })
    .from(evryActionPlans)
    .where(eq(evryActionPlans.churchId, sessionUser.churchId))
    .then((rows) => rows.length);
}

function actionPolicy() {
  return {
    classification: "application_action" as const,
    continuation: {
      kind: "application_action" as const,
      literalUserText: "Create the fixed meeting invitation fixture.",
    },
  };
}

async function main(): Promise<void> {
  await seedActorAndPeople();

  const requestRoute = await import("@/app/api/evry/requests/route");
  const confirmRoute =
    await import("@/app/api/evry/plans/[planId]/confirm/route");
  const capabilities = await import("@/lib/evry/eligibility/capabilities");
  const viewer = await import("@/lib/evry/eligibility/viewer");
  const plans = await import("@/lib/evry/plans");
  const recipes = await import("@/lib/evry/recipes");
  const fixtures = await import("./fixtures.test-helper");

  assert.ok(sessionUser);
  const actor = await viewer.requireEvryPlantViewer();
  const eligibleCapabilities = capabilities.eligibleEvryCapabilitiesFor(actor);
  let resolvedActorId: string | null = null;
  const successfulRegistry = fixtures.createFixtureRecipeRegistry(
    undefined,
    undefined,
    {
      async resolve(rawValue, authorization) {
        assert.equal(rawValue, "Alex and Beth");
        resolvedActorId = authorization.actor.userId;
        const rows = await db
          .select({ id: persons.id })
          .from(persons)
          .where(
            and(
              eq(persons.churchId, authorization.actor.plantId),
              inArray(persons.firstName, ["Alex", "Beth"])
            )
          )
          .orderBy(asc(persons.id));
        return rows.map(({ id }) => id);
      },
      check(inputs) {
        return (
          Array.isArray(inputs.person_ids) && inputs.person_ids.length === 2
        );
      },
    }
  );

  async function assertPlanningFailureDoesNotPersist(
    registry: ReturnType<typeof fixtures.createFixtureRecipeRegistry>
  ): Promise<void> {
    const before = await planCount();
    await assert.rejects(
      recipes.createEvryRecipePlan({
        actor,
        policy: actionPolicy(),
        recipeIdentity: RECIPE_IDENTITY,
        inputValues: FIXTURE_RECIPE_VALUES,
        requestKey: plans.mintEvryPlanRequestKey(),
        registry,
        eligibleCapabilities,
      }),
      recipes.EvryRecipeCompilationError
    );
    assert.equal(await planCount(), before);
  }

  await assertPlanningFailureDoesNotPersist(
    fixtures.createFixtureRecipeRegistry(undefined, undefined, {
      resolve() {
        throw new Error("fixture resolution failed");
      },
    })
  );
  await assertPlanningFailureDoesNotPersist(
    fixtures.createFixtureRecipeRegistry(undefined, undefined, {
      check() {
        return false;
      },
    })
  );
  assert.equal(await planCount(), 0);

  let classifierCalls = 0;
  const classify = (async (literalUserText: string) => {
    classifierCalls++;
    assert.equal(
      literalUserText,
      "Create the fixed meeting invitation fixture."
    );
    return actionPolicy();
  }) as EvryRequestClassifier;
  const postRequest = requestRoute.createEvryRequestPost({
    classify,
    continueRead: null,
    async continueAction(context) {
      const currentActor = await viewer.requireEvryPlantViewer();
      const created = await recipes.createEvryRecipePlan({
        actor: currentActor,
        policy: actionPolicy(),
        recipeIdentity: RECIPE_IDENTITY,
        inputValues: FIXTURE_RECIPE_VALUES,
        requestKey: context.planRequestKey,
        registry: successfulRegistry,
        eligibleCapabilities: context.eligibleCapabilities,
      });
      return {
        planId: created.id,
        fingerprint: created.fingerprint,
        status: created.status,
      };
    },
    audit: null,
  });
  const requestResponse = await postRequest(
    new Request("http://localhost/api/evry/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestText: "Create the fixed meeting invitation fixture.",
      }),
    })
  );
  assert.equal(requestResponse.status, 200);
  const requestBody = (await requestResponse.json()) as {
    status: string;
    classification: string;
    artifact: { planId: string; fingerprint: string; status: string };
  };
  assert.deepEqual(
    {
      status: requestBody.status,
      classification: requestBody.classification,
      planStatus: requestBody.artifact.status,
    },
    {
      status: "continued",
      classification: "application_action",
      planStatus: "awaiting_confirmation",
    }
  );
  assert.equal(classifierCalls, 1);

  const postConfirm = confirmRoute.createEvryPlanConfirmPost({
    registry: successfulRegistry.executionRegistry.planRegistry,
  });
  const confirmationResponse = await postConfirm(
    new Request(
      `http://localhost/api/evry/plans/${requestBody.artifact.planId}/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fingerprint: requestBody.artifact.fingerprint,
        }),
      }
    ),
    {
      params: Promise.resolve({ planId: requestBody.artifact.planId }),
    }
  );
  assert.equal(confirmationResponse.status, 200);
  assert.equal(
    ((await confirmationResponse.json()) as { status: string }).status,
    "approved"
  );

  const [[persisted], [state], confirmations] = await Promise.all([
    db
      .select({
        document: evryActionPlans.document,
        fingerprint: evryActionPlans.fingerprint,
      })
      .from(evryActionPlans)
      .where(eq(evryActionPlans.id, requestBody.artifact.planId)),
    db
      .select({ status: evryActionPlanStates.status })
      .from(evryActionPlanStates)
      .where(eq(evryActionPlanStates.planId, requestBody.artifact.planId)),
    db
      .select({
        fingerprint: evryPlanConfirmations.planFingerprint,
      })
      .from(evryPlanConfirmations)
      .where(eq(evryPlanConfirmations.planId, requestBody.artifact.planId)),
  ]);
  assert.ok(persisted);
  assert.equal(state?.status, "approved");
  assert.deepEqual(confirmations, [
    { fingerprint: requestBody.artifact.fingerprint },
  ]);
  assert.equal(persisted.fingerprint, requestBody.artifact.fingerprint);

  const expected = JSON.parse(
    readFileSync(new URL("./meeting-invitation.golden.json", import.meta.url), {
      encoding: "utf8",
    })
  );
  assert.deepEqual(persisted.document, expected);
  const document = plans.parseStoredEvryActionPlan({
    document: persisted.document,
    registry: successfulRegistry.executionRegistry.planRegistry,
  });
  assert.deepEqual(
    document.steps.map(({ id, dependsOn }) => [id, dependsOn]),
    [
      ["create-meeting", []],
      ["add-guests", ["create-meeting"]],
      ["send-invitations", ["create-meeting"]],
    ]
  );
  assert.deepEqual(
    document.steps[1]?.arguments.personIds,
    FIXTURE_RESOLVED_PERSON_IDS
  );
  assert.equal(JSON.stringify(document).includes("Alex and Beth"), false);
  assert.equal(resolvedActorId, sessionUser.id);
  assert.equal(sessionChecks >= 6, true);
  assert.equal(await planCount(), 1);

  console.log(
    "Evry recipe live request proof passed: resolver/precondition failures stored 0 plans; the request stored and confirmed 1 exact UUID-resolved immutable plan"
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
