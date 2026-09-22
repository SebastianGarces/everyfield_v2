import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import { peopleHistoryQuerySchema } from "../../capabilities/queries/people-query-sql";
import { peopleQueryArtifact } from "../../capabilities/queries/people";
import { historyNotesExample } from "./history-notes.example";
import {
  COMPOSITION_LIMITS,
  createCompositionBudget,
  runEvryComposition,
  type CompositionRegistry,
} from "./runner";

const id = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const base = peopleHistoryQuerySchema.parse({
  resource: { kind: "assessments" },
  dateBasis: "created_at",
  cohort: { all: { stages: ["core_group"] } },
  dates: { from: "2026-09-01", through: "2026-09-20" },
  authorIds: [id(900)],
  latestPerPerson: false,
  result: { mode: "list", limit: 50 },
});
type Query = z.infer<typeof peopleHistoryQuerySchema>;
const records = Array.from({ length: 53 }, (_, index) => ({
  id: id(index + 1),
  label: `Person ${index + 1}`,
  person: id(index + 101),
  entered: "2026-09-13T03:30:00.000000Z",
  // Concern evidence is deliberately beyond both the first record page and
  // the first note chunk. Unicode offsets match PostgreSQL character counts.
  notes:
    index === 51
      ? "🙂".repeat(480) + "Exhausted after extra shifts."
      : index === 52
        ? "x".repeat(240) + "Missed check-ins; needs help with a schedule."
        : "No concerns were recorded.",
}));
type Record = (typeof records)[number];
type Artifact = ReturnType<typeof peopleQueryArtifact>;
type Edit = (artifact: Artifact, call: number, input: Query) => unknown;

function fixture(rows: Record[] = records, edit?: Edit) {
  const calls: Query[] = [];
  const callIds: string[] = [];
  let active = 0;
  let highWater = 0;
  const registry: CompositionRegistry = {
    describe: () => [
      {
        name: "people.history.query",
        description: "Read recorded people history",
        effect: "read",
        inputSchema: peopleHistoryQuerySchema,
      },
    ],
    async invoke(name, raw, invocation) {
      assert.equal(name, "people.history.query");
      const input = peopleHistoryQuerySchema.parse(raw);
      assert.equal(input.result.mode, "list");
      if (input.result.mode !== "list") throw new Error("List expected");
      calls.push(input);
      callIds.push(invocation.callId);
      active++;
      highWater = Math.max(highWater, active);
      try {
        const selected = rows.filter(
          (row) => !input.recordIds || input.recordIds.includes(row.id)
        );
        const after = input.result.afterId;
        const remaining = selected.filter((row) => !after || row.id > after);
        const page = remaining.slice(0, input.result.limit);
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
            has_more: remaining.length > page.length,
            rows: page.map((row) => {
              const characters = Array.from(row.notes);
              return {
                id: row.id,
                label: row.label,
                person_id: row.person,
                author_id: id(900),
                author: "Recorded author",
                date: "2026-09-10",
                created_at: row.entered,
                content: characters.slice(offset, offset + 240).join(""),
                content_length: characters.length,
                content_offset: offset,
                content_next_offset:
                  characters.length > offset + 240 ? offset + 240 : null,
              };
            }),
          },
          "list",
          "people",
          input,
          new Date("2026-09-20T16:00:00Z"),
          "America/New_York"
        );
        return edit
          ? await edit(artifact, calls.length, input)
          : { ...artifact, resultReference: invocation.callId };
      } finally {
        active--;
      }
    },
  };
  return { registry, calls, callIds, highWater: () => highWater };
}
const outputSchema = z.object({
  complete: z.boolean(),
  reason: z.string().optional(),
  references: z.array(z.string()),
  records: z.array(
    z.object({
      id: z.string(),
      notes: z.string(),
      nextOffset: z.number().nullable(),
      facts: z.array(z.object({ label: z.string(), value: z.string() })),
    })
  ),
});
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const options = (registry: CompositionRegistry, query = base) => ({
  registry,
  js: historyNotesExample(query),
  callId: "history-notes-example",
  budget: createCompositionBudget(),
});

test("captured missing-result continuation refuses before invoking the reader", async () => {
  const f = fixture();
  const result = await runEvryComposition({
    ...options(f.registry),
    js: `return await tools['people.history.query']({resource:{kind:'assessments'},recordIds:['${id(52)}'],contentOffset:240,dateBasis:'created_at'});`,
  });
  assert.equal(result.status, "failed");
  if (result.status !== "failed") assert.fail();
  assert.equal(result.reason, "invalid_input");
  assert.equal(f.calls.length, 0);
});

test("real sandbox composes 53 records and multi-offset notes in four reads without losing filters or provenance", async () => {
  const f = fixture();
  const original = structuredClone(base);
  const result = await runEvryComposition(options(f.registry));
  assert.equal(result.status, "completed");
  if (result.status !== "completed") assert.fail();
  const output = outputSchema.parse(result.output);
  assert.equal(output.complete, true);
  assert.equal(result.calls, 4);
  assert.deepEqual(
    output.records.map((row) => row.id),
    records.map((row) => row.id)
  );
  assert.deepEqual(
    output.records.map((row) => digest(row.notes)),
    records.map((row) => digest(row.notes))
  );
  assert.ok(output.records.every((row) => row.nextOffset === null));
  assert.ok(
    output.records.every((row) =>
      row.facts.some(
        (fact) =>
          fact.label === "Recorded at (UTC)" &&
          fact.value === records[0]!.entered
      )
    )
  );
  assert.deepEqual(output.references, f.callIds);
  assert.equal(new Set(f.callIds).size, 4);
  assert.ok(
    f.callIds.every((value) => value.startsWith("history-notes-example:tool-"))
  );
  assert.equal(f.highWater(), 1);
  assert.ok(f.highWater() <= COMPOSITION_LIMITS.maxConcurrentToolCalls);
  for (const query of f.calls) {
    const {
      recordIds: _ids,
      contentOffset: _offset,
      result: _result,
      ...filters
    } = query;
    const { result: _initialResult, ...initialFilters } = base;
    assert.deepEqual(filters, initialFilters);
    assert.equal(query.text, undefined);
  }
  assert.deepEqual(f.calls[2]?.recordIds, [id(52), id(53)]);
  assert.deepEqual(f.calls[3]?.recordIds, [id(52)]);
  assert.equal(f.calls[2]?.contentOffset, 240);
  assert.equal(f.calls[3]?.contentOffset, 480);
  assert.deepEqual(f.calls[2]?.result, { mode: "list", limit: 50 });
  assert.deepEqual(base, original);
});

