import assert from "node:assert/strict";
import { test } from "node:test";

import { evryConversationTraceOutput } from "./conversation-request";

test("customer-visible conversation output is present in production traces", () => {
  const output = evryConversationTraceOutput({
    id: "conversation-1",
    title: "Follow-up tasks",
    messages: [
      {
        author: "user",
        body: "Who needs follow-up?",
        artifacts: [],
      },
      {
        author: "assistant",
        body: "Two people need follow-up.",
        artifacts: [
          {
            artifact: {
              kind: "read-result",
              title: "People needing follow-up",
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(output, {
    status: "completed",
    conversationId: "conversation-1",
    title: "Follow-up tasks",
    response: "Two people need follow-up.",
    artifacts: [
      {
        kind: "read-result",
        title: "People needing follow-up",
      },
    ],
  });
});

test("trace output reports an unavailable conversation without throwing", () => {
  assert.deepEqual(evryConversationTraceOutput(null), {
    status: "unavailable",
  });
});
