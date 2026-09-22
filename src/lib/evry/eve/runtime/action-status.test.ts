import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EVRY_CONFIRMATION_FIXTURES,
  meetingProgressFixture,
  partialMeetingReceiptFixture,
} from "@/lib/evry/artifacts/fixtures";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { EvryPlantViewerRefusalError } from "@/lib/evry/eligibility/viewer";
import { UnauthorizedError } from "@/lib/auth/unauthorized";
import {
  createEveActionStatusReader,
  projectEveActionStatus,
} from "./action-status";
import { createEveToolRegistry } from "../capabilities/registry";
import { eveRuntimeToolSchema } from "./tool-schemas";
import {
  createCompositionBudget,
  runEvryComposition,
} from "../composition/runner";

// Mock only the authentication boundary. Production obtains this private brand from fresh session auth.
const actor = {
  userId: "actor",
  plantId: "plant",
  seat: "owner",
} as EvryPlantActor;
const scope = {
  actor,
  appSessionId: "app-session",
  eveSessionId: "eve-session",
  conversationId: "conversation",
  turnId: "turn",
};
const confirmation = EVRY_CONFIRMATION_FIXTURES.meeting;
type Boundaries = NonNullable<
  Parameters<typeof createEveActionStatusReader>[1]
>;
type Review = NonNullable<Awaited<ReturnType<Boundaries["readReview"]>>>;
const pending: Review = {
  status: "available",
  plan: {
    identity: confirmation.plan,
    status: "awaiting_confirmation",
    confirmable: true,
    expiresAt: "2026-09-27T14:15:00Z",
  },
  artifact: confirmation,
};
function fixture() {
  const calls: string[] = [];
  let current: ReturnType<Boundaries["currentReview"]> = {
    callId: "original",
    plan: confirmation.plan,
  };
  const boundaries: Boundaries = {
    refreshActor: async (id) => {
      calls.push(`auth:${id}`);
      return actor;
    },
    findSession: async (id, owner) => {
      calls.push(`session:${id}:${owner.userId}:${owner.plantId}`);
      return {
        id,
        conversationId: scope.conversationId,
        userId: actor.userId,
        churchId: actor.plantId,
        archivedAt: null,
        title: "Private conversation",
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
    },
    currentReview: () => current,
    readReview: async (owner, identity) => {
      calls.push("read");
      assert.equal(owner, actor);
      assert.deepEqual(identity, current?.plan);
      return pending;
    },
  };
  return {
    calls,
    boundaries,
    replace: (value: typeof current) => {
      current = value;
    },
  };
}

test("status preserves planned vs durable vs uncertain evidence without private review payloads", () => {
  const before = JSON.stringify(pending);
  const planned = projectEveActionStatus(pending);
  assert.equal(planned.lifecycle, "awaiting_confirmation");
  assert.ok("plannedSteps" in planned);
  assert.equal("steps" in planned, false);
  assert.equal(JSON.stringify(pending), before);
  for (const lifecycle of ["cancelled", "superseded", "expired"] as const)
    assert.equal(
      projectEveActionStatus({
        ...pending,
        plan: { ...pending.plan, status: lifecycle, confirmable: false },
      }).lifecycle,
      lifecycle
    );
  const progress = projectEveActionStatus({
    ...pending,
    plan: { ...pending.plan, status: "executing", confirmable: false },
    artifact: meetingProgressFixture(confirmation.plan),
  });
  assert.ok("steps" in progress);
  assert.equal(progress.steps[0]?.recordedAffectedCount, 1);
  assert.equal(progress.steps[1]?.recordedExcludedCount, 3);
  assert.equal(progress.steps[2]?.recordedAffectedCount, null);
  assert.equal(progress.steps[3]?.recordedAffectedCount, null);
  const receipt = projectEveActionStatus({
    ...pending,
    plan: { ...pending.plan, status: "partially_failed", confirmable: false },
    artifact: partialMeetingReceiptFixture(confirmation.plan),
  });
  assert.ok("steps" in receipt);
  assert.equal(receipt.outcome, "partially_failed");
  assert.deepEqual(
    receipt.steps.map(({ status }) => status),
    ["completed", "completed", "failed", "refused", "skipped"]
  );
  for (const output of [planned, progress, receipt]) {
    const encoded = JSON.stringify(output);
    assert.doesNotMatch(
      encoded,
      /fingerprint|planId|stepId|sourceLinks|resolvedTargets|contentPreviews|recipients|@|safe_retry.*label/
    );
    assert.match(encoded, /does not establish email delivery/);
    assert.equal(encoded.includes(confirmation.plan.fingerprint), false);
  }
});

test("each read reauthenticates and has no fallback to another conversation or old review", async () => {
  const f = fixture();
  const read = createEveActionStatusReader(scope, f.boundaries);
  await read();
  await read();
  assert.deepEqual(
    f.calls,
    Array(2)
      .fill(["auth:app-session", "session:eve-session:actor:plant", "read"])
      .flat()
  );
  f.replace(null);
  assert.deepEqual(await read(), { status: "unavailable" });
  assert.equal(f.calls.filter((call) => call === "read").length, 2);
  for (const field of ["userId", "plantId"] as const) {
    f.boundaries.refreshActor = async () => ({ ...actor, [field]: "foreign" });
    assert.deepEqual(await read(), { status: "unavailable" });
  }
  assert.equal(f.calls.filter((call) => call.startsWith("session:")).length, 3);
  f.boundaries.refreshActor = async () => actor;
  f.boundaries.findSession = async () => null;
  assert.deepEqual(await read(), { status: "unavailable" });
  const session = await fixture().boundaries.findSession(
    scope.eveSessionId,
    actor
  );
  assert.ok(session);
  f.boundaries.findSession = async () => ({
    ...session,
    conversationId: "another-conversation",
  });
  assert.deepEqual(await read(), { status: "unavailable" });
});

test("revocation, mismatched fingerprints, replaced pointers and read failure cannot become zero results", async () => {
  for (const error of [
    new UnauthorizedError(),
    new EvryPlantViewerRefusalError(),
  ]) {
    const f = fixture();
    f.boundaries.refreshActor = async () => {
      throw error;
    };
    assert.deepEqual(await createEveActionStatusReader(scope, f.boundaries)(), {
      status: "unavailable",
    });
    assert.deepEqual(f.calls, []);
  }
  for (const result of [
    null,
    {
      ...pending,
      plan: {
        ...pending.plan,
        identity: EVRY_CONFIRMATION_FIXTURES.communication.plan,
      },
    },
    { ...pending, artifact: EVRY_CONFIRMATION_FIXTURES.communication },
  ]) {
    const f = fixture();
    f.boundaries.readReview = async () => result;
    assert.deepEqual(await createEveActionStatusReader(scope, f.boundaries)(), {
      status: "unavailable",
    });
  }
  const f = fixture();
  f.boundaries.readReview = async () => {
    f.replace({ callId: "new-review", plan: confirmation.plan });
    return pending;
  };
  assert.deepEqual(await createEveActionStatusReader(scope, f.boundaries)(), {
    status: "unavailable",
  });
  f.boundaries.readReview = async () => {
    throw new Error("fixture outage");
  };
  await assert.rejects(
    createEveActionStatusReader(scope, f.boundaries)(),
    /fixture outage/
  );
});

test("strict direct and composed calls cannot select a plan or acquire mutation authority", async () => {
  const f = fixture();
  const registry = createEveToolRegistry({
    context: {
      actor,
      literalUserText: "What happened?",
      pageContext: null,
      now: new Date(0),
    },
    reads: [],
    authorizeRead: async () => {
      throw new Error("not a feature permission");
    },
    readActionStatus: createEveActionStatusReader(scope, f.boundaries),
  });
  assert.equal(
    registry.describe().find(({ name }) => name === "actions.status")?.effect,
    "read"
  );
  for (const input of [
    { planId: confirmation.plan.planId },
    { fingerprint: confirmation.plan.fingerprint },
    { action: "retry" },
    { confirmed: true },
    { actorUserId: "foreign" },
    { sessionId: "other" },
    null,
    [],
  ]) {
    assert.equal(
      eveRuntimeToolSchema("actions.status").safeParse(input).success,
      false
    );
    assert.deepEqual(await registry.invoke("actions.status", input), {
      status: "invalid_input",
    });
  }
  assert.equal(f.calls.length, 0);
  const expected = await registry.invoke("actions.status", {});
  const result = await runEvryComposition({
    registry,
    callId: "status-composition",
    budget: createCompositionBudget(),
    js: `return await tools["actions.status"]({});`,
  });
  assert.deepEqual(result, { status: "completed", calls: 1, output: expected });
  assert.equal(f.calls.filter((call) => call === "read").length, 2);
  const noReader = createEveToolRegistry({
    context: {
      actor,
      literalUserText: "",
      pageContext: null,
      now: new Date(0),
    },
    reads: [],
    authorizeRead: async () => null,
  });
  assert.equal(
    noReader.describe().some(({ name }) => name === "actions.status"),
    false
  );
  assert.deepEqual(await noReader.invoke("actions.status", {}), {
    status: "unavailable",
    reason: "unknown_tool",
  });
});

test("cancellation stops reads and cannot leak a completed lookup after cancellation", async () => {
  const f = fixture();
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    createEveActionStatusReader(scope, f.boundaries)({ signal: abort.signal }),
    { name: "AbortError" }
  );
  assert.deepEqual(f.calls, []);
  const late = new AbortController();
  f.boundaries.readReview = async () => {
    late.abort();
    return pending;
  };
  await assert.rejects(
    createEveActionStatusReader(scope, f.boundaries)({ signal: late.signal }),
    { name: "AbortError" }
  );
});

test("authorization evidence records the real session check, never a successful read or invented permission", async () => {
  const f = fixture();
  const observed: boolean[] = [];
  const read = createEveActionStatusReader(scope, f.boundaries, (value) => {
    assert.equal(
      f.calls.includes("read"),
      false,
      "auth observed before reading the plan"
    );
    observed.push(value);
  });
  f.replace(null);
  await read();
  assert.deepEqual(
    observed,
    [true],
    "owned session remains authorized without a current pointer"
  );
  f.boundaries.findSession = async () => null;
  await read();
  f.boundaries.refreshActor = async () => {
    throw new UnauthorizedError();
  };
  await read();
  assert.deepEqual(observed, [true, false, false]);
  assert.equal(f.calls.includes("read"), false);
});
