import assert from "node:assert/strict";
import { test } from "node:test";

import {
  beginEvryConversationLoad,
  canApplyEvryConversationLoadResponse,
  cancelEvryConversationLoads,
  evrySubmissionMessage,
  finishEvryConversationLoad,
  initialEvryConversationLoadState,
  isEvryConversationLoading,
  isLatestEvryConversationLoad,
  pendingEvrySubmissionFor,
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
  assert.equal(minted, 1);

  const afterSuccess = pendingEvrySubmissionFor(null, SUBMISSION, mint);
  assert.equal(afterSuccess.requestKey, "request-2");
});

test("draft validation preserves every accepted message byte", () => {
  assert.equal(evrySubmissionMessage(" \n\t "), null);
  assert.equal(
    evrySubmissionMessage("  Create café follow-up — keep these bytes.  "),
    "  Create café follow-up — keep these bytes.  "
  );
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
