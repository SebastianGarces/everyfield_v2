import { createHash } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  churches,
  insightFeedback,
  phaseTransitions,
  plantAssessments,
  plantInsights,
} from "@/db/schema";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import type { EvryResolvedPageContext } from "@/lib/evry/resolvers/contract";
import { defineEvryReadRegistration } from "@/lib/evry/reads/contract";
import { MANUAL_SIGNALS } from "@/lib/phase-engine/manual-signals";
import {
  CHECKIN_HISTORY_WEEKS,
  CHECKIN_LEVELS,
} from "@/lib/phase-engine/planter-checkin";
import { listRecentCheckins } from "@/lib/phase-engine/planter-checkin-db";
import { getLatestAssessment } from "@/lib/phase-engine/assessment";
import { listManualSignals } from "@/lib/phase-engine/signals/attestation-service";
import { getMilestoneTimeline } from "@/lib/phase-engine/signals/milestones";
import { getPlantTrends } from "@/lib/phase-engine/signals/trends";
import { getPhaseReadiness } from "@/lib/phase-engine/transitions";
import { getPublishedArticleRefs } from "@/lib/wiki/get-articles";
import { wikiHref } from "@/lib/wiki/href";

import { PLANT_INTELLIGENCE_READ_IDENTITIES } from "./catalog";

const phaseLink = trustedEvryApplicationSourceLink({
  label: "Open Plant Intelligence",
  href: "/phase",
});
const PAGE_SIZE = 80;
const DISPLAY_CHUNK = 450;

const cursorSchema = z.strictObject({
  kind: z.enum(["assessment", "declarations", "feedback", "signals"]),
  recordId: z.string().uuid(),
  offset: z.number().int().nonnegative(),
  sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
type Cursor = z.infer<typeof cursorSchema>;

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string): Cursor | null {
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    );
  } catch {
    return null;
  }
}

function sourceFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function cursorMatches(
  cursor: Cursor | null,
  kind: Cursor["kind"],
  recordId: string,
  fingerprint: string
) {
  return (
    cursor === null ||
    (cursor.kind === kind &&
      cursor.recordId === recordId &&
      cursor.sourceFingerprint === fingerprint)
  );
}

function changedPageArtifact(title: string, reason: string) {
  return buildEvryReadArtifact({
    title,
    filters: [{ label: "Plant", value: "Current plant" }],
    exclusions: [{ reason, count: 1 }],
    items: [],
    sourceLinks: [phaseLink],
  });
}

/** Split display storage without tearing UTF-16 surrogate pairs. */
export function plantIntelligenceDisplayChunks(
  value: string | null | undefined,
  maximum = DISPLAY_CHUNK
): string[] {
  if (!value) return [];
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; ) {
    let end = Math.min(value.length, offset + maximum);
    if (
      end < value.length &&
      value.charCodeAt(end - 1) >= 0xd800 &&
      value.charCodeAt(end - 1) <= 0xdbff
    )
      end -= 1;
    chunks.push(value.slice(offset, end));
    offset = end;
  }
  return chunks;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "Not recorded";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function continuationFilter(
  prefix: string,
  cursor: Cursor | null,
  remaining: number
) {
  return cursor && remaining > 0
    ? [
        {
          label: "Continue without loss",
          value: `${prefix} cursor ${encodeCursor(cursor)}`,
        },
      ]
    : [];
}

async function scopedAssessment(plantId: string, assessmentId: string | null) {
  const conditions = [
    eq(plantAssessments.churchId, plantId),
    eq(plantAssessments.status, "complete"),
  ];
  if (assessmentId) conditions.push(eq(plantAssessments.id, assessmentId));
  const [assessment] = await db
    .select()
    .from(plantAssessments)
    .where(and(...conditions))
    .orderBy(desc(plantAssessments.generatedAt), desc(plantAssessments.id))
    .limit(1);
  if (!assessment) return null;
  const insights = await db
    .select()
    .from(plantInsights)
    .where(
      and(
        eq(plantInsights.assessmentId, assessment.id),
        eq(plantInsights.churchId, plantId),
        eq(plantInsights.audience, "planter")
      )
    )
    .orderBy(asc(plantInsights.rank), asc(plantInsights.id));
  return { assessment, insights };
}

