import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";

import type {
  EvryHydratedConversationArtifact,
  StoredEvryConversationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import {
  evryConversationIdSchema,
  evryConversationMessageIdSchema,
  evryConversationPlanIdentitySchema,
  evryConversationRequestKeySchema,
  initialEvryConversationState,
} from "@/lib/evry/conversations/contract";
import type {
  EvryStoredConversation,
  EvryStoredConversationMessage,
} from "@/lib/evry/conversations/repository";
import type { EvryConversationStore } from "@/lib/evry/conversations/service";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  ELIGIBLE_FIXTURE_CAPABILITIES,
  fixtureDocument,
  PLAN_FIXTURE_REGISTRY,
} from "@/lib/evry/plans/fixtures.test-helper";
import { fingerprintEvryActionPlan } from "@/lib/evry/plans/fingerprint";
import { mintEvryPlanRequestKey } from "@/lib/evry/plans/request-key";

type SessionUser = Readonly<{
  id: string;
  churchId: string | null;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
  seat: "owner" | "admin" | "member" | null;
}>;

const PLANT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "20000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = evryConversationIdSchema.parse(
  "30000000-0000-4000-8000-000000000001"
);
const PLAN_EXPIRES = new Date("2026-08-20T12:15:00.000Z");
const PLAN = evryConversationPlanIdentitySchema.parse({
  planId: "40000000-0000-4000-8000-000000000001",
  fingerprint: fingerprintEvryActionPlan({
    actorUserId: USER_ID,
    plantId: PLANT_ID,
    document: fixtureDocument(),
    expiresAt: PLAN_EXPIRES,
  }),
});
const START = new Date("2026-08-20T12:00:00.000Z");
const RETURN = new Date("2026-08-28T12:00:00.000Z");
const LITERAL = "  Create café follow-up — keep these bytes.  ";

const user = (id = USER_ID): SessionUser => ({
  id,
  churchId: PLANT_ID,
  sendingChurchId: null,
  sendingNetworkId: null,
  seat: "owner",
});

const events: string[] = [];
let sessions: Array<SessionUser | null> = [];
const sessionRefusal = new Error("Unauthorized");
let parseArtifactDocument: (
  input: unknown
) => StoredEvryConversationArtifactDocument;
let hydrateArtifact: (
  document: StoredEvryConversationArtifactDocument
) => EvryHydratedConversationArtifact;

mock.module("@/lib/auth/session", {
  namedExports: {
    verifySession: async () => {
      events.push("auth");
      const session = sessions.shift() ?? null;
      if (!session) throw sessionRefusal;
      return { user: session };
    },
  },
});

class TracedRequest extends Request {
  override async json(): Promise<unknown> {
    events.push("body");
    return super.json();
  }
}

