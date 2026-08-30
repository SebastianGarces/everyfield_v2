import { buildEvryReadArtifact } from "@/lib/evry/artifacts/core";
import { trustedEvryApplicationSourceLink } from "@/lib/evry/artifacts/types";
import { authorizeEvryReadCapability } from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  getDashboardMetrics,
  getRecentActivity,
} from "@/lib/dashboard/service";
import {
  loadNotificationFeedScreen,
  loadOlderNotifications,
  loadUnreadBadgeCount,
  notificationViewer,
} from "@/lib/notifications/feed";
import { notificationEntityHref } from "@/lib/notifications/entity-links";

import type { PlatformEvrySelection } from "./selection";

export const DASHBOARD_SUMMARY_IDENTITY = "dashboard.summary.get";
export const NOTIFICATION_FEED_IDENTITY = "notifications.feed.list";
export const NOTIFICATION_COUNT_IDENTITY = "notifications.badge.unread-count";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function boundedText(value: string, maximum: number) {
  if (value.length <= maximum) return value;
  let bounded = "";
  for (const { segment } of graphemes.segment(value)) {
    if (bounded.length + segment.length >= maximum) break;
    bounded += segment;
  }
  return `${bounded}…`;
}

function viewerFor(actor: EvryPlantActor) {
  const viewer = notificationViewer({
    user: {
      id: actor.userId,
      churchId: actor.plantId,
      sendingChurchId: null,
      sendingNetworkId: null,
    },
  });
  if (!viewer) throw new Error("Plant actor has no notification viewer");
  return viewer;
}

export type PlatformReadDependencies = Readonly<{
  authorize: typeof authorizeEvryReadCapability;
  dashboardMetrics: typeof getDashboardMetrics;
  recentActivity: typeof getRecentActivity;
  firstNotificationPage: typeof loadNotificationFeedScreen;
  olderNotificationPage: typeof loadOlderNotifications;
  unreadBadge: typeof loadUnreadBadgeCount;
}>;

const productionDependencies: PlatformReadDependencies = {
  authorize: authorizeEvryReadCapability,
  dashboardMetrics: getDashboardMetrics,
  recentActivity: getRecentActivity,
  firstNotificationPage: loadNotificationFeedScreen,
  olderNotificationPage: loadOlderNotifications,
  unreadBadge: loadUnreadBadgeCount,
};

async function authorizedActor(
  identity: string,
  actor: EvryPlantActor,
  authorize: PlatformReadDependencies["authorize"]
) {
  const authorization = await authorize(identity);
  return authorization &&
    authorization.actor.userId === actor.userId &&
    authorization.actor.plantId === actor.plantId
    ? authorization.actor
    : null;
}

