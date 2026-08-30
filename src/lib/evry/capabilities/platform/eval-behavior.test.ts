import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EvryArtifactRenderer } from "@/components/evry/artifacts/artifact-renderer";
import { publicEvryArtifact } from "@/lib/evry/artifacts/public";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import type { EvryReadCapabilityAuthorization } from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";
import { resolveEvryPolicyDecision } from "@/lib/evry/policy/core";

import {
  MARK_ALL_NOTIFICATIONS_IDENTITY,
  MARK_ONE_NOTIFICATION_IDENTITY,
  SUBMIT_FEEDBACK_IDENTITY,
} from "./effects";
import { PLATFORM_CAPABILITY_REGISTRY } from "./registrations";
import {
  DASHBOARD_SUMMARY_IDENTITY,
  NOTIFICATION_COUNT_IDENTITY,
  NOTIFICATION_FEED_IDENTITY,
  continuePlatformEvryRead,
  type PlatformReadDependencies,
} from "./reads";
import {
  PLATFORM_EVRY_EXECUTION_REGISTRY,
  PLATFORM_EVRY_PLAN_REGISTRY,
  PLATFORM_EVRY_REVIEW_REGISTRY,
} from "./runtime";
import {
  selectPlatformEvryRequest,
  type PlatformEvrySelection,
} from "./selection";

const ACTOR = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "member",
} as unknown as EvryPlantActor;
const FOREIGN_ACTOR = {
  ...ACTOR,
  plantId: "20000000-0000-4000-8000-000000000099",
} as EvryPlantActor;
const NOTIFICATION_ID = "30000000-0000-4000-8000-000000000001";
const CHECKED_AT = "2030-01-02T03:04:05.000Z";

const READ_SELECTIONS: Readonly<
  Record<
    string,
    Extract<
      PlatformEvrySelection,
      { kind: "dashboard" | "notification_count" | "notifications" }
    >
  >
> = {
  [DASHBOARD_SUMMARY_IDENTITY]: { kind: "dashboard" },
  [NOTIFICATION_FEED_IDENTITY]: {
    kind: "notifications",
    unreadOnly: false,
    before: null,
  },
  [NOTIFICATION_COUNT_IDENTITY]: { kind: "notification_count" },
};

const CAPABILITY_CASES: Readonly<
  Record<
    string,
    Readonly<{ command: string; selection: PlatformEvrySelection }>
  >
> = {
  [DASHBOARD_SUMMARY_IDENTITY]: {
    command: "show dashboard summary",
    selection: READ_SELECTIONS[DASHBOARD_SUMMARY_IDENTITY]!,
  },
  [NOTIFICATION_FEED_IDENTITY]: {
    command: "show notifications",
    selection: READ_SELECTIONS[NOTIFICATION_FEED_IDENTITY]!,
  },
  [NOTIFICATION_COUNT_IDENTITY]: {
    command: "show unread notification count",
    selection: READ_SELECTIONS[NOTIFICATION_COUNT_IDENTITY]!,
  },
  [MARK_ONE_NOTIFICATION_IDENTITY]: {
    command: `mark notification ${NOTIFICATION_ID} read`,
    selection: { kind: "mark_one", notificationId: NOTIFICATION_ID },
  },
  [MARK_ALL_NOTIFICATIONS_IDENTITY]: {
    command: "mark all notifications read",
    selection: { kind: "mark_all" },
  },
  [SUBMIT_FEEDBACK_IDENTITY]: {
    command:
      'submit feedback {"category":"bug","description":"Exact feedback description","pageUrl":"/notifications"}',
    selection: {
      kind: "feedback",
      category: "bug",
      description: "Exact feedback description",
      pageUrl: "/notifications",
    },
  },
};

function isReadSelection(
  selection: PlatformEvrySelection
): selection is Extract<
  PlatformEvrySelection,
  { kind: "dashboard" | "notification_count" | "notifications" }
> {
  return (
    selection.kind === "dashboard" ||
    selection.kind === "notification_count" ||
    selection.kind === "notifications"
  );
}

function authorization(
  identity: string,
  actor: EvryPlantActor
): EvryReadCapabilityAuthorization {
  const registration = PLATFORM_CAPABILITY_REGISTRY.registrationFor(identity);
  assert.ok(registration?.operationKind === "read");
  return { actor, registration } as EvryReadCapabilityAuthorization;
}