test("explicit resource filters, initial record selection and latest policy survive continuation", async () => {
  const query = peopleHistoryQuerySchema.parse({
    ...base,
    text: "requested exact phrase",
    resource: { kind: "assessments", maximumScore: 16 },
    latestPerPerson: true,
    recordIds: [id(52), id(53)],
  });
  const f = fixture();
  const result = await runEvryComposition(options(f.registry, query));
  assert.equal(result.status, "completed");
  if (result.status !== "completed") assert.fail();
  assert.equal(outputSchema.parse(result.output).complete, true);
  for (const call of f.calls) {
    assert.deepEqual(call.resource, query.resource);
    assert.equal(call.latestPerPerson, true);
    assert.equal(call.text, query.text);
    assert.ok(
      call.recordIds?.every((recordId) => query.recordIds!.includes(recordId))
    );
  }
});

test("a measured empty result is complete but oversized output cannot bypass the runner ceiling", async () => {
  const empty = await runEvryComposition(options(fixture([]).registry));
  assert.equal(empty.status, "completed");
  if (empty.status !== "completed") assert.fail();
  const output = outputSchema.parse(empty.output);
  assert.equal(output.complete, true);
  assert.deepEqual(output.records, []);
  const oversized = await runEvryComposition({
    ...options(fixture().registry),
    limits: { maxResultBytes: 256 },
  });
  assert.equal(oversized.status, "failed");
});

test("a reader refusal or inconsistent page never becomes complete evidence", async () => {
  const controls: Edit[] = [
    (artifact, call) => (call === 2 ? { status: "unavailable" } : artifact),
    (artifact, call) =>
      call === 2
        ? { ...artifact, counts: { ...artifact.counts, matched: 54 } }
        : artifact,
    (artifact, call) => (call === 2 ? { ...artifact, items: [] } : artifact),
    (artifact, call) =>
      call === 3 ? { ...artifact, items: artifact.items.slice(1) } : artifact,
    (artifact, call) =>
      call === 3
        ? {
            ...artifact,
            items: artifact.items.map((item) => ({
              ...item,
              facts: item.facts.map((fact) =>
                fact.label === "Next content offset"
                  ? { ...fact, value: "240" }
                  : fact
              ),
            })),
          }
        : artifact,
    (artifact, call) =>
      call === 3
        ? {
            ...artifact,
            items: artifact.items.map((item) => ({
              ...item,
              label: "Changed person",
            })),
          }
        : artifact,
  ];
  for (const edit of controls) {
    const f = fixture(records, edit);
    const result = await runEvryComposition(options(f.registry));
    assert.equal(result.status, "completed");
    if (result.status !== "completed") assert.fail();
    assert.equal(outputSchema.parse(result.output).complete, false);
    assert.ok(f.calls.length <= 3);
  }
});

test("24-call bound returns explicit partial record or note evidence, never a 25th dispatch", async () => {
  for (const [rows, query] of [
    [
      records.slice(0, 25),
      peopleHistoryQuerySchema.parse({
        ...base,
        result: { mode: "list", limit: 1 },
      }),
    ],
    [[{ ...records[0]!, notes: "x".repeat(240 * 25) }], base],
  ] as const) {
    const f = fixture([...rows]);
    const result = await runEvryComposition(options(f.registry, query));
    assert.equal(result.status, "completed");
    if (result.status !== "completed") assert.fail();
    const output = outputSchema.parse(result.output);
    assert.equal(output.complete, false);
    assert.equal(output.reason, "call_limit");
    assert.equal(f.calls.length, COMPOSITION_LIMITS.maxBridgeRequests);
  }
});

test("existing turn budget and timeout still terminate the example; host errors remain private", async () => {
  const f = fixture();
  const budget = createCompositionBudget(2);
  const bounded = await runEvryComposition({ ...options(f.registry), budget });
  assert.deepEqual(bounded, { status: "failed", reason: "limit", calls: 2 });
  assert.equal(f.calls.length, 2);
  assert.equal(budget.used, 2);
  const bad = fixture(records, () => {
    throw new Error("private-provider-diagnostic");
  });
  const failed = await runEvryComposition(options(bad.registry));
  assert.equal(failed.status, "failed");
  assert.doesNotMatch(JSON.stringify(failed), /private-provider/);
  const slow = fixture(records, async (artifact) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return artifact;
  });
  const timed = await runEvryComposition({
    ...options(slow.registry),
    limits: { timeoutMs: 30 },
  });
  assert.equal(timed.status, "failed");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(slow.calls.length <= 1);
});

test("the example rejects aggregate or midstream inputs rather than claiming a full read", () => {
  for (const query of [
    { ...base, result: { mode: "count" as const } },
    { ...base, result: { mode: "list" as const, afterId: id(2) } },
    { ...base, contentOffset: 240 },
  ])
    assert.throws(() => historyNotesExample(query), /starts at the first/);
});
