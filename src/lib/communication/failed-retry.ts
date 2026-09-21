import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import type { EvryEffectInput } from "@/lib/evry/executor";
import type { EvryCommunicationAudienceSnapshot } from "./evry-send";
import { communicationEvryEffectUuid } from "./evry-effect";

export const failedCommunicationSourceSchema = z.strictObject({
  id: z.string().uuid(),
  subject: z.string().max(500).nullable(),
  body: z.string().min(1).max(100_000),
  bodyHtml: z.string().max(200_000).nullable(),
  channel: z.literal("email"),
  templateId: z.string().uuid().nullable(),
  meetingId: z.string().uuid().nullable(),
  recipients: z
    .array(
      z.strictObject({
        id: z.string().uuid(),
        personId: z.string().uuid(),
        email: z.string().min(1).max(255),
        externalId: z.string().min(1).max(255),
        failureOrigin: z.literal("provider_delivery_failed"),
      })
    )
    .min(1)
    .max(100),
});
export type FailedCommunicationSource = z.infer<
  typeof failedCommunicationSourceSchema
>;

export const failedRetryOutboundSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  subject: z.string(),
  html: z.string().min(1),
  text: z.string().min(1),
});
export type FailedRetryOutbound = z.infer<typeof failedRetryOutboundSchema>;

/** Resend retains keys for 24h. Leave a one-hour safety margin; never mint a replacement key. */
export const FAILED_RETRY_SAFE_WINDOW_HOURS = 23;

// Aliases are private to this module. Every reader and lasting-effect boundary
// uses the same meaning of failure; error-message text is not provenance.
function eligibleSourceRecipient(churchId: string) {
  return sql`r.church_id = ${churchId}::uuid and p.church_id = r.church_id
    and r.status = 'failed' and r.channel = 'email'
    and r.failure_origin = 'provider_delivery_failed'
    and coalesce(r.error_message, '') !~ '^evry-(attempted|transient|permanent|local):'
    and r.external_id is not null and r.external_id <> ''
    and r.delivered_at is null and r.opened_at is null and r.clicked_at is null
    and p.deleted_at is null and lower(btrim(p.email)) = lower(btrim(r.email))
    and not exists (select 1 from email_suppressions s
      where s.email = lower(btrim(r.email)) and s.cleared_at is null)`;
}

/** Read only: no send, attempt claim or RSVP token is created while reviewing. */
export async function resolveFailedCommunicationSource(input: {
  churchId: string;
  communicationId: string;
  recipientIds?: readonly string[];
  /** Internal comparison of an existing approved source, not audience discovery. */
  includeClaimed?: boolean;
}): Promise<{
  source: FailedCommunicationSource;
  excludedCount: number;
} | null> {
  const result = await db.execute(sql`
    select c.id, c.subject, c.body, c.body_html as "bodyHtml", c.channel,
      c.template_id as "templateId", c.meeting_id as "meetingId",
      (select count(*)::int from communication_recipients all_r
       where all_r.church_id = c.church_id and all_r.communication_id = c.id) as total,
      (select coalesce(jsonb_agg(selected.row order by selected.id), '[]'::jsonb) from (
        select r.id, jsonb_build_object('id', r.id, 'personId', r.person_id,
          'email', lower(btrim(r.email)), 'externalId', r.external_id,
          'failureOrigin', r.failure_origin) as row
        from communication_recipients r join persons p on p.id = r.person_id
        where r.communication_id = c.id and ${eligibleSourceRecipient(input.churchId)}
          and ${input.includeClaimed ? sql`true` : sql`not exists (select 1 from communication_failed_retries f where f.source_recipient_id = r.id)`}
          and ${input.recipientIds ? sql`r.id in (select jsonb_array_elements_text(${JSON.stringify(input.recipientIds)}::jsonb)::uuid)` : sql`true`}
        order by r.id limit 101
      ) selected) as recipients
    from communications c where c.id = ${input.communicationId}::uuid
      and c.church_id = ${input.churchId}::uuid and c.channel = 'email'
      and c.status in ('sent', 'failed')
      and (c.meeting_id is null or exists (select 1 from church_meetings m
        where m.id = c.meeting_id and m.church_id = c.church_id))
  `);
  const row = result.rows[0];
  if (!row) return null;
  const parsed = failedCommunicationSourceSchema.safeParse({
    id: row.id,
    subject: row.subject,
    body: row.body,
    bodyHtml: row.bodyHtml,
    channel: row.channel,
    templateId: row.templateId,
    meetingId: row.meetingId,
    recipients: row.recipients,
  });
  if (!parsed.success) return null;
  const source = parsed.data;
  if (
    new Set(source.recipients.map((r) => r.personId)).size !==
    source.recipients.length
  )
    return null;
  if (
    input.recipientIds &&
    (new Set(input.recipientIds).size !== input.recipientIds.length ||
      input.recipientIds.length !== source.recipients.length)
  )
    return null;
  return {
    source,
    excludedCount: Number(row.total) - source.recipients.length,
  };
}

