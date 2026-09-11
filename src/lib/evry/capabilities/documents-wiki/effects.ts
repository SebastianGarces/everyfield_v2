import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  wikiArticleFeedback,
  wikiArticleFeedbackRatings,
  wikiBookmarks,
  wikiProgress,
  wikiProgressStatuses,
} from "@/db/schema";
import { buildEvryConfirmationArtifact } from "@/lib/evry/artifacts/review";
import {
  createEvryArtifactReviewRegistry,
  defineEvryArtifactReview,
  trustedReviewForEvryPlanDocument,
} from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import { eligibleEvryCapabilitiesFor } from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  defineEvryExecutionCapability,
  type EvryEffectInput,
} from "@/lib/evry/executor";
import {
  deriveEvryPlanRequestKey,
  parseEvryActionPlanCandidate,
  type EvryActionStep,
  type EvryPlanRequestKey,
} from "@/lib/evry/plans";
import { createEvryActionPlanRecord } from "@/lib/evry/plans/repository";
import {
  createEvryPlanCapabilityRegistry,
  defineEvryPlanCapability,
} from "@/lib/evry/plans/registry";
import { resolveMergeValues } from "@/lib/documents/merge";
import type { DocumentMergeValues } from "@/lib/documents/types";
import { resolveDocumentMergeContextForActor } from "@/lib/documents/merge-context";
import { canRenderDocument, renderDocument } from "@/lib/documents/render";
import {
  getGeneratedDocument,
  recordGeneratedDocumentAtId,
} from "@/lib/documents/service";
import { getTemplateById } from "@/lib/documents/templates";
import { isDocumentFormat } from "@/lib/documents/types";
import { articleBySlugQuery } from "@/lib/wiki/get-articles";
import { wikiHref } from "@/lib/wiki/href";
import { claimEvryWikiEffect } from "@/lib/wiki/evry-effect";

export const DOCUMENTS_WIKI_EFFECT_IDENTITIES = {
  generate: "documents.generate",
  bookmark: "wiki.bookmark.set",
  progress: "wiki.progress.set",
  feedback: "wiki.feedback.set",
} as const;

const jsonObject = z
  .string()
  .max(20_000)
  .refine((value) => {
    try {
      return (
        typeof JSON.parse(value) === "object" && JSON.parse(value) !== null
      );
    } catch {
      return false;
    }
  });
const generateSchema = z.strictObject({
  documentId: z.string().uuid(),
  templateId: z.string().min(1).max(64),
  templateName: z.string().min(1).max(200),
  templateFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  format: z.enum(["pdf", "docx", "xlsx"]),
  providedJson: jsonObject,
  resolvedJson: jsonObject,
});
const articleIdentityShape = {
  slug: z.string().min(1).max(500),
  title: z.string().min(1).max(500),
  sourceArticleId: z.string().uuid(),
  sourceUpdatedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/),
  articleFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
};
const bookmarkSchema = z.strictObject({
  ...articleIdentityShape,
  expectedBookmarked: z.boolean(),
  afterBookmarked: z.boolean(),
});
const progressSchema = z.strictObject({
  ...articleIdentityShape,
  expectedStatus: z.enum(wikiProgressStatuses),
  expectedScrollPosition: z.number().min(0).max(1),
  expectedPresent: z.boolean(),
  afterStatus: z.enum(wikiProgressStatuses),
  afterScrollPosition: z.number().min(0).max(1),
});
const feedbackSchema = z.strictObject({
  ...articleIdentityShape,
  expectedRating: z.enum(wikiArticleFeedbackRatings).nullable(),
  afterRating: z.enum(wikiArticleFeedbackRatings),
});

const PLANS = {
  generate: defineEvryPlanCapability({
    identity: DOCUMENTS_WIKI_EFFECT_IDENTITIES.generate,
    effectClass: "file_storage_write",
    arguments: generateSchema.shape,
  }),
  bookmark: defineEvryPlanCapability({
    identity: DOCUMENTS_WIKI_EFFECT_IDENTITIES.bookmark,
    effectClass: "database_write",
    arguments: bookmarkSchema.shape,
  }),
  progress: defineEvryPlanCapability({
    identity: DOCUMENTS_WIKI_EFFECT_IDENTITIES.progress,
    effectClass: "database_write",
    arguments: progressSchema.shape,
  }),
  feedback: defineEvryPlanCapability({
    identity: DOCUMENTS_WIKI_EFFECT_IDENTITIES.feedback,
    effectClass: "database_write",
    arguments: feedbackSchema.shape,
  }),
} as const;
export const DOCUMENTS_WIKI_PLAN_REGISTRY = createEvryPlanCapabilityRegistry(
  Object.values(PLANS)
);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");

