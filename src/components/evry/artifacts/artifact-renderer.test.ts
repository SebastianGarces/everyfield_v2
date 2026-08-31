import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  editedMeetingConfirmation,
  EVRY_CONFIRMATION_FIXTURES,
  meetingProgressFixture,
  partialMeetingReceiptFixture,
  UNEXPECTED_ERROR_RECEIPT,
} from "@/lib/evry/artifacts/fixtures";
import {
  evryPublicArtifactSchema,
  publicEvryArtifact,
} from "@/lib/evry/artifacts/public";
import { buildEvryReadArtifact } from "@/lib/evry/artifacts/core";
import { trustedEvryApplicationSourceLink } from "@/lib/evry/artifacts/types";
import {
  buildEvryProgressArtifact,
  buildEvryReceiptArtifact,
} from "@/lib/evry/artifacts/review";
import {
  boundaryArtifactFor,
  settingsHandoffArtifactFor,
} from "@/lib/evry/policy/artifacts";
import { evrySettingsSectionIdSchema } from "@/lib/evry/policy/schema";

import {
  EVRY_ARTIFACT_REGISTRY,
  EVRY_ARTIFACT_RENDER_VARIANTS,
  EvryArtifactRenderer,
  renderableEvryArtifact,
  type EvryRenderableArtifact,
} from "./artifact-renderer";

function render(
  model: EvryRenderableArtifact,
  controls: "confirmation" | "progress" | "reuse" | false = false
): string {
  return renderToStaticMarkup(
    createElement(EvryArtifactRenderer, {
      model,
      options:
        controls === "confirmation"
          ? {
              confirmationControls: {
                onCancel() {},
                onEdit() {},
                onExecute() {},
              },
            }
          : controls === "progress"
            ? { progressControls: { onSafeRetry() {} } }
            : controls === "reuse"
              ? {
                  receiptControls: {
                    disabled: false,
                    label: "Reuse",
                    onReuse() {},
                  },
                }
              : undefined,
    })
  );
}

test("the renderer registry is exhaustive across every required artifact", () => {
  assert.deepEqual(
    Object.keys(EVRY_ARTIFACT_REGISTRY),
    EVRY_ARTIFACT_RENDER_VARIANTS
  );
});

test("context, clarification, read, Settings, and boundary artifacts render structured review UI", () => {
  const context = render({
    variant: "context",
    artifact: { sourceKind: "task", recordId: "task-1", label: "Launch calls" },
  });
  assert.match(context, /Context/);
  assert.match(context, /Launch calls/);

  const sourceLink = trustedEvryApplicationSourceLink({
    label: "Launch calls",
    href: "/tasks/task-1",
  });
  const read = publicEvryArtifact(
    buildEvryReadArtifact({
      title: "Overdue tasks",
      filters: [{ label: "Status", value: "Overdue" }],
      exclusions: [{ reason: "Completed", count: 2 }],
      items: [
        {
          id: "task-1",
          label: "Launch calls",
          facts: [{ label: "Due", value: "August 28" }],
          sourceLink,
        },
      ],
      sourceLinks: [sourceLink],
    })
  );
  const readMarkup = render(renderableEvryArtifact(read));
  assert.match(readMarkup, /Read result/);
  assert.match(readMarkup, /1 result/);
  assert.doesNotMatch(readMarkup, /Matched|Shown|Applied filters/);
  assert.match(readMarkup, /Completed/);
  assert.doesNotMatch(readMarkup, />Confirm</);

  const settings = settingsHandoffArtifactFor(
    evrySettingsSectionIdSchema.parse("church")
  );
  assert.ok(settings);
  const settingsMarkup = render(
    renderableEvryArtifact(publicEvryArtifact(settings))
  );
  assert.match(settingsMarkup, /Open Church settings/);
  assert.match(settingsMarkup, /Evry has not read or changed the setting/);

  const boundaryMarkup = render(
    renderableEvryArtifact(publicEvryArtifact(boundaryArtifactFor("unrelated")))
  );
  assert.match(boundaryMarkup, /Ask Evry about EveryField/);
  assert.match(boundaryMarkup, /Find overdue tasks/);

  const clarification = publicEvryArtifact({
    kind: "clarification",
    mode: "choice",
    entityType: "person",
    prompt: "Which Alex did you mean?",
    choices: [
      {
        entityType: "person",
        id: "person-1",
        label: "Alex Rivera",
        distinguishingFacts: [{ label: "Email", value: "alex@example.test" }],
        sourceLink: trustedEvryApplicationSourceLink({
          label: "Alex Rivera",
          href: "/people/person-1",
        }),
      },
      {
        entityType: "person",
        id: "person-2",
        label: "Alex Morgan",
        distinguishingFacts: [{ label: "Email", value: "morgan@example.test" }],
        sourceLink: trustedEvryApplicationSourceLink({
          label: "Alex Morgan",
          href: "/people/person-2",
        }),
      },
    ],
    defaultChoiceId: null,
  });
  const choiceMarkup = render(renderableEvryArtifact(clarification));
  assert.match(choiceMarkup, /Which Alex did you mean/);
  assert.match(choiceMarkup, /Alex Rivera/);
  assert.match(choiceMarkup, /Alex Morgan/);
});