export async function failedCommunicationSourceIsCurrent(
  churchId: string,
  source: FailedCommunicationSource
) {
  const current = await resolveFailedCommunicationSource({
    churchId,
    communicationId: source.id,
    recipientIds: source.recipients.map((r) => r.id),
    includeClaimed: true,
  });
  return (
    current !== null &&
    JSON.stringify(current.source) === JSON.stringify(source)
  );
}

function exactSourceMessage(
  churchId: string,
  source: FailedCommunicationSource
) {
  return sql`c.id = ${source.id}::uuid and c.church_id = ${churchId}::uuid
    and c.subject is not distinct from ${source.subject} and c.body = ${source.body}
    and c.body_html is not distinct from ${source.bodyHtml} and c.channel = 'email'
    and c.template_id is not distinct from ${source.templateId}::uuid
    and c.meeting_id is not distinct from ${source.meetingId}::uuid
    and c.status in ('sent', 'failed')
    and (c.meeting_id is null or exists (select 1 from church_meetings m
      where m.id = c.meeting_id and m.church_id = c.church_id))`;
}

function authorizedActor(effect: EvryEffectInput) {
  return sql`a.id = ${effect.execution.actorUserId}::uuid
    and a.church_id = ${effect.execution.plantId}::uuid
    and a.sending_church_id is null and a.sending_network_id is null
    and a.seat in ('owner', 'admin')`;
}

function sourceRows(source: FailedCommunicationSource) {
  return sql`jsonb_to_recordset(${JSON.stringify(source.recipients)}::jsonb)
    as expected(id uuid, "personId" uuid, email text, "externalId" text)`;
}

function exactSourceRecipient() {
  return sql`r.id = expected.id and r.person_id = expected."personId"
    and lower(btrim(r.email)) = expected.email and r.external_id = expected."externalId"`;
}

function lockSource(
  effect: EvryEffectInput,
  source: FailedCommunicationSource
) {
  // This is a separate statement: eligibility below sees a fresh snapshot after
  // a competing writer/claim releases these rows. Unique source PK is the final arbiter.
  return db.execute(sql`select r.id from communications c
    join communication_recipients r on r.communication_id = c.id and r.church_id = c.church_id
    join persons p on p.id = r.person_id and p.church_id = c.church_id
    where c.id = ${source.id}::uuid and c.church_id = ${effect.execution.plantId}::uuid
      and r.id in (select jsonb_array_elements_text(${JSON.stringify(source.recipients.map((r) => r.id))}::jsonb)::uuid)
    order by r.id for update of c, r, p`);
}

/** Claim the entire approved cohort and create its child rows in one atomic statement. */
export async function prepareFailedCommunicationRetry(input: {
  effect: EvryEffectInput;
  communicationId: string;
  audience: EvryCommunicationAudienceSnapshot;
  source: FailedCommunicationSource;
}): Promise<boolean> {
  const { effect, source, audience } = input;
  const churchId = effect.execution.plantId;
  const children = audience.recipients.map((recipient) => ({
    id: communicationEvryEffectUuid(
      effect.effectKey,
      `recipient:${recipient.personId}`
    ),
    personId: recipient.personId,
    email: recipient.email,
  }));
  if (
    children.length !== source.recipients.length ||
    source.recipients.some(
      (r) =>
        !children.some(
          (child) => child.personId === r.personId && child.email === r.email
        )
    )
  )
    return false;
  const existing =
    await db.execute(sql`select f.source_recipient_id, f.retry_recipient_id
    from communication_failed_retries f where f.church_id = ${churchId}::uuid
      and f.plan_id = ${effect.execution.planId}::uuid and f.effect_key = ${effect.effectKey}`);
  if (existing.rows.length > 0)
    return (
      existing.rows.length === children.length &&
      source.recipients.every((r) =>
        existing.rows.some(
          (row) =>
            row.source_recipient_id === r.id &&
            row.retry_recipient_id ===
              communicationEvryEffectUuid(
                effect.effectKey,
                `recipient:${r.personId}`
              )
        )
      )
    );
  const results = await db.batch([
    db.execute(
      sql`select a.id from users a where ${authorizedActor(effect)} for update`
    ),
    lockSource(effect, source),
    db.execute(sql`
      with eligible as materialized (
        select r.id, r.person_id from ${sourceRows(source)}
        join communication_recipients r on ${exactSourceRecipient()}
        join communications c on c.id = r.communication_id
        join persons p on p.id = r.person_id
        where ${exactSourceMessage(churchId, source)} and ${eligibleSourceRecipient(churchId)}
          and not exists (select 1 from communication_failed_retries f where f.source_recipient_id = r.id)
      ), created as (
        insert into communications (id, church_id, subject, body, body_html,
          channel, template_id, meeting_id, status, recipient_count, created_by_id)
        select ${input.communicationId}::uuid, a.church_id, ${audience.subject},
          ${audience.body}, ${audience.bodyHtml}, 'email', ${audience.templateId}::uuid,
          ${audience.meetingId}::uuid, 'sending', ${children.length}, a.id
        from users a where ${authorizedActor(effect)}
          and (select count(*) from eligible) = ${source.recipients.length}
        returning id, church_id
      ), recipients as (
        insert into communication_recipients (id, church_id, communication_id, person_id, email, channel, status)
        select child.id, c.church_id, c.id, child."personId", child.email, 'email', 'pending'
        from created c cross join jsonb_to_recordset(${JSON.stringify(children)}::jsonb)
          as child(id uuid, "personId" uuid, email text)
        returning id, person_id, church_id
      )
      insert into communication_failed_retries (source_recipient_id, retry_recipient_id, church_id, plan_id, effect_key)
      select e.id, r.id, r.church_id, ${effect.execution.planId}::uuid, ${effect.effectKey}
      from eligible e join recipients r on r.person_id = e.person_id
      returning source_recipient_id
    `),
  ]);
  return results[2].rows.length === source.recipients.length;
}

