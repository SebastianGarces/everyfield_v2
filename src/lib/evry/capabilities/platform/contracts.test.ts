import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import { eligibleEvryCapabilitiesFor } from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { parseEvryActionPlanCandidate } from "@/lib/evry/plans";
import {
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  PRODUCTION_EVRY_REVIEW_REGISTRY,
} from "@/lib/evry/capabilities/production";

import {
  MARK_ALL_NOTIFICATIONS_PLAN,
  MARK_ONE_NOTIFICATION_PLAN,
  PLATFORM_ARTIFACT_REVIEWS,
  PLATFORM_EXECUTION_CAPABILITIES,
  SUBMIT_FEEDBACK_PLAN,
  feedbackArgumentsSchema,
  markAllArgumentsSchema,
  markOneArgumentsSchema,
} from "./effects";
import { PLATFORM_CAPABILITY_REGISTRY } from "./registrations";
import {
  PLATFORM_EVRY_PLAN_REGISTRY,
  PLATFORM_EVRY_REVIEW_REGISTRY,
} from "./runtime";

const snapshot = {
  id: "10000000-0000-4000-8000-000000000001",
  category: "meetings" as const,
  type: "meeting.reminder",
  title: "Exact title",
  body: "Exact body",
  entityType: "meeting",
  entityId: "20000000-0000-4000-8000-000000000001",
  status: "pending",
  scheduledFor: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
  createdAt: "2030-01-01T00:00:00.000Z",
};

const actor = {
  userId: "30000000-0000-4000-8000-000000000001",
  plantId: "40000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const plan = evryConversationPlanIdentitySchema.parse({
  planId: "50000000-0000-4000-8000-000000000001",
  fingerprint: "a".repeat(64),
});

test("all six registrations come from the generated closed inventory", () => {
  assert.deepEqual(
    PLATFORM_CAPABILITY_REGISTRY.registrations()
      .map(({ identity }) => identity)
      .toSorted(),
    [
      "dashboard.summary.get",
      "notifications.badge.unread-count",
      "notifications.feed.list",
      "notifications.feed.mark-all-read",
      "notifications.feed.mark-one-read",
      "platform.feedback.submit",
    ]
  );
});

test("effect argument parsers bind complete snapshots and reject unknown keys", () => {
  const visibility = {
    categories: ["meetings" as const],
    checkedAt: "2030-01-01T00:00:00.000Z",
  };
  assert.ok(
    markOneArgumentsSchema.safeParse({ notification: snapshot, visibility })
      .success
  );
  assert.ok(
    markAllArgumentsSchema.safeParse({
      notifications: [snapshot],
      visibility,
    }).success
  );
  assert.equal(
    markOneArgumentsSchema.safeParse({
      notification: snapshot,
      visibility,
      where: "true",
    }).success,
    false
  );
  assert.ok(
    feedbackArgumentsSchema.safeParse({
      feedbackId: snapshot.id,
      category: "bug",
      description: "literal",
      pageUrl: null,
    }).success
  );
});

test("each lasting platform capability has plan, execution, and review composition", () => {
  assert.deepEqual(
    PLATFORM_EXECUTION_CAPABILITIES.map(
      ({ planCapability }) => planCapability.identity
    ).toSorted(),
    [
      MARK_ALL_NOTIFICATIONS_PLAN.identity,
      MARK_ONE_NOTIFICATION_PLAN.identity,
      SUBMIT_FEEDBACK_PLAN.identity,
    ].toSorted()
  );
  assert.equal(PLATFORM_ARTIFACT_REVIEWS.length, 3);
  for (const execution of PLATFORM_EXECUTION_CAPABILITIES) {
    assert.equal(
      PRODUCTION_EVRY_EXECUTION_REGISTRY.registrationFor(
        execution.planCapability.identity
      ),
      execution
    );
  }
  assert.ok(
    PRODUCTION_EVRY_REVIEW_REGISTRY.registrationFor(
      parseEvryActionPlanCandidate({
        candidate: {
          steps: [
            {
              id: "feedback",
              capabilityIdentity: SUBMIT_FEEDBACK_PLAN.identity,
              arguments: {
                feedbackId: snapshot.id,
                category: "bug",
                description: "literal",
                pageUrl: null,
              },
              dependsOn: [],
            },
          ],
        },
        registry: PLATFORM_EVRY_PLAN_REGISTRY,
        eligibleCapabilities: eligibleEvryCapabilitiesFor(actor),
      })
    )
  );
});

