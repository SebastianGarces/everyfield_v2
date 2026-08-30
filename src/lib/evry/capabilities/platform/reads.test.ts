import assert from "node:assert/strict";
import test from "node:test";

import { storedEvryReadArtifactDocument } from "@/lib/evry/conversations/artifacts";
import type { EvryReadCapabilityAuthorization } from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

import {
  DASHBOARD_SUMMARY_IDENTITY,
  NOTIFICATION_COUNT_IDENTITY,
  NOTIFICATION_FEED_IDENTITY,
  continuePlatformEvryRead,
  type PlatformReadDependencies,
} from "./reads";

const actor = {
  plantId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  seat: "member",
} as unknown as EvryPlantActor;

function authorization(identity: string, authorizedActor = actor) {
  return {
    actor: authorizedActor,
    registration: {
      identity,
      operationKind: "read",
      applicationCapability: "read",
      parityCapability: "platform",
      surfaceIdentities: ["fixture"],
    },
  } as unknown as EvryReadCapabilityAuthorization;
}

function dependencies(
  overrides: Partial<PlatformReadDependencies> = {}
): PlatformReadDependencies {
  return {
    authorize: async (identity) => authorization(identity),
    dashboardMetrics: async () => ({
      coreGroupSize: 4,
      totalPeople: 9,
      overdueTasks: 2,
      visionMeetingsHeld: 3,
    }),
    recentActivity: async () => [
      {
        id: "activity-1",
        type: "task_completed",
        description: "Task completed: Call the venue",
        timestamp: new Date("2030-01-02T03:04:05.000Z"),
        metadata: {},
      },
    ],
    firstNotificationPage: async () => ({
      rows: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          category: "meetings",
          type: "meeting.reminder",
          title: "Vision meeting tomorrow",
          body: "Bring the guest list.",
          entityType: "meeting",
          entityId: "40000000-0000-4000-8000-000000000001",
          readAt: null,
          createdAt: new Date("2030-01-02T03:04:05.000Z"),
        },
      ],
      nextCursor: {
        createdAt: new Date("2030-01-02T03:04:05.000Z"),
        id: "30000000-0000-4000-8000-000000000001",
      },
      unreadCount: 1,
      hasAny: true,
    }),
    olderNotificationPage: async () => ({ rows: [], nextCursor: null }),
    unreadBadge: async () => 7,
    ...overrides,
  };
}

test("dashboard.summary.get:execution:read", async () => {
  const calls: unknown[][] = [];
  const artifact = await continuePlatformEvryRead({
    actor,
    selection: { kind: "dashboard" },
    dependencies: dependencies({
      authorize: async (identity) => {
        calls.push(["authorize", identity]);
        return authorization(identity);
      },
      dashboardMetrics: async (...args) => {
        calls.push(["metrics", ...args]);
        return {
          coreGroupSize: 4,
          totalPeople: 9,
          overdueTasks: 2,
          visionMeetingsHeld: 3,
        };
      },
      recentActivity: async (...args) => {
        calls.push(["activity", ...args]);
        return [];
      },
    }),
  });
  assert.ok(artifact);
  assert.deepEqual(calls, [
    ["authorize", DASHBOARD_SUMMARY_IDENTITY],
    ["metrics", actor.plantId, actor.userId],
    ["activity", actor.plantId],
  ]);
  assert.equal(artifact.counts.returned, 1);
  assert.doesNotThrow(() => storedEvryReadArtifactDocument(artifact));
});

test("notifications.feed.list:execution:read", async () => {
  let captured: unknown[] | null = null;
  const artifact = await continuePlatformEvryRead({
    actor,
    selection: { kind: "notifications", unreadOnly: true, before: null },
    dependencies: dependencies({
      firstNotificationPage: async (...args) => {
        captured = args;
        return dependencies().firstNotificationPage(...args);
      },
    }),
  });
  assert.ok(artifact);
  assert.deepEqual(captured?.[0], {
    scope: { churchId: actor.plantId, recipientUserId: actor.userId },
    owner: actor.userId,
    audience: "church",
  });
  assert.equal((captured?.[1] as { limit?: number }).limit, 30);
  assert.match(
    artifact.filters.find(({ label }) => label === "Next page command")
      ?.value ?? "",
    /^show unread notifications before 2030-01-02T03:04:05\.000Z\|30000000-/
  );
  assert.equal(artifact.items[0]?.facts[3]?.value, "Bring the guest list.");
  assert.equal(
    artifact.items[0]?.facts.find(({ label }) => label === "Mark-read command")
      ?.value,
    "mark notification 30000000-0000-4000-8000-000000000001 read"
  );
  assert.equal(
    artifact.items[0]?.sourceLink.href,
    "/meetings/40000000-0000-4000-8000-000000000001"
  );
  assert.doesNotThrow(() => storedEvryReadArtifactDocument(artifact));
});

