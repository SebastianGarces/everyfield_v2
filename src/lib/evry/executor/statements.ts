import { sql, type SQL } from "drizzle-orm";

import type { EvryAuditKey } from "@/lib/evry/audit/identity";

/**
 * Claim or resume the one attempt for an exact, confirmed, unexpired plan.
 * The state transition and attempt insert share one data-modifying CTE.
 */
export function startEvryExecutionStatement(input: {
  attemptId: string;
  attemptKey: EvryAuditKey;
  planId: string;
  actorUserId: string;
  plantId: string;
  fingerprint: string;
  startedAt: Date;
}): SQL {
  return sql`
    with eligible as materialized (
      select
        p.id, p.church_id, p.actor_user_id, p.fingerprint,
        c.id as confirmation_id, root.id as proposal_event_id,
        root.correlation_id
      from evry_action_plans p
      join evry_action_plan_states s
        on s.plan_id = p.id and s.church_id = p.church_id
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
        and p.expires_at > ${input.startedAt}
        and s.status = 'approved'
    ), transitioned as (
      update evry_action_plan_states s
      set status = 'executing',
          version = s.version + 1,
          changed_at = ${input.startedAt}
      from eligible e
      where s.plan_id = e.id
        and s.church_id = e.church_id
        and s.status = 'approved'
      returning s.plan_id
    ), attempted as (
      insert into evry_execution_attempts (
        id, plan_id, church_id, actor_user_id, plan_fingerprint,
        confirmation_id, proposal_event_id, proposal_event_type,
        correlation_id, attempt_key, started_at
      )
      select
        ${input.attemptId}::uuid, e.id, e.church_id, e.actor_user_id,
        e.fingerprint, e.confirmation_id, e.proposal_event_id,
        'plan_proposed', e.correlation_id, ${input.attemptKey},
        ${input.startedAt}
      from eligible e
      join transitioned t on t.plan_id = e.id
      on conflict (church_id, attempt_key) do nothing
      returning id
    )
    select id from attempted
  `;
}

/** Finish once, deriving the plan transition only from the winning insert. */
export function finishEvryExecutionStatement(input: {
  attemptId: string;
  planId: string;
  actorUserId: string;
  plantId: string;
  fingerprint: string;
  outcomeKey: EvryAuditKey;
  attemptStatus: "completed" | "partially_failed" | "failed" | "refused";
  planStatus: "completed" | "partially_failed" | "failed";
  occurredAt: Date;
}): SQL {
  return sql`
    with recorded as (
      insert into evry_execution_outcomes (
        attempt_id, plan_id, church_id, actor_user_id, plan_fingerprint,
        correlation_id, outcome_key, subject, status, result_code,
        affected_count, excluded_count, occurred_at
      )
      select
        a.id, a.plan_id, a.church_id, a.actor_user_id, a.plan_fingerprint,
        a.correlation_id, ${input.outcomeKey}, 'attempt',
        ${input.attemptStatus},
        case
          when ${input.attemptStatus} = 'completed' then 'execution_completed'
          when ${input.attemptStatus} = 'refused' then 'precondition_refused'
          else 'effect_failed'
        end,
        0, 0, ${input.occurredAt}
      from evry_execution_attempts a
      where a.id = ${input.attemptId}::uuid
        and a.plan_id = ${input.planId}::uuid
        and a.actor_user_id = ${input.actorUserId}::uuid
        and a.church_id = ${input.plantId}::uuid
        and a.plan_fingerprint = ${input.fingerprint}
      on conflict do nothing
      returning plan_id, church_id
    ), transitioned as (
      update evry_action_plan_states s
      set status = ${input.planStatus},
          version = s.version + 1,
          changed_at = ${input.occurredAt}
      from recorded r
      where s.plan_id = r.plan_id
        and s.church_id = r.church_id
        and s.status = 'executing'
      returning s.plan_id
    )
    select plan_id from transitioned
  `;
}