function readHarness(
  authorize: PlatformReadDependencies["authorize"]
): Readonly<{
  dependencies: PlatformReadDependencies;
  ownerCalls(): number;
}> {
  let calls = 0;
  const notification = {
    id: NOTIFICATION_ID,
    category: "meetings" as const,
    type: "meeting.reminder",
    title: "Exact notification title",
    body: "Exact notification body",
    entityType: null,
    entityId: null,
    readAt: null,
    createdAt: new Date(CHECKED_AT),
  };
  const dependencies: PlatformReadDependencies = {
    authorize,
    async dashboardMetrics() {
      calls += 1;
      return {
        coreGroupSize: 1,
        totalPeople: 2,
        overdueTasks: 3,
        visionMeetingsHeld: 4,
      };
    },
    async recentActivity() {
      calls += 1;
      return [];
    },
    async firstNotificationPage() {
      calls += 1;
      return {
        rows: [notification],
        nextCursor: null,
        unreadCount: 1,
        hasAny: true,
      };
    },
    async olderNotificationPage() {
      calls += 1;
      return { rows: [notification], nextCursor: null };
    },
    async unreadBadge() {
      calls += 1;
      return 1;
    },
  };
  return { dependencies, ownerCalls: () => calls };
}

for (const identity of [
  DASHBOARD_SUMMARY_IDENTITY,
  NOTIFICATION_FEED_IDENTITY,
  NOTIFICATION_COUNT_IDENTITY,
]) {
  test(`${identity}:tenancy:behavior`, async () => {
    const harness = readHarness(async (requested) =>
      authorization(requested, FOREIGN_ACTOR)
    );
    const result = await continuePlatformEvryRead({
      actor: ACTOR,
      selection: READ_SELECTIONS[identity]!,
      dependencies: harness.dependencies,
    });
    assert.equal(result, null);
    assert.equal(harness.ownerCalls(), 0);
  });

  test(`${identity}:permission:behavior`, async () => {
    const harness = readHarness(async () => null);
    const result = await continuePlatformEvryRead({
      actor: ACTOR,
      selection: READ_SELECTIONS[identity]!,
      dependencies: harness.dependencies,
    });
    assert.equal(result, null);
    assert.equal(harness.ownerCalls(), 0);
  });

  test(`${identity}:ui_artifact:behavior`, async () => {
    const harness = readHarness(async (requested) =>
      authorization(requested, ACTOR)
    );
    const artifact = await continuePlatformEvryRead({
      actor: ACTOR,
      selection: READ_SELECTIONS[identity]!,
      dependencies: harness.dependencies,
    });
    assert.ok(artifact);
    const publicArtifact = publicEvryArtifact(artifact);
    assert.equal(publicArtifact.kind, "read");
    const markup = renderToStaticMarkup(
      createElement(EvryArtifactRenderer, {
        model: { variant: "read", artifact: publicArtifact },
      })
    );
    assert.match(markup, /data-artifact-variant="read"/);
    assert.match(markup, new RegExp(artifact.title));
  });
}

const notificationSnapshot = {
  id: NOTIFICATION_ID,
  category: "meetings" as const,
  type: "meeting.reminder",
  title: "Exact notification title",
  body: "Exact notification body",
  entityType: null,
  entityId: null,
  status: "pending",
  scheduledFor: CHECKED_AT,
  updatedAt: CHECKED_AT,
  createdAt: CHECKED_AT,
};
const EFFECT_ARGUMENTS: Readonly<Record<string, Record<string, unknown>>> = {
  [MARK_ONE_NOTIFICATION_IDENTITY]: {
    notification: notificationSnapshot,
    visibility: { categories: ["meetings"], checkedAt: CHECKED_AT },
  },
  [MARK_ALL_NOTIFICATIONS_IDENTITY]: {
    notifications: [notificationSnapshot],
    visibility: { categories: ["meetings"], checkedAt: CHECKED_AT },
  },
  [SUBMIT_FEEDBACK_IDENTITY]: {
    feedbackId: "40000000-0000-4000-8000-000000000001",
    category: "bug",
    description: "Exact feedback description",
    pageUrl: "/notifications",
  },
};

function effectReview(identity: string) {
  const arguments_ = EFFECT_ARGUMENTS[identity];
  assert.ok(arguments_, `missing effect arguments for ${identity}`);
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "platform-effect",
          capabilityIdentity: identity,
          arguments: arguments_,
          dependsOn: [],
        },
      ],
    },
    registry: PLATFORM_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: [{ identity }],
  });
  const review = trustedReviewForEvryPlanDocument({
    plan: evryConversationPlanIdentitySchema.parse({
      planId: "50000000-0000-4000-8000-000000000001",
      fingerprint: "a".repeat(64),
    }),
    document,
    reviewRegistry: PLATFORM_EVRY_REVIEW_REGISTRY,
  });
  assert.ok(review, `missing trusted review for ${identity}`);
  return { document, review };
}

