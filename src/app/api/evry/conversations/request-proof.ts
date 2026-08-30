import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mock } from "node:test";

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

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
import type {
  EvryConversationActiveRunCoordinator,
  PreparedEvryConversationRun,
} from "@/lib/evry/runs/conversation";
import type { EvryConversationStreamStage } from "@/lib/evry/streaming/conversation-wire";
import type {
  EvryPageContext,
  EvryResolvedPageContext,
} from "@/lib/evry/resolvers/contract";
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
const LOCAL_TASK_ID = "50000000-0000-4000-8000-000000000001";
const FOREIGN_TASK_ID = "50000000-0000-4000-8000-000000000002";
const LOCAL_LAUNCH_ID = "60000000-0000-4000-8000-000000000001";
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
const contextQueries: Array<Readonly<{ sql: string; params: unknown[] }>> = [];
const dialect = new PgDialect();
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

const fakeDatabase = {
  select() {
    return {
      from() {
        return {
          where(predicate: SQL) {
            const query = dialect.sqlToQuery(predicate);
            contextQueries.push({ sql: query.sql, params: query.params });
            return {
              async limit() {
                if (query.sql.includes('"tasks"')) {
                  const [recordId, plantId] = query.params;
                  if (recordId === LOCAL_TASK_ID && plantId === PLANT_ID) {
                    return [{ id: LOCAL_TASK_ID, title: "Scoped task" }];
                  }
                  if (
                    recordId === FOREIGN_TASK_ID &&
                    plantId === "10000000-0000-4000-8000-000000000002"
                  ) {
                    return [{ id: FOREIGN_TASK_ID }];
                  }
                  return [];
                }

                if (
                  query.sql.includes('"launches"') &&
                  query.params[0] === PLANT_ID
                ) {
                  return [{ id: LOCAL_LAUNCH_ID }];
                }
                return [];
              },
            };
          },
        };
      },
    };
  },
};

mock.module("@/db", { namedExports: { db: fakeDatabase } });

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

