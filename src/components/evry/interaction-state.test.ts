import assert from "node:assert/strict";
import { test } from "node:test";

import {
  beginEvryConversationLoad,
  canApplyEvryConversationLoadResponse,
  cancelEvryConversationLoads,
  evryDraftAfterSubmission,
  evryConversationSubmissionEndpoint,
  evrySubmissionMessage,
  evryWorkspaceConversationHref,
  finishEvryConversationLoad,
  initialEvryConversationLoadState,
  isEvryConversationLoading,
  isLatestEvryConversationLoad,
  pendingEvrySubmissionFor,
  pendingEvrySubmissionAfterConversation,
  shouldFollowEvryTranscript,
  syncEvryWorkspaceConversationHistory,
  type EvrySubmission,
} from "./interaction-state";

const SUBMISSION: EvrySubmission = {
  conversationId: null,
  message: "Create the Friday follow-up.",
  pageContext: {
    kind: "person",
    recordId: "10000000-0000-4000-8000-000000000001",
  },
};

test("a response-loss retry keeps one request key until success", () => {
  let minted = 0;
  const mint = () => `request-${++minted}`;

  const first = pendingEvrySubmissionFor(null, SUBMISSION, mint);
  const retry = pendingEvrySubmissionFor(first, { ...SUBMISSION }, mint);
  assert.equal(first.requestKey, "request-1");
  assert.equal(retry.requestKey, first.requestKey);
  assert.equal(
    evryConversationSubmissionEndpoint(retry),
    "/api/evry/conversations"
  );
  assert.equal(minted, 1);

  const presented = pendingEvrySubmissionAfterConversation(
    first,
    first.requestKey,
    "10000000-0000-4000-8000-000000000009"
  );
  const retryAfterDurableFrame = pendingEvrySubmissionFor(
    presented,
    {
      ...SUBMISSION,
      conversationId: "10000000-0000-4000-8000-000000000009",
    },
    mint
  );
  assert.equal(retryAfterDurableFrame.requestKey, first.requestKey);
  assert.equal(
    evryConversationSubmissionEndpoint(retryAfterDurableFrame),
    "/api/evry/conversations"
  );
  assert.equal(minted, 1);

  const afterSuccess = pendingEvrySubmissionFor(null, SUBMISSION, mint);
  assert.equal(afterSuccess.requestKey, "request-2");
});

test("a continuation retry preserves its original conversation endpoint", () => {
  const conversationId = "10000000-0000-4000-8000-000000000008";
  const pending = pendingEvrySubmissionFor(
    null,
    { ...SUBMISSION, conversationId },
    () => "request-continue"
  );
  assert.equal(
    evryConversationSubmissionEndpoint(pending),
    `/api/evry/conversations/${conversationId}/messages`
  );
});

test("draft validation preserves every accepted message byte", () => {
  assert.equal(evrySubmissionMessage(" \n\t "), null);
  assert.equal(
    evrySubmissionMessage("  Create café follow-up — keep these bytes.  "),
    "  Create café follow-up — keep these bytes.  "
  );
});

test("a successful request clears only the submitted draft snapshot", () => {
  assert.equal(
    evryDraftAfterSubmission("Create the task", "Create the task"),
    ""
  );
  assert.equal(
    evryDraftAfterSubmission(
      "Create the task, then invite Alex",
      "Create the task"
    ),
    "Create the task, then invite Alex"
  );
});

test("the mounted workspace attaches a conversation created after expansion", () => {
  assert.equal(
    evryWorkspaceConversationHref(null, "conversation-1"),
    "/evry?conversation=conversation-1"
  );
  assert.equal(
    evryWorkspaceConversationHref("conversation-1", "conversation-1"),
    null
  );
});

test("created conversation URL sync preserves history search", () => {
  assert.equal(
    evryWorkspaceConversationHref(null, "conversation-b", "core team"),
    "/evry?q=core+team&conversation=conversation-b"
  );
});

test("workspace query sync cannot dispatch router navigation during a pending transition", () => {
  const routerNavigations: string[] = [];
  const historyReplacements: Array<{
    state: unknown;
    unused: string;
    href: string | URL | null | undefined;
  }> = [];
  const patchedHistoryReplacements: string[] = [];
  const historyState = { __NA: true, nextInternalState: "preserved" };
  const pendingSidebarDestination = "/people";
  const navigation = {
    state: historyState,
    replaceState(_state: unknown, _unused: string, href?: string | URL | null) {
      patchedHistoryReplacements.push(String(href));
    },
    replace(href: string) {
      routerNavigations.push(href);
    },
  };
  const didSync = syncEvryWorkspaceConversationHistory(
    navigation.state,
    (state, unused, href) => {
      historyReplacements.push({ state, unused, href });
    },
    null,
    "conversation-arrived-during-transition"
  );

  assert.equal(didSync, true);
  assert.deepEqual(historyReplacements, [
    {
      state: historyState,
      unused: "",
      href: "/evry?conversation=conversation-arrived-during-transition",
    },
  ]);
  assert.equal(pendingSidebarDestination, "/people");
  assert.deepEqual(patchedHistoryReplacements, []);
  assert.deepEqual(routerNavigations, []);
});

