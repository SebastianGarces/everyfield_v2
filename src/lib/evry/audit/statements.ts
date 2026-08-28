import { sql, type SQL } from "drizzle-orm";

import type { EvryActionPlanDocument } from "@/lib/evry/plans/schema";

import type { EvryAuditKey } from "./identity";

/** Stored bytes accepted by the issue-only inert execution proof. */
export const EVRY_AUDIT_NOOP_DOCUMENT = Object.freeze({
  version: 1,
  steps: [
    Object.freeze({
      id: "audit_noop",
      capabilityIdentity: "fixture:evry.audit.noop",
      effectClass: "database_write",
      arguments: Object.freeze({}),
      dependsOn: Object.freeze([]),
    }),
  ] as const,
}) satisfies EvryActionPlanDocument;

/**
 * Complete the deliberately effect-free confirmed fixture.
 *
 * The lifecycle CAS is the fixture effect. The attempt and outcome are sourced
 * from its RETURNING row, so an outcome constraint failure rolls the state
 * change back and a racing loser has no row from which to invent evidence.
 */
export function completeConfirmedNoopStatement(input: {
  planId: string;
  actorUserId: string;
  plantId: string;
  fingerprint: string;
  attemptId: string;
  attemptKey: EvryAuditKey;
  outcomeKey: EvryAuditKey;
  attemptOutcomeKey: EvryAuditKey;
  effectKey: EvryAuditKey;
  occurredAt: Date;
}): SQL {
  const terminalOccurredAt = new Date(input.occurredAt.getTime() + 1);
  return sql`
    with eligible as materialized (
      select
        p.id, p.church_id, p.actor_user_id, p.fingerprint,
        c.id as confirmation_id, root.id as proposal_event_id,
        root.correlation_id
      from evry_action_plans p
      join evry_action_plan_states s on s.plan_id = p.id
      join evry_plan_confirmations c
        on c.plan_id = p.id
       and c.church_id = p.church_id
       and c.actor_user_id = p.actor_user_id
       and c.plan_fingerprint = p.fingerprint
      join evry_product_audit_events root
        on root.plan_id = p.id
       and root.church_id = p.church_id
       and root.actor_user_id = p.actor_user_id
       and root.plan_fingerprint = p.fingerprint
       and root.event_type = 'plan_proposed'
      where p.id = ${input.planId}::uuid
        and p.actor_user_id = ${input.actorUserId}::uuid
        and p.church_id = ${input.plantId}::uuid
        and p.fingerprint = ${input.fingerprint}
        and p.document = ${JSON.stringify(EVRY_AUDIT_NOOP_DOCUMENT)}::jsonb
        and p.expires_at > ${input.occurredAt}
        and s.status = 'approved'
    ), completed as (
      update evry_action_plan_states s
      set status = 'completed',
          version = s.version + 1,
          changed_at = ${input.occurredAt}
      from eligible e
      where s.plan_id = e.id
        and s.church_id = e.church_id
        and s.status = 'approved'
      returning
        e.id, e.church_id, e.actor_user_id, e.fingerprint,
        e.confirmation_id, e.proposal_event_id, e.correlation_id
    ), attempted as (
      insert into evry_execution_attempts (
        id, plan_id, church_id, actor_user_id, plan_fingerprint,
        confirmation_id, proposal_event_id, proposal_event_type,
        correlation_id, attempt_key, started_at
      )
      select
        ${input.attemptId}::uuid,
        id, church_id, actor_user_id, fingerprint,
        confirmation_id, proposal_event_id, 'plan_proposed',
        correlation_id, ${input.attemptKey},
        ${input.occurredAt}
      from completed
      returning
        id, plan_id, church_id, actor_user_id, plan_fingerprint,
        correlation_id
    ), recorded_step as (
      insert into evry_execution_outcomes (
        attempt_id, plan_id, church_id, actor_user_id, plan_fingerprint,
        correlation_id, outcome_key, effect_key, subject, step_id,
        capability_identity, status, result_code, affected_count,
        excluded_count, occurred_at
      )
      select
        id, plan_id, church_id, actor_user_id, plan_fingerprint,
        correlation_id, ${input.outcomeKey}, ${input.effectKey},
        'step', 'audit_noop', 'fixture:evry.audit.noop',
        'completed', 'effect_completed', 0, 0,
        ${input.occurredAt}
      from attempted
      returning id, attempt_id
    ), recorded_attempt as (
      insert into evry_execution_outcomes (
        attempt_id, plan_id, church_id, actor_user_id, plan_fingerprint,
        correlation_id, outcome_key, subject, status, result_code,
        affected_count, excluded_count, occurred_at
      )
      select
        a.id, a.plan_id, a.church_id, a.actor_user_id, a.plan_fingerprint,
        a.correlation_id, ${input.attemptOutcomeKey}, 'attempt', 'completed',
        'execution_completed', 0, 0, ${terminalOccurredAt}
      from attempted a
      join recorded_step s on s.attempt_id = a.id
      returning id, attempt_id
    )
    select id, attempt_id from recorded_attempt
  `;
}