function request(url: string, body: unknown): Request {
  return new TracedRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

let stored: EvryStoredConversation | null = null;

function newMessage(input: {
  id?: string;
  requestKey: string;
  sequence: number;
  author: "user" | "assistant";
  body: string;
  pageContext: EvryStoredConversationMessage["pageContext"];
  relevanceKeys: EvryStoredConversationMessage["relevanceKeys"];
  deliveryStatus: "complete" | "interrupted";
  artifacts: readonly unknown[];
  createdAt: Date;
}): EvryStoredConversationMessage {
  return Object.freeze({
    id: evryConversationMessageIdSchema.parse(input.id ?? randomUUID()),
    requestKey: evryConversationRequestKeySchema.parse(input.requestKey),
    sequence: input.sequence,
    author: input.author,
    body: input.body,
    pageContext: input.pageContext,
    relevanceKeys: input.relevanceKeys,
    deliveryStatus: input.deliveryStatus,
    createdAt: input.createdAt,
    artifacts: Object.freeze(
      input.artifacts.map((untrusted, ordinal) => {
        const document = parseArtifactDocument(untrusted);
        return Object.freeze({
          id: randomUUID(),
          ordinal,
          kind: document.kind,
          document,
          artifact: hydrateArtifact(document),
        });
      })
    ),
  });
}

const store = {
  async create(input) {
    events.push("create");
    const initial = newMessage({
      requestKey: input.requestKey,
      sequence: 0,
      author: "user",
      body: input.body,
      pageContext: input.pageContext,
      relevanceKeys: [],
      deliveryStatus: "complete",
      artifacts: [],
      createdAt: input.createdAt,
    });
    stored = Object.freeze({
      id: CONVERSATION_ID,
      actorUserId: input.actorUserId,
      plantId: input.plantId,
      title: "Create café follow-up — keep these bytes.",
      createdAt: input.createdAt,
      lastActivityAt: input.createdAt,
      activePlan: null,
      stateVersion: 0,
      state: initialEvryConversationState(),
      messages: Object.freeze([initial]),
    });
    return stored;
  },
  async find(input) {
    events.push("find");
    return stored &&
      stored.id === input.conversationId &&
      stored.actorUserId === input.actorUserId &&
      stored.plantId === input.plantId
      ? stored
      : null;
  },
  async append(input) {
    events.push("append");
    if (
      !stored ||
      stored.id !== input.conversationId ||
      stored.actorUserId !== input.actorUserId ||
      stored.plantId !== input.plantId
    ) {
      throw new Error("unavailable");
    }
    const replay = stored.messages.find(
      ({ requestKey }) => requestKey === input.requestKey
    );
    if (replay) return stored;
    assert.equal(input.expectedStateVersion, stored.stateVersion);
    const appended = newMessage({
      id: input.messageId,
      requestKey: input.requestKey,
      sequence: stored.messages.length,
      author: input.author,
      body: input.body,
      pageContext: input.pageContext,
      relevanceKeys: input.relevanceKeys,
      deliveryStatus: input.deliveryStatus,
      artifacts: [...input.artifacts],
      createdAt: input.createdAt,
    });
    const activePlan =
      input.activePlan?.mode === "set"
        ? input.activePlan.plan
        : input.activePlan?.mode === "clear"
          ? null
          : stored.activePlan;
    stored = Object.freeze({
      ...stored,
      activePlan,
      stateVersion: stored.stateVersion + 1,
      state: input.state,
      lastActivityAt: input.createdAt,
      messages: Object.freeze([...stored.messages, appended]),
    });
    return stored;
  },
} satisfies EvryConversationStore;

async function response(response: Response) {
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body: await response.json(),
  };
}