test("created-conversation sync retries after an older route transition commits", () => {
  const replacements: string[] = [];
  const replace = (
    _state: unknown,
    _unused: string,
    href?: string | URL | null
  ) => {
    replacements.push(String(href));
  };

  assert.equal(
    syncEvryWorkspaceConversationHistory(
      {},
      replace,
      "conversation-a",
      "conversation-b"
    ),
    false
  );
  assert.deepEqual(replacements, []);

  assert.equal(
    syncEvryWorkspaceConversationHistory({}, replace, null, "conversation-b"),
    true
  );
  assert.deepEqual(replacements, ["/evry?conversation=conversation-b"]);
});

test("changing any semantic request input rotates the retry key", () => {
  let minted = 0;
  const mint = () => `request-${++minted}`;
  const first = pendingEvrySubmissionFor(null, SUBMISSION, mint);

  for (const changed of [
    { ...SUBMISSION, message: "Create the Monday follow-up." },
    { ...SUBMISSION, conversationId: crypto.randomUUID() },
    { ...SUBMISSION, pageContext: null },
    {
      ...SUBMISSION,
      pageContext: { ...SUBMISSION.pageContext!, kind: "task" as const },
    },
    {
      ...SUBMISSION,
      pageContext: {
        ...SUBMISSION.pageContext!,
        recordId: crypto.randomUUID(),
      },
    },
  ]) {
    assert.notEqual(
      pendingEvrySubmissionFor(first, changed, mint).requestKey,
      first.requestKey
    );
  }
});

test("only the latest conversation load may apply or clear loading", () => {
  const first = beginEvryConversationLoad(
    initialEvryConversationLoadState(),
    "conversation-a"
  );
  const second = beginEvryConversationLoad(first.state, "conversation-b");

  assert.equal(
    isEvryConversationLoading(second.state, "conversation-a"),
    false
  );
  assert.equal(isEvryConversationLoading(second.state, "conversation-b"), true);
  assert.equal(
    isLatestEvryConversationLoad(second.state, first.attempt),
    false
  );
  assert.equal(
    isLatestEvryConversationLoad(second.state, second.attempt),
    true
  );

  const staleCompletion = finishEvryConversationLoad(
    second.state,
    first.attempt
  );
  assert.equal(staleCompletion.applies, false);
  assert.equal(
    isEvryConversationLoading(staleCompletion.state, "conversation-b"),
    true
  );

  const latestCompletion = finishEvryConversationLoad(
    staleCompletion.state,
    second.attempt
  );
  assert.equal(latestCompletion.applies, true);
  assert.equal(latestCompletion.state.latest, null);
});

test("a latest response still cannot replace a different requested conversation", () => {
  const load = beginEvryConversationLoad(
    initialEvryConversationLoadState(),
    "conversation-a"
  );

  assert.equal(
    canApplyEvryConversationLoadResponse(
      load.state,
      load.attempt,
      "conversation-a"
    ),
    true
  );
  assert.equal(
    canApplyEvryConversationLoadResponse(
      load.state,
      load.attempt,
      "conversation-b"
    ),
    false
  );

  const newerLoad = beginEvryConversationLoad(load.state, "conversation-b");
  assert.equal(
    canApplyEvryConversationLoadResponse(
      newerLoad.state,
      load.attempt,
      "conversation-a"
    ),
    false
  );
});

test("leaving the workspace makes every in-flight load stale", () => {
  const load = beginEvryConversationLoad(
    initialEvryConversationLoadState(),
    "conversation-a"
  );
  const cancelled = cancelEvryConversationLoads(load.state);

  assert.equal(isLatestEvryConversationLoad(cancelled, load.attempt), false);
  assert.equal(
    finishEvryConversationLoad(cancelled, load.attempt).applies,
    false
  );
});

test("streamed transcript updates preserve a reader's scroll and composer focus", () => {
  assert.equal(
    shouldFollowEvryTranscript({
      distanceFromEnd: 240,
      focusInComposer: false,
    }),
    false
  );
  assert.equal(
    shouldFollowEvryTranscript({
      distanceFromEnd: 80,
      focusInComposer: false,
    }),
    true
  );
  assert.equal(
    shouldFollowEvryTranscript({
      distanceFromEnd: 240,
      focusInComposer: true,
    }),
    true
  );
});
