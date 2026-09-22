import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  ContextContainer,
  contextStorage,
} from "../../../../../node_modules/eve/dist/src/context/container.js";
import {
  selectCurrentEveResultRows,
  selectAuthorizedCurrentEveResultRows,
  selectEveResultRows,
  eveResultSelectionInputSchema,
} from "./result-selection";
import {
  collectResult,
  publishResult,
  evryResultState,
  evryIssuedResultReferences,
  withResultPresentation,
} from "./results";
import { publicReadArtifactSchema } from "../../artifacts/public";
import { createEveToolRegistry } from "../capabilities/registry";
import { eveRuntimeToolSchema } from "./tool-schemas";
import {
  runEvryComposition,
  createCompositionBudget,
} from "../composition/runner";
import { resolveToolLoad } from "./tool-selection";

function read(ids = ["alex", "jordan", "blank"]) {
  return {
    kind: "read" as const,
    resultMode: "list" as const,
    title: "Assessments",
    filters: [
      { label: "Matching records", value: "53" },
      { label: "Next page cursor", value: "next-page" },
    ],
    counts: { matched: 53, returned: ids.length, excluded: 0 },
    exclusions: [],
    items: ids.map((id) => ({
      id,
      label: id,
      facts: [
        {
          label: "Recorded notes",
          value: id === "blank" ? "Not recorded" : "A recorded concern",
        },
        {
          label: "person_id",
          value: `private-${id}`,
          modelOnly: true as const,
        },
      ],
      sourceLink: { label: `Open ${id}`, href: `/people/${id}` },
    })),
    sourceLinks: [{ label: "Open People", href: "/people" }],
  };
}
const source = (
  reference = "page-1",
  value: unknown = read(),
  capability = "people.history.query"
) =>
  collectResult(
    [],
    {
      reference,
      turnId: "turn-1",
      capability,
    },
    z.json().parse(JSON.parse(JSON.stringify(value)))
  );
const input = (itemIds = ["alex", "jordan"], resultReference = "page-1") =>
  eveResultSelectionInputSchema.parse({
    selections: [{ resultReference, itemIds }],
  });

test("exact selected rows retain facts, source links and truthful provenance without mutating the original page", () => {
  const original = read([
    "alex",
    "jordan",
    ...Array.from({ length: 48 }, (_, n) => `other-${n}`),
  ]);
  const records = source("page-1", original);
  const before = structuredClone(records);
  const selected = selectEveResultRows(records, "turn-1", input());
  assert.ok("items" in selected);
  assert.deepEqual(
    selected.items.map((item) => item.id),
    ["alex", "jordan"]
  );
  assert.deepEqual(selected.counts, { matched: 2, returned: 2, excluded: 0 });
  assert.deepEqual(selected.filters, []);
  assert.deepEqual(selected.selection.sources[0]?.counts, original.counts);
  assert.deepEqual(selected.selection.sources[0]?.filters, read().filters);
  assert.deepEqual(selected.items, original.items.slice(0, 2));
  assert.deepEqual(records, before);
});

test("cross-page selections deduplicate identical records and reject conflicting versions without dropping requested rows", () => {
  const pages = [...source(), ...source("page-2", read(["jordan", "other"]))];
  const request = eveResultSelectionInputSchema.parse({
    selections: [
      { resultReference: "page-1", itemIds: ["alex", "jordan"] },
      { resultReference: "page-2", itemIds: ["jordan", "other"] },
    ],
  });
  const selected = selectEveResultRows(pages, "turn-1", request);
  assert.ok("items" in selected);
  assert.deepEqual(
    selected.items.map((item) => item.id),
    ["alex", "jordan", "other"]
  );
  assert.equal(selected.selection.sources.length, 2);
  assert.equal(selected.counts.matched, 3);
  const changed = read(["jordan", "other"]);
  changed.items[0]!.label = "Changed Jordan";
  assert.deepEqual(
    selectEveResultRows(
      [...source(), ...source("page-2", changed)],
      "turn-1",
      request
    ),
    {
      status: "invalid_input",
      reason: "conflicting_items",
    }
  );
});