test("all confirmation families render the evidence their effect requires", () => {
  for (const fixture of Object.values(EVRY_CONFIRMATION_FIXTURES)) {
    const markup = render(
      renderableEvryArtifact(evryPublicArtifactSchema.parse(fixture)),
      "confirmation"
    );
    assert.match(markup, /Review before Evry acts/);
    assert.match(markup, /Nothing has changed yet/);
    assert.doesNotMatch(markup, />Summary</);
    assert.doesNotMatch(markup, /What will happen/);
    assert.match(markup, />Cancel</);
    assert.match(markup, />Edit plan</);
    assert.match(markup, new RegExp(`>${fixture.actionLabel}</button>`));
  }

  assert.match(
    render(
      renderableEvryArtifact(
        evryPublicArtifactSchema.parse(EVRY_CONFIRMATION_FIXTURES.meeting)
      ),
      "confirmation"
    ),
    /Wednesday, September 2, 2026 at 10:00 AM–11:30 AM EDT/
  );
  assert.match(
    render(
      renderableEvryArtifact(
        evryPublicArtifactSchema.parse(
          EVRY_CONFIRMATION_FIXTURES.bulkStageChange
        )
      ),
      "confirmation"
    ),
    /Changes after confirmation/
  );
  assert.match(
    render(
      renderableEvryArtifact(
        evryPublicArtifactSchema.parse(
          EVRY_CONFIRMATION_FIXTURES.destructiveAction
        )
      ),
      "confirmation"
    ),
    /cannot be undone after you confirm/
  );
  assert.match(
    render(
      renderableEvryArtifact(
        evryPublicArtifactSchema.parse(EVRY_CONFIRMATION_FIXTURES.fileImport)
      ),
      "confirmation"
    ),
    /may be difficult to undo after you confirm/
  );
  assert.match(
    render(
      renderableEvryArtifact(
        evryPublicArtifactSchema.parse(EVRY_CONFIRMATION_FIXTURES.fileImport)
      ),
      "confirmation"
    ),
    /Invalid email address/
  );
  assert.match(
    render(
      renderableEvryArtifact(
        evryPublicArtifactSchema.parse(
          EVRY_CONFIRMATION_FIXTURES.destructiveAction
        )
      ),
      "confirmation"
    ),
    /Open task[\s\S]*Deleted/
  );
  assert.match(
    render(
      renderableEvryArtifact(
        evryPublicArtifactSchema.parse(EVRY_CONFIRMATION_FIXTURES.communication)
      ),
      "confirmation"
    ),
    /Evry will use this template for 3 people[\s\S]*Launch update/
  );

  const meetingMarkup = render(
    renderableEvryArtifact(
      evryPublicArtifactSchema.parse(EVRY_CONFIRMATION_FIXTURES.meeting)
    ),
    "confirmation"
  );
  assert.match(meetingMarkup, />Meeting</);
  assert.match(meetingMarkup, />Guests</);
  assert.match(meetingMarkup, />Invitation email</);
  assert.match(meetingMarkup, /Evry will add 4 people to the guest list/);
  assert.match(meetingMarkup, /use this template for 4 people/);
  assert.doesNotMatch(meetingMarkup, /Add resolved guests/);
  assert.doesNotMatch(meetingMarkup, /Before and after|Sent immediately/);
});

