import assert from "node:assert/strict";
import { test } from "node:test";
import { EVRY_CONFIRMATION_FIXTURES } from "./fixtures";
import {
  pendingEvryProgress,
  progressFromRetryableEvryExecution,
  receiptFromEvryExecution,
} from "./execution-result";

test("pure execution presentation preserves reviewed identity and never turns uncertain work into a receipt", () => {
  const confirmation = EVRY_CONFIRMATION_FIXTURES.meeting;
  const pending = pendingEvryProgress(confirmation);
  assert.deepEqual(pending.plan, confirmation.plan);
  assert.equal(pending.steps[0]?.status, "active");
  assert(pending.steps.slice(1).every(({ status }) => status === "pending"));
  const steps = confirmation.steps.map(({ stepId }, index) => ({
    stepId,
    capabilityIdentity: "fixture.effect",
    status: index === 0 ? ("completed" as const) : ("retryable" as const),
    durable: index === 0,
    affectedCount: index === 0 ? 1 : 999,
    excludedCount: 0,
  }));
  const result = {
    status: "retryable" as const,
    correlationId: "proof",
    steps,
  };
  const progress = progressFromRetryableEvryExecution({ confirmation, result });
  assert.equal(progress.steps[0]?.affectedCount, 1);
  assert(
    progress.steps
      .slice(1)
      .every((step) => step.status === "safe_retry" && step.affectedCount === 0)
  );
  assert.throws(
    () => receiptFromEvryExecution({ confirmation, result }),
    /not a terminal receipt/
  );
  const receipt = receiptFromEvryExecution({
    confirmation,
    result: {
      status: "completed",
      correlationId: "proof",
      steps: steps.map((step) => ({
        ...step,
        status: "completed",
        durable: true,
        affectedCount: 1,
      })),
    },
  });
  assert.deepEqual(receipt.plan, confirmation.plan);
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.steps.length, confirmation.steps.length);
});