async function main(): Promise<void> {
  const artifactContract = await import("@/lib/evry/conversations/artifacts");
  parseArtifactDocument =
    artifactContract.parseEvryConversationArtifactDocument;
  hydrateArtifact = artifactContract.hydrateStoredEvryConversationArtifact;
  const repository = await import("@/lib/evry/conversations/repository");
  const conversations = await import("@/lib/evry/conversations/service");
  const planResume = await import("@/lib/evry/conversations/plan-resume");
  const planLifecycle = await import("@/lib/evry/plans/lifecycle");
  const planRegistry = await import("@/lib/evry/plans/registry");
  const createRoute = await import("./route");
  const getRoute = await import("./[conversationId]/route");
  const messageRoute = await import("./[conversationId]/messages/route");

  let capturedActor: EvryPlantActor | null = null;
  const createPost = createRoute.createEvryConversationCreatePost({
    now: () => START,
    create: async (input) => {
      capturedActor = input.actor;
      return conversations.createEvryConversation({ ...input, store });
    },
  });
  const loadPlan = async () => {
    events.push("plan-read");
    return {
      id: PLAN.planId,
      actorUserId: USER_ID,
      plantId: PLANT_ID,
      requestKey: mintEvryPlanRequestKey(),
      intentFingerprint: "b".repeat(64),
      fingerprint: PLAN.fingerprint,
      document: fixtureDocument(),
      createdAt: START,
      expiresAt: PLAN_EXPIRES,
      supersedesPlanId: null,
      status: "approved" as const,
      stateVersion: 0,
      stateChangedAt: START,
    };
  };
  const revalidatePlan = planResume.createEvryConversationPlanResumeRevalidator(
    {
      registry: PLAN_FIXTURE_REGISTRY,
      loadExact: loadPlan,
      eligibleCapabilitiesForActor: () => ELIGIBLE_FIXTURE_CAPABILITIES,
      targetIsCurrent: async () => {
        events.push("target-read");
        return true;
      },
    }
  );
  const get = getRoute.createEvryConversationGet({
    now: () => RETURN,
    resume: (input) =>
      conversations.resumeEvryConversation({
        ...input,
        store,
        revalidatePlan,
      }),
  });
  const messagePost = messageRoute.createEvryConversationMessagePost({
    now: () => RETURN,
    continueConversation: (input) =>
      conversations.continueEvryConversation({
        ...input,
        store,
        revalidatePlan,
      }),
  });

  sessions = [null];
  events.length = 0;
  const refused = await response(
    await createPost(
      request("http://localhost/api/evry/conversations", {
        requestKey: "not-a-uuid",
        message: "x",
      })
    )
  );
  assert.deepEqual(events, ["auth"]);
  assert.deepEqual(refused, {
    status: 401,
    cacheControl: "private, no-store",
    body: { status: "unavailable" },
  });

  const conflictingCreatePost = createRoute.createEvryConversationCreatePost({
    create: async () => {
      events.push("idempotency-conflict");
      throw new repository.EvryConversationIdempotencyError();
    },
  });
  sessions = [user()];
  events.length = 0;
  const createConflict = await response(
    await conflictingCreatePost(
      request("http://localhost/api/evry/conversations", {
        requestKey: randomUUID(),
        message: "Create this conversation.",
        pageContext: { kind: "task", recordId: "task-2" },
      })
    )
  );
  assert.deepEqual(events, ["auth", "body", "idempotency-conflict"]);
  assert.deepEqual(createConflict, {
    status: 409,
    cacheControl: "private, no-store",
    body: { status: "stale" },
  });

  const firstRequestKey = randomUUID();
  sessions = [user()];
  events.length = 0;
  const created = await response(
    await createPost(
      request("http://localhost/api/evry/conversations", {
        requestKey: firstRequestKey,
        message: LITERAL,
        pageContext: { kind: "task", recordId: "task-1" },
      })
    )
  );
  assert.equal(created.status, 201);
  assert.equal(created.cacheControl, "private, no-store");
  assert.equal(created.body.status, "created");
  assert.equal(created.body.conversation.messages[0].body, LITERAL);
  assert.deepEqual(events, ["auth", "body", "create"]);
  assert.ok(capturedActor);
  assert.ok(stored);

  const permissionLost = planResume.createEvryConversationPlanResumeRevalidator(
    {
      registry: PLAN_FIXTURE_REGISTRY,
      loadExact: loadPlan,
      eligibleCapabilitiesForActor: () => [],
      targetIsCurrent: async () => {
        assert.fail("an ineligible plan must not reach target validation");
      },
    }
  );
  const stalePlan = await permissionLost({
    actor: capturedActor,
    identity: PLAN,
    checkedAt: new Date("2026-08-20T12:05:00.000Z"),
  });
  assert.equal(stalePlan.status, "stale");
  assert.equal(stalePlan.confirmable, false);

  const terminalStatuses = planLifecycle.EVRY_PLAN_STATUSES.filter(
    planLifecycle.isTerminalEvryPlanStatus
  );
  let terminalAuthorityChecks = 0;
  for (const terminalStatus of terminalStatuses) {
    const historicalPlan =
      planResume.createEvryConversationPlanResumeRevalidator({
        registry: planRegistry.createEvryPlanCapabilityRegistry([]),
        loadExact: async () => ({
          ...(await loadPlan()),
          status: terminalStatus,
        }),
        eligibleCapabilitiesForActor: () => {
          terminalAuthorityChecks += 1;
          return [];
        },
        targetIsCurrent: async () => {
          terminalAuthorityChecks += 1;
          return false;
        },
      });
    const historical = await historicalPlan({
      actor: capturedActor,
      identity: PLAN,
      checkedAt: new Date("2026-08-20T12:05:00.000Z"),
    });
    assert.equal(historical.status, terminalStatus);
    assert.equal(historical.confirmable, false);
  }
  assert.deepEqual(terminalStatuses, [
    "completed",
    "partially_failed",
    "failed",
    "cancelled",
    "superseded",
    "expired",
  ]);
  assert.equal(terminalAuthorityChecks, 0);

  let targetChecks = 0;
  const staleTarget = planResume.createEvryConversationPlanResumeRevalidator({
    registry: PLAN_FIXTURE_REGISTRY,
    loadExact: loadPlan,
    eligibleCapabilitiesForActor: () => ELIGIBLE_FIXTURE_CAPABILITIES,
    targetIsCurrent: async () => {
      targetChecks += 1;
      return false;
    },
  });
  const changedTargetPlan = await staleTarget({
    actor: capturedActor,
    identity: PLAN,
    checkedAt: new Date("2026-08-20T12:05:00.000Z"),
  });
  assert.equal(changedTargetPlan.status, "stale");
  assert.equal(changedTargetPlan.confirmable, false);
  assert.equal(targetChecks, 1);

  const confirmation = parseArtifactDocument({
    kind: "confirmation",
    plan: PLAN,
    title: "Create the follow-up task",
    actionLabel: "Create task",
    items: [{ label: "Task", value: "Café follow-up" }],
    consequences: ["One task will be created."],
  });
  stored = await conversations.appendTrustedEvryConversationMessage({
    messageId: evryConversationMessageIdSchema.parse(randomUUID()),
    actor: capturedActor,
    conversationId: CONVERSATION_ID,
    requestKey: evryConversationRequestKeySchema.parse(randomUUID()),
    expectedStateVersion: stored.stateVersion,
    state: stored.state,
    author: "assistant",
    body: "Review the task before creating it.",
    pageContext: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    artifacts: [confirmation],
    idempotencyContext: { status: "none" },
    activePlan: { mode: "set", plan: PLAN },
    now: START,
    store,
  });

  // A new handler invocation and newly minted session actor reopen the stored
  // aggregate eight days later. Only the exact plan read runs; no effect seam
  // exists anywhere in the resume path.
  sessions = [user()];
  events.length = 0;
  const reopened = await response(
    await get(new Request("http://localhost/api/evry/conversations/x"), {
      params: Promise.resolve({ conversationId: CONVERSATION_ID }),
    })
  );
  assert.equal(reopened.status, 200);
  assert.equal(reopened.cacheControl, "private, no-store");
  assert.equal(reopened.body.conversation.activePlan.status, "expired");
  assert.equal(reopened.body.conversation.activePlan.confirmable, false);
  assert.equal(reopened.body.conversation.messages[0].body, LITERAL);
  assert.deepEqual(events, ["auth", "find", "plan-read"]);

  sessions = [user()];
  events.length = 0;
  const continued = await response(
    await messagePost(
      request(
        `http://localhost/api/evry/conversations/${CONVERSATION_ID}/messages`,
        { requestKey: randomUUID(), message: "Add her to it." }
      ),
      { params: Promise.resolve({ conversationId: CONVERSATION_ID }) }
    )
  );
  assert.equal(continued.status, 200);
  assert.equal(continued.cacheControl, "private, no-store");
  assert.equal(continued.body.status, "clarification");
  assert.equal(continued.body.reference.reason, "missing");
  assert.equal(
    continued.body.conversation.messages.at(-1).artifacts[0].artifact.kind,
    "clarification"
  );
  assert.equal(events.includes("plan-read"), true);
  assert.equal(events.includes("effect"), false);

  for (const session of [user(), user(OTHER_USER_ID)]) {
    sessions = [session];
    const unavailable = await response(
      await get(new Request("http://localhost/api/evry/conversations/x"), {
        params: Promise.resolve({
          conversationId:
            session.id === USER_ID ? randomUUID() : CONVERSATION_ID,
        }),
      })
    );
    assert.deepEqual(unavailable, {
      status: 404,
      cacheControl: "private, no-store",
      body: { status: "unavailable" },
    });
  }

  process.stdout.write("Evry conversation request proof passed\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
