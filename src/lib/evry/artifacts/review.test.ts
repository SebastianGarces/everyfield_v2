import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hydrateStoredEvryConversationArtifact,
  parseEvryConversationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";

import {
  applyFreshEvryConfirmation,
  beginEvryArtifactEdit,
  beginEvryArtifactExecution,
  cancelEvryArtifactReview,
  finishEvryArtifactExecution,
  type EvryArtifactInteractionState,
} from "./interaction";
import {
  editedMeetingConfirmation,
  EVRY_CONFIRMATION_FIXTURES,
  INITIAL_MEETING_CONFIRMATION,
  meetingProgressFixture,
  partialMeetingReceiptFixture,
  UNEXPECTED_ERROR_RECEIPT,
} from "./fixtures";
import {
  buildEvryProgressArtifact,
  evryDetailedConfirmationArtifactDocumentSchema,
  evryDetailedReceiptArtifactDocumentSchema,
} from "./review";

test("all five confirmation fixture families have complete versioned disclosure", () => {
  assert.deepEqual(Object.keys(EVRY_CONFIRMATION_FIXTURES), [
    "meeting",
    "bulkStageChange",
    "fileImport",
    "destructiveAction",
    "communication",
  ]);

  for (const [name, fixture] of Object.entries(EVRY_CONFIRMATION_FIXTURES)) {
    const reopened = parseEvryConversationArtifactDocument(
      JSON.parse(JSON.stringify(fixture))
    );
    assert.deepEqual(reopened, fixture, name);
    const hydrated = hydrateStoredEvryConversationArtifact(reopened);
    assert.deepEqual(JSON.parse(JSON.stringify(hydrated)), fixture);
    assert.equal(Object.isFrozen(fixture), true, name);
    assert.equal(Object.isFrozen(fixture.steps), true, name);
    assert.equal(Object.isFrozen(fixture.steps[0]), true, name);
    assert.equal(Object.isFrozen(hydrated), true, name);
    if (hydrated.kind !== "confirmation" || !("artifactVersion" in hydrated)) {
      assert.fail("expected a detailed confirmation");
    }
    assert.equal(Object.isFrozen(hydrated.steps), true, name);
    assert.equal(
      Object.isFrozen(hydrated.steps[0]?.resolvedTargets),
      true,
      name
    );
    assert.throws(() => Array.prototype.pop.call(hydrated.steps), TypeError);
    assert.equal(
      reopened.steps.every(({ resolvedTargets }) => resolvedTargets.length > 0),
      true,
      name
    );
    assert.equal(
      reopened.steps.every(({ counts }) => counts.length > 0),
      true,
      name
    );
    assert.equal(reopened.consequences.length > 0, true, name);
  }

  assert.ok(
    EVRY_CONFIRMATION_FIXTURES.meeting.steps.some(({ dateTime }) => dateTime)
  );
  assert.ok(
    EVRY_CONFIRMATION_FIXTURES.communication.steps.some(
      ({ contentPreviews }) => contentPreviews.length
    )
  );
  assert.ok(
    EVRY_CONFIRMATION_FIXTURES.bulkStageChange.steps.some(
      ({ beforeAfter }) => beforeAfter.length
    )
  );
  assert.ok(
    EVRY_CONFIRMATION_FIXTURES.destructiveAction.steps.some(
      ({ beforeAfter }) => beforeAfter.length
    )
  );
  assert.ok(
    EVRY_CONFIRMATION_FIXTURES.fileImport.steps.some(
      ({ exclusions }) => exclusions.length
    )
  );
});

test("effect-specific disclosure cannot omit its safety evidence", () => {
  const meeting = EVRY_CONFIRMATION_FIXTURES.meeting;
  assert.equal(
    evryDetailedConfirmationArtifactDocumentSchema.safeParse({
      ...meeting,
      steps: meeting.steps.map((step) =>
        step.effectKind === "meeting" ? { ...step, dateTime: null } : step
      ),
    }).success,
    false
  );

  const communication = EVRY_CONFIRMATION_FIXTURES.communication;
  assert.equal(
    evryDetailedConfirmationArtifactDocumentSchema.safeParse({
      ...communication,
      steps: communication.steps.map((step) => ({
        ...step,
        contentPreviews: [],
      })),
    }).success,
    false
  );

  const bulk = EVRY_CONFIRMATION_FIXTURES.bulkStageChange;
  assert.equal(
    evryDetailedConfirmationArtifactDocumentSchema.safeParse({
      ...bulk,
      steps: bulk.steps.map((step) => ({ ...step, beforeAfter: [] })),
    }).success,
    false
  );

  const fileImport = EVRY_CONFIRMATION_FIXTURES.fileImport;
  assert.equal(
    evryDetailedConfirmationArtifactDocumentSchema.safeParse({
      ...fileImport,
      steps: fileImport.steps.map((step) => ({
        ...step,
        beforeAfter: [],
      })),
    }).success,
    false
  );
});

