import { and, eq, sql, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import {
  churches,
  insightFeedback,
  planterCheckins,
  plantAssessments,
  plantInsights,
  plantSignals,
  users,
} from "@/db/schema";
import { buildEvryConfirmationArtifact } from "@/lib/evry/artifacts/review";
import {
  assertEvryPlanDocumentReviewable,
  createEvryArtifactReviewRegistry,
  defineEvryArtifactReview,
  trustedReviewForEvryPlanDocument,
} from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import type { EvryConversationPlanTargetValidator } from "@/lib/evry/conversations/plan-resume";
import {
  authorizeEvryEffectCapability,
  eligibleEvryCapabilitiesFor,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  createEvryExecutionCapabilityRegistry,
  defineEvryExecutionCapability,
  type EvryEffectInput,
} from "@/lib/evry/executor";
import { claimEvryDatabaseEffectDecision } from "@/lib/evry/executor/database-effect";
import {
  parseEvryActionPlanCandidate,
  type EvryPlanRequestKey,
} from "@/lib/evry/plans";
import { createEvryActionPlanRecord } from "@/lib/evry/plans/repository";
import { defineEvryPlanCapability } from "@/lib/evry/plans/registry";
import { emitPhaseChanged } from "@/lib/phase-engine/events";
import { MANUAL_SIGNAL_KEYS } from "@/lib/phase-engine/manual-signals";
import {
  CHECKIN_NOTE_MAX,
  weekStartOf,
} from "@/lib/phase-engine/planter-checkin";
import { ACTIVE_RUBRIC } from "@/lib/phase-engine/rubric";
import { buildFactSnapshot } from "@/lib/phase-engine/signals";
import { transitionPhaseSchema } from "@/lib/phase-engine/transitions";

import { PLANT_INTELLIGENCE_EFFECT_IDENTITIES } from "./catalog";

const uuid = z.string().uuid();
const iso = z.string().datetime();
const checkinLevel = z.enum(["steady", "strained", "struggling"]);
const attestationValue = z.union([
  z.boolean(),
  z.number(),
  z.string().max(1000),
]);

export type PlantIntelligenceRefresh = (
  paths: readonly string[]
) => void | Promise<void>;

const productionPlantIntelligenceRefresh: PlantIntelligenceRefresh = (
  paths
) => {
  for (const path of paths) revalidatePath(path);
};

const churchBaselineSchema = z.strictObject({
  currentPhase: z.number().int().min(0).max(6),
});
const assessmentBaselineSchema = z.strictObject({
  id: uuid,
  generatedAt: iso,
  planterSeenAt: z.null(),
});
const signalBaselineSchema = z
  .strictObject({
    id: uuid,
    value: attestationValue,
    attestedById: uuid,
    attestedAt: iso,
    updatedAt: iso,
  })
  .nullable();
const insightBaselineSchema = z.strictObject({
  id: uuid,
  assessmentId: uuid,
  rubricVersion: z.string().min(1).max(50),
  title: z.string().min(1).max(500),
});
const feedbackBaselineSchema = z
  .strictObject({
    id: uuid,
    rating: z.enum(["useful", "not_useful"]),
    comment: z.string().max(2000).nullable(),
    updatedAt: iso,
  })
  .nullable();
const checkinBaselineSchema = z
  .strictObject({
    id: uuid,
    spiritually: checkinLevel,
    marriageFamily: checkinLevel,
    financially: checkinLevel,
    pace: checkinLevel,
    note: z.string().max(CHECKIN_NOTE_MAX).nullable(),
    answeredById: uuid,
    updatedAt: iso,
  })
  .nullable();

export const transitionArgumentsSchema = z.strictObject({
  expected: churchBaselineSchema,
  toPhase: z.number().int().min(0).max(6),
  reason: z.string().trim().min(1).max(2000),
});
export const acknowledgeArgumentsSchema = z.strictObject({
  expected: assessmentBaselineSchema,
});
export const attestationArgumentsSchema = z.strictObject({
  signalKey: z.enum(MANUAL_SIGNAL_KEYS),
  expected: signalBaselineSchema,
  value: attestationValue,
});
export const feedbackArgumentsSchema = z.strictObject({
  insight: insightBaselineSchema,
  expected: feedbackBaselineSchema,
  rating: z.enum(["useful", "not_useful"]),
  comment: z.string().max(2000).nullable(),
});
export const checkinArgumentsSchema = z.strictObject({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expected: checkinBaselineSchema,
  spiritually: checkinLevel,
  marriageFamily: checkinLevel,
  financially: checkinLevel,
  pace: checkinLevel,
  note: z.string().max(CHECKIN_NOTE_MAX).nullable(),
});

const PLAN_BY_IDENTITY = {
  [PLANT_INTELLIGENCE_EFFECT_IDENTITIES.transitionPhase]:
    defineEvryPlanCapability({
      identity: PLANT_INTELLIGENCE_EFFECT_IDENTITIES.transitionPhase,
      effectClass: "database_write",
      arguments: transitionArgumentsSchema.shape,
    }),
  [PLANT_INTELLIGENCE_EFFECT_IDENTITIES.acknowledgeAssessment]:
    defineEvryPlanCapability({
      identity: PLANT_INTELLIGENCE_EFFECT_IDENTITIES.acknowledgeAssessment,
      effectClass: "database_write",
      arguments: acknowledgeArgumentsSchema.shape,
    }),
  [PLANT_INTELLIGENCE_EFFECT_IDENTITIES.setAttestation]:
    defineEvryPlanCapability({
      identity: PLANT_INTELLIGENCE_EFFECT_IDENTITIES.setAttestation,
      effectClass: "database_write",
      arguments: attestationArgumentsSchema.shape,
    }),
  [PLANT_INTELLIGENCE_EFFECT_IDENTITIES.submitFeedback]:
    defineEvryPlanCapability({
      identity: PLANT_INTELLIGENCE_EFFECT_IDENTITIES.submitFeedback,
      effectClass: "database_write",
      arguments: feedbackArgumentsSchema.shape,
    }),
  [PLANT_INTELLIGENCE_EFFECT_IDENTITIES.saveCheckin]: defineEvryPlanCapability({
    identity: PLANT_INTELLIGENCE_EFFECT_IDENTITIES.saveCheckin,
    effectClass: "database_write",
    arguments: checkinArgumentsSchema.shape,
  }),
} as const;

export type PlantIntelligenceEffectSelection =
  | Readonly<{ kind: "transition"; toPhase: number; reason: string }>
  | Readonly<{ kind: "acknowledge"; assessmentId: string | null }>
  | Readonly<{
      kind: "attestation";
      signalKey: z.infer<typeof attestationArgumentsSchema>["signalKey"];
      value: z.infer<typeof attestationValue>;
    }>
  | Readonly<{
      kind: "feedback";
      insightId: string;
      rating: "useful" | "not_useful";
      comment: string | null;
    }>
  | Readonly<{
      kind: "checkin";
      spiritually: z.infer<typeof checkinLevel>;
      marriageFamily: z.infer<typeof checkinLevel>;
      financially: z.infer<typeof checkinLevel>;
      pace: z.infer<typeof checkinLevel>;
      note: string | null;
    }>;

const selectionPayloadSchemas = {
  "declare-phase": z.strictObject({
    toPhase: z.number().int().min(0).max(6),
    reason: z.string().min(1).max(2000),
  }),
  "acknowledge-assessment": z.strictObject({ assessmentId: uuid.nullable() }),
  "set-attestation": z.strictObject({
    signalKey: z.enum(MANUAL_SIGNAL_KEYS),
    value: attestationValue,
  }),
  "submit-feedback": z.strictObject({
    insightId: uuid,
    rating: z.enum(["useful", "not_useful"]),
    comment: z.string().max(2000).nullable(),
  }),
  "save-checkin": z.strictObject({
    spiritually: checkinLevel,
    marriageFamily: checkinLevel,
    financially: checkinLevel,
    pace: checkinLevel,
    note: z.string().max(CHECKIN_NOTE_MAX).nullable(),
  }),
} as const;

/** Closed JSON commands preserve every literal payload code unit. */
export function selectPlantIntelligenceEvryEffect(
  literalUserText: string
): PlantIntelligenceEffectSelection | null {
  const match =
    /^plant intelligence (declare-phase|acknowledge-assessment|set-attestation|submit-feedback|save-checkin)\s+([\s\S]+)$/i.exec(
      literalUserText.trim()
    );
  if (!match?.[1] || !match[2]) return null;
  const command =
    match[1].toLowerCase() as keyof typeof selectionPayloadSchemas;
  let payload: unknown;
  try {
    payload = JSON.parse(match[2]);
  } catch {
    return null;
  }
  const parsed = selectionPayloadSchemas[command].safeParse(payload);
  if (!parsed.success) return null;
  switch (command) {
    case "declare-phase": {
      const value = selectionPayloadSchemas[command].parse(payload);
      const validated = transitionPhaseSchema.safeParse(value);
      return validated.success
        ? { kind: "transition", ...validated.data }
        : null;
    }
    case "acknowledge-assessment": {
      const value = selectionPayloadSchemas[command].parse(payload);
      return { kind: "acknowledge", assessmentId: value.assessmentId };
    }
    case "set-attestation": {
      const value = selectionPayloadSchemas[command].parse(payload);
      return { kind: "attestation", ...value };
    }
    case "submit-feedback": {
      const value = selectionPayloadSchemas[command].parse(payload);
      return { kind: "feedback", ...value };
    }
    case "save-checkin": {
      const value = selectionPayloadSchemas[command].parse(payload);
      return { kind: "checkin", ...value };
    }
  }
}

function identityFor(selection: PlantIntelligenceEffectSelection) {
  switch (selection.kind) {
    case "transition":
      return PLANT_INTELLIGENCE_EFFECT_IDENTITIES.transitionPhase;
    case "acknowledge":
      return PLANT_INTELLIGENCE_EFFECT_IDENTITIES.acknowledgeAssessment;
    case "attestation":
      return PLANT_INTELLIGENCE_EFFECT_IDENTITIES.setAttestation;
    case "feedback":
      return PLANT_INTELLIGENCE_EFFECT_IDENTITIES.submitFeedback;
    case "checkin":
      return PLANT_INTELLIGENCE_EFFECT_IDENTITIES.saveCheckin;
  }
}

export const plantIntelligenceEffectIdentityFor = identityFor;

async function exactActor(actor: EvryPlantActor, identity: string) {
  const authorization = await authorizeEvryEffectCapability(identity);
  return authorization &&
    authorization.actor.userId === actor.userId &&
    authorization.actor.plantId === actor.plantId
    ? authorization
    : null;
}

function signalSnapshot(row: typeof plantSignals.$inferSelect | undefined) {
  return row
    ? signalBaselineSchema.parse({
        id: row.id,
        value: row.value,
        attestedById: row.attestedById,
        attestedAt: row.attestedAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })
    : null;
}

function feedbackSnapshot(
  row: typeof insightFeedback.$inferSelect | undefined
) {
  return row
    ? feedbackBaselineSchema.parse({
        id: row.id,
        rating: row.rating,
        comment: row.comment,
        updatedAt: row.updatedAt.toISOString(),
      })
    : null;
}

function checkinSnapshot(row: typeof planterCheckins.$inferSelect | undefined) {
  return row
    ? checkinBaselineSchema.parse({
        id: row.id,
        spiritually: row.spiritually,
        marriageFamily: row.marriageFamily,
        financially: row.financially,
        pace: row.pace,
        note: row.note,
        answeredById: row.answeredById,
        updatedAt: row.updatedAt.toISOString(),
      })
    : null;
}

export async function resolvePlantIntelligenceEffectArguments(
  actor: EvryPlantActor,
  selection: PlantIntelligenceEffectSelection,
  contextAssessmentId: string | null = null
) {
  switch (selection.kind) {
    case "transition": {
      const [church] = await db
        .select({ currentPhase: churches.currentPhase })
        .from(churches)
        .where(eq(churches.id, actor.plantId))
        .limit(1);
      return church
        ? transitionArgumentsSchema.parse({
            expected: church,
            toPhase: selection.toPhase,
            reason: selection.reason,
          })
        : null;
    }
    case "acknowledge": {
      const assessmentId = selection.assessmentId ?? contextAssessmentId;
      if (!assessmentId) return null;
      const [row] = await db
        .select({
          id: plantAssessments.id,
          generatedAt: plantAssessments.generatedAt,
          planterSeenAt: plantAssessments.planterSeenAt,
        })
        .from(plantAssessments)
        .where(
          and(
            eq(plantAssessments.id, assessmentId),
            eq(plantAssessments.churchId, actor.plantId),
            eq(plantAssessments.status, "complete")
          )
        )
        .limit(1);
      return row?.planterSeenAt === null
        ? acknowledgeArgumentsSchema.parse({
            expected: {
              id: row.id,
              generatedAt: row.generatedAt.toISOString(),
              planterSeenAt: null,
            },
          })
        : null;
    }
    case "attestation": {
      const [row] = await db
        .select()
        .from(plantSignals)
        .where(
          and(
            eq(plantSignals.churchId, actor.plantId),
            eq(plantSignals.signalKey, selection.signalKey)
          )
        )
        .limit(1);
      return attestationArgumentsSchema.parse({
        signalKey: selection.signalKey,
        expected: signalSnapshot(row),
        value: selection.value,
      });
    }
    case "feedback": {
      // Match the owning action/service: feedback comments are trimmed and a
      // whitespace-only comment is stored as null.
      const comment = selection.comment?.trim() || null;
      const [target] = await db
        .select({
          id: plantInsights.id,
          assessmentId: plantInsights.assessmentId,
          rubricVersion: plantAssessments.rubricVersion,
          title: plantInsights.title,
        })
        .from(plantInsights)
        .innerJoin(
          plantAssessments,
          eq(plantAssessments.id, plantInsights.assessmentId)
        )
        .where(
          and(
            eq(plantInsights.id, selection.insightId),
            eq(plantInsights.churchId, actor.plantId),
            eq(plantInsights.audience, "planter"),
            eq(plantAssessments.status, "complete")
          )
        )
        .limit(1);
      if (!target) return null;
      const [existing] = await db
        .select()
        .from(insightFeedback)
        .where(
          and(
            eq(insightFeedback.insightId, selection.insightId),
            eq(insightFeedback.userId, actor.userId),
            eq(insightFeedback.churchId, actor.plantId)
          )
        )
        .limit(1);
      return feedbackArgumentsSchema.parse({
        insight: target,
        expected: feedbackSnapshot(existing),
        rating: selection.rating,
        comment,
      });
    }
    case "checkin": {
      const weekStart = weekStartOf(new Date());
      const [existing] = await db
        .select()
        .from(planterCheckins)
        .where(
          and(
            eq(planterCheckins.churchId, actor.plantId),
            eq(planterCheckins.weekStart, weekStart)
          )
        )
        .limit(1);
      const target = {
        weekStart,
        expected: checkinSnapshot(existing),
        spiritually: selection.spiritually,
        marriageFamily: selection.marriageFamily,
        financially: selection.financially,
        pace: selection.pace,
        note: selection.note,
      };
      return checkinArgumentsSchema.parse(target);
    }
  }
}

function baselinePredicate(
  tableName: "plant_signals" | "insight_feedback" | "planter_checkins",
  expected: { id: string; updatedAt: string } | null,
  scope: SQL
): SQL {
  return expected
    ? sql`exists (
        select 1 from ${sql.identifier(tableName)} current
        where ${scope}
          and current.id = ${expected.id}::uuid
          and date_trunc('milliseconds', current.updated_at) = ${expected.updatedAt}::timestamp
      )`
    : sql`not exists (
        select 1 from ${sql.identifier(tableName)} current where ${scope}
      )`;
}

async function seatIsCurrent(
  plantId: string,
  actorUserId: string,
  allowed: readonly ("owner" | "admin" | "member")[]
) {
  const [actor] = await db
    .select({ seat: users.seat })
    .from(users)
    .where(and(eq(users.id, actorUserId), eq(users.churchId, plantId)))
    .limit(1);
  return actor?.seat !== null && allowed.includes(actor!.seat);
}

async function transitionIsCurrent(plantId: string, value: unknown) {
  const parsed = transitionArgumentsSchema.safeParse(value);
  if (!parsed.success) return false;
  const [row] = await db
    .select({ currentPhase: churches.currentPhase })
    .from(churches)
    .where(eq(churches.id, plantId))
    .limit(1);
  return row?.currentPhase === parsed.data.expected.currentPhase;
}

async function acknowledgeIsCurrent(plantId: string, value: unknown) {
  const parsed = acknowledgeArgumentsSchema.safeParse(value);
  if (!parsed.success) return false;
  const [row] = await db
    .select({
      generatedAt: plantAssessments.generatedAt,
      planterSeenAt: plantAssessments.planterSeenAt,
    })
    .from(plantAssessments)
    .where(
      and(
        eq(plantAssessments.id, parsed.data.expected.id),
        eq(plantAssessments.churchId, plantId),
        eq(plantAssessments.status, "complete")
      )
    )
    .limit(1);
  return (
    row?.planterSeenAt === null &&
    row.generatedAt.toISOString() === parsed.data.expected.generatedAt
  );
}

async function attestationIsCurrent(plantId: string, value: unknown) {
  const parsed = attestationArgumentsSchema.safeParse(value);
  if (!parsed.success) return false;
  const [row] = await db
    .select()
    .from(plantSignals)
    .where(
      and(
        eq(plantSignals.churchId, plantId),
        eq(plantSignals.signalKey, parsed.data.signalKey)
      )
    )
    .limit(1);
  return (
    JSON.stringify(signalSnapshot(row)) === JSON.stringify(parsed.data.expected)
  );
}

async function feedbackIsCurrent(
  plantId: string,
  actorUserId: string,
  value: unknown
) {
  const parsed = feedbackArgumentsSchema.safeParse(value);
  if (!parsed.success) return false;
  const [target] = await db
    .select({
      id: plantInsights.id,
      assessmentId: plantInsights.assessmentId,
      rubricVersion: plantAssessments.rubricVersion,
      title: plantInsights.title,
    })
    .from(plantInsights)
    .innerJoin(
      plantAssessments,
      eq(plantAssessments.id, plantInsights.assessmentId)
    )
    .where(
      and(
        eq(plantInsights.id, parsed.data.insight.id),
        eq(plantInsights.churchId, plantId),
        eq(plantInsights.audience, "planter"),
        eq(plantAssessments.status, "complete")
      )
    )
    .limit(1);
  const [row] = await db
    .select()
    .from(insightFeedback)
    .where(
      and(
        eq(insightFeedback.insightId, parsed.data.insight.id),
        eq(insightFeedback.userId, actorUserId),
        eq(insightFeedback.churchId, plantId)
      )
    )
    .limit(1);
  return (
    JSON.stringify(target ?? null) === JSON.stringify(parsed.data.insight) &&
    JSON.stringify(feedbackSnapshot(row)) ===
      JSON.stringify(parsed.data.expected)
  );
}

async function checkinIsCurrent(plantId: string, value: unknown) {
  const parsed = checkinArgumentsSchema.safeParse(value);
  if (!parsed.success || parsed.data.weekStart !== weekStartOf(new Date()))
    return false;
  const [row] = await db
    .select()
    .from(planterCheckins)
    .where(
      and(
        eq(planterCheckins.churchId, plantId),
        eq(planterCheckins.weekStart, parsed.data.weekStart)
      )
    )
    .limit(1);
  return (
    JSON.stringify(checkinSnapshot(row)) ===
    JSON.stringify(parsed.data.expected)
  );
}

async function refreshClaimed(
  claim: Awaited<ReturnType<typeof claimEvryDatabaseEffectDecision>>,
  refresh: PlantIntelligenceRefresh,
  paths: readonly string[]
) {
  if (claim.disposition === "claimed") await refresh(paths);
  return claim.result;
}

async function executeTransition(
  input: EvryEffectInput,
  refresh: PlantIntelligenceRefresh
) {
  const parsed = transitionArgumentsSchema.safeParse(input.arguments);
  if (!parsed.success) return { status: "refused" as const, excludedCount: 1 };
  const args = parsed.data;
  const claim = await claimEvryDatabaseEffectDecision({
    execution: input.execution,
    effectKey: input.effectKey,
    mutationCtes: async () => {
      const factSnapshot = await buildFactSnapshot(input.execution.plantId);
      return sql`
        moved as (
          update churches c set current_phase = ${args.toPhase}
          from eligible e
          join users u on u.id = e.actor_user_id
            and u.church_id = e.church_id and u.seat = 'owner'
          where c.id = e.church_id
            and c.current_phase = ${args.expected.currentPhase}
          returning c.id, u.id as initiated_by_id
        ), transitioned as (
          insert into phase_transitions (
            church_id, from_phase, to_phase, initiated_by_id, reason, kind,
            fact_snapshot, rubric_version
          )
          select m.id, ${args.expected.currentPhase}, ${args.toPhase},
                 m.initiated_by_id, ${args.reason},
                 'transition', ${JSON.stringify(factSnapshot)}::jsonb,
                 ${ACTIVE_RUBRIC.version}
          from moved m
          returning id
        )`;
    },
    mutation: sql`
      select 1::integer as affected_count, 0::integer as excluded_count
      from transitioned cross join moved`,
    targetIsCurrent: async () =>
      (await seatIsCurrent(
        input.execution.plantId,
        input.execution.actorUserId,
        ["owner"]
      )) && transitionIsCurrent(input.execution.plantId, args),
  });
  if (claim.disposition === "claimed") {
    await emitPhaseChanged({
      churchId: input.execution.plantId,
      fromPhase: args.expected.currentPhase,
      toPhase: args.toPhase,
      initiatedById: input.execution.actorUserId,
      rubricVersion: ACTIVE_RUBRIC.version,
    });
  }
  return refreshClaimed(claim, refresh, ["/phase", "/dashboard"]);
}

async function executeAcknowledge(
  input: EvryEffectInput,
  refresh: PlantIntelligenceRefresh
) {
  const parsed = acknowledgeArgumentsSchema.safeParse(input.arguments);
  if (!parsed.success) return { status: "refused" as const, excludedCount: 1 };
  const expected = parsed.data.expected;
  const claim = await claimEvryDatabaseEffectDecision({
    execution: input.execution,
    effectKey: input.effectKey,
    mutationCtes: sql`
      written as (
        update plant_assessments a
        set planter_seen_at = transaction_timestamp()
        from eligible e
        join users u on u.id = e.actor_user_id
          and u.church_id = e.church_id and u.seat = 'owner'
        where a.id = ${expected.id}::uuid
          and a.church_id = e.church_id
          and a.status = 'complete'
          and date_trunc('milliseconds', a.generated_at) = ${expected.generatedAt}::timestamp
          and a.planter_seen_at is null
        returning a.id
      )`,
    mutation: sql`
      select 1::integer as affected_count, 0::integer as excluded_count from written`,
    targetIsCurrent: async () =>
      (await seatIsCurrent(
        input.execution.plantId,
        input.execution.actorUserId,
        ["owner"]
      )) && acknowledgeIsCurrent(input.execution.plantId, expected),
  });
  return refreshClaimed(claim, refresh, ["/phase"]);
}

async function executeAttestation(
  input: EvryEffectInput,
  refresh: PlantIntelligenceRefresh
) {
  const parsed = attestationArgumentsSchema.safeParse(input.arguments);
  if (!parsed.success) return { status: "refused" as const, excludedCount: 1 };
  const args = parsed.data;
  const scope = sql`current.church_id = ${input.execution.plantId}::uuid
    and current.signal_key = ${args.signalKey}`;
  const claim = await claimEvryDatabaseEffectDecision({
    execution: input.execution,
    effectKey: input.effectKey,
    mutationCtes: sql`
      written as (
        insert into plant_signals (
          church_id, signal_key, value, attested_by_id, attested_at,
          created_at, updated_at
        )
        select e.church_id, ${args.signalKey}, ${JSON.stringify(args.value)}::jsonb,
               u.id, transaction_timestamp(), transaction_timestamp(),
               transaction_timestamp()
        from eligible e
        join users u on u.id = e.actor_user_id
          and u.church_id = e.church_id and u.seat in ('owner', 'admin')
        where ${baselinePredicate("plant_signals", args.expected, scope)}
        on conflict (church_id, signal_key) do update
        set value = excluded.value,
            attested_by_id = excluded.attested_by_id,
            attested_at = excluded.attested_at,
            updated_at = excluded.updated_at
        where ${
          args.expected
            ? sql`plant_signals.id = ${args.expected.id}::uuid
                and date_trunc('milliseconds', plant_signals.updated_at) = ${args.expected.updatedAt}::timestamp`
            : sql`false`
        }
        returning id
      ), dirtied as (
        update churches c
        set last_material_event_at = transaction_timestamp(),
            updated_at = transaction_timestamp()
        from written w
        where c.id = ${input.execution.plantId}::uuid
        returning c.id
      )`,
    mutation: sql`
      select 1::integer as affected_count, 0::integer as excluded_count
      from written cross join dirtied`,
    targetIsCurrent: async () =>
      (await seatIsCurrent(
        input.execution.plantId,
        input.execution.actorUserId,
        ["owner", "admin"]
      )) && attestationIsCurrent(input.execution.plantId, args),
  });
  return refreshClaimed(claim, refresh, ["/phase"]);
}

async function executeFeedback(
  input: EvryEffectInput,
  refresh: PlantIntelligenceRefresh
) {
  const parsed = feedbackArgumentsSchema.safeParse(input.arguments);
  if (!parsed.success) return { status: "refused" as const, excludedCount: 1 };
  const args = parsed.data;
  const scope = sql`current.church_id = ${input.execution.plantId}::uuid
    and current.user_id = ${input.execution.actorUserId}::uuid
    and current.insight_id = ${args.insight.id}::uuid`;
  const claim = await claimEvryDatabaseEffectDecision({
    execution: input.execution,
    effectKey: input.effectKey,
    mutationCtes: sql`
      written as (
        insert into insight_feedback (
          insight_id, assessment_id, church_id, user_id, rubric_version,
          rating, comment, created_at, updated_at
        )
        select i.id, i.assessment_id, e.church_id, u.id,
               a.rubric_version, ${args.rating}, ${args.comment},
               transaction_timestamp(), transaction_timestamp()
        from eligible e
        join users u on u.id = e.actor_user_id
          and u.church_id = e.church_id and u.seat is not null
        join plant_insights i on i.id = ${args.insight.id}::uuid
          and i.church_id = e.church_id and i.audience = 'planter'
          and i.assessment_id = ${args.insight.assessmentId}::uuid
          and i.title = ${args.insight.title}
        join plant_assessments a on a.id = i.assessment_id
          and a.status = 'complete'
          and a.rubric_version = ${args.insight.rubricVersion}
        where ${baselinePredicate("insight_feedback", args.expected, scope)}
        on conflict (insight_id, user_id) do update
        set assessment_id = excluded.assessment_id,
            rubric_version = excluded.rubric_version,
            rating = excluded.rating,
            comment = excluded.comment,
            updated_at = excluded.updated_at
        where ${
          args.expected
            ? sql`insight_feedback.id = ${args.expected.id}::uuid
                and date_trunc('milliseconds', insight_feedback.updated_at) = ${args.expected.updatedAt}::timestamp`
            : sql`false`
        }
        returning id
      )`,
    mutation: sql`
      select 1::integer as affected_count, 0::integer as excluded_count from written`,
    targetIsCurrent: async () =>
      (await seatIsCurrent(
        input.execution.plantId,
        input.execution.actorUserId,
        ["owner", "admin", "member"]
      )) &&
      feedbackIsCurrent(
        input.execution.plantId,
        input.execution.actorUserId,
        args
      ),
  });
  return refreshClaimed(claim, refresh, ["/phase"]);
}

async function executeCheckin(
  input: EvryEffectInput,
  refresh: PlantIntelligenceRefresh
) {
  const parsed = checkinArgumentsSchema.safeParse(input.arguments);
  if (!parsed.success || parsed.data.weekStart !== weekStartOf(new Date()))
    return { status: "refused" as const, excludedCount: 1 };
  const args = parsed.data;
  const scope = sql`current.church_id = ${input.execution.plantId}::uuid
    and current.week_start = ${args.weekStart}::timestamp`;
  const claim = await claimEvryDatabaseEffectDecision({
    execution: input.execution,
    effectKey: input.effectKey,
    mutationCtes: sql`
      written as (
        insert into planter_checkins (
          church_id, week_start, spiritually, marriage_family, financially,
          pace, note, answered_by_id, created_at, updated_at
        )
        select e.church_id, ${args.weekStart}::timestamp, ${args.spiritually},
               ${args.marriageFamily}, ${args.financially}, ${args.pace},
               ${args.note}, u.id, transaction_timestamp(), transaction_timestamp()
        from eligible e
        join users u on u.id = e.actor_user_id
          and u.church_id = e.church_id and u.seat in ('owner', 'admin')
        where ${baselinePredicate("planter_checkins", args.expected, scope)}
        on conflict (church_id, week_start) do update
        set spiritually = excluded.spiritually,
            marriage_family = excluded.marriage_family,
            financially = excluded.financially,
            pace = excluded.pace,
            note = excluded.note,
            answered_by_id = excluded.answered_by_id,
            updated_at = excluded.updated_at
        where ${
          args.expected
            ? sql`planter_checkins.id = ${args.expected.id}::uuid
                and date_trunc('milliseconds', planter_checkins.updated_at) = ${args.expected.updatedAt}::timestamp`
            : sql`false`
        }
        returning id
      )`,
    mutation: sql`
      select 1::integer as affected_count, 0::integer as excluded_count from written`,
    targetIsCurrent: async () =>
      (await seatIsCurrent(
        input.execution.plantId,
        input.execution.actorUserId,
        ["owner", "admin"]
      )) && checkinIsCurrent(input.execution.plantId, args),
  });
  return refreshClaimed(claim, refresh, ["/phase"]);
}

export function createPlantIntelligenceExecutions(
  refresh: PlantIntelligenceRefresh = productionPlantIntelligenceRefresh
) {
  const executeByIdentity = {
    [PLANT_INTELLIGENCE_EFFECT_IDENTITIES.transitionPhase]: (input) =>
      executeTransition(input, refresh),
    [PLANT_INTELLIGENCE_EFFECT_IDENTITIES.acknowledgeAssessment]: (input) =>
      executeAcknowledge(input, refresh),
    [PLANT_INTELLIGENCE_EFFECT_IDENTITIES.setAttestation]: (input) =>
      executeAttestation(input, refresh),
    [PLANT_INTELLIGENCE_EFFECT_IDENTITIES.submitFeedback]: (input) =>
      executeFeedback(input, refresh),
    [PLANT_INTELLIGENCE_EFFECT_IDENTITIES.saveCheckin]: (input) =>
      executeCheckin(input, refresh),
  } satisfies Record<
    keyof typeof PLAN_BY_IDENTITY,
    (input: EvryEffectInput) => Promise<unknown>
  >;

  return Object.freeze(
    Object.entries(PLAN_BY_IDENTITY).map(([identity, planCapability]) =>
      defineEvryExecutionCapability({
        planCapability,
        executeIfCurrent:
          executeByIdentity[identity as keyof typeof executeByIdentity],
      })
    )
  );
}

export const PLANT_INTELLIGENCE_EXECUTIONS =
  createPlantIntelligenceExecutions();

export const PLANT_INTELLIGENCE_EXECUTION_REGISTRY =
  createEvryExecutionCapabilityRegistry(PLANT_INTELLIGENCE_EXECUTIONS);
export const PLANT_INTELLIGENCE_PLAN_REGISTRY =
  PLANT_INTELLIGENCE_EXECUTION_REGISTRY.planRegistry;

function reviewedStep(input: {
  stepId: string;
  title: string;
  target: string;
  before: string;
  after: string;
  preview?: string | null;
  difficult?: boolean;
}) {
  return {
    stepId: input.stepId,
    title: input.title,
    effectKind: "other" as const,
    reversibility: input.difficult
      ? ("difficult_to_reverse" as const)
      : ("reversible" as const),
    resolvedTargets: [
      {
        label: "Current plant",
        value: input.target,
        sourceLink: { label: "Open Plant Intelligence", href: "/phase" },
      },
    ],
    counts: [{ label: "Records", count: 1 }],
    exclusions: [],
    dateTime: null,
    contentPreviews: input.preview
      ? [{ label: "Exact content", content: input.preview }]
      : [],
    beforeAfter: [
      {
        label: input.title,
        before: input.before,
        after: input.after,
        count: 1,
      },
    ],
  };
}

export const PLANT_INTELLIGENCE_REVIEWS = Object.freeze([
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [
        PLANT_INTELLIGENCE_EFFECT_IDENTITIES.transitionPhase,
      ],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const args = transitionArgumentsSchema.parse(step.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Change the plant phase to ${args.toPhase}`,
        actionLabel: "Change phase",
        consequences: [
          "This writes an immutable phase-history row, changes the plant's current phase, and emits the canonical phase-changed event. Readiness remains advisory.",
        ],
        steps: [
          reviewedStep({
            stepId: step.id,
            title: "Phase transition",
            target: `Phase ${args.toPhase}`,
            before: `Phase ${args.expected.currentPhase}`,
            after: `Phase ${args.toPhase}`,
            preview: args.reason,
            difficult: true,
          }),
        ],
      });
    },
  }),
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [
        PLANT_INTELLIGENCE_EFFECT_IDENTITIES.acknowledgeAssessment,
      ],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const args = acknowledgeArgumentsSchema.parse(step.arguments);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: "Acknowledge this stored assessment",
        actionLabel: "Acknowledge assessment",
        consequences: [
          "This records the first planter view and releases this stored assessment to eligible oversight reads. It does not create or change a judgment.",
        ],
        steps: [
          reviewedStep({
            stepId: step.id,
            title: "Assessment first view",
            target: `${args.expected.id} · generated ${args.expected.generatedAt}`,
            before: "Not acknowledged",
            after: "Acknowledged and eligible for oversight release",
            difficult: true,
          }),
        ],
      });
    },
  }),
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [
        PLANT_INTELLIGENCE_EFFECT_IDENTITIES.setAttestation,
      ],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const args = attestationArgumentsSchema.parse(step.arguments);
      const before = args.expected
        ? JSON.stringify(args.expected.value)
        : "Not attested";
      const after = JSON.stringify(args.value);
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: "Save a manual attestation",
        actionLabel: "Save attestation",
        consequences: [
          "This stores the attestation with actor and time, then marks the plant for a future assessment. It does not run an assessment now.",
        ],
        steps: [
          reviewedStep({
            stepId: step.id,
            title: "Manual attestation",
            target: args.signalKey,
            before,
            after,
            preview: typeof args.value === "string" ? args.value : null,
          }),
        ],
      });
    },
  }),
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [
        PLANT_INTELLIGENCE_EFFECT_IDENTITIES.submitFeedback,
      ],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const args = feedbackArgumentsSchema.parse(step.arguments);
      const before = args.expected
        ? `${args.expected.rating}; comment ${JSON.stringify(args.expected.comment)}`
        : "No feedback";
      const after = `${args.rating}; comment ${JSON.stringify(args.comment)}`;
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: "Save feedback on a stored insight",
        actionLabel: "Save feedback",
        consequences: [
          "This updates only your feedback on the named stored insight and preserves the assessment and insight unchanged.",
        ],
        steps: [
          reviewedStep({
            stepId: step.id,
            title: "Insight feedback",
            target: `${args.insight.title} (${args.insight.id}; assessment ${args.insight.assessmentId}; rubric ${args.insight.rubricVersion})`,
            before,
            after,
            preview: args.comment,
          }),
        ],
      });
    },
  }),
  defineEvryArtifactReview({
    source: {
      kind: "generic",
      capabilityIdentities: [PLANT_INTELLIGENCE_EFFECT_IDENTITIES.saveCheckin],
    },
    build({ plan, document }) {
      const step = document.steps[0]!;
      const args = checkinArgumentsSchema.parse(step.arguments);
      const after = `${args.spiritually} / ${args.marriageFamily} / ${args.financially} / ${args.pace}; note ${JSON.stringify(args.note)}`;
      return buildEvryConfirmationArtifact({
        kind: "confirmation",
        artifactVersion: 1,
        plan,
        title: `Save the private check-in for ${args.weekStart}`,
        actionLabel: "Save private check-in",
        consequences: [
          "This stores the private weekly check-in. It never feeds an assessment, signal, judgment, or oversight read.",
        ],
        steps: [
          reviewedStep({
            stepId: step.id,
            title: "Private weekly check-in",
            target: args.weekStart,
            before: args.expected
              ? `${args.expected.spiritually} / ${args.expected.marriageFamily} / ${args.expected.financially} / ${args.expected.pace}; note ${JSON.stringify(args.expected.note)}`
              : "Not answered",
            after,
            preview: args.note,
          }),
        ],
      });
    },
  }),
]);

export const PLANT_INTELLIGENCE_REVIEW_REGISTRY =
  createEvryArtifactReviewRegistry(PLANT_INTELLIGENCE_REVIEWS);

export async function proposePlantIntelligenceEvryEffect(input: {
  actor: EvryPlantActor;
  selection: PlantIntelligenceEffectSelection;
  requestKey: EvryPlanRequestKey;
  contextAssessmentId?: string | null;
}) {
  const identity = identityFor(input.selection);
  const authorization = await exactActor(input.actor, identity);
  if (!authorization) return { kind: "refusal" as const };
  const args = await resolvePlantIntelligenceEffectArguments(
    authorization.actor,
    input.selection,
    input.contextAssessmentId ?? null
  );
  if (!args) return { kind: "refusal" as const };
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: identity,
          capabilityIdentity: identity,
          arguments: args,
          dependsOn: [],
        },
      ],
    },
    registry: PLANT_INTELLIGENCE_PLAN_REGISTRY,
    eligibleCapabilities: eligibleEvryCapabilitiesFor(authorization.actor),
  });
  assertEvryPlanDocumentReviewable({
    document,
    reviewRegistry: PLANT_INTELLIGENCE_REVIEW_REGISTRY,
  });
  const stored = await createEvryActionPlanRecord({
    actorUserId: authorization.actor.userId,
    plantId: authorization.actor.plantId,
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
    reviewRegistry: PLANT_INTELLIGENCE_REVIEW_REGISTRY,
  });
  if (!review) throw new Error("Plant Intelligence plan has no trusted review");
  return { kind: "plan" as const, plan, confirmation: review.confirmation };
}

export const plantIntelligenceEvryPlanTargetIsCurrent: EvryConversationPlanTargetValidator =
  async ({ actor, step }) => {
    switch (step.capabilityIdentity) {
      case PLANT_INTELLIGENCE_EFFECT_IDENTITIES.transitionPhase:
        return transitionIsCurrent(actor.plantId, step.arguments);
      case PLANT_INTELLIGENCE_EFFECT_IDENTITIES.acknowledgeAssessment:
        return acknowledgeIsCurrent(actor.plantId, step.arguments);
      case PLANT_INTELLIGENCE_EFFECT_IDENTITIES.setAttestation:
        return attestationIsCurrent(actor.plantId, step.arguments);
      case PLANT_INTELLIGENCE_EFFECT_IDENTITIES.submitFeedback:
        return feedbackIsCurrent(actor.plantId, actor.userId, step.arguments);
      case PLANT_INTELLIGENCE_EFFECT_IDENTITIES.saveCheckin:
        return checkinIsCurrent(actor.plantId, step.arguments);
      default:
        return false;
    }
  };
