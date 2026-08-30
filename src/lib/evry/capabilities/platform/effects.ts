import { createHash } from "node:crypto";

import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import {
  feedback,
  notificationCategories,
  notifications,
  users,
  type Feedback,
} from "@/db/schema";
import { defineEvryArtifactReview } from "@/lib/evry/artifacts/trusted-plan-review";
import { buildEvryConfirmationArtifact } from "@/lib/evry/artifacts/review";
import {
  createEvryExecutionCapabilityRegistry,
  defineEvryExecutionCapability,
  type EvryEffectInput,
} from "@/lib/evry/executor";
import { defineEvryPlanCapability } from "@/lib/evry/plans/registry";
import type { EvryActionStep } from "@/lib/evry/plans/schema";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { notifyNewFeedback } from "@/lib/feedback/notify";
import {
  notificationViewer,
  type NotificationViewer,
} from "@/lib/notifications/feed";
import { getInAppCategories } from "@/lib/notifications/preferences";
import { feedScopedWhere, feedVisibility } from "@/lib/notifications/queries";
import { defaultChannelEnabled } from "@/lib/notifications/categories";

import { claimPlatformDatabaseEffect } from "./atomic-effect";

export const MARK_ONE_NOTIFICATION_IDENTITY =
  "notifications.feed.mark-one-read";
export const MARK_ALL_NOTIFICATIONS_IDENTITY =
  "notifications.feed.mark-all-read";
export const SUBMIT_FEEDBACK_IDENTITY = "platform.feedback.submit";