test("notifications.badge.unread-count:execution:read", async () => {
  let capturedViewer: unknown = null;
  const artifact = await continuePlatformEvryRead({
    actor,
    selection: { kind: "notification_count" },
    dependencies: dependencies({
      unreadBadge: async (viewer) => {
        capturedViewer = viewer;
        return 7;
      },
    }),
  });
  assert.ok(artifact);
  assert.deepEqual(capturedViewer, {
    scope: { churchId: actor.plantId, recipientUserId: actor.userId },
    owner: actor.userId,
    audience: "church",
  });
  assert.equal(artifact.items[0]?.facts[0]?.value, "7");
  assert.doesNotThrow(() => storedEvryReadArtifactDocument(artifact));
});

test("unread badge failure remains an explicit non-count result", async () => {
  const artifact = await continuePlatformEvryRead({
    actor,
    selection: { kind: "notification_count" },
    dependencies: dependencies({
      unreadBadge: async () => {
        throw new Error("badge unavailable");
      },
    }),
  });
  assert.ok(artifact);
  assert.equal(artifact.counts.returned, 0);
  assert.equal(artifact.counts.excluded, 1);
  assert.match(artifact.title, /unavailable/i);
});

test("legal notification copy stays within the bounded public read artifact", async () => {
  const longTitle = "T".repeat(255);
  const longBody = "👩🏽‍💻".repeat(2_000);
  const artifact = await continuePlatformEvryRead({
    actor,
    selection: { kind: "notifications", unreadOnly: false, before: null },
    dependencies: dependencies({
      firstNotificationPage: async () => ({
        rows: [
          {
            id: "30000000-0000-4000-8000-000000000002",
            category: "tasks",
            type: "task.long-copy",
            title: longTitle,
            body: longBody,
            entityType: null,
            entityId: null,
            readAt: null,
            createdAt: new Date("2030-01-02T03:04:05.000Z"),
          },
        ],
        nextCursor: null,
        unreadCount: 1,
        hasAny: true,
      }),
    }),
  });
  assert.ok(artifact);
  assert.equal(artifact.items[0]?.label.length, 160);
  assert.equal(
    artifact.items[0]?.facts.find(({ label }) => label === "Title")?.value,
    longTitle
  );
  const messagePreview = artifact.items[0]?.facts.find(
    ({ label }) => label === "Message"
  )?.value;
  assert.ok(messagePreview && messagePreview.length <= 500);
  assert.ok(messagePreview.endsWith("…"));
  assert.match(
    artifact.items[0]?.facts.find(({ label }) => label === "Message size")
      ?.value ?? "",
    /open notifications for the full message/
  );
  assert.equal(artifact.items[0]?.sourceLink.href, "/notifications");
  assert.doesNotThrow(() => storedEvryReadArtifactDocument(artifact));
});

for (const fixture of [
  {
    identity: DASHBOARD_SUMMARY_IDENTITY,
    selection: { kind: "dashboard" as const },
  },
  {
    identity: NOTIFICATION_FEED_IDENTITY,
    selection: {
      kind: "notifications" as const,
      unreadOnly: false,
      before: null,
    },
  },
  {
    identity: NOTIFICATION_COUNT_IDENTITY,
    selection: { kind: "notification_count" as const },
  },
]) {
  test(`${fixture.identity}:idempotency:read`, async () => {
    const deps = dependencies();
    const first = await continuePlatformEvryRead({
      actor,
      selection: fixture.selection,
      dependencies: deps,
    });
    const replay = await continuePlatformEvryRead({
      actor,
      selection: fixture.selection,
      dependencies: deps,
    });
    assert.deepEqual(replay, first);
  });

  test(`${fixture.identity}:errors:read`, async () => {
    let reads = 0;
    const foreignActor = {
      ...actor,
      plantId: "90000000-0000-4000-8000-000000000001",
    } as EvryPlantActor;
    const deps = dependencies({
      authorize: async (identity) => authorization(identity, foreignActor),
      dashboardMetrics: async () => {
        reads += 1;
        throw new Error("must not run");
      },
      firstNotificationPage: async () => {
        reads += 1;
        throw new Error("must not run");
      },
    });
    assert.equal(
      await continuePlatformEvryRead({
        actor,
        selection: fixture.selection,
        dependencies: deps,
      }),
      null
    );
    assert.equal(reads, 0);
  });
}