/** Stored application output only: no judge, rubric synthesis, or guidance. */
export async function readPlantIntelligenceAssessmentForPlant(input: {
  plantId: string;
  assessmentId: string | null;
  cursor: Cursor | null;
}) {
  const resolved = await scopedAssessment(input.plantId, input.assessmentId);
  if (!resolved) {
    return buildEvryReadArtifact({
      title: "Stored Plant Intelligence assessment",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: [
        {
          reason: "Unavailable in this plant or no longer current",
          count: 1,
        },
      ],
      items: [],
      sourceLinks: [phaseLink],
    });
  }
  const articleRefs = await getPublishedArticleRefs(input.plantId);
  const articles = new Map(
    articleRefs.map((article) => [article.slug, article])
  );
  const assessmentItem = {
    id: `${resolved.assessment.id}:assessment`,
    label: "Stored assessment output",
    facts: [
      { label: "Assessment ID", value: resolved.assessment.id },
      {
        label: "Generated",
        value: resolved.assessment.generatedAt.toISOString(),
      },
      { label: "Phase", value: String(resolved.assessment.phase) },
      { label: "Rubric version", value: resolved.assessment.rubricVersion },
      {
        label: "Planter first opened",
        value:
          resolved.assessment.planterSeenAt?.toISOString() ??
          "Not acknowledged",
      },
      {
        label: "Scope",
        value:
          "Stored progress-toward-launch output; not a new church-health judgment.",
      },
    ],
    sourceLink: phaseLink,
  };
  const insightItems = resolved.insights.flatMap((insight) => {
    const title = plantIntelligenceDisplayChunks(insight.title);
    const body = plantIntelligenceDisplayChunks(insight.body);
    const citedFacts = plantIntelligenceDisplayChunks(
      insight.citedFacts === null ? null : JSON.stringify(insight.citedFacts)
    );
    const articleLinks = (insight.relatedArticleSlugs ?? []).flatMap((slug) => {
      const article = articles.get(slug);
      return article
        ? [
            {
              id: `${insight.id}:article:${slug}`,
              label: `Stored source: ${article.title}`,
              facts: [{ label: "Article slug", value: slug }],
              sourceLink: trustedEvryApplicationSourceLink({
                label: article.title,
                href: wikiHref(slug),
              }),
            },
          ]
        : [];
    });
    return [
      {
        id: `${insight.id}:summary`,
        label: "Stored insight",
        facts: [
          { label: "Insight ID", value: insight.id },
          { label: "Category", value: insight.category },
          { label: "Severity", value: insight.severity },
          { label: "Stored rank", value: String(insight.rank) },
        ],
        sourceLink: phaseLink,
      },
      ...title.map((value, index) => ({
        id: `${insight.id}:title:${index}`,
        label: `Stored title ${index + 1} of ${title.length}`,
        facts: [{ label: "Exact stored text", value }],
        sourceLink: phaseLink,
      })),
      ...body.map((value, index) => ({
        id: `${insight.id}:body:${index}`,
        label: `Stored body ${index + 1} of ${body.length}`,
        facts: [{ label: "Exact stored text", value }],
        sourceLink: phaseLink,
      })),
      ...citedFacts.map((value, index) => ({
        id: `${insight.id}:citation:${index}`,
        label: `Stored cited facts ${index + 1} of ${citedFacts.length}`,
        facts: [{ label: "Exact stored JSON", value }],
        sourceLink: phaseLink,
      })),
      ...articleLinks,
    ];
  });
  const allItems = [assessmentItem, ...insightItems];
  const fingerprint = sourceFingerprint(allItems);
  if (
    !cursorMatches(
      input.cursor,
      "assessment",
      resolved.assessment.id,
      fingerprint
    )
  )
    return changedPageArtifact(
      "Stored Plant Intelligence assessment",
      "The stored assessment changed; start again"
    );
  const offset = input.cursor?.offset ?? 0;
  const visible = allItems.slice(offset, offset + PAGE_SIZE);
  const remaining = Math.max(0, allItems.length - offset - visible.length);
  const next =
    remaining > 0
      ? {
          kind: "assessment" as const,
          recordId: resolved.assessment.id,
          offset: offset + visible.length,
          sourceFingerprint: fingerprint,
        }
      : null;
  return buildEvryReadArtifact({
    title: "Stored Plant Intelligence assessment",
    filters: [
      { label: "Plant", value: "Current plant" },
      { label: "Assessment", value: resolved.assessment.id },
      ...continuationFilter(
        "show plant intelligence assessment",
        next,
        remaining
      ),
    ],
    exclusions:
      remaining > 0
        ? [
            {
              reason: "Remaining stored items available by cursor",
              count: remaining,
            },
          ]
        : [],
    items: visible,
    sourceLinks: [phaseLink],
  });
}

