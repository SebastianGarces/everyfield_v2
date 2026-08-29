import assert from "node:assert/strict";
import { test } from "node:test";

import type { PublicEvryConversation } from "@/components/evry/client-contract";
import { EVRY_CONFIRMATION_FIXTURES } from "@/lib/evry/artifacts/fixtures";
import { buildEvryReceiptArtifact } from "@/lib/evry/artifacts/review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";

import {
  awaitingEvryCreatedConversation,
  canUseEvryHistoryComposer,
  canUseEvryNewComposer,
  conversationMatchesVisibleSearch,
  EVRY_HISTORY_STATE_PRESENTATION,
  evryCreatedConversationSyncDecision,
  evryHistoryConversationIdToLoad,
  evryHistoryHref,
  evryHistorySelectedConversationId,
  evryHistoryStateForConversation,
  latestEvryHistoryCheckpoint,
  shouldRestoreEvryNewComposer,
} from "./history-presentation";

const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const PLAN = evryConversationPlanIdentitySchema.parse({
  planId: "40000000-0000-4000-8000-000000000001",
  fingerprint: "a".repeat(64),
});
const COMPLETED_RECEIPT = buildEvryReceiptArtifact({
  kind: "result",
  artifactVersion: 1,
  plan: PLAN,
  title: "Meeting invitation sent",
  status: "completed",
  steps: [
    {
      stepId: "send-invitations",
      label: "Send meeting invitations",
      status: "completed",
      resultCode: "effect_completed",
      affectedCount: 24,
      excludedCount: 0,
      sourceLinks: [],
      retry: { status: "unavailable" },
      error: null,
    },
  ],
});

function conversation(input?: {
  activePlan?: PublicEvryConversation["activePlan"];
  artifacts?: PublicEvryConversation["messages"][number]["artifacts"];
  laterArtifacts?: PublicEvryConversation["messages"][number]["artifacts"];
}): PublicEvryConversation {
  return {
    id: CONVERSATION_ID,
    title: "Meeting invitation",
    createdAt: "2026-08-20T12:00:00.000Z",
    lastActivityAt: "2026-08-28T12:00:00.000Z",
    activePlan: input?.activePlan ?? null,
    stateVersion: 1,
    state: {},
    messages: [
      {
        id: "50000000-0000-4000-8000-000000000001",
        sequence: 0,
        author: "user",
        body: "Invite the core team to the September meeting.",
        pageContext: null,
        deliveryStatus: "complete",
        createdAt: "2026-08-20T12:00:00.000Z",
        artifacts: input?.artifacts ?? [],
      },
      {
        id: "50000000-0000-4000-8000-000000000002",
        sequence: 1,
        author: "user",
        body: "Keep this later plain turn visible too.",
        pageContext: null,
        deliveryStatus: "complete",
        createdAt: "2026-08-28T12:00:00.000Z",
        artifacts: input?.laterArtifacts ?? [],
      },
    ],
  };
}

test("history labels cover every actionable state with visible words", () => {
  assert.deepEqual(Object.keys(EVRY_HISTORY_STATE_PRESENTATION).sort(), [
    "awaiting_confirmation",
    "completed",
    "needs_attention",
    "ready",
    "rebuild_required",
    "running",
  ]);
  for (const presentation of Object.values(EVRY_HISTORY_STATE_PRESENTATION)) {
    assert.ok(presentation.label.length > 0);
  }
});

test("a completed plan yields to a later request or clarification", () => {
  const activePlan = {
    identity: PLAN,
    status: "completed" as const,
    expiresAt: "2026-08-20T12:15:00.000Z",
    confirmable: false,
  };
  const result: PublicEvryConversation["messages"][number]["artifacts"] = [
    {
      id: "60000000-0000-4000-8000-000000000010",
      ordinal: 0,
      artifact: COMPLETED_RECEIPT,
    },
  ];

  assert.equal(
    evryHistoryStateForConversation(
      conversation({ activePlan, artifacts: result })
    ),
    "ready"
  );
  assert.equal(
    evryHistoryStateForConversation(
      conversation({
        activePlan,
        artifacts: result,
        laterArtifacts: [
          {
            id: "60000000-0000-4000-8000-000000000011",
            ordinal: 0,
            artifact: {
              kind: "clarification",
              mode: "missing",
              entityType: "meeting",
              prompt: "Which meeting did you mean?",
            },
          },
        ],
      })
    ),
    "needs_attention"
  );
});

test("search sees the title and visible transcript, never artifact-only fields", () => {
  const fixture = conversation({
    artifacts: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        ordinal: 0,
        artifact: {
          ...EVRY_CONFIRMATION_FIXTURES.communication,
          title: "artifact-only-private-term",
        },
      },
    ],
  });

  assert.equal(
    conversationMatchesVisibleSearch(fixture, "meeting invitation"),
    true
  );
  assert.equal(conversationMatchesVisibleSearch(fixture, "core team"), true);
  assert.equal(
    conversationMatchesVisibleSearch(fixture, "artifact-only-private-term"),
    false
  );
});

