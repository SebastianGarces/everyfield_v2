import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import {
  initialEvryConversationState,
  evryConversationIdSchema,
  evryConversationRequestKeySchema,
} from "@/lib/evry/conversations/contract";
import type {
  EvryStoredConversation,
  EvryStoredConversationMessage,
  appendEvryConversationRecord,
} from "@/lib/evry/conversations/repository";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryReadCapabilityAuthorization } from "@/lib/evry/eligibility/capabilities";
import {
  createModelEvryConversation,
  type EvryModelRead,
} from "./model-conversation";
import { generateEvryModelTurn } from "./model-turn";
import { evryCapabilityConversationResultIdentity } from "./conversation";
import {
  modelDecision,
  scriptedConversationModel,
} from "./model-test-fixtures";
import { PRODUCTION_EVRY_MODEL_READS } from "./production";
import { INITIAL_MEETING_CONFIRMATION } from "@/lib/evry/artifacts/fixtures";
import { storedEvryReadArtifactDocument } from "@/lib/evry/conversations/artifacts";
import { createMeetingInvitationConversationContinuation } from "@/lib/evry/recipes/meeting-invitation-conversation";
import {
  hydrateStoredEvryConversationArtifact,
  parseEvryConversationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";

const now = new Date("2026-09-07T16:00:00Z");
const actor = {
  userId: "20000000-0000-4000-8000-000000000001",
  plantId: "30000000-0000-4000-8000-000000000001",
  seat: "owner",
} as EvryPlantActor;
const conversation: EvryStoredConversation = {
  id: evryConversationIdSchema.parse("10000000-0000-4000-8000-000000000001"),
  actorUserId: actor.userId,
  plantId: actor.plantId,
  title: "Test",
  createdAt: now,
  lastActivityAt: now,
  stateVersion: 0,
  state: initialEvryConversationState(),
  messages: [],
  activePlan: null,
};
const requestKey = "40000000-0000-4000-8000-000000000001";

test("a lookup can feed a second freshly authorized read without another user message", async () => {
  const f = fixture();
  let generations = 0;
  let authorizations = 0;
  const dispatch = createModelEvryConversation({
    reads: [f.read],
    continuations: [],
    authorizeRead: async () => {
      authorizations++;
      return f.authorization;
    },
    generate: async (input) => {
      generations++;
      if (generations === 2) {
        assert.match(JSON.stringify(input.context), /freshReadResults/);
        assert.match(JSON.stringify(input.context), /People needing follow-up/);
      }
      return {
        kind: "read",
        id: f.read.id,
        input: {
          section: generations === 1 ? "contacts" : "unowned_contacts",
          cursor: null,
        },
        ...(generations === 1 ? { continueReading: true as const } : {}),
      };
    },
  });
  await dispatch(f.input);
  assert.equal(generations, 2);
  assert.equal(authorizations, 2);
  assert.equal(f.runs.length, 2);
  assert.equal(f.appends.length, 1);
});

test("lookup chains stop after four reads and never prepare an effect after reading", async () => {
  for (const attemptsPreparation of [false, true]) {
    const f = fixture();
    let generations = 0;
    const dispatch = createModelEvryConversation({
      reads: [f.read],
      continuations: [],
      authorizeRead: async () => f.authorization,
      generate: async () => {
        generations++;
        if (attemptsPreparation && generations === 2)
          return { kind: "prepare" };
        if (attemptsPreparation && generations === 3)
          return {
            kind: "reply",
            body: "Please ask for the change separately.",
          };
        return {
          kind: "read",
          id: f.read.id,
          input: { section: "contacts", cursor: null },
          continueReading: true,
        };
      },
    });
    await dispatch(f.input);
    assert.equal(f.runs.length, attemptsPreparation ? 1 : 4);
    assert.equal(f.appends.length, 1);
    if (!attemptsPreparation)
      assert.match(JSON.stringify(f.appends), /lookup limit/);
  }
});

function userMessage(
  body: string,
  createdAt = now
): EvryStoredConversationMessage {
  const identity = evryCapabilityConversationResultIdentity({
    conversationId: conversation.id,
    userRequestKey: requestKey + ":user",
  });
  return {
    id: identity.messageId,
    requestKey: evryConversationRequestKeySchema.parse(requestKey),
    sequence: 1,
    author: "user",
    body,
    createdAt,
    pageContext: null,
    requestPageContext: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    artifacts: [],
  };
}

function fixture() {
  const runs: unknown[] = [];
  const appends: unknown[] = [];
  const read: EvryModelRead = {
    id: "tasks.follow-up-ownership",
    capabilityIdentity: "tasks.read.follow-up-ownership",
    inputSchema: z.strictObject({
      section: z.enum(["contacts", "unowned_contacts"]),
      cursor: z.string().uuid().nullable(),
    }),
    async run(_authorization, input, args) {
      runs.push({ literalUserText: input.literalUserText, args });
      return buildEvryReadArtifact({
        title: "People needing follow-up",
        filters: [],
        exclusions: [],
        items: [],
        sourceLinks: [],
      });
    },
  };
  const authorization = {
    actor,
    registration: { identity: read.capabilityIdentity, operationKind: "read" },
  } as EvryReadCapabilityAuthorization;
  const input = {
    actor,
    conversation,
    userRequestKey: requestKey,
    literalUserText: "please give me a list of people that need follow up",
    pageContext: null,
    requestPageContext: null,
    now,
    store: {
      async append(value: unknown) {
        appends.push(value);
        return conversation;
      },
    },
  };
  return { read, input, authorization, runs, appends };
}

test("the screenshot request reaches the model then a typed authorized read without any phrase matcher", async () => {
  const f = fixture();
  const scripted = scriptedConversationModel(
    modelDecision({
      readId: f.read.id,
      readInputJson: '{"section":"contacts","cursor":null}',
    })
  );
  const dispatch = createModelEvryConversation({
    reads: [f.read],
    continuations: [],
    generate: (input) => generateEvryModelTurn(input, () => scripted.model),
    authorizeRead: async () => f.authorization,
  });
  await dispatch(f.input);
  assert.equal(scripted.calls.length, 1);
  assert.deepEqual(f.runs, [
    {
      literalUserText: f.input.literalUserText,
      args: { section: "contacts", cursor: null },
    },
  ]);
  assert.equal(f.appends.length, 1);
  assert.match(JSON.stringify(f.appends), /People needing follow-up/);
});

test("replay returns the durable answer without another model call", async () => {
  const f = fixture();
  const identity = evryCapabilityConversationResultIdentity({
    conversationId: conversation.id,
    userRequestKey: requestKey,
  });
  const current: EvryStoredConversation = {
    ...conversation,
    messages: [
      {
        id: identity.messageId,
        requestKey: identity.requestKey,
        sequence: 2,
        author: "assistant",
        body: "An existing model reply",
        pageContext: null,
        relevanceKeys: [],
        deliveryStatus: "complete",
        createdAt: now,
        artifacts: [],
      },
    ],
  };
  const dispatch = createModelEvryConversation({
    reads: [f.read],
    continuations: [],
    generate: async () => {
      throw new Error("must not call model");
    },
  });
  assert.equal(await dispatch({ ...f.input, conversation: current }), current);
  assert.equal(f.appends.length, 0);
});

test("unknown tools, invalid arguments, denied permissions, and switched tenants never run a read", async () => {
  for (const mode of [
    "unknown",
    "invalid",
    "denied",
    "changed-tenant",
    "changed-user",
  ]) {
    const f = fixture();
    let calls = 0;
    const dispatch = createModelEvryConversation({
      reads: [f.read],
      continuations: [],
      generate: async () =>
        ++calls === 1
          ? {
              kind: "read",
              id: mode === "unknown" ? "raw.sql" : f.read.id,
              input:
                mode === "invalid"
                  ? { section: "contacts", cursor: null, plantId: "foreign" }
                  : { section: "contacts", cursor: null },
            }
          : {
              kind: "reply",
              body: "I couldn't access that information. Which list do you need?",
            },
      authorizeRead: async () =>
        mode === "denied"
          ? null
          : {
              ...f.authorization,
              actor: {
                ...actor,
                plantId: mode === "changed-tenant" ? "foreign" : actor.plantId,
                userId: mode === "changed-user" ? "foreign" : actor.userId,
              },
            },
    });
    await dispatch(f.input);
    assert.equal(calls, 2, mode);
    assert.equal(f.runs.length, 0, mode);
    assert.equal(f.appends.length, 1, mode);
  }
});

test("plain model replies do not prepare plans, execute effects, or erase a pending plan", async () => {
  const f = fixture();
  const dispatch = createModelEvryConversation({
    reads: [f.read],
    continuations: [
      {
        identity: "test-plan",
        matches: () => true,
        continue: async () => {
          throw new Error("must not prepare");
        },
      },
    ],
    generate: async () => ({
      kind: "reply",
      body: "Use the confirmation button to approve the exact plan.",
    }),
  });
  await dispatch({ ...f.input, literalUserText: "yes send it" });
  assert.equal(f.runs.length, 0);
  assert.deepEqual((f.appends[0] as { activePlan: unknown }).activePlan, {
    mode: "preserve",
  });
});

test("all installed model reads have unique ids and serializable schemas", () => {
  assert.equal(
    new Set(PRODUCTION_EVRY_MODEL_READS.map(({ id }) => id)).size,
    PRODUCTION_EVRY_MODEL_READS.length
  );
  assert.ok(
    PRODUCTION_EVRY_MODEL_READS.some(
      ({ id }) => id === "tasks.follow-up-ownership"
    )
  );
  assert.ok(
    PRODUCTION_EVRY_MODEL_READS.some(({ id }) => id === "meetings.read.list")
  );
  for (const read of PRODUCTION_EVRY_MODEL_READS)
    assert.doesNotThrow(
      () => z.toJSONSchema(read.inputSchema, { unrepresentable: "any" }),
      read.id
    );
});

test("a plan saved before an interrupted result is recovered without a second model choice", async () => {
  const f = fixture();
  let current = conversation;
  let generations = 0;
  let planWrites = 0;
  let failFinalAppend = true;
  const literal =
    "Create a meeting for tomorrow at 10 AM. Keep this exact title: Café | Outreach";
  current = {
    ...conversation,
    messages: [userMessage(literal, new Date("2026-09-08T00:30:00Z"))],
  };
  const dispatch = createModelEvryConversation({
    reads: [],
    generate: async () =>
      ++generations === 1
        ? { kind: "prepare" }
        : {
            kind: "reply",
            body: "A response to the next request",
          },
    continuations: [
      {
        identity: "test-plan",
        matches: () => true,
        async continue(input) {
          assert.equal(
            input.literalUserText,
            literal,
            "relative dates, recipients and field bytes are not model-rewritten"
          );
          assert.equal(
            input.now.toISOString(),
            "2026-09-08T00:30:00.000Z",
            "the trusted resolver receives the same instant, even across the New York calendar boundary"
          );
          assert.equal(input.userRequestKey, requestKey);
          assert.equal(input.pageContext, null);
          assert.equal(input.requestPageContext, null);
          assert.ok(
            input.conversation.state.pendingModelPreparation,
            "checkpoint precedes any plan work"
          );
          if (planWrites === 0) planWrites++;
          return {
            body: "Review the saved plan",
            artifacts: [INITIAL_MEETING_CONFIRMATION],
            activePlan: {
              mode: "set",
              plan: INITIAL_MEETING_CONFIRMATION.plan,
            },
          };
        },
      },
    ],
  });
  const store: typeof f.input.store = {
    async append(value) {
      const request = value as Parameters<
        typeof appendEvryConversationRecord
      >[0];
      assert.equal(request.expectedStateVersion, current.stateVersion);
      if (!request.state.pendingModelPreparation && failFinalAppend)
        throw new Error("connection lost after plan commit");
      current = {
        ...current,
        stateVersion: current.stateVersion + 1,
        state: request.state,
      };
      return current;
    },
  };
  const input = {
    ...f.input,
    conversation: current,
    literalUserText: literal,
    now: new Date("2026-09-08T00:30:00Z"),
    store,
  };
  await assert.rejects(() => dispatch(input), /connection lost/);
  assert.ok(current.state.pendingModelPreparation);
  failFinalAppend = false;
  await dispatch({
    ...input,
    conversation: current,
    userRequestKey: "50000000-0000-4000-8000-000000000001",
    literalUserText: "What can you do?",
    now: new Date("2026-09-10T12:00:00Z"),
    pageContext: {
      kind: "task",
      recordId: "50000000-0000-4000-8000-000000000001",
      label: "Other page",
    },
    requestPageContext: {
      kind: "task",
      recordId: "50000000-0000-4000-8000-000000000001",
    },
  });
  assert.equal(
    generations,
    2,
    "one original model choice and one new turn, no regenerated preparation"
  );
  assert.equal(planWrites, 1);
  assert.equal(current.state.pendingModelPreparation, null);
});

test("real meeting clarification survives its checkpoint, replay, and terminal unavailability", async () => {
  const f = fixture();
  const original =
    "Create a meeting for August 5, 2026 at 10 AM at the church location, lasting 90 minutes. Invite the core team and add prospects who have not visited a Vision Meeting. Draft an email invitation and send it to them.";
  const document = parseEvryConversationArtifactDocument({
    kind: "clarification",
    mode: "missing",
    entityType: "meeting_location",
    prompt: "Which location?",
  });
  const answer = { ...userMessage("North Hall"), sequence: 3 };
  let current: EvryStoredConversation = {
    ...conversation,
    messages: [
      {
        ...userMessage(original),
        requestKey: evryConversationRequestKeySchema.parse(
          "60000000-0000-4000-8000-000000000001"
        ),
      },
      {
        ...userMessage("Which location?"),
        author: "assistant",
        sequence: 2,
        artifacts: [
          {
            id: "clarification",
            ordinal: 0,
            kind: "clarification",
            document,
            artifact: hydrateStoredEvryConversationArtifact(document),
          },
        ],
      },
      answer,
    ],
  };
  let fail = true;
  let choices = 0;
  let resolutions = 0;
  const continuation = createMeetingInvitationConversationContinuation({
    findPlan: async () => null,
    authorizeRead: async () => f.authorization,
    resolveAuthorized: async ({ request }) => {
      resolutions++;
      assert.equal(request.locationQuery, "North Hall");
      if (fail) throw new Error("temporary resolver outage");
      return { kind: "unavailable" };
    },
    createPlan: async () => {
      throw new Error("no effect or plan may execute in this proof");
    },
  });
  const store = {
    async append(request: Parameters<typeof appendEvryConversationRecord>[0]) {
      assert.equal(request.expectedStateVersion, current.stateVersion);
      current = {
        ...current,
        stateVersion: current.stateVersion + 1,
        state: request.state,
        messages: [
          ...current.messages,
          {
            ...userMessage(request.body),
            id: request.messageId,
            requestKey: request.requestKey,
            author: request.author,
            sequence: current.messages.length + 1,
          },
        ],
      };
      return current;
    },
  };
  const dispatch = createModelEvryConversation({
    reads: [],
    continuations: [continuation],
    generate: async () =>
      ++choices === 1
        ? { kind: "prepare" }
        : {
            kind: "reply",
            body: "I couldn't prepare that review. You can use Meetings.",
          },
  });
  const input = {
    ...f.input,
    store,
    conversation: current,
    literalUserText: answer.body,
  };
  await assert.rejects(() => dispatch(input), /temporary resolver outage/);
  assert.ok(current.state.pendingModelPreparation);
  fail = false;
  await dispatch({ ...input, conversation: current });
  assert.equal(
    resolutions,
    2,
    "both attempts preserve the real meeting location clarification"
  );
  assert.equal(
    choices,
    2,
    "retry only generates terminal explanation, not a new operation choice"
  );
  assert.equal(current.state.pendingModelPreparation, null);
  await dispatch({
    ...input,
    conversation: current,
    literalUserText: "What can you do?",
    userRequestKey: "70000000-0000-4000-8000-000000000001",
  });
  assert.equal(
    choices,
    3,
    "terminal unavailability does not trap the conversation"
  );
});

test("model context includes bounded visible rows and historical older pending plans without target reads", async () => {
  const f = fixture();
  const identity = evryCapabilityConversationResultIdentity({
    conversationId: conversation.id,
    userRequestKey: requestKey,
  });
  const artifact = buildEvryReadArtifact({
    title: "People",
    filters: [],
    exclusions: [],
    sourceLinks: [],
    items: [
      {
        id: "50000000-0000-4000-8000-000000000001",
        label: "Alex",
        facts: [],
        sourceLink: trustedEvryApplicationSourceLink({
          label: "Alex",
          href: "/people/50000000-0000-4000-8000-000000000001",
        }),
      },
    ],
  });
  const oldMessage = {
    id: identity.messageId,
    requestKey: identity.requestKey,
    sequence: 1,
    author: "assistant" as const,
    body: "One person",
    pageContext: null,
    relevanceKeys: [],
    deliveryStatus: "complete" as const,
    createdAt: now,
    artifacts: [
      {
        id: "artifact",
        ordinal: 0,
        kind: "read" as const,
        document: storedEvryReadArtifactDocument(artifact),
        artifact,
      },
    ],
  };
  const messages = [
    oldMessage,
    ...Array.from({ length: 10 }, (_, index) => ({
      ...oldMessage,
      sequence: index + 2,
      body: "A later turn",
      artifacts: [],
    })),
  ];
  const dispatch = createModelEvryConversation({
    reads: [],
    continuations: [],
    generate: async ({ context }) => {
      const encoded = JSON.stringify(context);
      assert.match(encoded, /Alex/);
      assert.match(encoded, /historicalOnly/);
      assert.ok(encoded.includes(INITIAL_MEETING_CONFIRMATION.plan.planId));
      assert.match(encoded, /not_revalidated/);
      return {
        kind: "reply",
        body: "There was an earlier review. Its current status needs checking.",
      };
    },
  });
  await dispatch({
    ...f.input,
    conversation: {
      ...conversation,
      messages,
      activePlan: INITIAL_MEETING_CONFIRMATION.plan,
    },
  });
});