export async function readPlantIntelligenceAttestationsForPlant(
  plantId: string
) {
  const rows = await listManualSignals(plantId);
  const byKey = new Map(rows.map((row) => [row.signalKey, row]));
  return buildEvryReadArtifact({
    title: "Stored Plant Intelligence attestations",
    filters: [{ label: "Plant", value: "Current plant" }],
    exclusions: [],
    items: MANUAL_SIGNALS.map((definition) => {
      const row = byKey.get(definition.key);
      return {
        id: row?.id ?? `unanswered:${definition.key}`,
        label: definition.label,
        facts: [
          { label: "Signal key", value: definition.key },
          { label: "Stored value", value: displayValue(row?.value) },
          {
            label: "Attested",
            value: row?.attestedAt.toISOString() ?? "Never",
          },
          {
            label: "Reaffirmation",
            value: definition.reaffirms ? "30 days" : "Not required",
          },
        ],
        sourceLink: phaseLink,
      };
    }),
    sourceLinks: [phaseLink],
  });
}

export async function readPlantIntelligenceCheckinsForPlant(plantId: string) {
  const rows = await listRecentCheckins(
    plantId,
    new Date(),
    CHECKIN_HISTORY_WEEKS
  );
  const levelLabels = new Map(
    CHECKIN_LEVELS.map((level) => [level.value, level.label])
  );
  return buildEvryReadArtifact({
    title: "Private stored planter check-ins",
    filters: [
      { label: "Plant", value: "Current plant" },
      {
        label: "Privacy",
        value: "Plant Owner view only; never an assessment signal",
      },
    ],
    exclusions: [],
    items: rows.flatMap((row) => {
      const note = plantIntelligenceDisplayChunks(row.note);
      return [
        {
          id: `${row.id}:summary`,
          label: row.weekStart.slice(0, 10),
          facts: [
            {
              label: "Spiritually",
              value: levelLabels.get(row.spiritually) ?? row.spiritually,
            },
            {
              label: "Marriage & family",
              value: levelLabels.get(row.marriageFamily) ?? row.marriageFamily,
            },
            {
              label: "Financially",
              value: levelLabels.get(row.financially) ?? row.financially,
            },
            { label: "Pace", value: levelLabels.get(row.pace) ?? row.pace },
            { label: "Updated", value: row.updatedAt.toISOString() },
          ],
          sourceLink: phaseLink,
        },
        ...note.map((value, index) => ({
          id: `${row.id}:note:${index}`,
          label: `Private note ${index + 1} of ${note.length}`,
          facts: [{ label: "Exact stored text", value }],
          sourceLink: phaseLink,
        })),
      ];
    }),
    sourceLinks: [phaseLink],
  });
}