test("atomic source structurally scopes, revalidates, mutates, and claims together", () => {
  const source = readFileSync(
    "src/lib/evry/capabilities/platform/effects.ts",
    "utf8"
  );
  const atomic = readFileSync(
    "src/lib/evry/capabilities/platform/atomic-effect.ts",
    "utf8"
  );
  assert.match(source, /n\.church_id = \$\{input\.actor\.plantId\}/);
  assert.match(source, /n\.recipient_user_id = \$\{input\.actor\.userId\}/);
  assert.match(source, /full join expected_rows/);
  assert.match(
    source,
    /from current_categories c\s+full join confirmed_categories/
  );
  assert.match(source, /left join notification_preferences/);
  assert.match(source, /exists \(select 1 from exact_categories\)/);
  assert.match(
    source,
    /exact_set as materialized[\s\S]*having count\(\*\) > 0/
  );
  assert.match(source, /scheduled_for <= \$\{occurredAt\}::timestamptz/);
  assert.match(source, /read_at is null/);
  assert.match(atomic, /mutation as materialized[\s\S]*claimed as/);
  assert.match(atomic, /status = 'executing'/);
  assert.match(
    atomic,
    /join users u[\s\S]*u\.church_id = a\.church_id[\s\S]*u\.sending_church_id is null[\s\S]*u\.sending_network_id is null[\s\S]*u\.seat is not null/
  );
});

test("maximum legal feedback is losslessly paged into a review artifact", () => {
  const description = "👩🏽‍💻".repeat(625);
  assert.equal(description.length, 4_375);
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "feedback",
          capabilityIdentity: SUBMIT_FEEDBACK_PLAN.identity,
          arguments: {
            feedbackId: snapshot.id,
            category: "bug",
            description,
            pageUrl: null,
          },
          dependsOn: [],
        },
      ],
    },
    registry: PLATFORM_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: eligibleEvryCapabilitiesFor(actor),
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: PLATFORM_EVRY_REVIEW_REGISTRY,
  });
  assert.ok(review);
  const descriptionPages = review.confirmation.steps[0]?.contentPreviews.filter(
    ({ label }) => label.startsWith("Exact description")
  );
  assert.equal(
    descriptionPages?.map(({ content }) => content).join(""),
    description
  );
  assert.ok(descriptionPages?.every(({ content }) => content.length <= 4_000));
});

test("an oversized legal notification plan uses a bounded immutable manifest", () => {
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "mark-one",
          capabilityIdentity: MARK_ONE_NOTIFICATION_PLAN.identity,
          arguments: {
            notification: {
              ...snapshot,
              body: "exact body ".repeat(24_000),
            },
            visibility: {
              categories: ["meetings"],
              checkedAt: "2030-01-01T00:00:00.000Z",
            },
          },
          dependsOn: [],
        },
      ],
    },
    registry: PLATFORM_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: eligibleEvryCapabilitiesFor(actor),
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: PLATFORM_EVRY_REVIEW_REGISTRY,
  });
  assert.ok(review);
  const previews = review.confirmation.steps[0]?.contentPreviews;
  assert.equal(previews?.length, 1);
  assert.match(previews?.[0]?.label ?? "", /manifest/i);
  assert.match(previews?.[0]?.content ?? "", /"notifications":1/);
  assert.match(previews?.[0]?.content ?? "", /"sha256":"[0-9a-f]{64}"/);
});

test("a large mark-all plan caps rendered targets without capping legal rows", () => {
  const notifications = Array.from({ length: 150 }, (_, index) => ({
    ...snapshot,
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    title: `Exact title ${index + 1}`,
  }));
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "mark-all",
          capabilityIdentity: MARK_ALL_NOTIFICATIONS_PLAN.identity,
          arguments: {
            notifications,
            visibility: {
              categories: ["meetings"],
              checkedAt: "2030-01-01T00:00:00.000Z",
            },
          },
          dependsOn: [],
        },
      ],
    },
    registry: PLATFORM_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: eligibleEvryCapabilitiesFor(actor),
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: PLATFORM_EVRY_REVIEW_REGISTRY,
  });
  assert.ok(review);
  const step = review.confirmation.steps[0];
  assert.equal(step?.counts[0]?.count, notifications.length);
  assert.equal(step?.resolvedTargets.length, 100);
  assert.match(step?.resolvedTargets.at(-1)?.value ?? "", /51 more/);
});
