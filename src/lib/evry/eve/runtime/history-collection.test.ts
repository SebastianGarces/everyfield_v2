import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { peopleHistoryQuerySchema } from "../../capabilities/queries/people-query-sql";
import { peopleQueryArtifact } from "../../capabilities/queries/people";
import { historyContinuationModelOutput } from "./history-continuation";
import {
  historyCollectionInputSchema,
  historyCollectionOutputSchema,
} from "./history-collection";
import {
  createCompositionBudget,
  runEvryComposition,
  COMPOSITION_LIMITS,
  type CompositionTrace,
} from "../composition/runner";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = {
  resource: { kind: "assessments" },
  cohort: { all: { stages: ["core_group"] } },
  dates: { from: "2026-09-01", through: "2026-09-20" },
  dateBasis: "created_at",
  authorIds: [id(900)],
  latestPerPerson: false,
};
const rows = Array.from({ length: 53 }, (_, i) => ({
  id: id(i + 1),
  notes: i >= 50 ? "🙂é".repeat(245) + "Needs help." : "No concerns.",
}));
type Query = z.infer<typeof peopleHistoryQuerySchema>;
function page(input: Query, source = rows) {
  assert.equal(input.result.mode, "list");
  if (input.result.mode !== "list") assert.fail();
  const { afterId, limit } = input.result;
  const selected = source.filter(
    (r) => !input.recordIds || input.recordIds.includes(r.id)
  );
  const remaining = selected.filter((r) => !afterId || r.id > afterId);
  const current = remaining.slice(0, limit);
  const offset = input.contentOffset ?? 0;
  const artifact = peopleQueryArtifact(
    "Recorded people history",
    {
      total: selected.length,
      people: selected.length,
      households: 0,
      without_household: selected.length,
      groups: [],
      group_total: 0,
      has_more: remaining.length > current.length,
      rows: current.map((row) => ({
        id: row.id,
        label: "Recorded person",
        person_id: id(901),
        author_id: id(900),
        created_at: "2026-09-14T03:30:00.123456Z",
        date: "2026-09-10",
        outcome: "Recorded outcome",
        content: Array.from(row.notes)
          .slice(offset, offset + 240)
          .join(""),
        content_length: Array.from(row.notes).length,
        content_offset: offset,
        content_next_offset:
          Array.from(row.notes).length > offset + 240 ? offset + 240 : null,
      })),
    },
    "list",
    "people",
    input,
    new Date("2026-09-20T12:00:00Z"),
    "America/New_York"
  );
  return historyContinuationModelOutput(
    input,
    z.json().parse(JSON.parse(JSON.stringify(artifact)))
  );
}
function setup(
  options: {
    source?: typeof rows;
    change?: (output: unknown, input: Query, call: number) => unknown;
    maxCalls?: number;
    signal?: AbortSignal;
  } = {}
) {
  const calls: Query[] = [];
  const events: CompositionTrace[] = [];
  return {
    calls,
    events,
    run: (
      js = `return await history.collect(${JSON.stringify(scope)});`,
      limits?: Partial<typeof COMPOSITION_LIMITS>
    ) =>
      runEvryComposition({
        js,
        limits,
        signal: options.signal,
        callId: "history-helper",
        budget: createCompositionBudget(options.maxCalls),
        onCall: (event) => events.push(event),
        registry: {
          describe: () => [
            {
              name: "people.history.query",
              description: "History",
              effect: "read",
              inputSchema: peopleHistoryQuerySchema,
            },
          ],
          async invoke(name, raw, invocation) {
            assert.equal(name, "people.history.query");
            const input = peopleHistoryQuerySchema.parse(raw);
            calls.push(input);
            const output = {
              ...z.object({}).passthrough().parse(page(input, options.source)),
              resultReference: invocation.callId,
            };
            return options.change
              ? options.change(output, input, calls.length)
              : output;
          },
        },
      }),
  };
}
async function evidence(fixture: ReturnType<typeof setup>) {
  const result = await fixture.run();
  assert.equal(result.status, "completed");
  if (result.status !== "completed") assert.fail();
  return historyCollectionOutputSchema.parse(result.output);
}

test("collects all pages and batches Unicode note continuations through the actual bridge", async () => {
  const fixture = setup();
  const result = await evidence(fixture);
  assert.equal(result.status, "complete");
  assert.equal(result.matched, 53);
  assert.equal(result.readCount, 4);
  assert.deepEqual(
    result.records.map((r) => ({ id: r.item.id, notes: r.notes })),
    rows
  );
  assert.ok(result.records.every((r) => r.contentComplete));
  assert.equal(result.snapshot, "multiple_reads");
  assert.equal(
    fixture.events.filter((e) => e.status === "succeeded").length,
    4
  );
  assert.equal(new Set(fixture.events.map((e) => e.callId)).size, 4);
  for (const input of fixture.calls) {
    const {
      result: _result,
      recordIds: _ids,
      contentOffset: _offset,
      ...filters
    } = input;
    assert.deepEqual(filters, scope);
    if (input.recordIds) {
      assert.equal(input.recordIds.length, 3);
      assert.equal(input.result.mode, "list");
      if (input.result.mode === "list")
        assert.equal(input.result.afterId, undefined);
    }
  }
  const first = result.records[0];
  assert.ok(
    first.item.facts.some((f) => f.label === "person_id" && f.value === id(901))
  );
  assert.ok(
    first.item.facts.some(
      (f) =>
        f.label === "Recorded at (UTC)" &&
        f.value === "2026-09-14T03:30:00.123456Z"
    )
  );
  assert.ok(first.item.sourceLink.href);
  assert.ok(result.records[50].resultReferences.length === 3);
  assert.ok(
    result.records.every(
      (r) =>
        !r.item.facts.some((f) =>
          /Recorded notes|Next content offset/.test(f.label)
        )
    )
  );
});