export async function readPlantIntelligenceFeedbackForPlant(input: {
  plantId: string;
  userId: string;
  cursor: Cursor | null;
}) {
  const rows = await db
    .select({
      id: insightFeedback.id,
      insightId: insightFeedback.insightId,
      rating: insightFeedback.rating,
      comment: insightFeedback.comment,
      rubricVersion: insightFeedback.rubricVersion,
      updatedAt: insightFeedback.updatedAt,
      title: plantInsights.title,
    })
    .from(insightFeedback)
    .innerJoin(
      plantInsights,
      and(
        eq(plantInsights.id, insightFeedback.insightId),
        eq(plantInsights.churchId, input.plantId)
      )
    )
    .where(
      and(
        eq(insightFeedback.churchId, input.plantId),
        eq(insightFeedback.userId, input.userId)
      )
    )
    .orderBy(desc(insightFeedback.updatedAt), desc(insightFeedback.id));
  const flattened = rows.flatMap((row) => {
    const title = plantIntelligenceDisplayChunks(row.title);
    const comment = plantIntelligenceDisplayChunks(row.comment);
    return [
      {
        id: `${row.id}:summary`,
        label: "Stored insight feedback",
        facts: [
          { label: "Feedback ID", value: row.id },
          { label: "Insight ID", value: row.insightId },
          { label: "Rating", value: row.rating },
          { label: "Rubric version", value: row.rubricVersion },
          { label: "Updated", value: row.updatedAt.toISOString() },
        ],
        sourceLink: phaseLink,
      },
      ...title.map((value, index) => ({
        id: `${row.id}:title:${index}`,
        label: `Stored insight title ${index + 1} of ${title.length}`,
        facts: [{ label: "Exact stored text", value }],
        sourceLink: phaseLink,
      })),
      ...comment.map((value, index) => ({
        id: `${row.id}:comment:${index}`,
        label: `Stored comment ${index + 1} of ${comment.length}`,
        facts: [{ label: "Exact stored text", value }],
        sourceLink: phaseLink,
      })),
    ];
  });
  const fingerprint = sourceFingerprint(flattened);
  if (!cursorMatches(input.cursor, "feedback", input.userId, fingerprint))
    return changedPageArtifact(
      "Your stored Plant Intelligence feedback",
      "The stored feedback changed; start again"
    );
  const offset = input.cursor?.offset ?? 0;
  const visible = flattened.slice(offset, offset + PAGE_SIZE);
  const remaining = Math.max(0, flattened.length - offset - visible.length);
  const next =
    remaining > 0
      ? {
          kind: "feedback" as const,
          recordId: input.userId,
          offset: offset + visible.length,
          sourceFingerprint: fingerprint,
        }
      : null;
  return buildEvryReadArtifact({
    title: "Your stored Plant Intelligence feedback",
    filters: [
      { label: "Plant", value: "Current plant" },
      ...continuationFilter(
        "show plant intelligence feedback",
        next,
        remaining
      ),
    ],
    exclusions:
      remaining > 0
        ? [
            {
              reason: "Remaining stored feedback available by cursor",
              count: remaining,
            },
          ]
        : [],
    items: visible,
    sourceLinks: [phaseLink],
  });
}

export async function readPlantIntelligenceDeclarationsForPlant(input: {
  plantId: string;
  cursor: Cursor | null;
}) {
  const [church] = await db
    .select({ currentPhase: churches.currentPhase })
    .from(churches)
    .where(eq(churches.id, input.plantId))
    .limit(1);
  const rows = await db
    .select()
    .from(phaseTransitions)
    .where(eq(phaseTransitions.churchId, input.plantId))
    .orderBy(desc(phaseTransitions.createdAt), desc(phaseTransitions.id));
  const flattened = rows.flatMap((row) => {
    const reason = plantIntelligenceDisplayChunks(row.reason);
    return [
      {
        id: `${row.id}:summary`,
        label:
          row.kind === "initial_declaration"
            ? `Initial declaration · Phase ${row.toPhase}`
            : `Phase ${row.fromPhase} → ${row.toPhase}`,
        facts: [
          { label: "Transition ID", value: row.id },
          { label: "Kind", value: row.kind },
          { label: "Recorded", value: row.createdAt.toISOString() },
          { label: "Rubric version", value: row.rubricVersion },
        ],
        sourceLink: phaseLink,
      },
      ...reason.map((value, index) => ({
        id: `${row.id}:reason:${index}`,
        label: `Stored reason ${index + 1} of ${reason.length}`,
        facts: [{ label: "Exact stored text", value }],
        sourceLink: phaseLink,
      })),
    ];
  });
  const recordId = rows[0]?.id ?? "00000000-0000-0000-0000-000000000000";
  const fingerprint = sourceFingerprint({
    currentPhase: church?.currentPhase ?? null,
    items: flattened,
  });
  if (!cursorMatches(input.cursor, "declarations", recordId, fingerprint))
    return changedPageArtifact(
      "Stored Plant Intelligence phase history",
      "The stored phase history changed; start again"
    );
  const offset = input.cursor?.offset ?? 0;
  const visible = flattened.slice(offset, offset + PAGE_SIZE);
  const remaining = Math.max(0, flattened.length - offset - visible.length);
  const next =
    remaining > 0
      ? {
          kind: "declarations" as const,
          recordId,
          offset: offset + visible.length,
          sourceFingerprint: fingerprint,
        }
      : null;
  return buildEvryReadArtifact({
    title: "Stored Plant Intelligence phase history",
    filters: [
      { label: "Plant", value: "Current plant" },
      {
        label: "Current phase",
        value: church ? String(church.currentPhase) : "Unavailable",
      },
      ...continuationFilter(
        "show plant intelligence phase history",
        next,
        remaining
      ),
    ],
    exclusions:
      remaining > 0
        ? [
            {
              reason: "Remaining stored history available by cursor",
              count: remaining,
            },
          ]
        : [],
    items: visible,
    sourceLinks: [phaseLink],
  });
}

