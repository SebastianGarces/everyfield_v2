import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";

import type { UserSeat } from "@/db/schema";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

const plantId = required("EVRY_PI_PROOF_PLANT_ID");
const actorUserId = required("EVRY_PI_PROOF_ACTOR_ID");
const sessionUser = {
  id: actorUserId,
  churchId: plantId,
  sendingChurchId: null,
  sendingNetworkId: null,
  seat: "owner" as UserSeat,
};
let sessionAuthorizations = 0;
let freshAuthorizations = 0;
const revalidatedPaths: string[] = [];

mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => {
      sessionAuthorizations++;
      return { user: sessionUser };
    },
    verifyFreshSession: async () => {
      freshAuthorizations++;
      return { user: sessionUser };
    },
  },
});

mock.module("next/cache", {
  namedExports: {
    revalidatePath: (path: string) => {
      revalidatedPaths.push(path);
    },
  },
});

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response: Response) {
  return { status: response.status, body: await response.json() };
}

async function main() {
  const { db } = await import("@/db");
  const { evryActionPlans, plantSignals } = await import("@/db/schema");
  const { and, desc, eq } = await import("drizzle-orm");
  const reads = await import("./reads");
  const readOutcomes = new Set<string>();
  const readCommands = new Map<string, string>([
    [
      "plant-intelligence.assessments.read",
      "show plant intelligence assessment",
    ],
    [
      "plant-intelligence.attestations.read",
      "show plant intelligence attestations",
    ],
    ["plant-intelligence.checkins.read", "show plant intelligence check-ins"],
    [
      "plant-intelligence.declarations.read",
      "show plant intelligence phase history",
    ],
    ["plant-intelligence.feedback.read", "show plant intelligence feedback"],
    ["plant-intelligence.signals.read", "show plant intelligence signals"],
  ]);

  for (const [identity, command] of readCommands) {
    const selected = reads.selectPlantIntelligenceEvryRead(command);
    assert.ok(selected);
    const first = await reads.executePlantIntelligenceEvryRead(selected);
    const second = await reads.executePlantIntelligenceEvryRead(selected);
    assert.equal(first?.kind, "read");
    assert.deepEqual(second, first);
    readOutcomes.add(`${identity}:execution`);
    readOutcomes.add(`${identity}:idempotency`);

    const registration = reads.PLANT_INTELLIGENCE_READ_REGISTRATIONS.find(
      ({ id }) => id === selected.readId
    );
    assert.ok(registration);
    assert.equal(
      await registration.execute(
        { literalUserText: command, pageContext: null },
        { ...selected.input, plantId: randomUUID() }
      ),
      null
    );
    readOutcomes.add(`${identity}:errors`);
  }

  const createRoute = await import("@/app/api/evry/conversations/route");
  const confirmRoute =
    await import("@/app/api/evry/plans/[planId]/confirm/route");
  const executeRoute =
    await import("@/app/api/evry/plans/[planId]/execute/route");
  const production = await import("../production");
  const command =
    'plant intelligence set-attestation {"signalKey":"systems_tested","value":"Production route lifecycle"}';
  const created = await json(
    await createRoute.createEvryConversationCreatePost()(
      post("http://localhost/api/evry/conversations", {
        requestKey: randomUUID(),
        message: command,
      })
    )
  );
  assert.equal(created.status, 201);
  assert.equal((created.body as { status?: string }).status, "created");
  assert.match(JSON.stringify(created.body), /"kind":"confirmation"/);

  const [plan] = await db
    .select({
      id: evryActionPlans.id,
      fingerprint: evryActionPlans.fingerprint,
    })
    .from(evryActionPlans)
    .where(
      and(
        eq(evryActionPlans.churchId, plantId),
        eq(evryActionPlans.actorUserId, actorUserId)
      )
    )
    .orderBy(desc(evryActionPlans.createdAt), desc(evryActionPlans.id))
    .limit(1);
  assert.ok(plan);

  const confirmed = await json(
    await confirmRoute.createEvryPlanConfirmPost({
      registry: production.PRODUCTION_EVRY_PLAN_REGISTRY,
    })(
      post(`http://localhost/api/evry/plans/${plan.id}/confirm`, {
        fingerprint: plan.fingerprint,
      }),
      { params: Promise.resolve({ planId: plan.id }) }
    )
  );
  assert.equal(confirmed.status, 200);
  assert.equal((confirmed.body as { status?: string }).status, "approved");

  const executed = await json(
    await executeRoute.createEvryPlanExecutePost({
      registry: production.PRODUCTION_EVRY_EXECUTION_REGISTRY,
    })(
      post(`http://localhost/api/evry/plans/${plan.id}/execute`, {
        fingerprint: plan.fingerprint,
      }),
      { params: Promise.resolve({ planId: plan.id }) }
    )
  );
  assert.equal(executed.status, 200);
  assert.equal((executed.body as { status?: string }).status, "completed");
  const [signal] = await db
    .select()
    .from(plantSignals)
    .where(
      and(
        eq(plantSignals.churchId, plantId),
        eq(plantSignals.signalKey, "systems_tested")
      )
    )
    .limit(1);
  assert.equal(signal?.value, "Production route lifecycle");
  assert.ok(sessionAuthorizations >= 10, "routes and reads re-mint sessions");
  assert.ok(
    freshAuthorizations >= 2,
    "proposal and executor re-mint fresh authority"
  );
  assert.deepEqual(revalidatedPaths, ["/phase"]);

  process.stdout.write(
    "Plant Intelligence production lifecycle proof passed\n"
  );
  process.stdout.write(
    `EVRY_PLANT_INTELLIGENCE_READ_OUTCOMES=${JSON.stringify([...readOutcomes].sort())}\n`
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