/** Frozen payloads are private provider data, never tool output. */
export async function storedFailedRetryOutbound(
  effect: EvryEffectInput,
  recipientId: string
) {
  const result =
    await db.execute(sql`select outbound from communication_failed_retries
    where retry_recipient_id = ${recipientId}::uuid and church_id = ${effect.execution.plantId}::uuid
      and plan_id = ${effect.execution.planId}::uuid and effect_key = ${effect.effectKey}`);
  return failedRetryOutboundSchema.safeParse(result.rows[0]?.outbound);
}

/** Revalidate the source inside the same statement that acquires a provider attempt. */
export async function acquireFailedRetryProviderAttempt(input: {
  effect: EvryEffectInput;
  source: FailedCommunicationSource;
  recipientId: string;
  outbound: FailedRetryOutbound;
}): Promise<
  | { status: "ready"; outbound: FailedRetryOutbound }
  | { status: "excluded" | "unresolved" }
> {
  const { effect, source } = input;
  const churchId = effect.execution.plantId;
  const results = await db.batch([
    db.execute(
      sql`select a.id from users a where ${authorizedActor(effect)} for update`
    ),
    lockSource(effect, source),
    db.execute(sql`
      with acquired as (
        update communication_failed_retries f
        set outbound = coalesce(f.outbound, ${JSON.stringify(input.outbound)}::jsonb),
          first_attempt_at = coalesce(f.first_attempt_at, clock_timestamp())
        from users a, ${sourceRows(source)}, communication_recipients r,
          communications c, persons p, communication_recipients child
        where ${authorizedActor(effect)} and f.church_id = a.church_id
          and f.retry_recipient_id = ${input.recipientId}::uuid
          and f.plan_id = ${effect.execution.planId}::uuid and f.effect_key = ${effect.effectKey}
          and child.id = f.retry_recipient_id and child.church_id = f.church_id
          and child.status in ('pending', 'failed')
          and (child.error_message is null or child.error_message like 'evry-attempted:%' or child.error_message like 'evry-transient:%')
          and f.source_recipient_id = r.id and ${exactSourceRecipient()}
          and c.id = r.communication_id and p.id = r.person_id
          and ${exactSourceMessage(churchId, source)} and ${eligibleSourceRecipient(churchId)}
          and (f.first_attempt_at is null or f.first_attempt_at > clock_timestamp() - ${FAILED_RETRY_SAFE_WINDOW_HOURS} * interval '1 hour')
        returning f.retry_recipient_id, f.outbound
      ), marked as (
        update communication_recipients child set error_message = 'evry-attempted:provider request may have started'
        from acquired where child.id = acquired.retry_recipient_id and child.church_id = ${churchId}::uuid
        returning child.id
      ), excluded as (
        update communication_recipients child
        set status = 'failed', error_message = 'evry-local:original delivery is no longer eligible for retry'
        from communication_failed_retries f, users a
        where ${authorizedActor(effect)} and f.church_id = a.church_id
          and f.retry_recipient_id = ${input.recipientId}::uuid
          and f.plan_id = ${effect.execution.planId}::uuid and f.effect_key = ${effect.effectKey}
          and child.id = f.retry_recipient_id and child.church_id = f.church_id
          and child.status = 'pending' and child.error_message is null
          and f.first_attempt_at is null and not exists (select 1 from acquired)
          and not exists (
            select 1 from ${sourceRows(source)}
            join communication_recipients r on ${exactSourceRecipient()}
            join communications c on c.id = r.communication_id
            join persons p on p.id = r.person_id
            where r.id = f.source_recipient_id
              and ${exactSourceMessage(churchId, source)} and ${eligibleSourceRecipient(churchId)}
          ) returning child.id
      ) select 'ready' as status, acquired.outbound from acquired join marked on marked.id = acquired.retry_recipient_id
        union all select 'excluded' as status, null::jsonb as outbound from excluded
    `),
  ]);
  const row = results[2].rows[0];
  if (row?.status === "excluded") return { status: "excluded" };
  const parsed = failedRetryOutboundSchema.safeParse(row?.outbound);
  return parsed.success
    ? { status: "ready", outbound: parsed.data }
    : { status: "unresolved" };
}