function deterministicUuid(value: string): string {
  const hex = createHash("sha256")
    .update(`evry-document-v1\u001f${value}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function exactTuple(input: EvryEffectInput, identity: string) {
  return (
    input.authorization.registration.identity === identity &&
    input.execution.capabilityIdentity === identity &&
    input.execution.actorUserId === input.authorization.actor.userId &&
    input.execution.plantId === input.authorization.actor.plantId
  );
}

function templateFingerprint(templateId: string): string | null {
  const template = getTemplateById(templateId);
  return template ? digest(template) : null;
}

type WikiSourceRow = Awaited<ReturnType<typeof articleBySlugQuery>>[number];

function articleFingerprint(article: WikiSourceRow) {
  return digest({
    id: article.id,
    churchId: article.churchId,
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    content: article.content,
    phase: article.phase,
    sectionId: article.sectionId,
    sortOrder: article.sortOrder,
    contentType: article.contentType,
    status: article.status,
    updatedAt: article.updatedAtExact,
  });
}

async function articleSnapshot(
  slugValue: string,
  churchId: string
): Promise<WikiSourceRow | null> {
  return (await articleBySlugQuery(slugValue, churchId))[0] ?? null;
}

async function bookmarkState(userId: string, slug: string) {
  const [row] = await db
    .select({ id: wikiBookmarks.id })
    .from(wikiBookmarks)
    .where(
      and(eq(wikiBookmarks.userId, userId), eq(wikiBookmarks.articleSlug, slug))
    )
    .limit(1);
  return Boolean(row);
}

async function progressState(userId: string, slug: string) {
  const [row] = await db
    .select({
      status: wikiProgress.status,
      scrollPosition: wikiProgress.scrollPosition,
    })
    .from(wikiProgress)
    .where(
      and(eq(wikiProgress.userId, userId), eq(wikiProgress.articleSlug, slug))
    )
    .limit(1);
  return {
    present: Boolean(row),
    status: row?.status ?? ("not_started" as const),
    scrollPosition: row?.scrollPosition ?? 0,
  };
}

async function feedbackState(churchId: string, userId: string, slug: string) {
  const [row] = await db
    .select({ rating: wikiArticleFeedback.rating })
    .from(wikiArticleFeedback)
    .where(
      and(
        eq(wikiArticleFeedback.churchId, churchId),
        eq(wikiArticleFeedback.userId, userId),
        eq(wikiArticleFeedback.articleSlug, slug)
      )
    )
    .limit(1);
  return row?.rating ?? null;
}

function exactVisibleArticle(input: {
  plantId: string;
  slug: string;
  title: string;
  sourceArticleId: string;
  sourceUpdatedAt: string;
}) {
  return sql`exists (
    select 1 from wiki_articles article
    where article.id = ${input.sourceArticleId}::uuid
      and article.slug = ${input.slug}
      and article.title = ${input.title}
      and article.status = 'published'
      and article.updated_at = ${input.sourceUpdatedAt}::timestamp
      and (article.church_id is null or article.church_id = ${input.plantId}::uuid)
      and (
        article.church_id is not null or not exists (
          select 1 from wiki_articles override
          where override.slug = article.slug
            and override.church_id = ${input.plantId}::uuid
            and override.status = 'published'
        )
      )
  )`;
}

export type DocumentsWikiEffectSelection =
  | Readonly<{
      kind: "generate";
      templateId: string;
      format: string;
      provided: Readonly<Record<string, string>>;
    }>
  | Readonly<{ kind: "bookmark"; slug: string; bookmarked: boolean }>
  | Readonly<{
      kind: "progress";
      slug: string;
      status: "not_started" | "in_progress" | "completed";
      scrollPosition: number | null;
    }>
  | Readonly<{
      kind: "feedback";
      slug: string;
      rating: "helpful" | "unhelpful";
    }>;

function fields(value: string): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const item of value.split(";")) {
    const index = item.indexOf("=");
    if (index <= 0) return null;
    const key = item.slice(0, index).trim();
    const fieldValue = item.slice(index + 1);
    if (
      !/^[a-z][a-z0-9_]{0,63}$/.test(key) ||
      key in result ||
      fieldValue.length > 4_000
    )
      return null;
    result[key] = fieldValue;
  }
  return result;
}

export function selectDocumentsWikiEffect(
  textValue: string
): DocumentsWikiEffectSelection | null {
  const generate = /^\s*generate document:\s*([\s\S]+)$/i.exec(textValue)?.[1];
  if (generate) {
    const values = fields(generate);
    if (!values?.template || !values.format) return null;
    const { template, format, ...provided } = values;
    return { kind: "generate", templateId: template, format, provided };
  }
  const text = textValue.trim();
  const bookmark =
    /^(bookmark|unbookmark) wiki article:\s*([^;]{1,500})$/i.exec(text);
  if (bookmark)
    return {
      kind: "bookmark",
      slug: bookmark[2]!.trim(),
      bookmarked: bookmark[1]!.toLowerCase() === "bookmark",
    };
  const progress =
    /^set wiki progress:\s*slug=([^;]{1,500});\s*status=(not_started|in_progress|completed)(?:;\s*scroll=([0-9.]+))?$/i.exec(
      text
    );
  if (progress) {
    const scrollPosition =
      progress[3] === undefined ? null : Number(progress[3]);
    if (
      scrollPosition !== null &&
      (!Number.isFinite(scrollPosition) ||
        scrollPosition < 0 ||
        scrollPosition > 1)
    )
      return null;
    return {
      kind: "progress",
      slug: progress[1]!.trim(),
      status: progress[2]!.toLowerCase() as
        | "not_started"
        | "in_progress"
        | "completed",
      scrollPosition,
    };
  }
  const feedback =
    /^rate wiki article:\s*slug=([^;]{1,500});\s*rating=(helpful|unhelpful)$/i.exec(
      text
    );
  if (feedback)
    return {
      kind: "feedback",
      slug: feedback[1]!.trim(),
      rating: feedback[2]!.toLowerCase() as "helpful" | "unhelpful",
    };
  return null;
}

export const DOCUMENTS_WIKI_EXECUTIONS = [
  defineEvryExecutionCapability({
    planCapability: PLANS.generate,
    async executeIfCurrent(input) {
      const parsed = generateSchema.safeParse(input.arguments);
      if (!parsed.success || !exactTuple(input, PLANS.generate.identity))
        return { status: "refused", excludedCount: 1 };
      const existing = await getGeneratedDocument(
        input.authorization.actor.plantId,
        parsed.data.documentId
      );
      if (existing)
        return existing.userId === input.authorization.actor.userId &&
          existing.templateId === parsed.data.templateId &&
          existing.format === parsed.data.format
          ? { status: "completed", affectedCount: 1, excludedCount: 0 }
          : { status: "refused", excludedCount: 1 };
      const template = getTemplateById(parsed.data.templateId);
      const context = await resolveDocumentMergeContextForActor(
        input.authorization.actor
      );
      if (
        !template ||
        !context ||
        template.name !== parsed.data.templateName ||
        templateFingerprint(template.id) !== parsed.data.templateFingerprint ||
        !template.formats.includes(parsed.data.format) ||
        !canRenderDocument(parsed.data.format, template.id)
      )
        return { status: "refused", excludedCount: 1 };
      const provided = JSON.parse(
        parsed.data.providedJson
      ) as DocumentMergeValues;
      const resolved = resolveMergeValues(template, context.merge, provided);
      if (
        canonical(resolved) !== canonical(JSON.parse(parsed.data.resolvedJson))
      )
        return { status: "refused", excludedCount: 1 };
      const bytes = await renderDocument(
        parsed.data.format,
        template.id,
        resolved
      );
      await recordGeneratedDocumentAtId({
        id: parsed.data.documentId,
        churchId: input.authorization.actor.plantId,
        userId: input.authorization.actor.userId,
        templateId: template.id,
        format: parsed.data.format,
        bytes,
      });
      return { status: "completed", affectedCount: 1, excludedCount: 0 };
    },
  }),
  defineEvryExecutionCapability({
    planCapability: PLANS.bookmark,
    async executeIfCurrent(input) {
      const parsed = bookmarkSchema.safeParse(input.arguments);
      if (!parsed.success || !exactTuple(input, PLANS.bookmark.identity))
        return { status: "refused", excludedCount: 1 };
      const articleGate = exactVisibleArticle({
        plantId: input.authorization.actor.plantId,
        ...parsed.data,
      });
      const mutation = parsed.data.afterBookmarked
        ? sql`insert into wiki_bookmarks (user_id, article_slug)
            select e.actor_user_id, ${parsed.data.slug} from eligible e
            where ${parsed.data.expectedBookmarked} = false and ${articleGate}
              and not exists (select 1 from wiki_bookmarks b where b.user_id = e.actor_user_id and b.article_slug = ${parsed.data.slug})
            on conflict do nothing returning 1::int as affected_count, 0::int as excluded_count`
        : sql`delete from wiki_bookmarks b using eligible e
            where ${parsed.data.expectedBookmarked} = true and ${articleGate}
              and b.user_id = e.actor_user_id and b.article_slug = ${parsed.data.slug}
            returning 1::int as affected_count, 0::int as excluded_count`;
      return claimEvryWikiEffect({
        execution: input.execution,
        effectKey: input.effectKey,
        mutation,
        targetIsCurrent: () =>
          documentsWikiTargetIsCurrent({
            actor: input.authorization.actor,
            step: {
              id: input.execution.stepId,
              capabilityIdentity: input.execution.capabilityIdentity,
              effectClass: "database_write",
              arguments: input.arguments,
              dependsOn: [],
            },
          }),
      });
    },
  }),
  defineEvryExecutionCapability({
    planCapability: PLANS.progress,
    async executeIfCurrent(input) {
      const parsed = progressSchema.safeParse(input.arguments);
      if (!parsed.success || !exactTuple(input, PLANS.progress.identity))
        return { status: "refused", excludedCount: 1 };
      const articleGate = exactVisibleArticle({
        plantId: input.authorization.actor.plantId,
        ...parsed.data,
      });
      const expectedRow = parsed.data.expectedPresent
        ? sql`exists (select 1 from wiki_progress p where p.user_id = e.actor_user_id and p.article_slug = ${parsed.data.slug} and p.status = ${parsed.data.expectedStatus} and coalesce(p.scroll_position, 0) = ${parsed.data.expectedScrollPosition})`
        : sql`not exists (select 1 from wiki_progress p where p.user_id = e.actor_user_id and p.article_slug = ${parsed.data.slug})`;
      const mutation = sql`
        insert into wiki_progress (user_id, article_slug, status, scroll_position, last_viewed_at, completed_at)
        select e.actor_user_id, ${parsed.data.slug}, ${parsed.data.afterStatus}, ${parsed.data.afterScrollPosition}, transaction_timestamp(),
          case when ${parsed.data.afterStatus} = 'completed' then transaction_timestamp() else null end
        from eligible e where ${articleGate} and ${expectedRow}
        on conflict (user_id, article_slug) do update set
          status = excluded.status,
          scroll_position = excluded.scroll_position,
          last_viewed_at = transaction_timestamp(),
          updated_at = transaction_timestamp(),
          completed_at = case when excluded.status = 'completed' then transaction_timestamp() else wiki_progress.completed_at end
        where ${parsed.data.expectedPresent}
          and wiki_progress.status = ${parsed.data.expectedStatus}
          and coalesce(wiki_progress.scroll_position, 0) = ${parsed.data.expectedScrollPosition}
        returning 1::int as affected_count, 0::int as excluded_count`;
      return claimEvryWikiEffect({
        execution: input.execution,
        effectKey: input.effectKey,
        mutation,
        targetIsCurrent: () =>
          documentsWikiTargetIsCurrent({
            actor: input.authorization.actor,
            step: {
              id: input.execution.stepId,
              capabilityIdentity: input.execution.capabilityIdentity,
              effectClass: "database_write",
              arguments: input.arguments,
              dependsOn: [],
            },
          }),
      });
    },
  }),
  defineEvryExecutionCapability({
    planCapability: PLANS.feedback,
    async executeIfCurrent(input) {
      const parsed = feedbackSchema.safeParse(input.arguments);
      if (!parsed.success || !exactTuple(input, PLANS.feedback.identity))
        return { status: "refused", excludedCount: 1 };
      const articleGate = exactVisibleArticle({
        plantId: input.authorization.actor.plantId,
        ...parsed.data,
      });
      const expectedRow =
        parsed.data.expectedRating === null
          ? sql`not exists (select 1 from wiki_article_feedback f where f.church_id = e.church_id and f.user_id = e.actor_user_id and f.article_slug = ${parsed.data.slug})`
          : sql`exists (select 1 from wiki_article_feedback f where f.church_id = e.church_id and f.user_id = e.actor_user_id and f.article_slug = ${parsed.data.slug} and f.rating = ${parsed.data.expectedRating})`;
      const mutation = sql`
        insert into wiki_article_feedback (church_id, user_id, article_slug, rating)
        select e.church_id, e.actor_user_id, ${parsed.data.slug}, ${parsed.data.afterRating}
        from eligible e where ${articleGate} and ${expectedRow}
        on conflict (church_id, user_id, article_slug) do update set
          rating = excluded.rating, updated_at = transaction_timestamp()
        where wiki_article_feedback.rating is not distinct from ${parsed.data.expectedRating}
        returning 1::int as affected_count, 0::int as excluded_count`;
      return claimEvryWikiEffect({
        execution: input.execution,
        effectKey: input.effectKey,
        mutation,
        targetIsCurrent: () =>
          documentsWikiTargetIsCurrent({
            actor: input.authorization.actor,
            step: {
              id: input.execution.stepId,
              capabilityIdentity: input.execution.capabilityIdentity,
              effectClass: "database_write",
              arguments: input.arguments,
              dependsOn: [],
            },
          }),
      });
    },
  }),
] as const;

function target(label: string, value: string, href: string | null = null) {
  const sourceLabel = `Open ${value}`;
  let bounded = "";
  for (const point of sourceLabel) {
    if (bounded.length + point.length > 159) break;
    bounded += point;
  }
  return {
    label,
    value,
    sourceLink: href
      ? { label: sourceLabel.length <= 160 ? sourceLabel : `${bounded}…`, href }
      : null,
  };
}

export const DOCUMENTS_WIKI_REVIEWS = [
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [DOCUMENTS_WIKI_EFFECT_IDENTITIES.generate],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const args = generateSchema.parse(step.arguments);
      const values = JSON.parse(args.resolvedJson) as Record<string, string>;
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Generate ${args.templateName}`,
        actionLabel: "Generate document",
        consequences: [
          "This renders one exact file, stores it privately, and adds it to this plant’s document history.",
        ],
        steps: [
          {
            stepId: step.id,
            title: "Generate and store document",
            effectKind: "other",
            reversibility: "reversible",
            resolvedTargets: [
              target(
                "Template",
                args.templateName,
                `/documents?template=${encodeURIComponent(args.templateId)}`
              ),
              target("Format", args.format.toUpperCase()),
            ],
            counts: [
              { label: "Documents", count: 1 },
              { label: "Merge fields", count: Object.keys(values).length },
            ],
            exclusions: [],
            dateTime: null,
            contentPreviews: Object.entries(values).map(([key, value]) => ({
              label: key,
              content: value || "(empty)",
            })),
            beforeAfter: [],
          },
        ],
      });
    },
  }),
  ...(
    [
      DOCUMENTS_WIKI_EFFECT_IDENTITIES.bookmark,
      DOCUMENTS_WIKI_EFFECT_IDENTITIES.progress,
      DOCUMENTS_WIKI_EFFECT_IDENTITIES.feedback,
    ] as const
  ).map((identity) =>
    defineEvryArtifactReview({
      source: { kind: "generic", capabilityIdentities: [identity] },
      build({ plan, document }) {
        const step = document.steps[0]!;
        const common = articleIdentityShape.slug.parse(step.arguments.slug);
        const title = articleIdentityShape.title.parse(step.arguments.title);
        const change =
          identity === DOCUMENTS_WIKI_EFFECT_IDENTITIES.bookmark
            ? {
                label: "Bookmark",
                before: String(
                  bookmarkSchema.parse(step.arguments).expectedBookmarked
                ),
                after: String(
                  bookmarkSchema.parse(step.arguments).afterBookmarked
                ),
              }
            : identity === DOCUMENTS_WIKI_EFFECT_IDENTITIES.progress
              ? {
                  label: "Progress",
                  before: `${progressSchema.parse(step.arguments).expectedStatus} at ${progressSchema.parse(step.arguments).expectedScrollPosition}`,
                  after: `${progressSchema.parse(step.arguments).afterStatus} at ${progressSchema.parse(step.arguments).afterScrollPosition}`,
                }
              : {
                  label: "Feedback",
                  before:
                    feedbackSchema.parse(step.arguments).expectedRating ??
                    "Not rated",
                  after: feedbackSchema.parse(step.arguments).afterRating,
                };
        return buildEvryConfirmationArtifact({
          kind: "confirmation",
          artifactVersion: 1,
          plan,
          title: `Update wiki ${change.label.toLowerCase()}`,
          actionLabel: `Save ${change.label.toLowerCase()}`,
          consequences: [
            `This updates the current reader’s ${change.label.toLowerCase()} for one visible wiki article.`,
          ],
          steps: [
            {
              stepId: step.id,
              title: `Update ${change.label.toLowerCase()}`,
              effectKind: "other",
              reversibility: "reversible",
              resolvedTargets: [target("Article", title, wikiHref(common))],
              counts: [{ label: "Articles", count: 1 }],
              exclusions: [],
              dateTime: null,
              contentPreviews: [],
              beforeAfter: [{ ...change, count: 1 }],
            },
          ],
        });
      },
    })
  ),
] as const;

