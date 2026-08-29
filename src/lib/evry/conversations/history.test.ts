import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildEvryConversationHistoryQuery,
  EVRY_CONVERSATION_HISTORY_LIMIT,
  evryConversationActionableState,
  evryConversationHistorySearchSchema,
} from "./history";

const NOW = new Date("2026-08-28T12:00:00.000Z");
const FUTURE = new Date("2026-08-28T12:10:00.000Z");
const PAST = new Date("2026-08-28T11:59:00.000Z");
const PLAN_ID = "40000000-0000-4000-8000-000000000001";
const ACTOR_ID = "20000000-0000-4000-8000-000000000001";
const PLANT_ID = "10000000-0000-4000-8000-000000000001";

test("every durable plan state has one actionable history state", () => {
  const cases = [
    [null, null, null, "ready"],
    [PLAN_ID, "draft", FUTURE, "running"],
    [PLAN_ID, "awaiting_confirmation", FUTURE, "awaiting_confirmation"],
    [PLAN_ID, "awaiting_confirmation", PAST, "rebuild_required"],
    [PLAN_ID, "approved", FUTURE, "running"],
    [PLAN_ID, "approved", PAST, "rebuild_required"],
    [PLAN_ID, "executing", PAST, "running"],
    [PLAN_ID, "partially_failed", PAST, "needs_attention"],
    [PLAN_ID, "failed", PAST, "needs_attention"],
    [PLAN_ID, "completed", PAST, "completed"],
    [PLAN_ID, "cancelled", PAST, "completed"],
    [PLAN_ID, "superseded", PAST, "completed"],
    [PLAN_ID, "expired", PAST, "rebuild_required"],
    [PLAN_ID, null, null, "rebuild_required"],
  ] as const;

  for (const [
    activePlanId,
    activePlanStatus,
    activePlanExpiresAt,
    expected,
  ] of cases) {
    assert.equal(
      evryConversationActionableState({
        activePlanId,
        activePlanStatus,
        activePlanExpiresAt,
        latestMessageSequence: 1,
        latestArtifactMessageSequence: 1,
        latestArtifactKind: "result",
        now: NOW,
      }),
      expected,
      `${activePlanStatus ?? "no plan"} -> ${expected}`
    );
  }
});

test("a terminal plan cannot mask a later request or clarification", () => {
  const terminal = {
    activePlanId: PLAN_ID,
    activePlanStatus: "completed" as const,
    activePlanExpiresAt: PAST,
    now: NOW,
  };

  assert.equal(
    evryConversationActionableState({
      ...terminal,
      latestMessageSequence: 3,
      latestArtifactMessageSequence: 2,
      latestArtifactKind: "result",
    }),
    "ready"
  );
  assert.equal(
    evryConversationActionableState({
      ...terminal,
      latestMessageSequence: 3,
      latestArtifactMessageSequence: 3,
      latestArtifactKind: "clarification",
    }),
    "needs_attention"
  );
});

test("history search is bounded, trimmed, and treats an empty query as no filter", () => {
  assert.equal(
    evryConversationHistorySearchSchema.parse("  meeting  "),
    "meeting"
  );
  assert.equal(evryConversationHistorySearchSchema.parse("   "), null);
  assert.equal(
    evryConversationHistorySearchSchema.safeParse("x".repeat(121)).success,
    false
  );
});

test("the exact query scopes title and transcript matching to actor plus plant", () => {
  const query = buildEvryConversationHistoryQuery({
    actorUserId: ACTOR_ID,
    plantId: PLANT_ID,
    search: "private%_term",
  }).toSQL();

  assert.match(
    query.sql,
    /where \("evry_conversations"\."actor_user_id" = \$1 and "evry_conversations"\."church_id" = \$2/
  );
  assert.match(
    query.sql,
    /"evry_conversation_messages"\."conversation_id" = "evry_conversations"\."id" and "evry_conversation_messages"\."actor_user_id" = \$4 and "evry_conversation_messages"\."church_id" = \$5/
  );
  assert.match(query.sql, /"evry_conversation_messages"\."body" ilike \$6/);
  assert.match(
    query.sql,
    /"evry_conversation_artifacts"\."actor_user_id" = "evry_conversations"\."actor_user_id"/
  );
  assert.match(
    query.sql,
    /"evry_conversation_artifacts"\."church_id" = "evry_conversations"\."church_id"/
  );
  assert.match(query.sql, /order by .*"last_activity_at" desc.*"id" desc/);
  assert.deepEqual(query.params, [
    ACTOR_ID,
    PLANT_ID,
    "%private\\%\\_term%",
    ACTOR_ID,
    PLANT_ID,
    "%private\\%\\_term%",
    1,
    EVRY_CONVERSATION_HISTORY_LIMIT,
  ]);
});
