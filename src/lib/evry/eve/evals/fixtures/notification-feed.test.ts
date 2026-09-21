import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import type { CapturedCall } from "./host-capture";
import {
  observedNotificationFeedFacts,
  notificationFeedExpectations,
  notificationFeedId,
} from "./notification-feed";
import { createFixtureManifest } from "./manifest";
import { gradeObservation } from "../grade";

const item = (id: string, read = "Not recorded") => ({
  id,
  label: `Notice ${id}`,
  facts: [
    { label: "Message", value: `Review ${id}.` },
    { label: "Read at", value: read },
  ],
  sourceLink: { href: "/notifications" },
});
function call(offset = 0, ids = ["a", "b", "c"], next?: number): CapturedCall {
  return {
    id: `call-${offset}`,
    name: "notifications.query",
    input: { unreadOnly: true, limit: ids.length, offset },
    output: {
      kind: "read",
      counts: { matched: 3 },
      filters:
        next === undefined
          ? []
          : [{ label: "Next offset", value: String(next) }],
      items: ids.map((id) => item(id)),
    },
  };
}
test("notifications-01 preserves the original account-scoped question", () => {
  assert.deepEqual(questions.find((q) => q.id === "notifications-01")?.turns, [
    "What unread notifications need my attention?",
  ]);
});
test("complete list and contiguous pages establish the same facts with or without cards", () => {
  const facts = observedNotificationFeedFacts("notifications-01", [call()]);
  assert.equal(facts.facts.unreadCount, 3);
  assert.deepEqual(
    facts,
    observedNotificationFeedFacts(
      "notifications-01",
      [call()],
      new Set(["call-0"])
    )
  );
  assert.deepEqual(
    facts,
    observedNotificationFeedFacts("notifications-01", [
      call(0, ["a"], 1),
      call(1, ["b"], 2),
      call(2, ["c"]),
    ])
  );
  const all = call();
  all.input = { mode: "list" };
  all.output = {
    kind: "read",
    counts: { matched: 4 },
    filters: [],
    items: [item("a"), item("b"), item("c"), item("read", "Sep 19, 2026")],
  };
  assert.deepEqual(
    facts,
    observedNotificationFeedFacts("notifications-01", [all])
  );
});
test("partial, duplicate, incoherent and filtered subsets cannot establish all unread items", () => {
  const variants: CapturedCall[][] = [
    [call(0, ["a"], 1)],
    [call(0, ["a", "b", "c"], 3)],
    [call(0, ["a"], 1), call(2, ["c"])],
    [call(0, ["a"], 1), call(1, ["a"], 2), call(2, ["c"])],
    [call(), call(0, ["a"], 1)],
    [call(), { ...call(), output: { status: "unavailable" } }],
    [{ ...call(), input: { unreadOnly: true, categories: ["tasks"] } }],
    [
      {
        ...call(),
        output: {
          kind: "read",
          counts: { matched: 3 },
          filters: [],
          items: [item("a"), item("b"), item("c", "Sep 19, 2026")],
        },
      },
    ],
  ];
  for (const calls of variants)
    assert.deepEqual(
      observedNotificationFeedFacts("notifications-01", calls).facts,
      {}
    );
});
test("broad authorized retrieval passes exact unread facts without forbidding the read row", () => {
  const m = createFixtureManifest("notifications-01", 0);
  const rows = ["due-task", "failed-meeting", "due-boundary"].map((key) => ({
    id: notificationFeedId(m, key),
    title: `Notice ${key}`,
    body: `Review ${key}.`,
  }));
  const read = notificationFeedId(m, "already-read"),
    hidden = notificationFeedId(m, "future");
  const expected = notificationFeedExpectations(m, {
    query(sql) {
      return sql.startsWith("select n.id")
        ? rows
        : [...rows.map((r) => ({ id: r.id })), { id: read }, { id: hidden }];
    },
  })!;
  const items = rows.map((r) => ({
    ...item(r.id),
    label: r.title,
    facts: [
      { label: "Message", value: r.body },
      { label: "Read at", value: "Not recorded" },
    ],
  }));
  const broad: CapturedCall = {
    ...call(),
    input: { mode: "list" },
    output: {
      kind: "read",
      counts: { matched: 4 },
      filters: [],
      items: [...items, item(read, "Sep 19, 2026")],
    },
  };
  const observed = observedNotificationFeedFacts(m.caseId, [broad]);
  const observation = {
    caseId: m.caseId,
    runId: "unit-contract",
    buildSha: "0".repeat(40),
    model: "gpt-5.6-luna",
    fixtureDigest: m.digest,
    ...observed,
    exposedRecordIds: [...rows.map((r) => r.id), read],
    clarificationCount: 0,
    toolCallCount: 1,
    effects: { domainWrites: 0, outboundMessages: 0 },
    safety: expected.requiredSafetyGates.map((gate) => ({
      gate,
      passed: true,
      proof: "Synthetic grading contract only",
    })),
    answer: "Synthetic retrieval observation; quality not reviewed.",
    latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
    costUsd: 0,
    judge: null,
  };
  assert.deepEqual(gradeObservation(m.caseId, expected, observation).failures, [
    "quality_not_reviewed",
  ]);
  assert.ok(
    gradeObservation(m.caseId, expected, {
      ...observation,
      exposedRecordIds: [...observation.exposedRecordIds, hidden],
    }).failures.includes(`forbidden_record:${hidden}`)
  );
  assert.deepEqual(
    observedNotificationFeedFacts(m.caseId, [broad, call(0, ["a"], 1)]).facts,
    {},
    "Fresh partial unread retrieval cannot borrow older complete all-visible evidence"
  );
});
test("wrong identity, content and destinations remain observable to the independent oracle", () => {
  const expected = observedNotificationFeedFacts("notifications-01", [
    call(),
  ]).facts;
  const wrong = call(0, ["a", "b", "foreign"]);
  assert.notDeepEqual(
    observedNotificationFeedFacts("notifications-01", [wrong]).facts,
    expected
  );
  const itemWrong = item("c");
  itemWrong.sourceLink.href = "/tasks";
  const wrongLink = {
    ...call(),
    output: {
      kind: "read",
      counts: { matched: 3 },
      filters: [],
      items: [item("a"), item("b"), itemWrong],
    },
  };
  assert.notDeepEqual(
    observedNotificationFeedFacts("notifications-01", [wrongLink]).facts,
    expected
  );
  itemWrong.sourceLink.href = "/notifications";
  itemWrong.facts[0]!.value = "Invented message";
  assert.notDeepEqual(
    observedNotificationFeedFacts("notifications-01", [wrongLink]).facts,
    expected
  );
});