export const DOCUMENTS_WIKI_REVIEW_REGISTRY = createEvryArtifactReviewRegistry(
  DOCUMENTS_WIKI_REVIEWS
);

export async function proposeDocumentsWikiEffect(input: {
  actor: EvryPlantActor;
  selection: DocumentsWikiEffectSelection;
  requestKey: EvryPlanRequestKey;
}) {
  const identity = DOCUMENTS_WIKI_EFFECT_IDENTITIES[input.selection.kind];
  let args: Record<string, unknown> | null = null;
  if (input.selection.kind === "generate") {
    const template = getTemplateById(input.selection.templateId);
    const context = await resolveDocumentMergeContextForActor(input.actor);
    if (
      !template ||
      !context ||
      !isDocumentFormat(input.selection.format) ||
      !template.formats.includes(input.selection.format) ||
      !canRenderDocument(input.selection.format, template.id) ||
      Object.keys(input.selection.provided).some(
        (key) => !template.mergeFields.some((field) => field.key === key)
      )
    )
      return null;
    const resolved = resolveMergeValues(
      template,
      context.merge,
      input.selection.provided
    );
    if (
      template.mergeFields.some(
        (field) => field.required && !resolved[field.key]
      )
    )
      return null;
    const effectSeed = deriveEvryPlanRequestKey("documents-generate-effect", [
      input.actor.userId,
      input.actor.plantId,
      String(input.requestKey),
    ]);
    args = {
      documentId: deterministicUuid(String(effectSeed)),
      templateId: template.id,
      templateName: template.name,
      templateFingerprint: templateFingerprint(template.id),
      format: input.selection.format,
      providedJson: canonical(input.selection.provided),
      resolvedJson: canonical(resolved),
    };
  } else {
    const article = await articleSnapshot(
      input.selection.slug,
      input.actor.plantId
    );
    if (!article) return null;
    const common = {
      slug: article.slug,
      title: article.title,
      sourceArticleId: article.id,
      sourceUpdatedAt: article.updatedAtExact,
      articleFingerprint: articleFingerprint(article),
    };
    if (input.selection.kind === "bookmark") {
      const before = await bookmarkState(input.actor.userId, article.slug);
      if (before === input.selection.bookmarked) return null;
      args = {
        ...common,
        expectedBookmarked: before,
        afterBookmarked: input.selection.bookmarked,
      };
    }
    if (input.selection.kind === "progress") {
      const before = await progressState(input.actor.userId, article.slug);
      const afterScrollPosition =
        input.selection.scrollPosition ?? before.scrollPosition;
      if (
        before.status === input.selection.status &&
        before.scrollPosition === afterScrollPosition
      )
        return null;
      args = {
        ...common,
        expectedStatus: before.status,
        expectedScrollPosition: before.scrollPosition,
        expectedPresent: before.present,
        afterStatus: input.selection.status,
        afterScrollPosition,
      };
    }
    if (input.selection.kind === "feedback") {
      const before = await feedbackState(
        input.actor.plantId,
        input.actor.userId,
        article.slug
      );
      if (before === input.selection.rating) return null;
      args = {
        ...common,
        expectedRating: before,
        afterRating: input.selection.rating,
      };
    }
  }
  if (!args) return null;
  const planCapability = DOCUMENTS_WIKI_PLAN_REGISTRY.registrationFor(identity);
  if (!planCapability?.argumentsSchema.safeParse(args).success) return null;
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: input.selection.kind.replaceAll("_", "-"),
          capabilityIdentity: identity,
          arguments: args,
          dependsOn: [],
        },
      ],
    },
    registry: DOCUMENTS_WIKI_PLAN_REGISTRY,
    eligibleCapabilities: eligibleEvryCapabilitiesFor(input.actor),
  });
  const stored = await createEvryActionPlanRecord({
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    requestKey: input.requestKey,
    document,
  });
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: stored.id,
    fingerprint: stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: DOCUMENTS_WIKI_REVIEW_REGISTRY,
  });
  return review ? { plan, confirmation: review.confirmation } : null;
}