test("unknown IDs refuse the entire selection, while unknown, foreign-session, stale and evicted handles disclose no records", () => {
  assert.deepEqual(
    selectEveResultRows(source(), "turn-1", input(["alex", "foreign"])),
    { status: "invalid_input", reason: "items_not_in_source" }
  );
  for (const [records, turnId, request] of [
    [source(), "turn-1", input(["alex"], "unknown")],
    [[], "turn-1", input()],
    [source(), "next-turn", input()],
    [source("retained"), "turn-1", input()],
  ] as const)
    assert.deepEqual(selectEveResultRows([...records], turnId, request), {
      status: "unavailable",
      reason: "source_result_unavailable",
    });
});

test("count, group, clarification and preparation sources cannot become selected list cards", () => {
  for (const mode of ["count", "group"] as const)
    assert.deepEqual(
      selectEveResultRows(
        source("page-1", { ...read(), resultMode: mode }),
        "turn-1",
        input()
      ),
      { status: "unavailable", reason: "source_not_a_list" }
    );
  const clarification = {
    kind: "clarification",
    mode: "missing",
    entityType: "person",
    prompt: "Which person?",
  };
  assert.deepEqual(
    selectEveResultRows(source("page-1", clarification), "turn-1", input()),
    { status: "unavailable", reason: "source_not_a_list" }
  );
  assert.deepEqual(
    selectEveResultRows(
      source("page-1", { artifacts: [read()] }, "actions.prepare"),
      "turn-1",
      input()
    ),
    { status: "unavailable", reason: "source_result_unavailable" }
  );
});

test("different capability/title/mode sources cannot be merged into a mislabeled collection", () => {
  const request = eveResultSelectionInputSchema.parse({
    selections: [
      { resultReference: "page-1", itemIds: ["alex"] },
      { resultReference: "page-2", itemIds: ["jordan"] },
    ],
  });
  for (const second of [
    source("page-2", read(), "tasks.query"),
    source("page-2", { ...read(), title: "Interviews" }),
    source("page-2", {
      ...read(),
      resultMode: undefined,
      counts: { matched: 3, returned: 3, excluded: 0 },
    }),
  ])
    assert.deepEqual(
      selectEveResultRows([...source(), ...second], "turn-1", request),
      { status: "invalid_input", reason: "incompatible_sources" }
    );
});

test("strict selection input has no model-authored facts or labels, duplicates, empty selections, or unbounded rows", () => {
  const valid = {
    selections: [{ resultReference: "page-1", itemIds: ["alex"] }],
  };
  for (const bad of [
    { ...valid, title: "New title" },
    { selections: [] },
    { selections: [{ resultReference: "page-1", itemIds: [] }] },
    { selections: [{ resultReference: "page-1", itemIds: ["alex", "alex"] }] },
    { selections: [...valid.selections, ...valid.selections] },
    {
      selections: [
        {
          resultReference: "page-1",
          itemIds: Array.from({ length: 101 }, (_, i) => String(i)),
        },
      ],
    },
  ])
    assert.equal(eveResultSelectionInputSchema.safeParse(bad).success, false);
  assert.equal(
    eveRuntimeToolSchema("results.select").safeParse(valid).success,
    true
  );
});

test("native selection publication issues a normal marker, strips model-only facts and preserves original totals through repeated selections", () =>
  contextStorage.run(new ContextContainer(), () => {
    publishResult(
      {
        reference: "page-1",
        turnId: "turn-1",
        capability: "people.history.query",
      },
      z.json().parse(read())
    );
    const selected = selectCurrentEveResultRows("turn-1", input());
    publishResult(
      { reference: "selected", turnId: "turn-1", capability: "results.select" },
      z.json().parse(selected)
    );
    const narrowed = selectCurrentEveResultRows(
      "turn-1",
      input(["alex"], "selected")
    );
    assert.ok("selection" in narrowed);
    assert.equal(narrowed.selection.sources[0]?.reference, "page-1");
    assert.equal(narrowed.selection.sources[0]?.counts.matched, 53);
    assert.deepEqual(narrowed.selection.sources[0]?.itemIds, ["alex"]);
    const envelope = withResultPresentation(selected, "turn-1", ["selected"]);
    const artifact = publicReadArtifactSchema.parse(
      envelope.presentation.results[0]?.artifacts[0]
    );
    assert.equal(artifact.items.length, 2);
    assert.ok(
      artifact.items.every((item) =>
        item.facts.every((fact) => fact.label !== "person_id")
      )
    );
    assert.deepEqual(evryIssuedResultReferences.get(), ["page-1", "selected"]);
    assert.equal(evryResultState.get().length, 2);
    assert.equal(
      publicReadArtifactSchema.safeParse({
        ...artifact,
        counts: { ...artifact.counts, matched: 53 },
      }).success,
      false
    );
  }));

