import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canTransitionEvryPlan,
  EVRY_PLAN_STATUSES,
  isTerminalEvryPlanStatus,
  type EvryPlanStatus,
} from "./lifecycle";

const LEGAL = new Set([
  "draft>awaiting_confirmation",
  "draft>cancelled",
  "draft>superseded",
  "awaiting_confirmation>approved",
  "awaiting_confirmation>cancelled",
  "awaiting_confirmation>superseded",
  "awaiting_confirmation>expired",
  "approved>executing",
  "approved>cancelled",
  "approved>superseded",
  "approved>expired",
  "executing>completed",
  "executing>partially_failed",
  "executing>failed",
]);

test("the lifecycle admits every legal transition and refuses every other pair", () => {
  for (const from of EVRY_PLAN_STATUSES) {
    for (const to of EVRY_PLAN_STATUSES) {
      assert.equal(
        canTransitionEvryPlan(from, to),
        LEGAL.has(`${from}>${to}`),
        `${from} -> ${to}`
      );
    }
  }
});

test("cancelled, superseded, expired, and completed outcomes are terminal", () => {
  const terminal: EvryPlanStatus[] = [
    "completed",
    "partially_failed",
    "failed",
    "cancelled",
    "superseded",
    "expired",
  ];

  for (const status of EVRY_PLAN_STATUSES) {
    assert.equal(isTerminalEvryPlanStatus(status), terminal.includes(status));
  }
});