export async function documentsWikiTargetIsCurrent(input: {
  actor: EvryPlantActor;
  step: EvryActionStep;
}) {
  const identity = input.step.capabilityIdentity;
  if (identity === DOCUMENTS_WIKI_EFFECT_IDENTITIES.generate) {
    const parsed = generateSchema.safeParse(input.step.arguments);
    if (!parsed.success) return false;
    const existing = await getGeneratedDocument(
      input.actor.plantId,
      parsed.data.documentId
    );
    if (existing)
      return (
        existing.userId === input.actor.userId &&
        existing.templateId === parsed.data.templateId &&
        existing.format === parsed.data.format
      );
    const template = getTemplateById(parsed.data.templateId);
    const context = await resolveDocumentMergeContextForActor(input.actor);
    return Boolean(
      template &&
      context &&
      template.name === parsed.data.templateName &&
      templateFingerprint(template.id) === parsed.data.templateFingerprint &&
      canonical(
        resolveMergeValues(
          template,
          context.merge,
          JSON.parse(parsed.data.providedJson) as DocumentMergeValues
        )
      ) === canonical(JSON.parse(parsed.data.resolvedJson))
    );
  }
  const schema =
    identity === DOCUMENTS_WIKI_EFFECT_IDENTITIES.bookmark
      ? bookmarkSchema
      : identity === DOCUMENTS_WIKI_EFFECT_IDENTITIES.progress
        ? progressSchema
        : identity === DOCUMENTS_WIKI_EFFECT_IDENTITIES.feedback
          ? feedbackSchema
          : null;
  const parsed = schema?.safeParse(input.step.arguments);
  if (!parsed?.success) return false;
  const args = parsed.data as
    | z.infer<typeof bookmarkSchema>
    | z.infer<typeof progressSchema>
    | z.infer<typeof feedbackSchema>;
  const article = await articleSnapshot(args.slug, input.actor.plantId);
  if (
    !article ||
    article.id !== args.sourceArticleId ||
    article.updatedAtExact !== args.sourceUpdatedAt ||
    article.title !== args.title ||
    articleFingerprint(article) !== args.articleFingerprint
  )
    return false;
  if (identity === DOCUMENTS_WIKI_EFFECT_IDENTITIES.bookmark)
    return (
      (await bookmarkState(input.actor.userId, args.slug)) ===
      (args as z.infer<typeof bookmarkSchema>).expectedBookmarked
    );
  if (identity === DOCUMENTS_WIKI_EFFECT_IDENTITIES.progress) {
    const current = await progressState(input.actor.userId, args.slug);
    const expected = args as z.infer<typeof progressSchema>;
    return (
      current.present === expected.expectedPresent &&
      current.status === expected.expectedStatus &&
      current.scrollPosition === expected.expectedScrollPosition
    );
  }
  return (
    (await feedbackState(
      input.actor.plantId,
      input.actor.userId,
      args.slug
    )) === (args as z.infer<typeof feedbackSchema>).expectedRating
  );
}
