import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import type { CapturedCall } from "./host-capture";
import {
  bindCommunicationRetryTurns,
  communicationRetryFixtureIds,
  communicationRetryPlanReference,
} from "./communication-retry";

const plan = {
  planId: "11111111-1111-4111-8111-111111111111",
  fingerprint: "a".repeat(64),
};
const prepared: CapturedCall = {
  id: "prepare",
  name: "actions.prepare",
  input: {
    request: { operation: "communication.retry_failed", arguments: {} },
  },
  output: {
    artifacts: [{ kind: "confirmation" }],
    activePlan: { mode: "set", plan },
  },
};

test("failed invitation case preserves original request and binds its missing meeting explicitly", () => {
  assert.deepEqual(communicationRetryFixtureIds, ["communication-06"]);
  const question = questions.find((q) => q.id === "communication-06")!;
  assert.equal(
    question.turns[0],
    "Resend only the failed invitations from that meeting."
  );
  const m = createFixtureManifest(question.id, 0);
  const turns = bindCommunicationRetryTurns(m, question.turns);
  assert.deepEqual(turns.slice(0, question.turns.length), question.turns);
  assert.equal(turns.length, question.turns.length + 1);
  assert.ok(turns.at(-1)?.includes(`/meetings/${m.ids["meeting-upcoming"]}`));
});
test("only presented native confirmation returns a candidate reference; it is not yet SQL evidence", () => {
  assert.deepEqual(
    communicationRetryPlanReference([prepared], new Set([prepared.id])),
    plan
  );
  assert.equal(communicationRetryPlanReference([prepared], new Set()), null);
  assert.equal(
    communicationRetryPlanReference(
      [{ ...prepared, output: { activePlan: { mode: "set", plan } } }],
      new Set([prepared.id])
    ),
    null
  );
  assert.equal(
    communicationRetryPlanReference(
      [
        {
          ...prepared,
          output: {
            artifacts: [{ kind: "read" }],
            activePlan: { mode: "set", plan },
          },
        },
      ],
      new Set([prepared.id])
    ),
    null
  );
});
test("model input, malformed reference and an earlier review after failed preparation cannot earn facts", () => {
  assert.equal(
    communicationRetryPlanReference(
      [{ ...prepared, output: {}, input: prepared.output }],
      new Set([prepared.id])
    ),
    null
  );
  assert.equal(
    communicationRetryPlanReference(
      [
        {
          ...prepared,
          output: {
            artifacts: [{ kind: "confirmation" }],
            activePlan: { mode: "set", plan: { ...plan, fingerprint: "bad" } },
          },
        },
      ],
      new Set([prepared.id])
    ),
    null
  );
  assert.equal(
    communicationRetryPlanReference(
      [
        prepared,
        {
          id: "failed",
          name: "actions.prepare",
          input: {},
          output: { status: "unavailable" },
        },
      ],
      new Set([prepared.id])
    ),
    null
  );
});
