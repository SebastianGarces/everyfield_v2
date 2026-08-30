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
