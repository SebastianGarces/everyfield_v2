import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EVRY_ACKNOWLEDGEMENT_BUDGET_MS,
  EVRY_WORK_PHASES,
  applyEvrySequencedWork,
  beginEvrySequencedWork,
  evryWorkPresentation,
  measureEvryAcknowledgement,
  type EvryWorkState,
} from "./state";

test("the work state is closed over every specific user-visible phase", () => {
  assert.deepEqual(EVRY_WORK_PHASES, [
    "idle",
    "reading",
    "planning",
    "confirmation",
    "execution",
    "complete",
    "blocked",
    "failed",
  ]);

  const cases: readonly EvryWorkState[] = [
    { phase: "idle" },
    { phase: "reading", message: "Checking the people directory" },
    { phase: "planning", message: "Preparing your review" },
    {
      phase: "confirmation",
      message: "Your review is ready. Nothing happens until you confirm.",
    },
    { phase: "execution", message: "Sending 24 invitations" },
    { phase: "complete", message: "Receipt ready" },
    { phase: "blocked", message: "This confirmation is no longer current." },
    { phase: "failed", message: "Evry could not complete this request." },
  ];

  assert.deepEqual(
    cases.map((state) => evryWorkPresentation(state)),
    [
      { announcement: "", assertive: "", busy: false },
      {
        announcement: "Checking the people directory",
        assertive: "",
        busy: true,
      },
      {
        announcement: "Preparing your review",
        assertive: "",
        busy: true,
      },
      {
        announcement:
          "Your review is ready. Nothing happens until you confirm.",
        assertive: "",
        busy: false,
      },
      { announcement: "Sending 24 invitations", assertive: "", busy: true },
      { announcement: "Receipt ready", assertive: "", busy: false },
      {
        announcement: "",
        assertive: "This confirmation is no longer current.",
        busy: false,
      },
      {
        announcement: "",
        assertive: "Evry could not complete this request.",
        busy: false,
      },
    ]
  );
});

test("late, duplicate, and foreign request updates cannot replace the active phase", () => {
  const started = beginEvrySequencedWork("request-b", {
    phase: "reading",
    message: "Checking this conversation",
  });
  const planning = applyEvrySequencedWork(started, {
    requestId: "request-b",
    sequence: 1,
    state: { phase: "planning", message: "Preparing your review" },
  });
  assert.equal(planning.state.phase, "planning");
  assert.equal(
    applyEvrySequencedWork(planning, {
      requestId: "request-a",
      sequence: 99,
      state: { phase: "failed", message: "Stale A failed" },
    }),
    planning
  );
  assert.equal(
    applyEvrySequencedWork(planning, {
      requestId: "request-b",
      sequence: 1,
      state: { phase: "failed", message: "Duplicate update" },
    }),
    planning
  );
});

test("acknowledgement timing uses the render commit and enforces the FRD budget", () => {
  assert.equal(EVRY_ACKNOWLEDGEMENT_BUDGET_MS, 250);
  assert.deepEqual(measureEvryAcknowledgement(1_000, 1_249), {
    durationMs: 249,
    withinBudget: true,
  });
  assert.deepEqual(measureEvryAcknowledgement(1_000, 1_250), {
    durationMs: 250,
    withinBudget: true,
  });
  assert.deepEqual(measureEvryAcknowledgement(1_000, 1_251), {
    durationMs: 251,
    withinBudget: false,
  });
  assert.throws(() => measureEvryAcknowledgement(5, 4));
});