export async function readPlantIntelligenceSignalsForPlant(input: {
  plantId: string;
  cursor: Cursor | null;
}) {
  const latest = await getLatestAssessment(input.plantId);
  const [readiness, trends, timeline] = await Promise.all([
    getPhaseReadiness(input.plantId),
    getPlantTrends(input.plantId, latest, "planter"),
    getMilestoneTimeline(input.plantId, latest, "planter"),
  ]);
  const readinessHeadline = plantIntelligenceDisplayChunks(readiness.headline);
  const readinessDetail = plantIntelligenceDisplayChunks(readiness.detail);
  const allItems = [
    {
      id: "readiness",
      label: "Stored readiness projection",
      facts: [
        { label: "State", value: readiness.state },
        { label: "Assessment ID", value: readiness.assessmentId ?? "None" },
      ],
      sourceLink: phaseLink,
    },
    ...readinessHeadline.map((value, index) => ({
      id: `readiness:headline:${index}`,
      label: `Stored readiness headline ${index + 1} of ${readinessHeadline.length}`,
      facts: [{ label: "Exact stored text", value }],
      sourceLink: phaseLink,
    })),
    ...readinessDetail.map((value, index) => ({
      id: `readiness:detail:${index}`,
      label: `Stored readiness detail ${index + 1} of ${readinessDetail.length}`,
      facts: [{ label: "Exact stored text", value }],
      sourceLink: phaseLink,
    })),
    ...(trends?.metrics ?? []).flatMap((metric) => {
      const alertTitle = plantIntelligenceDisplayChunks(
        metric.alert.insightTitle
      );
      return [
        {
          id: `trend:${metric.key}`,
          label: metric.label,
          facts: [
            { label: "Description", value: metric.description },
            {
              label: "Value",
              value: metric.value === null ? "Unknown" : String(metric.value),
            },
            {
              label: "Value at",
              value: metric.valueAt?.toISOString() ?? "Unknown",
            },
            { label: "Stale", value: String(metric.valueIsStale) },
            { label: "Unit", value: metric.unit },
            { label: "Reading", value: metric.reading ?? "Unknown" },
            {
              label: "Delta",
              value: metric.delta === null ? "Unknown" : String(metric.delta),
            },
            {
              label: "Direction",
              value: metric.direction ?? "No measured trend",
            },
            { label: "Since", value: metric.since?.toISOString() ?? "Unknown" },
            { label: "Fact paths", value: metric.factPaths.join(", ") },
            { label: "Stored alert", value: metric.alert.standing },
            {
              label: "Alert insight ID",
              value: metric.alert.insightId ?? "None",
            },
          ],
          sourceLink: phaseLink,
        },
        ...alertTitle.map((value, index) => ({
          id: `trend:${metric.key}:alert-title:${index}`,
          label: `Stored alert title ${index + 1} of ${alertTitle.length}`,
          facts: [{ label: "Exact stored text", value }],
          sourceLink: phaseLink,
        })),
        ...metric.points.map((point, index) => ({
          id: `trend:${metric.key}:point:${index}`,
          label: `Stored trend point ${index + 1} of ${metric.points.length}`,
          facts: [
            { label: "When", value: point.at.toISOString() },
            { label: "Value", value: String(point.value) },
          ],
          sourceLink: phaseLink,
        })),
      ];
    }),
    ...timeline.events.flatMap((event) => {
      const label = plantIntelligenceDisplayChunks(event.label);
      const detail = plantIntelligenceDisplayChunks(event.detail);
      const alertTitle = plantIntelligenceDisplayChunks(
        event.alert.insightTitle
      );
      return [
        {
          id: `milestone:${event.id}`,
          label: "Stored milestone",
          facts: [
            { label: "Kind", value: event.kind },
            { label: "When", value: event.at.toISOString() },
            { label: "State", value: event.state },
            { label: "Stored alert", value: event.alert.standing },
            {
              label: "Alert insight ID",
              value: event.alert.insightId ?? "None",
            },
          ],
          sourceLink: phaseLink,
        },
        ...label.map((value, index) => ({
          id: `milestone:${event.id}:label:${index}`,
          label: `Stored label ${index + 1} of ${label.length}`,
          facts: [{ label: "Exact stored text", value }],
          sourceLink: phaseLink,
        })),
        ...detail.map((value, index) => ({
          id: `milestone:${event.id}:detail:${index}`,
          label: `Stored detail ${index + 1} of ${detail.length}`,
          facts: [{ label: "Exact stored text", value }],
          sourceLink: phaseLink,
        })),
        ...alertTitle.map((value, index) => ({
          id: `milestone:${event.id}:alert-title:${index}`,
          label: `Stored alert title ${index + 1} of ${alertTitle.length}`,
          facts: [{ label: "Exact stored text", value }],
          sourceLink: phaseLink,
        })),
      ];
    }),
  ];
  const recordId =
    latest?.assessment.id ?? "00000000-0000-0000-0000-000000000000";
  const fingerprint = sourceFingerprint(allItems);
  if (!cursorMatches(input.cursor, "signals", recordId, fingerprint))
    return changedPageArtifact(
      "Stored and deterministic Plant Intelligence signals",
      "The stored signal page changed; start again"
    );
  const offset = input.cursor?.offset ?? 0;
  const visible = allItems.slice(offset, offset + PAGE_SIZE);
  const remaining = Math.max(0, allItems.length - offset - visible.length);
  const next =
    remaining > 0
      ? {
          kind: "signals" as const,
          recordId,
          offset: offset + visible.length,
          sourceFingerprint: fingerprint,
        }
      : null;
  return buildEvryReadArtifact({
    title: "Stored and deterministic Plant Intelligence signals",
    filters: [
      { label: "Plant", value: "Current plant" },
      {
        label: "Policy",
        value:
          "Stored assessment output and deterministic application projections only",
      },
      ...continuationFilter("show plant intelligence signals", next, remaining),
    ],
    exclusions:
      remaining > 0
        ? [
            {
              reason: "Remaining stored signals available by cursor",
              count: remaining,
            },
          ]
        : [],
    items: visible,
    sourceLinks: [phaseLink],
  });
}

