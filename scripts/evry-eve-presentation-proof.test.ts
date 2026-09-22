import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertProviderPresentation,
  assertSavedPresentationInventory,
  presentationAssertionSchema,
} from "./evry-eve-presentation-proof";

test("fixture assertions inspect provider evidence without mistaking native correlations or user literals for reusable cards", () => {
  const expected = presentationAssertionSchema.parse({
    retired: ["prior:read"],
    current: ["current-read"],
    preservedText: ["Jordan has 4 tasks"],
    userText: "Literal prior:read",
  });
  const prompt: Parameters<typeof assertProviderPresentation>[0] = [
    { role: "user", content: [{ type: "text", text: expected.userText }] },
    {
      role: "assistant",
      content: [{ type: "text", text: "Jordan has 4 tasks" }],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: "tasks_query",
          toolCallId: "prior:read",
          output: { type: "json", value: { resultReference: "current-read" } },
        },
      ],
    },
  ];
  assert.deepEqual(assertProviderPresentation(prompt, expected), {
    retiredChecked: 1,
    currentChecked: 1,
    factsChecked: 1,
    userTextPreserved: true,
  });
  for (const stale of ["prior:read", "prior%3Aread", "prior%3aread"]) {
    assert.throws(
      () =>
        assertProviderPresentation(
          [
            ...prompt,
            { role: "assistant", content: [{ type: "text", text: stale }] },
          ],
          expected
        ),
      /Retired presentation reference/
    );
  }
  assert.throws(
    () => assertProviderPresentation(prompt.slice(1), expected),
    /Original user text/
  );
  assert.throws(
    () =>
      assertProviderPresentation(prompt, { ...expected, current: ["missing"] }),
    /Current presentation/
  );
  assert.throws(
    () =>
      assertProviderPresentation(prompt, {
        ...expected,
        preservedText: ["invented"],
      }),
    /Retained evidence/
  );
});

test("fixture checkpoint parser requires the exact issued set in completed native-format state, not a model answer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evry-presentation-parser-"));
  try {
    const events = join(directory, ".eve/.workflow-data/events");
    await mkdir(events, { recursive: true });
    const bytes = Buffer.from(
      `devl${JSON.stringify([
        { serializedContext: 1 },
        { "evry.issued-result-references": 2 },
        [3, 4],
        "read-a",
        "read-b",
      ])}`
    );
    await writeFile(
      join(events, "fixture.json"),
      JSON.stringify({
        eventType: "step_completed",
        eventData: {
          stepName: "fixture//turnStep",
          result: { __type: "Uint8Array", data: bytes.toString("base64") },
        },
      })
    );
    assert.deepEqual(
      await assertSavedPresentationInventory(directory, ["read-a", "read-b"]),
      {
        matchingSnapshots: 1,
        issuedCount: 2,
        exactIssuedSet: true,
      }
    );
    await assert.rejects(
      assertSavedPresentationInventory(directory, ["read-a"]),
      /unexpected identity/
    );
    await assert.rejects(
      assertSavedPresentationInventory(directory, [
        "read-a",
        "read-b",
        "never-published",
      ]),
      /No completed native checkpoint/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
