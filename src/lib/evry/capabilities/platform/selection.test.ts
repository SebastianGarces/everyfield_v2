import assert from "node:assert/strict";
import test from "node:test";

import { selectPlatformEvryRequest } from "./selection";

const ID = "10000000-0000-4000-8000-000000000001";

test("platform selection is closed across reads and confirmed effects", () => {
  assert.deepEqual(selectPlatformEvryRequest("show dashboard summary"), {
    kind: "dashboard",
  });
  assert.deepEqual(selectPlatformEvryRequest("show unread notifications"), {
    kind: "notifications",
    unreadOnly: true,
    before: null,
  });
  assert.deepEqual(
    selectPlatformEvryRequest("show unread notification count"),
    { kind: "notification_count" }
  );
  assert.deepEqual(selectPlatformEvryRequest(`mark notification ${ID} read`), {
    kind: "mark_one",
    notificationId: ID,
  });
  assert.deepEqual(selectPlatformEvryRequest("mark all notifications read"), {
    kind: "mark_all",
  });
  assert.equal(selectPlatformEvryRequest("delete all notifications"), null);
  assert.equal(selectPlatformEvryRequest("query the database"), null);
});

test("incomplete platform effects select a focused clarification", () => {
  assert.deepEqual(selectPlatformEvryRequest("mark notification read"), {
    kind: "clarification",
    subject: "notification",
    prompt:
      "Which notification should be marked read? Ask “show notifications,” then send the visible Mark-read command for the notification you mean, or say “mark all notifications read.”",
  });
  assert.deepEqual(selectPlatformEvryRequest("submit feedback"), {
    kind: "clarification",
    subject: "feedback",
    prompt:
      "What feedback should be submitted? Include a category (bug, suggestion, question, or other) and the exact description you want stored.",
  });
  assert.equal(selectPlatformEvryRequest("mark a task complete"), null);
});

test("feedback classifier preserves literal user payload under compatibility text", () => {
  const description = "Ｆｕｌｌｗｉｄｔｈ body ① ﬀ 👩🏽‍💻";
  const selection = selectPlatformEvryRequest(
    `ｓｕｂｍｉｔ ｆｅｅｄｂａｃｋ ${JSON.stringify({
      category: "bug",
      description,
      pageUrl: "/people?filter=a|b",
    })}`
  );
  assert.deepEqual(selection, {
    kind: "feedback",
    category: "bug",
    description,
    pageUrl: "/people?filter=a|b",
  });
});

test("feedback selection matches the UI's empty source-page normalization", () => {
  assert.deepEqual(
    selectPlatformEvryRequest(
      'submit feedback {"category":"question","description":"literal","pageUrl":""}'
    ),
    {
      kind: "feedback",
      category: "question",
      description: "literal",
      pageUrl: null,
    }
  );
});

test("malformed feedback payload remains inside the clarification boundary", () => {
  const selection = selectPlatformEvryRequest("submit feedback not-json");
  assert.equal(selection?.kind, "clarification");
  assert.equal(
    selection?.kind === "clarification" ? selection.subject : null,
    "feedback"
  );
});

test("notification paging selector preserves exact keyset tuple", () => {
  assert.deepEqual(
    selectPlatformEvryRequest(
      `show unread notifications before 2030-01-02T03:04:05.000Z|${ID}`
    ),
    {
      kind: "notifications",
      unreadOnly: true,
      before: { createdAt: "2030-01-02T03:04:05.000Z", id: ID },
    }
  );
  assert.equal(
    selectPlatformEvryRequest(`show notifications before 1|${ID}`),
    null
  );
});