const assessmentInput = {
  assessmentId: z.string().uuid().nullable(),
  cursor: cursorSchema.nullable(),
};

export const PLANT_INTELLIGENCE_READ_REGISTRATIONS = Object.freeze([
  defineEvryReadRegistration({
    id: "plant-intelligence.assessment",
    capabilityIdentity: PLANT_INTELLIGENCE_READ_IDENTITIES.assessments,
    inputShape: assessmentInput,
    run: ({ authorization }, input) =>
      readPlantIntelligenceAssessmentForPlant({
        plantId: authorization.actor.plantId,
        ...input,
      }),
  }),
  defineEvryReadRegistration({
    id: "plant-intelligence.attestations",
    capabilityIdentity: PLANT_INTELLIGENCE_READ_IDENTITIES.attestations,
    inputShape: {},
    run: ({ authorization }) =>
      readPlantIntelligenceAttestationsForPlant(authorization.actor.plantId),
  }),
  defineEvryReadRegistration({
    id: "plant-intelligence.checkins",
    capabilityIdentity: PLANT_INTELLIGENCE_READ_IDENTITIES.checkins,
    inputShape: {},
    run: ({ authorization }) =>
      readPlantIntelligenceCheckinsForPlant(authorization.actor.plantId),
  }),
  defineEvryReadRegistration({
    id: "plant-intelligence.declarations",
    capabilityIdentity: PLANT_INTELLIGENCE_READ_IDENTITIES.declarations,
    inputShape: { cursor: cursorSchema.nullable() },
    run: ({ authorization }, { cursor }) =>
      readPlantIntelligenceDeclarationsForPlant({
        plantId: authorization.actor.plantId,
        cursor,
      }),
  }),
  defineEvryReadRegistration({
    id: "plant-intelligence.feedback",
    capabilityIdentity: PLANT_INTELLIGENCE_READ_IDENTITIES.feedback,
    inputShape: { cursor: cursorSchema.nullable() },
    run: ({ authorization }, { cursor }) =>
      readPlantIntelligenceFeedbackForPlant({
        plantId: authorization.actor.plantId,
        userId: authorization.actor.userId,
        cursor,
      }),
  }),
  defineEvryReadRegistration({
    id: "plant-intelligence.signals",
    capabilityIdentity: PLANT_INTELLIGENCE_READ_IDENTITIES.signals,
    inputShape: { cursor: cursorSchema.nullable() },
    run: ({ authorization }, { cursor }) =>
      readPlantIntelligenceSignalsForPlant({
        plantId: authorization.actor.plantId,
        cursor,
      }),
  }),
]);