test("confirmation links and timing reuse the application trust boundaries", () => {
  const destructive = EVRY_CONFIRMATION_FIXTURES.destructiveAction;
  assert.equal(
    evryDetailedConfirmationArtifactDocumentSchema.safeParse({
      ...destructive,
      steps: destructive.steps.map((step) => ({
        ...step,
        resolvedTargets: step.resolvedTargets.map((target) => ({
          ...target,
          sourceLink: {
            label: "Escaping link",
            href: "/\\evil.example",
          },
        })),
      })),
    }).success,
    false
  );

  const meeting = EVRY_CONFIRMATION_FIXTURES.meeting;
  assert.equal(
    evryDetailedConfirmationArtifactDocumentSchema.safeParse({
      ...meeting,
      steps: meeting.steps.map((step) =>
        step.dateTime
          ? {
              ...step,
              dateTime: {
                ...step.dateTime,
                startsAt: {
                  ...step.dateTime.startsAt,
                  utcOffset: "+14:00",
                },
              },
            }
          : step
      ),
    }).success,
    false
  );
});

test("editing destroys the displayed confirmation and only a fresh plan may replace it", async () => {
  const initial: EvryArtifactInteractionState = {
    status: "review",
    confirmation: INITIAL_MEETING_CONFIRMATION,
  };
  const editing = beginEvryArtifactEdit(initial);
  assert.equal(editing.status, "editing");
  assert.equal("confirmation" in editing, false);
  assert.throws(
    () => applyFreshEvryConfirmation(editing, INITIAL_MEETING_CONFIRMATION),
    /fresh confirmation/
  );

  const fresh = await editedMeetingConfirmation(
    "Jamie Patel · jamie@example.test"
  );
  const ready = applyFreshEvryConfirmation(editing, fresh);
  assert.equal(ready.status, "review");
  if (ready.status !== "review") assert.fail("expected fresh review");
  assert.notEqual(
    ready.confirmation.plan.fingerprint,
    INITIAL_MEETING_CONFIRMATION.plan.fingerprint
  );

  const another = await editedMeetingConfirmation(
    "Robin Flores · robin@example.test"
  );
  assert.notEqual(fresh.plan.planId, another.plan.planId);
  assert.notEqual(fresh.plan.fingerprint, another.plan.fingerprint);
});

test("the execution transition closes synchronous double clicks and receipts stay terminal", async () => {
  const fresh = await editedMeetingConfirmation(
    "Jamie Patel · jamie@example.test"
  );
  const progress = meetingProgressFixture(fresh.plan);
  const receipt = partialMeetingReceiptFixture(fresh.plan);
  const initial: EvryArtifactInteractionState = {
    status: "review",
    confirmation: fresh,
  };

  const first = beginEvryArtifactExecution(initial, progress);
  assert.equal(first.shouldExecute, true);
  const second = beginEvryArtifactExecution(first.state, progress);
  assert.equal(second.shouldExecute, false);
  assert.equal(second.state.status, "executing");

  const finished = finishEvryArtifactExecution(first.state, receipt);
  assert.equal(finished.status, "receipt");
  assert.equal(
    beginEvryArtifactExecution(finished, progress).shouldExecute,
    false
  );

  const missingStep = buildEvryProgressArtifact({
    ...meetingProgressFixture(initial.confirmation.plan),
    steps: meetingProgressFixture(initial.confirmation.plan).steps.slice(1),
  });
  assert.equal(
    beginEvryArtifactExecution(initial, missingStep).shouldExecute,
    false
  );
  assert.equal(cancelEvryArtifactReview(finished), finished);
});

test("progress and receipts must stay bound to the exact reviewed plan", async () => {
  const initial: EvryArtifactInteractionState = {
    status: "review",
    confirmation: INITIAL_MEETING_CONFIRMATION,
  };
  const different = await editedMeetingConfirmation(
    "Jamie Patel · jamie@example.test"
  );

  assert.equal(
    beginEvryArtifactExecution(initial, meetingProgressFixture(different.plan))
      .shouldExecute,
    false
  );

  const executing = beginEvryArtifactExecution(
    initial,
    meetingProgressFixture(initial.confirmation.plan)
  ).state;
  assert.equal(executing.status, "executing");
  assert.throws(
    () =>
      finishEvryArtifactExecution(
        executing,
        partialMeetingReceiptFixture(different.plan)
      ),
    /match the executing plan/
  );
});

test("progress and receipts reopen with every terminal and safe-retry state", async () => {
  const fresh = await editedMeetingConfirmation(
    "Jamie Patel · jamie@example.test"
  );
  const progress = meetingProgressFixture(fresh.plan);
  const receipt = partialMeetingReceiptFixture(fresh.plan);

  assert.deepEqual(
    parseEvryConversationArtifactDocument(JSON.parse(JSON.stringify(progress))),
    progress
  );
  assert.deepEqual(
    parseEvryConversationArtifactDocument(JSON.parse(JSON.stringify(receipt))),
    receipt
  );
  assert.deepEqual(
    new Set(receipt.steps.map(({ status }) => status)),
    new Set(["completed", "failed", "refused", "skipped"])
  );
  assert.ok(receipt.steps.some(({ retry }) => retry.status === "safe_retry"));
});

test("unexpected error documents have no field for internal detail", () => {
  const unexpected = UNEXPECTED_ERROR_RECEIPT.steps[0]?.error;
  assert.deepEqual(unexpected, {
    kind: "unexpected",
    correlationId: "90000000-0000-4000-8000-000000000001",
  });
  assert.equal(
    evryDetailedReceiptArtifactDocumentSchema.safeParse({
      ...UNEXPECTED_ERROR_RECEIPT,
      steps: UNEXPECTED_ERROR_RECEIPT.steps.map((step) => ({
        ...step,
        error:
          step.error?.kind === "unexpected"
            ? { ...step.error, message: "provider stack and prompt" }
            : step.error,
      })),
    }).success,
    false
  );
});