test("reopen restores the latest structured checkpoint and a stale plan can only rebuild", () => {
  const fixture = conversation({
    activePlan: {
      identity: PLAN,
      status: "stale",
      expiresAt: null,
      confirmable: false,
    },
    artifacts: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        ordinal: 0,
        artifact: {
          kind: "confirmation",
          plan: PLAN,
          title: "Invite the core team",
          actionLabel: "Send 24 invitations",
          items: [{ label: "Recipients", value: "24 people" }],
          consequences: ["24 messages will be sent."],
        },
      },
    ],
  });

  assert.equal(evryHistoryStateForConversation(fixture), "rebuild_required");
  assert.deepEqual(latestEvryHistoryCheckpoint(fixture), {
    messageId: "50000000-0000-4000-8000-000000000001",
    kind: "confirmation",
    label: "Rebuild needed",
    title: "Invite the core team",
    detail:
      "This plan stays in your history, but its approval is no longer current.",
    rebuildRequired: true,
  });
});

test("history URLs preserve search while selecting and clear selection explicitly", () => {
  assert.equal(
    evryHistoryHref({ conversationId: CONVERSATION_ID, search: "core team" }),
    `/evry?q=core+team&conversation=${CONVERSATION_ID}`
  );
  assert.equal(evryHistoryHref({ search: "core team" }), "/evry?q=core+team");
  assert.equal(
    evryHistoryHref({ newConversation: true, search: "core team" }),
    "/evry?q=core+team&new=1"
  );
  assert.equal(evryHistoryHref({}), "/evry");
});

test("a delayed selection never exposes the previous conversation's composer", () => {
  const available = (
    navigationPending: boolean,
    selectedConversationId: string | null,
    loadedConversationId: string | null
  ) =>
    canUseEvryHistoryComposer({
      navigationPending,
      selectedConversationId,
      loadedConversationId,
    });

  assert.equal(available(false, "conversation-a", "conversation-a"), true);
  assert.equal(available(true, "conversation-a", "conversation-a"), false);
  assert.equal(available(false, "conversation-b", "conversation-a"), false);
  assert.equal(available(false, "conversation-b", "conversation-b"), true);
});

test("New excludes the stale mounted conversation and syncs only its created id", () => {
  const awaiting = awaitingEvryCreatedConversation("conversation-a");
  const staleMountedConversation = evryCreatedConversationSyncDecision({
    marker: awaiting,
    mountedConversationId: "conversation-a",
    urlConversationId: "conversation-a",
  });
  assert.deepEqual(staleMountedConversation, {
    nextMarker: awaiting,
    conversationIdToSync: null,
  });

  const beforeRouteCommit = evryCreatedConversationSyncDecision({
    marker: staleMountedConversation.nextMarker,
    mountedConversationId: "conversation-b",
    urlConversationId: "conversation-a",
  });
  assert.deepEqual(beforeRouteCommit, {
    nextMarker: {
      kind: "captured",
      conversationId: "conversation-b",
    },
    conversationIdToSync: null,
  });

  const afterRouteCommit = evryCreatedConversationSyncDecision({
    marker: beforeRouteCommit.nextMarker,
    mountedConversationId: "conversation-b",
    urlConversationId: null,
  });
  assert.deepEqual(afterRouteCommit, {
    nextMarker: null,
    conversationIdToSync: "conversation-b",
  });
  assert.deepEqual(
    evryCreatedConversationSyncDecision({
      marker: afterRouteCommit.nextMarker,
      mountedConversationId: "conversation-b",
      urlConversationId: null,
    }),
    { nextMarker: null, conversationIdToSync: null }
  );
});

test("New cannot expose or reload stale conversation A before its route commits", () => {
  const selectedWhileStale = evryHistorySelectedConversationId({
    isCreatingNew: true,
    previousConversationId: "conversation-a",
    mountedConversationId: "conversation-a",
    routeConversationId: "conversation-a",
  });
  assert.equal(selectedWhileStale, null);
  assert.equal(
    canUseEvryNewComposer({
      isCreatingNew: true,
      mountedConversationId: "conversation-a",
    }),
    false
  );
  assert.equal(
    canUseEvryHistoryComposer({
      navigationPending: false,
      selectedConversationId: selectedWhileStale,
      loadedConversationId: "conversation-a",
    }),
    false
  );
  assert.equal(
    evryHistoryConversationIdToLoad({
      isCreatingNew: true,
      navigationPending: false,
      routeConversationId: "conversation-a",
    }),
    null
  );
  assert.equal(
    canUseEvryNewComposer({
      isCreatingNew: true,
      mountedConversationId: null,
    }),
    true
  );

  const selectedAfterCreate = evryHistorySelectedConversationId({
    isCreatingNew: true,
    previousConversationId: "conversation-a",
    mountedConversationId: "conversation-b",
    routeConversationId: null,
  });
  assert.equal(selectedAfterCreate, "conversation-b");
  assert.equal(
    canUseEvryHistoryComposer({
      navigationPending: false,
      selectedConversationId: selectedAfterCreate,
      loadedConversationId: "conversation-b",
    }),
    true
  );
});

test("expansion restores an unsent draft or page context without resetting it", () => {
  const shouldRestore = (hasDraft: boolean, hasPageContext: boolean) =>
    shouldRestoreEvryNewComposer({
      routeConversationId: null,
      loadedConversationId: null,
      hasDraft,
      hasPageContext,
    });

  assert.equal(shouldRestore(true, false), true);
  assert.equal(shouldRestore(false, true), true);
  assert.equal(shouldRestore(false, false), false);
  assert.equal(
    shouldRestoreEvryNewComposer({
      routeConversationId: "conversation-a",
      loadedConversationId: null,
      hasDraft: true,
      hasPageContext: true,
    }),
    false
  );
});
