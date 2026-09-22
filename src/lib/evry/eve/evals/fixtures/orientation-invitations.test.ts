import assert from "node:assert/strict";
import { test } from "node:test";
import { questions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import type { CapturedCall } from "./host-capture";
import {
  orientationInvitationsFixtureIds,
  orientationInvitationsPlanReference,
  orientationInvitationsRequest,
  readPreparedOrientationInvitationsFacts,
} from "./orientation-invitations";

const plan = {
  planId: "11111111-1111-4111-8111-111111111111",
  fingerprint: "a".repeat(64),
};
const call: CapturedCall = {
  id: "review",
  name: "actions.prepare",
  input: {},
  output: {
    artifacts: [{ kind: "confirmation" }],
    activePlan: { mode: "set", plan },
  },
};
test("orientations-04 preserves the exact original question without invented setup", () => {
  assert.deepEqual(orientationInvitationsFixtureIds, ["orientations-04"]);
  assert.deepEqual(questions.find((q) => q.id === "orientations-04")!.turns, [
    orientationInvitationsRequest,
  ]);
});
test("only a presented actual confirmation supplies a plan reference", () => {
  assert.deepEqual(
    orientationInvitationsPlanReference([call], new Set([call.id])),
    plan
  );
  assert.equal(orientationInvitationsPlanReference([call], new Set()), null);
  for (const output of [
    {},
    { activePlan: { mode: "set", plan } },
    { artifacts: [{ kind: "read" }], activePlan: { mode: "set", plan } },
    {
      artifacts: [{ kind: "confirmation" }],
      activePlan: { mode: "set", plan: { ...plan, fingerprint: "untrusted" } },
    },
  ])
    assert.equal(
      orientationInvitationsPlanReference(
        [{ ...call, output }],
        new Set([call.id])
      ),
      null
    );
});
test("a failed or unshown newer preparation cannot borrow a prior review", () => {
  assert.equal(
    orientationInvitationsPlanReference(
      [call, { ...call, id: "later", output: {} }],
      new Set([call.id, "later"])
    ),
    null
  );
  assert.equal(
    orientationInvitationsPlanReference(
      [call, { ...call, id: "later" }],
      new Set([call.id])
    ),
    null
  );
});
test("a read or model label cannot be used as confirmation evidence", async () => {
  let reads = 0;
  const observed = await readPreparedOrientationInvitationsFacts({
    manifest: createFixtureManifest("orientations-04", 1),
    store: {
      query: () => {
        reads++;
        return [];
      },
    },
    calls: [{ ...call, name: "people.query" }],
    presented: new Set([call.id]),
  });
  assert.deepEqual(observed, { facts: {}, evidence: [] });
  assert.equal(reads, 0);
});
test("an unknown stored plan cannot receive facts from a plausible review payload", async () => {
  const observed = await readPreparedOrientationInvitationsFacts({
    manifest: createFixtureManifest("orientations-04", 1),
    store: { query: () => [] },
    calls: [call],
    presented: new Set([call.id]),
  });
  assert.deepEqual(observed, { facts: {}, evidence: [] });
});
