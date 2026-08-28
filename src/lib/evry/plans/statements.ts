import { sql, type SQL } from "drizzle-orm";

import type { EvryPlanRequestKey } from "./request-key";
import type { EvryActionPlanDocument } from "./schema";

/** Exact-scope approval/expiry CAS plus immutable confirmation insert. */
export function confirmEvryActionPlanStatement(input: {
  planId: string;
  actorUserId: string;
  plantId: string;
  fingerprint: string;
  decidedAt: Date;
  approvedEventKey: string;
  expiredEventKey: string;
}): SQL {
  return sql`
    with transitioned as (
      update evry_action_plan_states s
      set status = case
            when p.expires_at <= ${input.decidedAt} then 'expired'
            else 'approved'
          end,
          version = s.version + 1,
          changed_at = ${input.decidedAt}
      from evry_action_plans p,
           evry_product_audit_events root
      where s.plan_id = p.id
        and p.id = ${input.planId}::uuid
        and p.actor_user_id = ${input.actorUserId}::uuid
        and p.church_id = ${input.plantId}::uuid
        and p.fingerprint = ${input.fingerprint}
        and root.plan_id = p.id
        and root.church_id = p.church_id
        and root.actor_user_id = p.actor_user_id
        and root.plan_fingerprint = p.fingerprint
        and root.event_type = 'plan_proposed'
        and (
          s.status = 'awaiting_confirmation'
          or (
            s.status = 'approved'
            and p.expires_at <= ${input.decidedAt}
          )
        )
      returning p.id, p.church_id, p.actor_user_id, p.fingerprint,
        root.correlation_id, s.status
    ), confirmed as (
      insert into evry_plan_confirmations (
        plan_id, church_id, actor_user_id, plan_fingerprint, decided_at
      )
      select
        t.id, t.church_id, t.actor_user_id, t.fingerprint, ${input.decidedAt}
      from transitioned t
      where t.status = 'approved'
      returning id
    ), audited as (
      insert into evry_product_audit_events (
        plan_id, church_id, actor_user_id, plan_fingerprint,
        correlation_id, event_key, event_type, occurred_at
      )
      select
        t.id, t.church_id, t.actor_user_id, t.fingerprint,
        t.correlation_id,
        case
          when t.status = 'approved' then ${input.approvedEventKey}
          else ${input.expiredEventKey}
        end,
        case
          when t.status = 'approved' then 'plan_approved'
          else 'plan_expired'
        end,
        ${input.decidedAt}
      from transitioned t
      returning id
    )
    select t.status, c.id as confirmation_id
    from transitioned t
    left join confirmed c on true
    cross join audited a
  `;
}

/** Supersede the exact predecessor and insert its replacement as one CAS. */
export function reviseEvryActionPlanStatement(input: {
  oldPlanId: string;
  oldFingerprint: string;
  actorUserId: string;
  plantId: string;
  replacementId: string;
  replacementRequestKey: EvryPlanRequestKey;
  replacementIntentFingerprint: string;
  replacementFingerprint: string;
  replacementDocument: EvryActionPlanDocument;
  createdAt: Date;
  expiresAt: Date;
  supersededEventKey: string;
  proposedEventKey: string;
}): SQL {
  return sql`
    with superseded as (
      update evry_action_plan_states s
      set status = 'superseded',
          version = s.version + 1,
          changed_at = ${input.createdAt}
      from evry_action_plans p,
           evry_product_audit_events root
      where s.plan_id = p.id
        and p.id = ${input.oldPlanId}::uuid
        and p.actor_user_id = ${input.actorUserId}::uuid
        and p.church_id = ${input.plantId}::uuid
        and p.fingerprint = ${input.oldFingerprint}
        and root.plan_id = p.id
        and root.church_id = p.church_id
        and root.actor_user_id = p.actor_user_id
        and root.plan_fingerprint = p.fingerprint
        and root.event_type = 'plan_proposed'
        and s.status in ('draft', 'awaiting_confirmation', 'approved')
      returning p.id, p.church_id, p.actor_user_id, p.fingerprint,
        root.correlation_id
    ), superseded_event as (
      insert into evry_product_audit_events (
        plan_id, church_id, actor_user_id, plan_fingerprint,
        correlation_id, event_key, event_type, occurred_at
      )
      select
        id, church_id, actor_user_id, fingerprint,
        correlation_id, ${input.supersededEventKey}, 'plan_superseded',
        ${input.createdAt}
      from superseded
      returning correlation_id
    ), inserted_plan as (
      insert into evry_action_plans (
        id, church_id, actor_user_id, request_key, intent_fingerprint,
        fingerprint, document,
        created_at, expires_at, supersedes_plan_id
      )
      select
        ${input.replacementId}::uuid,
        ${input.plantId}::uuid,
        ${input.actorUserId}::uuid,
        ${input.replacementRequestKey}::uuid,
        ${input.replacementIntentFingerprint},
        ${input.replacementFingerprint},
        ${JSON.stringify(input.replacementDocument)}::jsonb,
        ${input.createdAt},
        ${input.expiresAt},
        s.id
      from superseded s
      returning id, church_id, actor_user_id, fingerprint
    ), inserted_state as (
      insert into evry_action_plan_states (
        plan_id, church_id, status, version, changed_at
      )
      select id, church_id, 'awaiting_confirmation', 0, ${input.createdAt}
      from inserted_plan
      returning plan_id
    ), proposed_event as (
      insert into evry_product_audit_events (
        plan_id, church_id, actor_user_id, plan_fingerprint,
        correlation_id, event_key, event_type, occurred_at
      )
      select
        p.id, p.church_id, p.actor_user_id, p.fingerprint,
        s.correlation_id, ${input.proposedEventKey}, 'plan_proposed',
        ${input.createdAt}
      from inserted_plan p
      cross join superseded_event s
      returning plan_id
    )
    select s.plan_id as id
    from inserted_state s
    join proposed_event a on a.plan_id = s.plan_id
  `;
}

/** Cancel the exact plan and append its event in the same statement. */
export function cancelEvryActionPlanStatement(input: {
  planId: string;
  actorUserId: string;
  plantId: string;
  fingerprint: string;
  cancelledAt: Date;
  eventKey: string;
}): SQL {
  return sql`
    with cancelled as (
      update evry_action_plan_states s
      set status = 'cancelled',
          version = s.version + 1,
          changed_at = ${input.cancelledAt}
      from evry_action_plans p,
           evry_product_audit_events root
      where s.plan_id = p.id
        and p.id = ${input.planId}::uuid
        and p.actor_user_id = ${input.actorUserId}::uuid
        and p.church_id = ${input.plantId}::uuid
        and p.fingerprint = ${input.fingerprint}
        and root.plan_id = p.id
        and root.church_id = p.church_id
        and root.actor_user_id = p.actor_user_id
        and root.plan_fingerprint = p.fingerprint
        and root.event_type = 'plan_proposed'
        and s.status in ('draft', 'awaiting_confirmation', 'approved')
      returning p.id, p.church_id, p.actor_user_id, p.fingerprint,
        root.correlation_id
    ), audited as (
      insert into evry_product_audit_events (
        plan_id, church_id, actor_user_id, plan_fingerprint,
        correlation_id, event_key, event_type, occurred_at
      )
      select
        id, church_id, actor_user_id, fingerprint,
        correlation_id, ${input.eventKey}, 'plan_cancelled',
        ${input.cancelledAt}
      from cancelled
      returning plan_id
    )
    select id from cancelled
    join audited on audited.plan_id = cancelled.id
  `;
}