function streamRequest(url: string, body: unknown): Request {
  return new TracedRequest(url, {
    method: "POST",
    headers: {
      accept: "application/x-ndjson",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function streamEvents(result: Response): Promise<unknown[]> {
  assert.match(
    result.headers.get("content-type") ?? "",
    /application\/x-ndjson/
  );
  return (await result.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

let stored: EvryStoredConversation | null = null;
const requestPageContexts = new Map<string, EvryPageContext | null>();

function rememberRequestPageContext(
  requestKey: string,
  pageContext: EvryPageContext | null
): void {
  if (pageContext !== null) {
    assert.deepEqual(Object.keys(pageContext).sort(), ["kind", "recordId"]);
  }
  const existing = requestPageContexts.get(requestKey);
  if (existing !== undefined) {
    assert.deepEqual(pageContext, existing);
    return;
  }
  requestPageContexts.set(requestKey, pageContext);
}

function newMessage(input: {
  id?: string;
  requestKey: string;
  sequence: number;
  author: "user" | "assistant";
  body: string;
  pageContext: EvryStoredConversationMessage["pageContext"];
  requestPageContext?: EvryStoredConversationMessage["requestPageContext"];
  replayReference?: EvryStoredConversationMessage["replayReference"];
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
    requestPageContext: input.requestPageContext,
    replayReference: input.replayReference ?? null,
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
    rememberRequestPageContext(input.requestKey, input.requestPageContext);
    const replay = stored?.messages.find(
      ({ requestKey }) => requestKey === input.requestKey
    );
    if (replay) {
      assert.equal(replay.body, input.body);
      assert.ok(stored);
      return stored;
    }
    const initial = newMessage({
      requestKey: input.requestKey,
      sequence: 0,
      author: "user",
      body: input.body,
      pageContext: input.pageContext,
      requestPageContext: input.requestPageContext,
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
    rememberRequestPageContext(input.requestKey, input.requestPageContext);
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
      requestPageContext: input.requestPageContext,
      replayReference: input.replayReference,
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

type ProofConversationMessage = Readonly<{
  author: "user" | "assistant";
  body: string;
  pageContext: EvryStoredConversationMessage["pageContext"];
}>;

function messageWithBody(
  messages: readonly ProofConversationMessage[],
  body: string
): ProofConversationMessage {
  const found = messages.find(
    (message) => message.author === "user" && message.body === body
  );
  assert.ok(found);
  return found;
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
  const streamContract = await import("@/lib/evry/streaming/conversation-wire");
  const runContract = await import("@/lib/evry/runs/contract");
  const createRoute = await import("./route");
  const getRoute = await import("./[conversationId]/route");
  const messageRoute = await import("./[conversationId]/messages/route");
  const reuseRoute = await import("./[conversationId]/reuse/route");
  const pageContextResolver = await import("@/lib/evry/resolvers/page-context");

  let capturedActor: EvryPlantActor | null = null;
  const activeRuns: EvryConversationActiveRunCoordinator = {
    async prepare(
      input: Parameters<
        typeof import("@/lib/evry/runs/conversation").prepareEvryConversationActiveRun
      >[0]
    ) {
      return {
        input,
        claim: {
          ownership: "claimed" as const,
          run: runContract.parseEvryActiveRunRecord({
            id: randomUUID(),
            churchId: input.actor.plantId,
            actorUserId: input.actor.userId,
            requestKey: input.requestKey,
            requestFingerprint: runContract.fingerprintEvryActiveRunRequest(
              input.fingerprintInput
            ),
            kind: "conversation",
            operation: input.identity.operation,
            status: "active",
            stage: "accepted",
            version: 0,
            conversationId: input.identity.conversationId,
            planId: null,
            planFingerprint: null,
            startedAt: input.startedAt,
            changedAt: input.startedAt,
            expiresAt: new Date(
              input.startedAt.valueOf() + runContract.EVRY_ACTIVE_RUN_TTL_MS
            ),
            completedAt: null,
          }),
        },
      };
    },
    async run(
      prepared: PreparedEvryConversationRun,
      report: (stage: EvryConversationStreamStage) => void
    ) {
      return prepared.input.perform(async (stage) => report(stage));
    },
  };
  let pageContextRecordState: "available" | "missing" | "renamed" = "available";
  const resolvePageContext = async (input: {
    actor: EvryPlantActor;
    pageContext: EvryPageContext | null;
  }): Promise<EvryResolvedPageContext | null> => {
    if (input.pageContext === null) return null;
    events.push("context");
    assert.equal(input.actor.plantId, PLANT_ID);
    return input.pageContext.recordId === "foreign-task" ||
      pageContextRecordState === "missing"
      ? null
      : {
          ...input.pageContext,
          label:
            pageContextRecordState === "renamed"
              ? `Renamed ${input.pageContext.kind}`
              : `Scoped ${input.pageContext.kind}`,
        };
  };
  const createPost = createRoute.createEvryConversationCreatePost({
    activeRuns,
    now: () => START,
    resolvePageContext,
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
    activeRuns,
    now: () => RETURN,
    resolvePageContext,
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
    resolvePageContext,
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
  assert.deepEqual(events, ["auth", "body", "context", "idempotency-conflict"]);
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
  assert.deepEqual(created.body.conversation.messages[0].pageContext, {
    kind: "task",
    recordId: "task-1",
    label: "Scoped task",
  });
  assert.equal(created.body.conversation.messages[1].author, "assistant");
  assert.equal(
    created.body.conversation.messages[1].artifacts[0].artifact.kind,
    "boundary"
  );
  assert.deepEqual(events, [
    "auth",
    "body",
    "context",
    "create",
    "append",
    "find",
  ]);
  assert.ok(capturedActor);
  assert.ok(stored);

  sessions = [user()];
  events.length = 0;
  const createStream = (
    await streamEvents(
      await createPost(
        streamRequest("http://localhost/api/evry/conversations", {
          requestKey: firstRequestKey,
          message: LITERAL,
          pageContext: { kind: "task", recordId: "task-1" },
        })
      )
    )
  ).map((event) =>
    streamContract.evryConversationStreamEventSchema.parse(event)
  );
  assert.deepEqual(
    createStream.map((event) => [
      event.type,
      "code" in event ? event.code : null,
    ]),
    [
      ["work", "request_accepted"],
      ["work", "compiling_response"],
      ["conversation", null],
      ["complete", null],
    ]
  );
  assert.deepEqual(
    createStream.map((event) => event.sequence),
    [0, 1, 2, 3]
  );
  assert.equal(createStream[2]?.requestId, firstRequestKey);
  assert.deepEqual(events, ["auth", "body", "context", "create", "find"]);

  pageContextRecordState = "missing";
  sessions = [user()];
  events.length = 0;
  const replayedCreateAfterDelete = await response(
    await createPost(
      request("http://localhost/api/evry/conversations", {
        requestKey: firstRequestKey,
        message: LITERAL,
        pageContext: { kind: "task", recordId: "task-1" },
      })
    )
  );
  assert.equal(replayedCreateAfterDelete.status, 201);
  assert.equal(replayedCreateAfterDelete.body.conversation.id, CONVERSATION_ID);
  assert.equal(replayedCreateAfterDelete.body.conversation.messages.length, 2);
  assert.equal(
    replayedCreateAfterDelete.body.conversation.messages[0].pageContext.label,
    "Scoped task"
  );
  assert.deepEqual(events, ["auth", "body", "context", "create", "find"]);
  pageContextRecordState = "available";

  contextQueries.length = 0;
  assert.equal(
    await pageContextResolver.resolveAuthorizedEvryPageContext({
      actor: capturedActor,
      pageContext: { kind: "task", recordId: "not-a-uuid" },
    }),
    null
  );
  assert.equal(contextQueries.length, 0, "invalid ids must not reach the DB");

  assert.deepEqual(
    await pageContextResolver.resolveAuthorizedEvryPageContext({
      actor: capturedActor,
      pageContext: { kind: "task", recordId: LOCAL_TASK_ID },
    }),
    { kind: "task", recordId: LOCAL_TASK_ID, label: "Scoped task" }
  );
  assert.equal(contextQueries.at(-1)?.sql.includes('"tasks"'), true);
  assert.deepEqual(contextQueries.at(-1)?.params.slice(0, 2), [
    LOCAL_TASK_ID,
    PLANT_ID,
  ]);

  assert.equal(
    await pageContextResolver.resolveAuthorizedEvryPageContext({
      actor: capturedActor,
      pageContext: { kind: "task", recordId: FOREIGN_TASK_ID },
    }),
    null
  );
  assert.deepEqual(contextQueries.at(-1)?.params.slice(0, 2), [
    FOREIGN_TASK_ID,
    PLANT_ID,
  ]);

  assert.deepEqual(
    await pageContextResolver.resolveAuthorizedEvryPageContext({
      actor: capturedActor,
      pageContext: { kind: "launch", recordId: "current" },
    }),
    {
      kind: "launch",
      recordId: LOCAL_LAUNCH_ID,
      label: "Launch Sunday",
    }
  );

  sessions = [user()];
  events.length = 0;
  const forgedContext = await response(
    await messagePost(
      request(
        `http://localhost/api/evry/conversations/${CONVERSATION_ID}/messages`,
        {
          requestKey: randomUUID(),
          message: "Keep working on this request.",
          pageContext: { kind: "task", recordId: "foreign-task" },
        }
      ),
      { params: Promise.resolve({ conversationId: CONVERSATION_ID }) }
    )
  );
  assert.equal(forgedContext.status, 200);
  const forgedContextMessage = messageWithBody(
    forgedContext.body.conversation.messages,
    "Keep working on this request."
  );
  assert.equal(forgedContextMessage.pageContext, null);
  assert.deepEqual(events.slice(0, 4), ["auth", "body", "find", "context"]);

  const appendRetryKey = randomUUID();
  const appendRetryBody = "Keep the scoped task in this request.";
  sessions = [user()];
  events.length = 0;
  const firstAppend = await response(
    await messagePost(
      request(
        `http://localhost/api/evry/conversations/${CONVERSATION_ID}/messages`,
        {
          requestKey: appendRetryKey,
          message: appendRetryBody,
          pageContext: { kind: "task", recordId: "task-1" },
        }
      ),
      { params: Promise.resolve({ conversationId: CONVERSATION_ID }) }
    )
  );
  assert.equal(firstAppend.status, 200);
  const firstAppendMessage = messageWithBody(
    firstAppend.body.conversation.messages,
    appendRetryBody
  );
  assert.equal(firstAppendMessage.pageContext?.label, "Scoped task");
  const messageCountAfterFirstAppend =
    firstAppend.body.conversation.messages.length;

  sessions = [user()];
  events.length = 0;
  const continuationStream = (
    await streamEvents(
      await messagePost(
        streamRequest(
          `http://localhost/api/evry/conversations/${CONVERSATION_ID}/messages`,
          {
            requestKey: appendRetryKey,
            message: appendRetryBody,
            pageContext: { kind: "task", recordId: "task-1" },
          }
        ),
        { params: Promise.resolve({ conversationId: CONVERSATION_ID }) }
      )
    )
  ).map((event) =>
    streamContract.evryConversationStreamEventSchema.parse(event)
  );
  assert.deepEqual(
    continuationStream.map((event) => [
      event.type,
      "code" in event ? event.code : null,
    ]),
    [
      ["work", "request_accepted"],
      ["conversation", null],
      ["complete", null],
    ]
  );
  assert.deepEqual(
    continuationStream.map((event) => event.sequence),
    [0, 1, 2]
  );
  assert.equal(continuationStream[1]?.requestId, appendRetryKey);

  pageContextRecordState = "missing";
  sessions = [user()];
  events.length = 0;
  const replayedAppendAfterDelete = await response(
    await messagePost(
      request(
        `http://localhost/api/evry/conversations/${CONVERSATION_ID}/messages`,
        {
          requestKey: appendRetryKey,
          message: appendRetryBody,
          pageContext: { kind: "task", recordId: "task-1" },
        }
      ),
      { params: Promise.resolve({ conversationId: CONVERSATION_ID }) }
    )
  );
  assert.equal(replayedAppendAfterDelete.status, 200);
  assert.equal(
    replayedAppendAfterDelete.body.conversation.messages.length,
    messageCountAfterFirstAppend
  );
  assert.equal(
    messageWithBody(
      replayedAppendAfterDelete.body.conversation.messages,
      appendRetryBody
    ).pageContext?.label,
    "Scoped task"
  );
  assert.deepEqual(events, ["auth", "body", "find", "find"]);

  sessions = [user()];
  events.length = 0;
  const changedAppendContext = await response(
    await messagePost(
      request(
        `http://localhost/api/evry/conversations/${CONVERSATION_ID}/messages`,
        {
          requestKey: appendRetryKey,
          message: appendRetryBody,
          pageContext: { kind: "task", recordId: "foreign-task" },
        }
      ),
      { params: Promise.resolve({ conversationId: CONVERSATION_ID }) }
    )
  );
  assert.equal(changedAppendContext.status, 409);
  assert.deepEqual(changedAppendContext.body, { status: "stale" });
  assert.deepEqual(events, ["auth", "body", "find"]);
  pageContextRecordState = "available";

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
    requestPageContext: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    artifacts: [confirmation],
    idempotencyContext: { status: "none" },
    replayReference: null,
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
  assert.equal(
    reopened.body.conversation.messages[0].pageContext.label,
    "Scoped task"
  );
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

  const reusePost = reuseRoute.createEvryRecipeReusePost({
    activeRuns,
    now: () => RETURN,
    async reuse(input) {
      events.push("reuse");
      assert.equal(input.actor.userId, USER_ID);
      assert.equal(input.actor.plantId, PLANT_ID);
      assert.equal(input.sourceConversationId, CONVERSATION_ID);
      assert.equal(input.recipeIdentity, "fixture.recipe");
      assert.equal(input.now, RETURN);
      assert.ok(stored);
      return {
        status: "created",
        copiedIntent: "Reuse the visible meeting invitation intent.",
        resumed: {
          conversation: stored,
          activePlan: null,
          context: {} as never,
        },
      };
    },
  });
  sessions = [null];
  events.length = 0;
  const unauthenticatedReuse = await response(
    await reusePost(
      request(
        `http://localhost/api/evry/conversations/${CONVERSATION_ID}/reuse`,
        {
          requestKey: "not-a-uuid",
          resultArtifactId: "not-a-uuid",
          recipeIdentity: "fixture.recipe",
        }
      ),
      { params: Promise.resolve({ conversationId: "not-a-uuid" }) }
    )
  );
  assert.deepEqual(events, ["auth"]);
  assert.deepEqual(unauthenticatedReuse, {
    status: 401,
    cacheControl: "private, no-store",
    body: { status: "unavailable" },
  });

  sessions = [user()];
  events.length = 0;
  const reused = await response(
    await reusePost(
      request(
        `http://localhost/api/evry/conversations/${CONVERSATION_ID}/reuse`,
        {
          requestKey: randomUUID(),
          resultArtifactId: randomUUID(),
          recipeIdentity: "fixture.recipe",
        }
      ),
      { params: Promise.resolve({ conversationId: CONVERSATION_ID }) }
    )
  );
  assert.deepEqual(events, ["auth", "body", "reuse"]);
  assert.equal(reused.status, 201);
  assert.equal(reused.cacheControl, "private, no-store");
  assert.equal(reused.body.status, "created");
  assert.equal(reused.body.conversation.id, CONVERSATION_ID);

  process.stdout.write("Evry conversation request proof passed\n");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
