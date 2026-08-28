import assert from "node:assert/strict";
import { test } from "node:test";

import { evryConversationStateDocumentSchema } from "./contract";
import { resolveEvryConversationReference } from "./references";

const NOW = new Date("2026-08-28T12:00:00.000Z");
const MESSAGE_ID = "10000000-0000-4000-8000-000000000001";

function reference(input: {
  key: string;
  id: string;
  label: string;
  validThrough?: string | null;
  aliases?: readonly string[];
}) {
  return {
    key: input.key,
    entityType: "person",
    entityId: input.id,
    label: input.label,
    distinguishingFacts: [{ label: "Team", value: input.label }],
    sourceLink: { label: input.label, href: `/people/${input.id}` },
    aliases: input.aliases ?? ["her"],
    sourceMessageId: MESSAGE_ID,
    resolvedAt: "2026-08-20T12:00:00.000Z",
    validThrough: input.validThrough ?? "2026-09-20T12:00:00.000Z",
  };
}

function state(
  references: readonly ReturnType<typeof reference>[],
  explicitChoices: readonly unknown[] = [],
  summary = ""
) {
  return evryConversationStateDocumentSchema.parse({
    version: 1,
    resolvedReferences: references,
    explicitChoices,
    activeRecipe: null,
    pendingClarification: null,
    completedSteps: [],
    summary: summary === "" ? null : { text: summary, throughSequence: 4 },
  });
}

test("one fresh structured referent resolves and emits its relevance key", () => {
  const result = resolveEvryConversationReference({
    text: "Add her to the meeting too.",
    state: state([
      reference({ key: "person.alex", id: "alex", label: "Alex Rivera" }),
    ]),
    now: NOW,
  });

  assert.equal(result.status, "resolved");
  if (result.status !== "resolved") assert.fail("expected resolution");
  assert.equal(result.reference.entityId, "alex");
  assert.deepEqual(result.relevanceKeys, ["person.alex"]);
});

test("two referents clarify with no default instead of guessing", () => {
  const result = resolveEvryConversationReference({
    text: "Add her to the meeting too.",
    state: state([
      reference({ key: "person.alex", id: "alex", label: "Alex Rivera" }),
      reference({ key: "person.sam", id: "sam", label: "Sam Lee" }),
    ]),
    now: NOW,
  });

  assert.equal(result.status, "clarification");
  if (result.status !== "clarification") assert.fail("expected clarification");
  assert.equal(result.reason, "ambiguous");
  assert.equal(result.artifact.mode, "choice");
  if (result.artifact.mode !== "choice") assert.fail("expected choices");
  assert.equal(result.artifact.defaultChoiceId, null);
  assert.deepEqual(
    result.artifact.choices.map(({ id }) => id),
    ["alex", "sam"]
  );
  assert.equal(
    Object.getOwnPropertySymbols(result.artifact.choices[0].sourceLink).length,
    1
  );
});

test("an exact explicit choice resolves a prior ambiguity", () => {
  const alex = reference({
    key: "person.alex",
    id: "alex",
    label: "Alex Rivera",
  });
  const sam = reference({ key: "person.sam", id: "sam", label: "Sam Lee" });
  const result = resolveEvryConversationReference({
    text: "Add her to the meeting too.",
    state: state(
      [alex, sam],
      [
        {
          id: "20000000-0000-4000-8000-000000000001",
          clarificationArtifactId: "30000000-0000-4000-8000-000000000001",
          offeredReferences: [
            {
              referenceKey: "person.alex",
              entityType: "person",
              entityId: "alex",
            },
            {
              referenceKey: "person.sam",
              entityType: "person",
              entityId: "sam",
            },
          ],
          referenceKey: "person.sam",
          selectedEntityId: "sam",
          sourceMessageId: MESSAGE_ID,
          selectedAt: "2026-08-27T12:00:00.000Z",
        },
      ]
    ),
    now: NOW,
  });

  assert.equal(result.status, "resolved");
  if (result.status !== "resolved") assert.fail("expected resolution");
  assert.equal(result.reference.entityId, "sam");
});

test("stale structured references and summary-only names both clarify", () => {
  const stale = resolveEvryConversationReference({
    text: "Add her to the meeting too.",
    state: state([
      reference({
        key: "person.alex",
        id: "alex",
        label: "Alex Rivera",
        validThrough: "2026-08-27T12:00:00.000Z",
      }),
    ]),
    now: NOW,
  });
  assert.equal(stale.status, "clarification");
  if (stale.status !== "clarification") assert.fail("expected clarification");
  assert.equal(stale.reason, "stale");

  const summaryOnly = resolveEvryConversationReference({
    text: "Add her to the meeting too.",
    state: state([], [], "The person is Alex Rivera."),
    now: NOW,
  });
  assert.equal(summaryOnly.status, "clarification");
  if (summaryOnly.status !== "clarification") {
    assert.fail("expected clarification");
  }
  assert.equal(summaryOnly.reason, "missing");
});

test("reference expiry compares instants rather than ISO text spelling", () => {
  const atTheBoundary = resolveEvryConversationReference({
    text: "Add her to the meeting too.",
    state: state([
      reference({
        key: "person.alex",
        id: "alex",
        label: "Alex Rivera",
        validThrough: "2026-08-28T12:00:00Z",
      }),
    ]),
    now: NOW,
  });

  assert.equal(atTheBoundary.status, "clarification");
  if (atTheBoundary.status !== "clarification") {
    assert.fail("expected clarification");
  }
  assert.equal(atTheBoundary.reason, "stale");
});

test("reference aliases use the same Unicode-aware canonical form as input", () => {
  const result = resolveEvryConversationReference({
    text: "Add CAFÉ O’Connor to the meeting.",
    state: state([
      reference({
        key: "person.cafe_oconnor",
        id: "cafe",
        label: "Café O’Connor",
        aliases: ["café o connor"],
      }),
    ]),
    now: NOW,
  });

  assert.equal(result.status, "resolved");
  if (result.status !== "resolved") assert.fail("expected resolution");
  assert.equal(result.reference.entityId, "cafe");
});