export type PlantIntelligenceReadSelection = Readonly<{
  readId: string;
  input: Record<string, unknown>;
}>;

export function selectPlantIntelligenceEvryRead(
  literalUserText: string,
  pageContext: EvryResolvedPageContext | null = null
): PlantIntelligenceReadSelection | null {
  const text = literalUserText.normalize("NFKC").trim();
  const assessmentCursor =
    /^show plant intelligence assessment cursor ([A-Za-z0-9_-]+)$/i.exec(text);
  if (assessmentCursor?.[1]) {
    const cursor = decodeCursor(assessmentCursor[1]);
    return cursor?.kind === "assessment"
      ? {
          readId: "plant-intelligence.assessment",
          input: { assessmentId: cursor.recordId, cursor },
        }
      : null;
  }
  const assessment =
    /^show plant intelligence assessment(?: ([0-9a-f-]{36}))?$/i.exec(text);
  if (assessment) {
    const id = assessment[1]?.toLowerCase() ?? null;
    if (id && !z.string().uuid().safeParse(id).success) return null;
    return {
      readId: "plant-intelligence.assessment",
      input: { assessmentId: id, cursor: null },
    };
  }
  if (
    /^show (?:this|the current) plant intelligence assessment$/i.test(text) &&
    pageContext?.kind === "plant_intelligence"
  )
    return {
      readId: "plant-intelligence.assessment",
      input: { assessmentId: pageContext.recordId, cursor: null },
    };
  const historyCursor =
    /^show plant intelligence phase history cursor ([A-Za-z0-9_-]+)$/i.exec(
      text
    );
  if (historyCursor?.[1]) {
    const cursor = decodeCursor(historyCursor[1]);
    return cursor?.kind === "declarations"
      ? { readId: "plant-intelligence.declarations", input: { cursor } }
      : null;
  }
  if (/^show plant intelligence (?:phase history|declarations)$/i.test(text))
    return {
      readId: "plant-intelligence.declarations",
      input: { cursor: null },
    };
  if (
    /^show plant intelligence (?:signals|trends|timeline|readiness)$/i.test(
      text
    )
  )
    return { readId: "plant-intelligence.signals", input: { cursor: null } };
  if (/^show plant intelligence attestations$/i.test(text))
    return { readId: "plant-intelligence.attestations", input: {} };
  const signalCursor =
    /^show plant intelligence signals cursor ([A-Za-z0-9_-]+)$/i.exec(text);
  if (signalCursor?.[1]) {
    const cursor = decodeCursor(signalCursor[1]);
    return cursor?.kind === "signals"
      ? { readId: "plant-intelligence.signals", input: { cursor } }
      : null;
  }
  const feedbackCursor =
    /^show plant intelligence feedback cursor ([A-Za-z0-9_-]+)$/i.exec(text);
  if (feedbackCursor?.[1]) {
    const cursor = decodeCursor(feedbackCursor[1]);
    return cursor?.kind === "feedback"
      ? { readId: "plant-intelligence.feedback", input: { cursor } }
      : null;
  }
  if (/^show plant intelligence feedback$/i.test(text))
    return { readId: "plant-intelligence.feedback", input: { cursor: null } };
  if (/^show plant intelligence (?:check-ins|checkins)$/i.test(text))
    return { readId: "plant-intelligence.checkins", input: {} };
  return null;
}

export async function executePlantIntelligenceEvryRead(
  selection: PlantIntelligenceReadSelection
) {
  const registration = PLANT_INTELLIGENCE_READ_REGISTRATIONS.find(
    ({ id }) => id === selection.readId
  );
  return registration
    ? registration.execute(
        { literalUserText: "plant intelligence", pageContext: null },
        selection.input
      )
    : null;
}