export async function continuePlatformEvryRead(input: {
  actor: EvryPlantActor;
  selection: Extract<
    PlatformEvrySelection,
    { kind: "dashboard" | "notification_count" | "notifications" }
  >;
  dependencies?: PlatformReadDependencies;
}) {
  const dependencies = input.dependencies ?? productionDependencies;
  if (input.selection.kind === "dashboard") {
    const actor = await authorizedActor(
      DASHBOARD_SUMMARY_IDENTITY,
      input.actor,
      dependencies.authorize
    );
    if (!actor) return null;
    const [metrics, activity] = await Promise.all([
      dependencies.dashboardMetrics(actor.plantId, actor.userId),
      dependencies.recentActivity(actor.plantId),
    ]);
    return buildEvryReadArtifact({
      title: "Dashboard summary",
      filters: [{ label: "Recent activity", value: "Newest 20 events" }],
      exclusions: [],
      items: [
        {
          id: "dashboard-metrics",
          label: "Current metrics",
          facts: [
            { label: "Core group", value: String(metrics.coreGroupSize) },
            { label: "People", value: String(metrics.totalPeople) },
            { label: "Overdue tasks", value: String(metrics.overdueTasks) },
            {
              label: "Vision meetings held",
              value: String(metrics.visionMeetingsHeld),
            },
          ],
          sourceLink: trustedEvryApplicationSourceLink({
            label: "Open dashboard",
            href: "/dashboard",
          }),
        },
        ...activity.map((item) => ({
          id: item.id,
          label: boundedText(item.description, 160),
          facts: [
            { label: "Type", value: item.type.replaceAll("_", " ") },
            { label: "Description", value: boundedText(item.description, 500) },
            ...(item.description.length > 500
              ? [
                  {
                    label: "Description size",
                    value: `${item.description.length} UTF-16 code units; open the dashboard for the full text`,
                  },
                ]
              : []),
            { label: "Recorded", value: item.timestamp.toISOString() },
          ],
          sourceLink: trustedEvryApplicationSourceLink({
            label: "Open dashboard",
            href: "/dashboard",
          }),
        })),
      ],
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open dashboard",
          href: "/dashboard",
        }),
      ],
    });
  }

  if (input.selection.kind === "notification_count") {
    const actor = await authorizedActor(
      NOTIFICATION_COUNT_IDENTITY,
      input.actor,
      dependencies.authorize
    );
    if (!actor) return null;
    const viewer = viewerFor(actor);
    let count: number;
    try {
      count = await dependencies.unreadBadge(viewer);
    } catch {
      return buildEvryReadArtifact({
        title: "Unread notification count unavailable",
        filters: [],
        exclusions: [
          { reason: "The notification count could not be read", count: 1 },
        ],
        items: [],
        sourceLinks: [
          trustedEvryApplicationSourceLink({
            label: "Open notifications",
            href: "/notifications",
          }),
        ],
      });
    }
    return buildEvryReadArtifact({
      title: "Unread notification count",
      filters: [],
      exclusions: [],
      items: [
        {
          id: "unread-notification-count",
          label: "Unread notifications",
          facts: [{ label: "Count", value: String(count) }],
          sourceLink: trustedEvryApplicationSourceLink({
            label: "Open notifications",
            href: "/notifications",
          }),
        },
      ],
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open notifications",
          href: "/notifications",
        }),
      ],
    });
  }

  const actor = await authorizedActor(
    NOTIFICATION_FEED_IDENTITY,
    input.actor,
    dependencies.authorize
  );
  if (!actor) return null;
  const viewer = viewerFor(actor);
  const now = new Date();
  const page = input.selection.before
    ? await dependencies.olderNotificationPage(viewer, {
        before: {
          createdAt: new Date(input.selection.before.createdAt),
          id: input.selection.before.id,
        },
        unreadOnly: input.selection.unreadOnly,
        limit: 30,
      })
    : await dependencies.firstNotificationPage(viewer, {
        unreadOnly: input.selection.unreadOnly,
        limit: 30,
        now,
      });
  const rows = page.rows;
  const next = page.nextCursor;
  return buildEvryReadArtifact({
    title: input.selection.unreadOnly
      ? "Unread notifications"
      : "Notifications",
    filters: [
      {
        label: "View",
        value: input.selection.unreadOnly ? "Unread only" : "All visible",
      },
      ...(next
        ? [
            {
              label: "Next page command",
              value: `show ${input.selection.unreadOnly ? "unread " : ""}notifications before ${next.createdAt.toISOString()}|${next.id}`,
            },
          ]
        : []),
    ],
    exclusions: [],
    items: rows.map((row) => {
      const entityHref = notificationEntityHref(row.entityType, row.entityId);
      return {
        id: row.id,
        label: boundedText(row.title, 160),
        facts: [
          { label: "Category", value: row.category },
          { label: "Type", value: row.type },
          { label: "Title", value: row.title },
          { label: "Message", value: boundedText(row.body, 500) },
          ...(row.body.length > 500
            ? [
                {
                  label: "Message size",
                  value: `${row.body.length} UTF-16 code units; open notifications for the full message`,
                },
              ]
            : []),
          { label: "Created", value: row.createdAt.toISOString() },
          { label: "Read", value: row.readAt ? "Yes" : "No" },
        ],
        sourceLink: trustedEvryApplicationSourceLink({
          label: entityHref ? "Open referenced record" : "Open notifications",
          href: entityHref ?? "/notifications",
        }),
      };
    }),
    sourceLinks: [
      trustedEvryApplicationSourceLink({
        label: "Open notifications",
        href: "/notifications",
      }),
    ],
  });
}
