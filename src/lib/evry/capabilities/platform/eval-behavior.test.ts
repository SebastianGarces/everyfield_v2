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
  PLATFORM_EVRY_PLAN_REGISTRY,
  PLATFORM_EVRY_REVIEW_REGISTRY,
} from "./runtime";
import type { PlatformEvrySelection } from "./selection";

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

for (const identity of [
  MARK_ONE_NOTIFICATION_IDENTITY,
  MARK_ALL_NOTIFICATIONS_IDENTITY,
  SUBMIT_FEEDBACK_IDENTITY,
]) {
  test(`${identity}:ui_artifact:behavior`, () => {
    const document = parseEvryActionPlanCandidate({
      candidate: {
        steps: [
          {
            id: "platform-effect",
            capabilityIdentity: identity,
            arguments: EFFECT_ARGUMENTS[identity]!,
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
    assert.ok(review);
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