test("empty cohort and measured empty notes are complete, not unknown", async () => {
  const empty = await evidence(setup({ source: [] }));
  assert.equal(empty.status, "complete");
  assert.equal(empty.matched, 0);
  assert.deepEqual(empty.records, []);
  const blank = await evidence(setup({ source: [{ id: id(1), notes: "" }] }));
  assert.equal(blank.status, "complete");
  assert.equal(blank.records[0].totalCharacters, 0);
  assert.equal(blank.records[0].notes, "");
});

test("schema and sandbox refuse literal search and caller-owned pagination", async () => {
  for (const extra of [
    { text: "concern" },
    { result: { mode: "count" } },
    { contentOffset: 240 },
    { unknown: true },
  ]) {
    assert.equal(
      historyCollectionInputSchema.safeParse({ ...scope, ...extra }).success,
      false
    );
    const fixture = setup();
    const result = await fixture.run(
      `return await history.collect(${JSON.stringify({ ...scope, ...extra })});`
    );
    assert.equal(result.status, "failed");
    assert.equal(fixture.calls.length, 0);
  }
});

test("unknown continuation and note metadata never become empty complete evidence", async () => {
  for (const change of [
    (value: unknown) => ({
      ...z.object({}).passthrough().parse(value),
      continuation: { status: "unavailable" },
    }),
    (value: unknown) => {
      const object = z
        .object({
          continuation: z
            .object({
              records: z.array(
                z.object({ id: z.string(), content: z.unknown() })
              ),
            })
            .passthrough(),
        })
        .passthrough()
        .parse(value);
      object.continuation.records[0].content = { status: "unavailable" };
      return object;
    },
  ]) {
    const result = await evidence(setup({ change }));
    assert.equal(result.status, "partial");
    if (result.status === "partial")
      assert.equal(result.reason, "continuation_unavailable");
  }
});

test("a failed later read retains partial evidence without forwarding error text", async () => {
  const result = await evidence(
    setup({
      change: (output, _input, call) => {
        if (call === 3) throw Error("secret SQL customer payload");
        return output;
      },
    })
  );
  assert.equal(result.status, "partial");
  assert.equal(result.records.length, 53);
  assert.equal(result.records[50].contentComplete, false);
  assert.doesNotMatch(JSON.stringify(result), /secret|SQL|payload/);
});

test("count drift, missing exact IDs, changed identities and note-length changes refuse completion", async () => {
  for (const mutation of ["count", "missing", "identity", "length"]) {
    const result = await evidence(
      setup({
        change: (value, input, call) => {
          if (call !== 3) return value;
          const output = z
            .object({
              counts: z.object({ matched: z.number() }).passthrough(),
              items: z.array(z.object({ label: z.string() }).passthrough()),
              continuation: z
                .object({
                  records: z.array(
                    z
                      .object({
                        content: z
                          .object({ totalCharacters: z.number() })
                          .passthrough(),
                      })
                      .passthrough()
                  ),
                })
                .passthrough(),
            })
            .passthrough()
            .parse(value);
          assert.ok(input.recordIds);
          if (mutation === "count") output.counts.matched++;
          if (mutation === "missing") {
            output.items.pop();
            output.continuation.records.pop();
            output.counts.matched--;
          }
          if (mutation === "identity") output.items[0].label = "Changed person";
          if (mutation === "length")
            output.continuation.records[0].content.totalCharacters++;
          return output;
        },
      })
    );
    assert.equal(result.status, "partial", mutation);
  }
});

test("shared turn budget and sandbox call limits cannot be bypassed by collection", async () => {
  const fixture = setup({ maxCalls: 2 });
  assert.deepEqual(await fixture.run(), {
    status: "failed",
    reason: "limit",
    calls: 2,
  });
  assert.equal(fixture.calls.length, 2);
  const program = setup();
  const result = await program.run(undefined, { maxBridgeRequests: 2 });
  assert.deepEqual(result, { status: "failed", reason: "limit", calls: 2 });
  assert.equal(program.calls.length, 2);
});

test("aborted programs never dispatch, original source allowance is unchanged and helper does not grant authority", async () => {
  const controller = new AbortController();
  controller.abort();
  const cancelled = setup({ signal: controller.signal });
  assert.equal((await cancelled.run()).status, "failed");
  assert.equal(cancelled.calls.length, 0);
  const fixture = setup();
  assert.deepEqual(await fixture.run("return 1;", { maxSourceBytes: 9 }), {
    status: "completed",
    output: 1,
    calls: 0,
  });
  assert.deepEqual(await fixture.run("return 12;", { maxSourceBytes: 9 }), {
    status: "failed",
    reason: "limit",
    calls: 0,
  });
  const shadow = await fixture.run(
    "const history = 'local'; return [history,typeof process,typeof fetch];"
  );
  assert.deepEqual(shadow, {
    status: "completed",
    output: ["local", "undefined", "undefined"],
    calls: 0,
  });
});

test("ordinary composition does not require the history capability, and catches cannot erase a terminal budget", async () => {
  const ordinary = await runEvryComposition({
    js: "return 1;",
    callId: "no-history",
    budget: createCompositionBudget(),
    registry: {
      describe: () => [],
      invoke: async () => assert.fail("No host calls"),
    },
  });
  assert.deepEqual(ordinary, { status: "completed", output: 1, calls: 0 });
  const limited = setup({ maxCalls: 1 });
  assert.deepEqual(
    await limited.run(
      `try {await history.collect(${JSON.stringify(scope)});} catch {} return {status:'complete'};`
    ),
    { status: "failed", reason: "limit", calls: 1 }
  );
});