const notificationSnapshotSchema = z.strictObject({
  id: z.string().uuid(),
  category: z.enum(notificationCategories),
  type: z.string().min(1).max(64),
  title: z.string().min(1).max(255),
  body: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().uuid().nullable(),
  status: z.string(),
  scheduledFor: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

const visibilitySnapshotSchema = z.strictObject({
  categories: z.array(z.enum(notificationCategories)),
  checkedAt: z.string().datetime(),
});

const markOneArgumentsSchema = z.strictObject({
  notification: notificationSnapshotSchema,
  visibility: visibilitySnapshotSchema,
});
const markAllArgumentsSchema = z.strictObject({
  notifications: z.array(notificationSnapshotSchema).min(1),
  visibility: visibilitySnapshotSchema,
});
const feedbackArgumentsSchema = z.strictObject({
  feedbackId: z.string().uuid(),
  category: z.enum(["bug", "suggestion", "question", "other"]),
  description: z.string().min(1).max(5000),
  pageUrl: z.string().max(500).nullable(),
});

export type NotificationSnapshot = z.infer<typeof notificationSnapshotSchema>;

function viewerFor(actor: EvryPlantActor): NotificationViewer {
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

function snapshot(row: {
  id: string;
  category: (typeof notificationCategories)[number];
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  status: string;
  scheduledFor: string;
  updatedAt: string;
  createdAt: string;
}): NotificationSnapshot {
  return notificationSnapshotSchema.parse(row);
}

const notificationSnapshotColumns = {
  id: notifications.id,
  category: notifications.category,
  type: notifications.type,
  title: notifications.title,
  body: notifications.body,
  entityType: notifications.entityType,
  entityId: notifications.entityId,
  status: notifications.status,
  scheduledFor: sql<string>`to_char(${notifications.scheduledFor}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  updatedAt: sql<string>`to_char(${notifications.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  createdAt: sql<string>`to_char(${notifications.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
};

/** Exact rows the canonical feed permits this plant actor to mark right now. */
export async function loadEvryUnreadNotificationSnapshot(input: {
  actor: EvryPlantActor;
  notificationId?: string;
  now: Date;
}) {
  const viewer = viewerFor(input.actor);
  const categories = await getInAppCategories(viewer.owner, viewer.audience);
  const rows = await db
    .select(notificationSnapshotColumns)
    .from(notifications)
    .where(
      feedScopedWhere(
        viewer.scope,
        isNull(notifications.readAt),
        input.notificationId
          ? eq(notifications.id, input.notificationId)
          : undefined,
        ...feedVisibility(input.now, categories)
      )
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id));
  return {
    notifications: rows.map(snapshot),
    visibility: {
      categories,
      checkedAt: input.now.toISOString(),
    },
  } as const;
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function currentCategories(input: EvryEffectInput) {
  const viewer = viewerFor(input.authorization.actor);
  return getInAppCategories(viewer.owner, viewer.audience);
}

async function plantActorIsCurrent(actor: EvryPlantActor) {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, actor.userId),
        eq(users.churchId, actor.plantId),
        isNull(users.sendingChurchId),
        isNull(users.sendingNetworkId),
        isNotNull(users.seat)
      )
    )
    .limit(1);
  return row !== undefined;
}

function exactExecutionTuple(input: EvryEffectInput, identity: string) {
  const actor = input.authorization.actor;
  return (
    input.authorization.registration.identity === identity &&
    input.execution.capabilityIdentity === identity &&
    input.execution.actorUserId === actor.userId &&
    input.execution.plantId === actor.plantId
  );
}

function expectedRowsJson(rows: readonly NotificationSnapshot[]) {
  return JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      category: row.category,
      type: row.type,
      title: row.title,
      body: row.body,
      entity_type: row.entityType,
      entity_id: row.entityId,
      status: row.status,
      scheduled_for: row.scheduledFor,
      updated_at: row.updatedAt,
      created_at: row.createdAt,
    }))
  );
}

function notificationMutation(input: {
  actor: EvryPlantActor;
  rows: readonly NotificationSnapshot[];
  categories: readonly (typeof notificationCategories)[number][];
  now: Date;
  exactAllVisible: boolean;
}) {
  const expected = expectedRowsJson(input.rows);
  const occurredAt = input.now.toISOString();
  const categoryDefaults = notificationCategories.map(
    (category) =>
      sql`(${category}::text, ${defaultChannelEnabled(category, "in_app", "church")}::boolean)`
  );
  const confirmedCategories = JSON.stringify(input.categories);
  return sql`
    with category_defaults(category, default_enabled) as materialized (
      values ${sql.join(categoryDefaults, sql`, `)}
    ), confirmed_categories as materialized (
      select jsonb_array_elements_text(${confirmedCategories}::jsonb) as category
    ), current_categories as materialized (
      select d.category
      from category_defaults d
      left join notification_preferences p
        on p.user_id = ${input.actor.userId}::uuid
       and p.category = d.category
       and p.channel = 'in_app'
      where coalesce(p.enabled, d.default_enabled)
    ), exact_categories as materialized (
      select 1 as current
      where not exists (
        select 1
        from current_categories c
        full join confirmed_categories x using (category)
        where c.category is null or x.category is null
      )
    ), expected_rows as materialized (
      select *
      from jsonb_to_recordset(${expected}::jsonb) as x(
        id uuid, category text, type text, title text, body text,
        entity_type text, entity_id uuid, status text,
        scheduled_for timestamp, updated_at timestamp, created_at timestamp
      )
    ), current_rows as materialized (
      select n.id, n.category, n.type, n.title, n.body, n.entity_type,
             n.entity_id, n.status, n.scheduled_for, n.updated_at, n.created_at
      from notifications n
      where n.church_id = ${input.actor.plantId}::uuid
        and n.anchor_type = 'church'
        and n.recipient_user_id = ${input.actor.userId}::uuid
        and n.read_at is null
        and n.status <> 'cancelled'
        and n.scheduled_for <= ${occurredAt}::timestamptz
        and n.category in (select category from current_categories)
        and (
          ${input.exactAllVisible}
          or n.id in (select id from expected_rows)
        )
    ), exact_set as materialized (
      select count(*)::int as expected_count
      from expected_rows
      where exists (select 1 from eligible)
        and exists (select 1 from exact_categories)
        and not exists (
          select 1
          from current_rows c
          full join expected_rows x using (id)
          where c.id is null or x.id is null
             or c.category is distinct from x.category
             or c.type is distinct from x.type
             or c.title is distinct from x.title
             or c.body is distinct from x.body
             or c.entity_type is distinct from x.entity_type
             or c.entity_id is distinct from x.entity_id
             or c.status is distinct from x.status
             or c.scheduled_for is distinct from x.scheduled_for
             or c.updated_at is distinct from x.updated_at
             or c.created_at is distinct from x.created_at
        )
      having count(*) > 0
    )
    update notifications n
    set read_at = ${occurredAt}::timestamptz,
        updated_at = ${occurredAt}::timestamptz
    from expected_rows x, exact_set
    where n.id = x.id
      and n.church_id = ${input.actor.plantId}::uuid
      and n.recipient_user_id = ${input.actor.userId}::uuid
      and n.read_at is null
    returning exact_set.expected_count
  `;
}

export const MARK_ONE_NOTIFICATION_PLAN = defineEvryPlanCapability({
  identity: MARK_ONE_NOTIFICATION_IDENTITY,
  effectClass: "database_write",
  arguments: markOneArgumentsSchema.shape,
});
export const MARK_ALL_NOTIFICATIONS_PLAN = defineEvryPlanCapability({
  identity: MARK_ALL_NOTIFICATIONS_IDENTITY,
  effectClass: "database_write",
  arguments: markAllArgumentsSchema.shape,
});
export const SUBMIT_FEEDBACK_PLAN = defineEvryPlanCapability({
  identity: SUBMIT_FEEDBACK_IDENTITY,
  effectClass: "database_write",
  arguments: feedbackArgumentsSchema.shape,
});

async function notificationTargetIsCurrent(input: {
  actor: EvryPlantActor;
  rows: readonly NotificationSnapshot[];
  categories: readonly (typeof notificationCategories)[number][];
  exactAllVisible?: boolean;
}) {
  if (!(await plantActorIsCurrent(input.actor))) return false;
  const current = await loadEvryUnreadNotificationSnapshot({
    actor: input.actor,
    notificationId: input.exactAllVisible ? undefined : input.rows[0]?.id,
    now: new Date(),
  });
  return (
    sameStrings(current.visibility.categories, input.categories) &&
    expectedRowsJson(current.notifications) === expectedRowsJson(input.rows)
  );
}

type NotificationExecutionDependencies = Readonly<{
  /** Test seam for proving atomic revalidation after the optimistic pre-read. */
  beforeClaim?(): Promise<void>;
}>;

function notificationExecution(
  input: {
    identity: string;
    plan: typeof MARK_ONE_NOTIFICATION_PLAN;
    parse(arguments_: unknown): Readonly<{
      rows: readonly NotificationSnapshot[];
      categories: readonly (typeof notificationCategories)[number][];
      exactAllVisible: boolean;
    }> | null;
  },
  dependencies: NotificationExecutionDependencies = {}
) {
  return defineEvryExecutionCapability({
    planCapability: input.plan,
    async executeIfCurrent(effect) {
      const parsed = input.parse(effect.arguments);
      if (!parsed || !exactExecutionTuple(effect, input.identity)) {
        return { status: "refused", excludedCount: 1 };
      }
      try {
        const categories = await currentCategories(effect);
        if (!sameStrings(categories, parsed.categories)) {
          return { status: "refused", excludedCount: parsed.rows.length };
        }
        await dependencies.beforeClaim?.();
        const now = new Date();
        const claim = await claimPlatformDatabaseEffect({
          execution: effect.execution,
          effectKey: effect.effectKey,
          mutation: notificationMutation({
            actor: effect.authorization.actor,
            rows: parsed.rows,
            categories,
            now,
            exactAllVisible: parsed.exactAllVisible,
          }),
          targetIsCurrent: () =>
            notificationTargetIsCurrent({
              actor: effect.authorization.actor,
              rows: parsed.rows,
              categories,
              exactAllVisible: parsed.exactAllVisible,
            }),
        });
        return claim.result;
      } catch {
        return { status: "retryable" };
      }
    },
  });
}

export function createMarkOneNotificationExecution(
  dependencies?: NotificationExecutionDependencies
) {
  return notificationExecution(
    {
      identity: MARK_ONE_NOTIFICATION_IDENTITY,
      plan: MARK_ONE_NOTIFICATION_PLAN,
      parse(arguments_) {
        const parsed = markOneArgumentsSchema.safeParse(arguments_);
        return parsed.success
          ? {
              rows: [parsed.data.notification],
              categories: parsed.data.visibility.categories,
              exactAllVisible: false,
            }
          : null;
      },
    },
    dependencies
  );
}

export function createMarkAllNotificationsExecution(
  dependencies?: NotificationExecutionDependencies
) {
  return notificationExecution(
    {
      identity: MARK_ALL_NOTIFICATIONS_IDENTITY,
      plan: MARK_ALL_NOTIFICATIONS_PLAN,
      parse(arguments_) {
        const parsed = markAllArgumentsSchema.safeParse(arguments_);
        return parsed.success
          ? {
              rows: parsed.data.notifications,
              categories: parsed.data.visibility.categories,
              exactAllVisible: true,
            }
          : null;
      },
    },
    dependencies
  );
}

export const MARK_ONE_NOTIFICATION_EXECUTION =
  createMarkOneNotificationExecution();

export const MARK_ALL_NOTIFICATIONS_EXECUTION =
  createMarkAllNotificationsExecution();

type FeedbackScheduler = (
  row: Feedback,
  submitter: {
    name: string | null;
    email: string;
  }
) => void;

const scheduleFeedbackNotification: FeedbackScheduler = (row, submitter) => {
  after(() => notifyNewFeedback(row, submitter));
};

export function createSubmitFeedbackExecution(
  schedule: FeedbackScheduler = scheduleFeedbackNotification
) {
  return defineEvryExecutionCapability({
    planCapability: SUBMIT_FEEDBACK_PLAN,
    async executeIfCurrent(input) {
      const parsed = feedbackArgumentsSchema.safeParse(input.arguments);
      if (
        !parsed.success ||
        !exactExecutionTuple(input, SUBMIT_FEEDBACK_IDENTITY)
      ) {
        return { status: "refused", excludedCount: 1 };
      }
      try {
        const claim = await claimPlatformDatabaseEffect({
          execution: input.execution,
          effectKey: input.effectKey,
          mutation: sql`
            insert into feedback (
              id, church_id, user_id, category, description, page_url,
              status, created_at, updated_at
            )
            select ${parsed.data.feedbackId}::uuid, e.church_id,
                   e.actor_user_id, ${parsed.data.category},
                   ${parsed.data.description}, ${parsed.data.pageUrl},
                   'new', transaction_timestamp(), transaction_timestamp()
            from eligible e
            where not exists (
              select 1 from feedback f where f.id = ${parsed.data.feedbackId}::uuid
            )
            returning 1::int as expected_count
          `,
          targetIsCurrent: async () => {
            if (!(await plantActorIsCurrent(input.authorization.actor))) {
              return false;
            }
            const [row] = await db
              .select({ id: feedback.id })
              .from(feedback)
              .where(eq(feedback.id, parsed.data.feedbackId))
              .limit(1);
            return row === undefined;
          },
        });
        if (claim.result.status === "completed" && claim.newlyClaimed) {
          const [row, submitter] = await Promise.all([
            db
              .select()
              .from(feedback)
              .where(
                and(
                  eq(feedback.id, parsed.data.feedbackId),
                  eq(feedback.churchId, input.authorization.actor.plantId),
                  eq(feedback.userId, input.authorization.actor.userId)
                )
              )
              .limit(1)
              .then((rows) => rows[0]),
            db
              .select({ name: users.name, email: users.email })
              .from(users)
              .where(eq(users.id, input.authorization.actor.userId))
              .limit(1)
              .then((rows) => rows[0]),
          ]);
          if (row && submitter) {
            try {
              schedule(row, submitter);
            } catch {
              // The durable row is the submission; bridge scheduling is best effort.
            }
          }
        }
        return claim.result;
      } catch {
        return { status: "retryable" };
      }
    },
  });
}

export const SUBMIT_FEEDBACK_EXECUTION = createSubmitFeedbackExecution();

export const PLATFORM_EXECUTION_CAPABILITIES = [
  MARK_ONE_NOTIFICATION_EXECUTION,
  MARK_ALL_NOTIFICATIONS_EXECUTION,
  SUBMIT_FEEDBACK_EXECUTION,
] as const;

export const PLATFORM_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry(PLATFORM_EXECUTION_CAPABILITIES);

function literalPages(value: string, label: string) {
  const pages: { label: string; content: string }[] = [];
  for (let start = 0; start < value.length; start += 4_000) {
    let end = Math.min(value.length, start + 4_000);
    if (
      end < value.length &&
      value.charCodeAt(end - 1) >= 0xd800 &&
      value.charCodeAt(end - 1) <= 0xdbff
    ) {
      end -= 1;
    }
    pages.push({
      label: `${label}${value.length > 4_000 ? ` page ${pages.length + 1}` : ""}`,
      content: value.slice(start, end),
    });
    start = end - 4_000;
  }
  return pages;
}

const MAX_BROWSER_PREVIEW_PAGES = 64;
const MAX_BROWSER_RESOLVED_TARGETS = 100;

function planPages(rows: readonly NotificationSnapshot[]) {
  const json = JSON.stringify(rows);
  if (json.length > 4_000 * MAX_BROWSER_PREVIEW_PAGES) {
    return [
      {
        label: "Complete immutable notification manifest",
        content: JSON.stringify({
          utf16CodeUnits: json.length,
          sha256: createHash("sha256").update(json).digest("hex"),
          notifications: rows.length,
          disclosure:
            "The stored plan and confirmation fingerprint bind every exact notification; the browser preview is capped at 64 pages.",
        }),
      },
    ];
  }
  return literalPages(json, "Exact immutable payload");
}

function notificationReview(input: {
  plan: Parameters<
    ReturnType<typeof defineEvryArtifactReview>["build"]
  >[0]["plan"];
  step: EvryActionStep;
  rows: readonly NotificationSnapshot[];
  title: string;
  actionLabel: string;
}) {
  const displayedRows =
    input.rows.length > MAX_BROWSER_RESOLVED_TARGETS
      ? input.rows.slice(0, MAX_BROWSER_RESOLVED_TARGETS - 1)
      : input.rows;
  const omittedRows = input.rows.length - displayedRows.length;
  return buildEvryConfirmationArtifact({
    kind: "confirmation",
    artifactVersion: 1,
    plan: input.plan,
    title: input.title,
    actionLabel: input.actionLabel,
    consequences: [
      "This changes only the read state of the exact visible notifications bound by this plan and summarized here.",
    ],
    steps: [
      {
        stepId: input.step.id,
        title: input.title,
        effectKind: input.rows.length > 1 ? "bulk_change" : "other",
        reversibility: "reversible",
        resolvedTargets: [
          ...displayedRows.map((row) => ({
            label: "Notification",
            value: `${row.title} · ${row.id}`,
            sourceLink: {
              label: "Open notifications",
              href: "/notifications",
            },
          })),
          ...(omittedRows > 0
            ? [
                {
                  label: "Additional exact notifications",
                  value: `${omittedRows} more are bound by the immutable plan manifest`,
                  sourceLink: {
                    label: "Open notifications",
                    href: "/notifications",
                  },
                },
              ]
            : []),
        ],
        counts: [
          { label: "Notifications to mark read", count: input.rows.length },
        ],
        exclusions: [],
        dateTime: null,
        contentPreviews: planPages(input.rows),
        beforeAfter:
          input.rows.length > 1
            ? [
                {
                  label: "Read state",
                  before: "Unread",
                  after: "Read",
                  count: input.rows.length,
                },
              ]
            : [],
      },
    ],
  });
}

export const PLATFORM_ARTIFACT_REVIEWS = [
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [MARK_ONE_NOTIFICATION_IDENTITY],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const parsed = markOneArgumentsSchema.parse(step.arguments);
      return notificationReview({
        plan,
        step,
        rows: [parsed.notification],
        title: "Mark notification read",
        actionLabel: "Mark read",
      });
    },
  }),
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [MARK_ALL_NOTIFICATIONS_IDENTITY],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const parsed = markAllArgumentsSchema.parse(step.arguments);
      return notificationReview({
        plan,
        step,
        rows: parsed.notifications,
        title: "Mark all visible notifications read",
        actionLabel: "Mark all read",
      });
    },
  }),
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [SUBMIT_FEEDBACK_IDENTITY],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const parsed = feedbackArgumentsSchema.parse(step.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: "Submit product feedback",
        actionLabel: "Submit feedback",
        consequences: [
          "This stores the feedback and may send it to the EveryField team by email and a redacted public issue.",
        ],
        steps: [
          {
            stepId: step.id,
            title: "Submit product feedback",
            effectKind: "other",
            reversibility: "difficult_to_reverse",
            resolvedTargets: [
              {
                label: "Category",
                value: parsed.category,
                sourceLink: null,
              },
            ],
            counts: [{ label: "Feedback submissions", count: 1 }],
            exclusions: [],
            dateTime: null,
            contentPreviews: [
              ...literalPages(parsed.description, "Exact description"),
              {
                label: "Source page",
                content: parsed.pageUrl ?? "(Not supplied)",
              },
            ],
            beforeAfter: [
              {
                label: "Submission",
                before: "Not submitted",
                after: "Stored and queued for the one-way feedback bridge",
                count: 1,
              },
            ],
          },
        ],
      });
    },
  }),
] as const;

export function platformEffectUuid(effectKey: string, purpose: string) {
  const digest = createHash("sha256")
    .update("evry-platform-effect-v1\0")
    .update(effectKey)
    .update("\0")
    .update(purpose)
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "4";
  digest[16] = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(
    16
  );
  return `${digest.slice(0, 8).join("")}-${digest.slice(8, 12).join("")}-${digest.slice(12, 16).join("")}-${digest.slice(16, 20).join("")}-${digest.slice(20).join("")}`;
}

export async function platformEvryTargetIsCurrent(input: {
  actor: EvryPlantActor;
  step: EvryActionStep;
}) {
  if (input.step.capabilityIdentity === SUBMIT_FEEDBACK_IDENTITY) {
    const parsed = feedbackArgumentsSchema.safeParse(input.step.arguments);
    if (!parsed.success) return false;
    if (!(await plantActorIsCurrent(input.actor))) return false;
    const [row] = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(eq(feedback.id, parsed.data.feedbackId))
      .limit(1);
    return row === undefined;
  }
  const parsed =
    input.step.capabilityIdentity === MARK_ONE_NOTIFICATION_IDENTITY
      ? markOneArgumentsSchema.safeParse(input.step.arguments)
      : markAllArgumentsSchema.safeParse(input.step.arguments);
  if (!parsed.success) return false;
  const rows =
    "notification" in parsed.data
      ? [parsed.data.notification]
      : parsed.data.notifications;
  return notificationTargetIsCurrent({
    actor: input.actor,
    rows,
    categories: parsed.data.visibility.categories,
    exactAllVisible:
      input.step.capabilityIdentity === MARK_ALL_NOTIFICATIONS_IDENTITY,
  });
}

export {
  feedbackArgumentsSchema,
  markAllArgumentsSchema,
  markOneArgumentsSchema,
};