for (const [identity, fixture] of Object.entries(CAPABILITY_CASES)) {
  test(`${identity}:policy:behavior`, () => {
    const registration = PLATFORM_CAPABILITY_REGISTRY.registrationFor(identity);
    assert.ok(registration);
    const classification =
      registration.operationKind === "read"
        ? ("application_read" as const)
        : ("application_action" as const);
    const allowed = resolveEvryPolicyDecision(fixture.command, {
      classification,
    });
    assert.equal(allowed.classification, classification);
    assert.ok("continuation" in allowed);
    assert.deepEqual(allowed.continuation, {
      kind: classification,
      literalUserText: fixture.command,
    });
    const stopped = resolveEvryPolicyDecision(fixture.command, {
      classification: "unrelated",
    });
    assert.equal(stopped.classification, "unrelated");
    assert.equal("continuation" in stopped, false);
  });

  test(`${identity}:selection:behavior`, () => {
    assert.deepEqual(
      selectPlatformEvryRequest(fixture.command),
      fixture.selection
    );
  });

  test(`${identity}:arguments:behavior`, () => {
    if (isReadSelection(fixture.selection)) {
      assert.equal(
        selectPlatformEvryRequest(`${fixture.command} with forged arguments`),
        null
      );
      assert.equal(
        PLATFORM_EVRY_EXECUTION_REGISTRY.registrationFor(identity),
        null
      );
      return;
    }
    const execution =
      PLATFORM_EVRY_EXECUTION_REGISTRY.registrationFor(identity);
    const arguments_ = EFFECT_ARGUMENTS[identity];
    assert.ok(execution && arguments_);
    assert.equal(
      execution.planCapability.argumentsSchema.safeParse(arguments_).success,
      true
    );
    assert.equal(
      execution.planCapability.argumentsSchema.safeParse({
        ...arguments_,
        forgedTarget: "90000000-0000-4000-8000-000000000001",
      }).success,
      false
    );
  });

  test(`${identity}:confirmation:behavior`, async () => {
    if (isReadSelection(fixture.selection)) {
      const harness = readHarness(async (requested) =>
        authorization(requested, ACTOR)
      );
      const artifact = await continuePlatformEvryRead({
        actor: ACTOR,
        selection: fixture.selection,
        dependencies: harness.dependencies,
      });
      assert.ok(artifact);
      assert.equal(publicEvryArtifact(artifact).kind, "read");
      assert.equal(
        PLATFORM_EVRY_EXECUTION_REGISTRY.registrationFor(identity),
        null
      );
      return;
    }
    const { document, review } = effectReview(identity);
    assert.equal(
      review.confirmation.plan.planId,
      "50000000-0000-4000-8000-000000000001"
    );
    assert.equal(review.confirmation.plan.fingerprint, "a".repeat(64));
    assert.equal(review.confirmation.steps.length, 1);
    const step = review.confirmation.steps[0];
    assert.equal(step?.stepId, document.steps[0]?.id);
    assert.ok(step);
    if (identity === SUBMIT_FEEDBACK_IDENTITY) {
      assert.deepEqual(step.resolvedTargets, [
        { label: "Category", value: "bug", sourceLink: null },
      ]);
      assert.deepEqual(step.contentPreviews, [
        {
          label: "Exact description",
          content: "Exact feedback description",
        },
        { label: "Source page", content: "/notifications" },
      ]);
      return;
    }
    assert.deepEqual(
      step.resolvedTargets.map(({ label, value }) => ({ label, value })),
      [
        {
          label: "Notification",
          value: `Exact notification title · ${NOTIFICATION_ID}`,
        },
      ]
    );
    assert.deepEqual(step.contentPreviews, [
      {
        label: "Exact immutable payload",
        content: JSON.stringify([notificationSnapshot]),
      },
    ]);
  });
}

for (const identity of [
  MARK_ONE_NOTIFICATION_IDENTITY,
  MARK_ALL_NOTIFICATIONS_IDENTITY,
  SUBMIT_FEEDBACK_IDENTITY,
]) {
  test(`${identity}:ui_artifact:behavior`, () => {
    const { review } = effectReview(identity);
    const markup = renderToStaticMarkup(
      createElement(EvryArtifactRenderer, {
        model: { variant: "confirmation", artifact: review.confirmation },
      })
    );
    assert.match(markup, /data-artifact-variant="confirmation"/);
    assert.match(markup, new RegExp(review.confirmation.title));
    assert.match(
      markup,
      identity === SUBMIT_FEEDBACK_IDENTITY
        ? /Exact feedback description/
        : /Exact notification title/
    );
  });
}
