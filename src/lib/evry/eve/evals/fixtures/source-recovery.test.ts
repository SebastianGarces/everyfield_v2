import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import type { CapturedCall } from "./host-capture";
import {
  bindSourceRecoveryTurns,
  createSourceRecoveryFault,
  observedSourceRecoveryFacts,
  sourceRecoveryRequest,
  sourceRecoverySetup,
  type SourceRecoveryFault,
} from "./source-recovery";

const m = createFixtureManifest("edges-13", 0);
const fault: SourceRecoveryFault = {
  source: "meetings.query",
  boundary: "neon_http",
  plantId: m.ids.plant,
  ordinal: 1,
};
function page(
  ids: string[],
  total = ids.length,
  cursor = "0",
  next = "End of results",
  where: unknown = {}
): CapturedCall {
  return {
    id: `page-${cursor}`,
    name: "tasks.query",
    input: { where, query: { mode: "list", cursor } },
    output: {
      kind: "read",
      resultMode: "list",
      counts: { matched: total, returned: ids.length },
      items: ids.map((id) => ({ id, label: id })),
      filters: [{ label: "Next page cursor", value: next }],
    },
  };
}
test("original question follows real retrieval context, never a fabricated assistant response", () => {
  const scenario = questions.find((q) => q.id === "edges-13")!;
  assert.deepEqual(scenario.turns, [sourceRecoveryRequest]);
  assert.deepEqual(bindSourceRecoveryTurns(scenario.turns), [
    sourceRecoverySetup,
    sourceRecoveryRequest,
  ]);
  assert.throws(() => bindSourceRecoveryTurns(["Different question"]));
});
test("observer requires real failure receipt and complete retained task pages", () => {
  const calls = [page(["a", "b"], 3, "0", "2"), page(["c"], 3, "2")];
  assert.deepEqual(observedSourceRecoveryFacts(m, calls, [fault]), {
    facts: {
      taskIds: ["a", "b", "c"],
      meetingSourceFailed: true,
      failedSourceNotEmptyResult: true,
    },
    evidence: ["complete-retrieved-tasks", "actual-meeting-dependency-failure"],
  });
  for (const faults of [
    [],
    [{ ...fault, plantId: m.ids["foreign-plant"] }],
    [fault, fault],
  ]) {
    assert.equal(
      observedSourceRecoveryFacts(m, calls, faults).facts.meetingSourceFailed,
      undefined
    );
  }
  for (const bad of [
    [calls[0]!],
    [calls[1]!],
    [calls[0]!, page(["a"], 3, "2")],
    [calls[0]!, page(["c"], 3, "1")],
    [calls[0]!, page(["c"], 3, "2", "End of results", { search: "unrelated" })],
    [...calls, page(["a"], 3, "0", "1")],
    [...calls, { ...page([]), output: { status: "unavailable" } }],
  ])
    assert.equal(
      observedSourceRecoveryFacts(m, bad, [fault]).facts.taskIds,
      undefined
    );
});
test("repeated refreshes and reordered equivalent keys work without unioning populations", () => {
  const a = page(["a"], 2, "0", "1", { x: 1, y: 2 });
  const b = page(["b"], 2, "1", "End of results", { y: 2, x: 1 });
  assert.deepEqual(
    observedSourceRecoveryFacts(m, [a, b, a, b], [fault]).facts.taskIds,
    ["a", "b"]
  );
});
test("failed source cannot become zero; a real nonempty retry is allowed", () => {
  const zero = { ...page([]), name: "meetings.query" };
  assert.equal(
    observedSourceRecoveryFacts(m, [page(["a"]), zero], [fault]).facts
      .failedSourceNotEmptyResult,
    false
  );
  assert.equal(
    observedSourceRecoveryFacts(
      m,
      [page(["a"]), { ...page(["meeting"]), name: "meetings.query" }],
      [fault]
    ).facts.failedSourceNotEmptyResult,
    true
  );
});
test("same-scope corroborating count preserves complete identities, never manufactures them", () => {
  const full = page(["a", "b"], 2, "0", "End of results", { mine: true });
  const count: CapturedCall = {
    ...page([], 2, "0", "End of results", { mine: true }),
    input: { where: { mine: true }, query: { mode: "count" } },
    output: {
      kind: "read",
      resultMode: "count",
      counts: { matched: 2, returned: 0 },
      items: [],
    },
  };
  assert.deepEqual(
    observedSourceRecoveryFacts(m, [full, count], [fault]).facts.taskIds,
    ["a", "b"]
  );
  for (const calls of [
    [count],
    [page(["a"], 2, "0", "1", { mine: true }), count],
    [
      full,
      { ...count, input: { where: { mine: false }, query: { mode: "count" } } },
    ],
    [
      full,
      {
        ...count,
        output: {
          kind: "read",
          resultMode: "count",
          counts: { matched: 3, returned: 0 },
          items: [],
        },
      },
    ],
    [full, { ...count, output: { status: "unavailable" } }],
  ])
    assert.equal(
      observedSourceRecoveryFacts(m, calls, [fault]).facts.taskIds,
      undefined
    );
});
test("only exact isolated dependency and tenant are faulted once; all other requests delegate", async () => {
  let delegated = 0;
  const proxyUrl = "http://127.0.0.1:12345/sql";
  const mockFetch: typeof fetch = async () => {
    delegated++;
    return new Response("{}");
  };
  const injection = createSourceRecoveryFault({
    proxyUrl,
    plantId: m.ids.plant,
    fetch: mockFetch,
  });
  const query = 'select "id" from "church_meetings" where "church_id" = $1';
  const request = (query: string, plantId = m.ids.plant) => ({
    method: "POST",
    body: JSON.stringify({ query, params: [plantId] }),
  });
  await injection.fetch(
    proxyUrl,
    request('select "id" from "tasks" where "church_id"=$1')
  );
  await injection.fetch(proxyUrl, request(query, m.ids["foreign-plant"]));
  await injection.fetch("http://127.0.0.1:23456/sql", request(query));
  await injection.fetch(
    proxyUrl,
    request('update "church_meetings" set title=$1')
  );
  await assert.rejects(
    injection.fetch(proxyUrl, request(query)),
    /dependency unavailable/
  );
  assert.deepEqual(injection.receipts, [fault]);
  assert.equal(delegated, 4);
  await injection.fetch(proxyUrl, request(query));
  assert.equal(delegated, 5);
  assert.equal(injection.attempts, 2);
  assert.equal(injection.receipts.length, 1);
  assert.throws(() =>
    createSourceRecoveryFault({
      proxyUrl: "https://shared.example/sql",
      plantId: m.ids.plant,
      fetch: mockFetch,
    })
  );
});
test("Request and batched Neon bodies use the same dependency guard, without consuming original body", async () => {
  const proxyUrl = "http://127.0.0.1:12345/sql";
  let received = "";
  const injection = createSourceRecoveryFault({
    proxyUrl,
    plantId: m.ids.plant,
    fetch: async (input) => {
      assert.ok(input instanceof Request);
      received = await input.text();
      return new Response("{}");
    },
  });
  const body = JSON.stringify({
    queries: [
      {
        query:
          "with filtered as (select id from public.church_meetings where church_id=$1), page as (select * from filtered limit 50) select * from page",
        params: [m.ids.plant],
      },
    ],
  });
  await assert.rejects(
    injection.fetch(new Request(proxyUrl, { method: "POST", body })),
    /dependency unavailable/
  );
  await injection.fetch(new Request(proxyUrl, { method: "POST", body }));
  assert.equal(received, body);
});