test("selection requires fresh source permissions, including after a derived card, and state belongs only to its native session", async () => {
  const owner = new ContextContainer();
  await contextStorage.run(owner, async () => {
    publishResult(
      {
        reference: "page-1",
        turnId: "turn-1",
        capability: "people.history.query",
        authorizationIdentities: ["people.assessments.read"],
      },
      z.json().parse(read())
    );
    const checked: string[] = [];
    const selected = await selectAuthorizedCurrentEveResultRows(
      "turn-1",
      input(),
      async (identity) => {
        checked.push(identity);
        return true;
      }
    );
    assert.deepEqual(checked, ["people.assessments.read"]);
    assert.ok("items" in selected.result);
    publishResult(
      {
        reference: "selected",
        turnId: "turn-1",
        capability: "results.select",
        authorizationIdentities: selected.authorizationIdentities,
      },
      z.json().parse(selected.result)
    );
    const refused = await selectAuthorizedCurrentEveResultRows(
      "turn-1",
      input(["alex"], "selected"),
      async () => false
    );
    assert.deepEqual(refused.result, {
      status: "unavailable",
      reason: "not_authorized",
    });
    assert.deepEqual(refused.authorizationIdentities, []);
  });
  await contextStorage.run(new ContextContainer(), async () => {
    let checks = 0;
    const foreign = await selectAuthorizedCurrentEveResultRows(
      "turn-1",
      input(),
      async () => {
        checks++;
        return true;
      }
    );
    assert.deepEqual(foreign.result, {
      status: "unavailable",
      reason: "source_result_unavailable",
    });
    assert.equal(checks, 0);
    publishResult(
      {
        reference: "page-1",
        turnId: "turn-1",
        capability: "people.history.query",
      },
      z.json().parse(read())
    );
    const legacy = await selectAuthorizedCurrentEveResultRows(
      "turn-1",
      input(),
      async () => {
        checks++;
        return true;
      }
    );
    assert.deepEqual(legacy.result, {
      status: "unavailable",
      reason: "source_result_unavailable",
    });
    assert.equal(
      checks,
      0,
      "missing authority provenance cannot be guessed from a tool name"
    );
  });
});

test("direct discovery and real code-mode composition share the bounded selection contract without a data read or preparation", async () =>
  contextStorage.run(new ContextContainer(), async () => {
    publishResult(
      {
        reference: "page-1",
        turnId: "turn-1",
        capability: "people.history.query",
      },
      z.json().parse(read())
    );
    let reads = 0;
    const registry = createEveToolRegistry({
      context: {
        actor: { userId: "actor", plantId: "plant" },
        literalUserText: "Show the matching rows",
        pageContext: null,
        now: new Date(0),
      },
      authorizeRead: async () => {
        reads++;
        return null;
      },
      selectResult: (args) => selectCurrentEveResultRows("turn-1", args),
    });
    const load = resolveToolLoad(
      { names: [], preparationOperations: [] },
      { names: ["results.select"], preparationOperations: [], mode: "add" },
      registry.describe(),
      []
    );
    assert.equal(load.status, "loaded");
    const direct = await registry.invoke("results.select", input());
    const composed = await runEvryComposition({
      registry,
      callId: "select-composition",
      budget: createCompositionBudget(),
      js: `return await tools["results.select"](${JSON.stringify(input())});`,
    });
    assert.equal(composed.status, "completed");
    if (composed.status !== "completed")
      assert.fail("Composition did not finish");
    assert.deepEqual(composed.output, direct);
    assert.equal(reads, 0);
    assert.equal(
      evryResultState.get().length,
      1,
      "the generic registry does not issue native result handles"
    );
  }));
