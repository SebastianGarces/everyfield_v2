import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "./core";
import { publicEvryArtifact } from "./public";
import {
  hydrateStoredEvryConversationArtifact,
  storedEvryReadArtifactDocument,
} from "@/lib/evry/conversations/artifacts";

const link = trustedEvryApplicationSourceLink({
  label: "Tasks",
  href: "/tasks",
});
const page = buildEvryReadArtifact({
  title: "Pending tasks",
  filters: [],
  exclusions: [],
  items: [{ id: "fixture", label: "Task", facts: [], sourceLink: link }],
  sourceLinks: [link],
});

test("exact filtered totals survive persistence, hydration and public projection", () => {
  for (const [resultMode, matched] of [
    ["list", 22],
    ["group", 22],
    ["count", 0],
  ] as const) {
    const stored = storedEvryReadArtifactDocument({
      ...page,
      resultMode,
      counts: { matched, returned: 1, excluded: 0 },
    });
    const hydrated = hydrateStoredEvryConversationArtifact(stored);
    const projected = publicEvryArtifact(hydrated);
    assert.equal(projected.kind, "read");
    if (projected.kind !== "read") throw new Error("Wrong result kind");
    assert.equal(projected.resultMode, resultMode);
    assert.equal(projected.counts.matched, matched);
  }
});

test("query totals do not weaken returned-row, exclusion or legacy snapshot integrity", () => {
  assert.throws(() =>
    storedEvryReadArtifactDocument({
      ...page,
      resultMode: "list",
      counts: { matched: 22, returned: 2, excluded: 0 },
    })
  );
  assert.throws(() =>
    storedEvryReadArtifactDocument({
      ...page,
      resultMode: "group",
      counts: { matched: 22, returned: 1, excluded: 1 },
    })
  );
  assert.throws(() =>
    storedEvryReadArtifactDocument({
      ...page,
      resultMode: "list",
      counts: { matched: 0, returned: 1, excluded: 0 },
    })
  );
  assert.throws(() =>
    storedEvryReadArtifactDocument({
      ...page,
      counts: { matched: 22, returned: 1, excluded: 0 },
    })
  );
});

test("internal relationship identifiers survive storage but never reach displayed read facts", () => {
  const artifact = buildEvryReadArtifact({
    title: "Pending tasks",
    filters: [],
    exclusions: [],
    sourceLinks: [link],
    items: [
      {
        id: "task",
        label: "Call Alex",
        sourceLink: link,
        facts: [
          { label: "Assignee", value: "Alex" },
          {
            label: "Assignee account ID",
            value: "20000000-0000-4000-8000-000000000001",
            modelOnly: true,
          },
        ],
      },
    ],
  });
  const stored = storedEvryReadArtifactDocument(artifact);
  const hydrated = hydrateStoredEvryConversationArtifact(stored);
  assert.equal(hydrated.kind, "read");
  if (hydrated.kind !== "read") throw new Error("Wrong kind");
  assert.equal(hydrated.items[0].facts[1].modelOnly, true);
  const shown = publicEvryArtifact(hydrated);
  assert.equal(shown.kind, "read");
  if (shown.kind !== "read") throw new Error("Wrong kind");
  assert.deepEqual(shown.items[0].facts, [
    { label: "Assignee", value: "Alex" },
  ]);
});