test("progress and a terminal receipt expose every step state without a second execute control", async () => {
  const confirmation = await editedMeetingConfirmation(
    "Jamie Patel · jamie@example.test"
  );
  const progressMarkup = render(
    renderableEvryArtifact(
      publicEvryArtifact(meetingProgressFixture(confirmation.plan))
    )
  );
  assert.match(progressMarkup, /Completed/);
  assert.match(progressMarkup, /In progress/);
  assert.match(progressMarkup, /Pending/);
  assert.match(progressMarkup, /second execution is unavailable/);
  assert.doesNotMatch(progressMarkup, />Create meeting and send/);

  const safeRetryMarkup = render(
    renderableEvryArtifact(
      evryPublicArtifactSchema.parse(
        buildEvryProgressArtifact({
          kind: "progress",
          artifactVersion: 1,
          plan: confirmation.plan,
          title: "Safe retry available",
          error: {
            kind: "expected",
            message: "Retry this exact plan to reconcile it safely.",
          },
          steps: confirmation.steps.map((step) => ({
            stepId: step.stepId,
            label: step.title,
            status: "safe_retry",
            affectedCount: 0,
            excludedCount: 0,
          })),
        })
      )
    ),
    "progress"
  );
  assert.match(safeRetryMarkup, />Retry exact plan safely</);
  assert.match(safeRetryMarkup, /Only the same exact plan/);

  const receiptMarkup = render(
    renderableEvryArtifact(
      evryPublicArtifactSchema.parse(
        partialMeetingReceiptFixture(confirmation.plan)
      )
    )
  );
  for (const label of [
    "Completed",
    "Refused",
    "Failed",
    "Skipped",
    "Safe retry",
  ]) {
    assert.match(receiptMarkup, new RegExp(label));
  }
  assert.match(
    receiptMarkup,
    /Your current seat cannot add the follow-up task/
  );
  assert.match(receiptMarkup, /has no execute control/);
  assert.doesNotMatch(receiptMarkup, /<button/);
});

test("a reusable completed receipt exposes one explicit Reuse action", () => {
  const confirmation = EVRY_CONFIRMATION_FIXTURES.meeting;
  const reusable = buildEvryReceiptArtifact({
    kind: "result",
    artifactVersion: 1,
    plan: confirmation.plan,
    title: "Receipt: meeting invitation",
    status: "completed",
    reuse: {
      recipeIdentity: "meeting.invitation.reference",
      label: "Reuse",
    },
    steps: confirmation.steps.map((step) => ({
      stepId: step.stepId,
      label: step.title,
      status: "completed" as const,
      resultCode: "effect_completed" as const,
      affectedCount: 1,
      excludedCount: 0,
      sourceLinks: [],
      retry: { status: "unavailable" as const },
      error: null,
    })),
  });
  const markup = render(
    renderableEvryArtifact(evryPublicArtifactSchema.parse(reusable)),
    "reuse"
  );
  assert.match(markup, />Reuse</);
  assert.equal((markup.match(/<button/g) ?? []).length, 1);
});

test("unexpected errors render only generic copy and their support identity", () => {
  const markup = render(
    renderableEvryArtifact(
      evryPublicArtifactSchema.parse(UNEXPECTED_ERROR_RECEIPT)
    )
  );
  assert.match(markup, /Evry couldn&#x27;t complete this step/);
  assert.match(markup, /Try again later or contact support/);
  assert.match(markup, /90000000-0000-4000-8000-000000000001/);
  assert.doesNotMatch(markup, /provider|prompt|stack|database/i);
});
