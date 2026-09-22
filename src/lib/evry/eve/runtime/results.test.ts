import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ContextContainer,
  contextStorage,
} from "../../../../../node_modules/eve/dist/src/context/container.js";
import {
  evryIssuedResultReferences,
  evryResultState,
  publishResult,
  findResult,
} from "./results";
import { projectPresentationHistory } from "./presentation-guidance";

test("trusted publication retains exact issued identities beyond artifact eviction and restored context", () => {
  const context = new ContextContainer();
  contextStorage.run(context, () => {
    for (let i = 0; i < 30; i++)
      publishResult(
        {
          turnId: "turn-1",
          reference: `read-${i}`,
          capability: "people.query",
        },
        {
          kind: "read",
          title: "People",
          items: [],
          resultReference: "untrusted-alias",
        }
      );
    assert.equal(evryResultState.get().length, 24);
    assert.equal(evryIssuedResultReferences.get().length, 30);
    assert.equal(
      findResult(evryResultState.get(), "read-0", "turn-1"),
      undefined
    );
    assert.equal(
      findResult(evryResultState.get(), "read-29", "turn-2"),
      undefined
    );
    assert.ok(!evryIssuedResultReferences.get().includes("untrusted-alias"));
    const projected = projectPresentationHistory(
      [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "[[evry-result:read-0]] [[evry-result:read-29]]",
            },
          ],
        },
      ],
      {
        turnId: "turn-1",
        results: evryResultState.get(),
        issuedReferences: evryIssuedResultReferences.get(),
      }
    );
    assert.match(JSON.stringify(projected), /Earlier result card omitted/);
    assert.match(JSON.stringify(projected), /\[\[evry-result:read-29\]\]/);
  });
  const restored = new ContextContainer();
  for (const [key, value] of context.entries())
    restored.set(key, JSON.parse(JSON.stringify(value)));
  contextStorage.run(restored, () => {
    publishResult(
      { turnId: "turn-2", reference: "next-read", capability: "tasks.query" },
      { kind: "read", title: "Tasks", items: [] }
    );
    assert.equal(evryResultState.get().length, 1);
    assert.equal(evryIssuedResultReferences.get().length, 31);
    assert.ok(evryIssuedResultReferences.get().includes("read-0"));
  });
  contextStorage.run(new ContextContainer(), () =>
    assert.deepEqual(evryIssuedResultReferences.get(), [])
  );
});

test("unavailable/refused/non-read results do not issue a handle; replay is idempotent and preparation stays separate", () => {
  contextStorage.run(new ContextContainer(), () => {
    const entry = {
      turnId: "one",
      reference: "real-read",
      capability: "people.query",
    };
    const refusedResults: Parameters<typeof publishResult>[1][] = [
      { status: "unavailable", reason: "not_authorized" },
      { kind: "confirmation", approved: true },
      null,
    ];
    for (const result of refusedResults) publishResult(entry, result);
    assert.deepEqual(evryIssuedResultReferences.get(), []);
    publishResult(
      { ...entry, capability: "actions.prepare" },
      { kind: "read", title: "Not a read capability" }
    );
    assert.deepEqual(evryIssuedResultReferences.get(), []);
    publishResult(entry, { kind: "clarification", title: "Choose a person" });
    publishResult(entry, { kind: "clarification", title: "Choose a person" });
    assert.deepEqual(evryIssuedResultReferences.get(), ["real-read"]);
  });
});
