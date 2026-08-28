import assert from "node:assert/strict";
import { test } from "node:test";

import { trustedEvryApplicationSourceLink } from "../artifacts/core";
import type { EvryResolverCandidate } from "./contract";
import { resolveEvryCandidates } from "./core";

function candidate(
  id: string,
  label: string,
  match: "exact" | "fuzzy" = "exact"
): EvryResolverCandidate {
  return {
    id,
    label,
    match,
    distinguishingFacts: [{ label: "Stage", value: "Prospect" }],
    sourceLink: trustedEvryApplicationSourceLink({
      label,
      href: `/people/${id}`,
    }),
  };
}

const PERSON_RESOLUTION = {
  entityType: "person",
  prompt: "Which person did you mean?",
} as const;

test("one exact candidate resolves even when fuzzy alternatives exist", () => {
  const resolution = resolveEvryCandidates({
    ...PERSON_RESOLUTION,
    candidates: [
      candidate("fuzzy", "Alexis Kim", "fuzzy"),
      candidate("exact", "Alex Kim"),
    ],
  });

  assert.equal(resolution.status, "resolved");
  if (resolution.status !== "resolved") return;
  assert.equal(resolution.entity.id, "exact");
});

test("one fuzzy candidate resolves when no exact candidate exists", () => {
  const resolution = resolveEvryCandidates({
    ...PERSON_RESOLUTION,
    candidates: [candidate("fuzzy", "Alec Kim", "fuzzy")],
  });

  assert.equal(resolution.status, "resolved");
  if (resolution.status !== "resolved") return;
  assert.equal(resolution.entity.id, "fuzzy");
});

test("two Alex records stay unselected in stable order", () => {
  const resolution = resolveEvryCandidates({
    ...PERSON_RESOLUTION,
    candidates: [
      candidate("alex-z", "Alex Rivera"),
      candidate("alex-a", "Alex Rivera"),
      candidate("alex-a", "Alex Rivera", "fuzzy"),
    ],
  });

  assert.equal(resolution.status, "clarification");
  if (
    resolution.status !== "clarification" ||
    resolution.artifact.mode !== "choice"
  ) {
    return;
  }
  assert.deepEqual(
    resolution.artifact.choices.map(({ id }) => id),
    ["alex-a", "alex-z"]
  );
  assert.equal(resolution.artifact.defaultChoiceId, null);
});

test("absent candidates produce the neutral missing artifact", () => {
  assert.deepEqual(
    resolveEvryCandidates({ ...PERSON_RESOLUTION, candidates: [] }),
    {
      status: "clarification",
      artifact: {
        kind: "clarification",
        mode: "missing",
        entityType: "person",
        prompt: "Which person did you mean?",
      },
    }
  );
});
