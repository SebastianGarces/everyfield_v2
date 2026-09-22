import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { peopleHistoryQuerySchema } from "../../capabilities/queries/people-query-sql";
import { peopleQueryArtifact } from "../../capabilities/queries/people";
import { collectResult, publicResultArtifacts } from "./results";
import {
  describeHistoryContinuation,
  historyContinuationModelOutput,
  historyContinuationSchema,
} from "./history-continuation";
import {
  createCompositionBudget,
  runEvryComposition,
} from "../composition/runner";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = peopleHistoryQuerySchema.parse({
  resource: { kind: "assessments" },
  cohort: { all: { stages: ["core_group"] } },
  dates: { from: "2026-09-01", through: "2026-09-20" },
  dateBasis: "created_at",
  authorIds: [id(900)],
  latestPerPerson: false,
  result: { mode: "list", limit: 50 },
});
type Query = z.infer<typeof peopleHistoryQuerySchema>;
const rows = Array.from({ length: 53 }, (_, i) => ({
  id: id(i + 1),
  notes: i === 51 ? "🙂".repeat(480) + "Needs help." : "No concerns.",
}));

function artifact(input = base, records = rows) {
  assert.equal(input.result.mode, "list");
  if (input.result.mode !== "list") assert.fail();
  const selected = records.filter(
    (row) => !input.recordIds || input.recordIds.includes(row.id)
  );
  const after = input.result.afterId;
  const remaining = selected.filter((row) => !after || row.id > after);
  const page = remaining.slice(0, input.result.limit);
  const offset = input.contentOffset ?? 0;
  const value = peopleQueryArtifact(
    "Recorded people history",
    {
      total: selected.length,
      people: selected.length,
      households: 0,
      without_household: selected.length,
      groups: [],
      group_total: 0,
      has_more: remaining.length > page.length,
      rows: page.map((row) => ({
        id: row.id,
        label: "Recorded person",
        person_id: id(901),
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
  return {
    ...value,
    filters: value.filters.map((filter) => ({ ...filter })),
    items: value.items.map((item) => ({
      ...item,
      facts: item.facts.map((fact) => ({ ...fact })),
    })),
  };
}
const json = (value: unknown) =>
  z.json().parse(JSON.parse(JSON.stringify(value)));
function continuation(input: unknown, output: unknown) {
  const projected = historyContinuationModelOutput(input, json(output));
  return z.object({ continuation: historyContinuationSchema }).parse(projected)
    .continuation;
}
const entry = {
  name: "people.history.query",
  description: "Read recorded history.",
  inputSchema: peopleHistoryQuerySchema,
  effect: "read" as const,
};

test("typed list continuation follows exact pages independently of Unicode note offsets", () => {
  const first = continuation(base, artifact());
  assert.equal(first.status, "available");
  if (first.status !== "available") assert.fail();
  assert.equal(first.nextAfterId, id(50));
  const nextInput = peopleHistoryQuerySchema.parse({
    ...base,
    result: { mode: "list", limit: 50, afterId: first.nextAfterId },
  });
  const last = continuation(nextInput, artifact(nextInput));
  assert.equal(last.status, "available");
  if (last.status !== "available") assert.fail();
  assert.equal(last.nextAfterId, null);
  assert.deepEqual(last.records[1], {
    id: id(52),
    content: {
      status: "available",
      offset: 0,
      totalCharacters: 491,
      nextOffset: 240,
    },
  });
  for (const offset of [240, 480]) {
    const exact = peopleHistoryQuerySchema.parse({
      ...base,
      recordIds: [id(52)],
      contentOffset: offset,
    });
    const value = continuation(exact, artifact(exact));
    assert.equal(value.status, "available");
    if (value.status !== "available") assert.fail();
    assert.deepEqual(value.records[0].content, {
      status: "available",
      offset,
      totalCharacters: 491,
      nextOffset: offset === 240 ? 480 : null,
    });
  }
});

test("empty lists and measured empty notes are complete; absent notes are unknown", () => {
  assert.deepEqual(continuation(base, artifact(base, [])), {
    status: "available",
    nextAfterId: null,
    records: [],
  });
  const empty = artifact(base, [{ id: id(1), notes: "" }]);
  assert.deepEqual(continuation(base, empty), {
    status: "available",
    nextAfterId: null,
    records: [
      {
        id: id(1),
        content: {
          status: "available",
          offset: 0,
          totalCharacters: 0,
          nextOffset: null,
        },
      },
    ],
  });
  const missing = structuredClone(empty);
  missing.items[0].facts = missing.items[0].facts.filter(
    ({ label }) => !["Recorded notes", "Notes character count"].includes(label)
  );
  const value = continuation(base, missing);
  assert.equal(value.status, "available");
  if (value.status !== "available") assert.fail();
  assert.deepEqual(value.records[0].content, { status: "unavailable" });
});

test("missing, duplicate, inconsistent and malformed page metadata never claim completion", () => {
  for (const edit of [
    (a: ReturnType<typeof artifact>) => {
      a.filters = a.filters.filter(({ label }) => label !== "Next page cursor");
    },
    (a: ReturnType<typeof artifact>) => {
      a.filters.push({ label: "Next page cursor", value: "End of results" });
    },
    (a: ReturnType<typeof artifact>) => {
      a.filters.find(({ label }) => label === "Next page cursor")!.value =
        "not-a-cursor";
    },
    (a: ReturnType<typeof artifact>) => {
      a.filters.find(({ label }) => label === "Next page cursor")!.value =
        "End of results";
    },
    (a: ReturnType<typeof artifact>) => {
      a.filters.find(({ label }) => label === "Next page cursor")!.value =
        id(49);
    },
    (a: ReturnType<typeof artifact>) => {
      a.items[1].id = a.items[0].id;
    },
    (a: ReturnType<typeof artifact>) => {
      a.items.pop();
    },
  ]) {
    const value = structuredClone(artifact());
    edit(value);
    assert.deepEqual(continuation(base, value), { status: "unavailable" });
  }
});

test("missing or malformed note metadata is unavailable, including offsets and Unicode byte-count confusion", () => {
  const input = peopleHistoryQuerySchema.parse({
    ...base,
    recordIds: [id(52)],
  });
  for (const label of [
    "Notes character count",
    "Notes character offset",
    "Next content offset",
    "Recorded notes",
  ]) {
    for (const change of ["missing", "duplicate", "malformed", "untrusted"]) {
      const value = structuredClone(artifact(input));
      const facts = value.items[0].facts;
      const fact = facts.find((fact) => fact.label === label)!;
      if (change === "missing")
        value.items[0].facts = facts.filter((fact) => fact.label !== label);
      if (change === "duplicate") facts.push({ ...fact });
      if (change === "malformed")
        fact.value = label === "Recorded notes" ? "partial" : "-1";
      if (change === "untrusted" && label !== "Recorded notes")
        delete fact.modelOnly;
      if (change === "untrusted" && label === "Recorded notes") continue;
      const result = continuation(input, value);
      assert.equal(result.status, "available");
      if (result.status !== "available") assert.fail();
      assert.deepEqual(
        result.records[0].content,
        { status: "unavailable" },
        `${label} ${change}`
      );
    }
  }
  const bytes = structuredClone(artifact(input));
  bytes.items[0].facts.find(
    ({ label }) => label === "Next content offset"
  )!.value = "480";
  const result = continuation(input, bytes);
  assert.equal(result.status, "available");
  if (result.status !== "available") assert.fail();
  assert.deepEqual(result.records[0].content, { status: "unavailable" });
});

test("failures and aggregate results stay unchanged; original artifact and native presentation retain no continuation", () => {
  for (const value of [
    null,
    { status: "unavailable" },
    { status: "invalid_input" },
    { kind: "clarification" },
  ]) {
    const original = json(value);
    assert.equal(historyContinuationModelOutput(base, original), original);
  }
  const original = json(artifact());
  for (const result of [
    { mode: "count" },
    { mode: "group", by: "person", limit: 50 },
    null,
  ]) {
    assert.equal(
      historyContinuationModelOutput({ ...base, result }, original),
      original
    );
  }
  const before = JSON.stringify(original);
  const retained = collectResult(
    [],
    { reference: "call_exact", turnId: "turn", capability: entry.name },
    original
  );
  const model = historyContinuationModelOutput(base, original);
  assert.equal(JSON.stringify(original), before);
  assert.notEqual(model, original);
  assert.deepEqual(retained[0].artifacts, [original]);
  assert.doesNotMatch(
    JSON.stringify(publicResultArtifacts(retained[0].artifacts)),
    /continuation|Notes character/
  );
});

test("selected-tool output discovery derives its shape from the same schema", () => {
  const described = describeHistoryContinuation(entry);
  assert.equal(described.inputSchema, entry.inputSchema);
  assert.ok(
    described.description.includes(
      JSON.stringify(z.toJSONSchema(historyContinuationSchema))
    )
  );
  assert.match(described.description, /unavailable|Unavailable/);
  assert.equal(
    describeHistoryContinuation({ ...entry, name: "tasks.query" }).description,
    entry.description
  );
});

test("real code-mode sandbox consumes typed continuation for all 53 IDs and complete Unicode notes", async () => {
  const calls: Query[] = [];
  const originalInputs = JSON.stringify(base);
  const result = await runEvryComposition({
    callId: "typed-history",
    budget: createCompositionBudget(),
    registry: {
      describe: () => [describeHistoryContinuation(entry)],
      async invoke(_name, raw, invocation) {
        const input = peopleHistoryQuerySchema.parse(raw);
        calls.push(input);
        const value = historyContinuationModelOutput(
          input,
          json(artifact(input))
        );
        return {
          ...z.object({}).passthrough().parse(value),
          resultReference: invocation.callId,
        };
      },
    },
    js: `const base=${JSON.stringify(base)}; const records=[]; const refs=[];
      let afterId;
      do {
        const r=await tools['people.history.query']({...base,result:{...base.result,...(afterId?{afterId}:{})}});
        refs.push(r.resultReference);
        if(r.continuation.status!=='available') return {complete:false};
        for(const record of r.continuation.records) {
          const item=r.items.find(item=>item.id===record.id);
          records.push({...record,notes:item.facts.find(f=>f.label==='Recorded notes').value});
        }
        afterId=r.continuation.nextAfterId;
      }while(afterId);
      for(const record of records) {
        if(record.content.status!=='available')return {complete:false};
        while(record.content.nextOffset!==null) {
          const r=await tools['people.history.query']({...base,recordIds:[record.id],contentOffset:record.content.nextOffset});
          refs.push(r.resultReference);
          if(r.continuation.status!=='available'||r.continuation.records.length!==1||r.continuation.records[0].content.status!=='available')return {complete:false};
          record.notes+=r.items[0].facts.find(f=>f.label==='Recorded notes').value;
          record.content=r.continuation.records[0].content;
        }
      }
      return {complete:true,records:records.map(r=>({id:r.id,notes:r.notes})),refs};`,
  });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") assert.fail();
  assert.equal(result.calls, 4);
  assert.deepEqual(
    z
      .object({
        records: z.array(z.object({ id: z.string(), notes: z.string() })),
        complete: z.literal(true),
      })
      .parse(result.output).records,
    rows
  );
  assert.equal(JSON.stringify(base), originalInputs);
  for (const call of calls) {
    const {
      result: _result,
      recordIds: _ids,
      contentOffset: _offset,
      ...actual
    } = call;
    const { result: _baseResult, ...expected } = base;
    assert.deepEqual(actual, expected);
    if (call.recordIds && call.result.mode === "list")
      assert.equal(call.result.afterId, undefined);
  }
});
