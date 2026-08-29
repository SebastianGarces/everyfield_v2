import { and, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { messageTemplates } from "@/db/schema/communication";
import type { EvryEffectInput, EvryEffectResult } from "@/lib/evry/executor";

import { claimEvryCommunicationDatabaseEffect } from "./evry-effect";

export type EvryCommunicationTemplateSnapshot = Readonly<{
  id: string;
  name: string;
  description: string | null;
  category: string;
  channel: string;
  subject: string | null;
  body: string;
  bodyHtml: string | null;
  isSystem: boolean;
  sourceTemplateId: string | null;
  updatedAt: string;
}>;

/** Preserve Postgres's microseconds so an approved snapshot is a real CAS. */
const templateSnapshotProjection = {
  id: messageTemplates.id,
  churchId: messageTemplates.churchId,
  name: messageTemplates.name,
  description: messageTemplates.description,
  category: messageTemplates.category,
  channel: messageTemplates.channel,
  subject: messageTemplates.subject,
  body: messageTemplates.body,
  bodyHtml: messageTemplates.bodyHtml,
  isSystem: messageTemplates.isSystem,
  sourceTemplateId: messageTemplates.sourceTemplateId,
  updatedAt: sql<string>`to_char(${messageTemplates.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
} as const;

export async function getEvryCommunicationTemplateSnapshot(input: {
  churchId: string;
  templateId: string;
}): Promise<EvryCommunicationTemplateSnapshot | null> {
  const [template] = await db
    .select(templateSnapshotProjection)
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.id, input.templateId),
        or(
          and(
            eq(messageTemplates.isSystem, true),
            isNull(messageTemplates.churchId)
          ),
          eq(messageTemplates.churchId, input.churchId)
        )
      )
    )
    .limit(1);
  if (
    !template ||
    (!template.isSystem && template.churchId !== input.churchId)
  ) {
    return null;
  }
  const { churchId: _churchId, ...snapshot } = template;
  return snapshot;
}

export type EvryCommunicationTemplateContent = Readonly<{
  name: string;
  description: string | null;
  category: string;
  channel: string;
  subject: string | null;
  body: string;
  bodyHtml: string;
}>;

function exactTuple(input: EvryEffectInput, identity: string): boolean {
  const actor = input.authorization.actor;
  return (
    input.authorization.registration.identity === identity &&
    input.execution.capabilityIdentity === identity &&
    input.execution.actorUserId === actor.userId &&
    input.execution.plantId === actor.plantId
  );
}

export async function claimEvryCommunicationTemplateCreate(input: {
  effect: EvryEffectInput;
  identity: string;
  templateId: string;
  content: EvryCommunicationTemplateContent;
}): Promise<EvryEffectResult> {
  if (!exactTuple(input.effect, input.identity)) {
    return { status: "refused", excludedCount: 1 };
  }
  const churchId = input.effect.execution.plantId;
  return claimEvryCommunicationDatabaseEffect({
    execution: input.effect.execution,
    effectKey: input.effect.effectKey,
    mutation: sql`
      insert into message_templates (
        id, church_id, name, description, category, channel, subject, body,
        body_html, is_system
      )
      select
        ${input.templateId}::uuid, e.church_id, ${input.content.name},
        ${input.content.description}, ${input.content.category},
        ${input.content.channel}, ${input.content.subject}, ${input.content.body},
        ${input.content.bodyHtml}, false
      from eligible e
      on conflict (id) do nothing
      returning 1::int affected_count, 0::int excluded_count
    `,
    async targetIsCurrent() {
      const snapshot = await getEvryCommunicationTemplateSnapshot({
        churchId,
        templateId: input.templateId,
      });
      return snapshot === null;
    },
  });
}

export async function claimEvryCommunicationTemplateUpdate(input: {
  effect: EvryEffectInput;
  identity: string;
  templateId: string;
  expectedUpdatedAt: string;
  content: EvryCommunicationTemplateContent;
}): Promise<EvryEffectResult> {
  if (!exactTuple(input.effect, input.identity)) {
    return { status: "refused", excludedCount: 1 };
  }
  const churchId = input.effect.execution.plantId;
  return claimEvryCommunicationDatabaseEffect({
    execution: input.effect.execution,
    effectKey: input.effect.effectKey,
    mutation: sql`
      update message_templates t
      set name = ${input.content.name},
          description = ${input.content.description},
          category = ${input.content.category},
          channel = ${input.content.channel},
          subject = ${input.content.subject},
          body = ${input.content.body},
          body_html = ${input.content.bodyHtml},
          updated_at = transaction_timestamp()
      from eligible e
      where t.id = ${input.templateId}::uuid
        and t.church_id = e.church_id
        and t.is_system = false
        and t.updated_at = ${input.expectedUpdatedAt}::timestamptz
      returning 1::int affected_count, 0::int excluded_count
    `,
    async targetIsCurrent() {
      const snapshot = await getEvryCommunicationTemplateSnapshot({
        churchId,
        templateId: input.templateId,
      });
      return Boolean(
        snapshot &&
        !snapshot.isSystem &&
        snapshot.updatedAt === input.expectedUpdatedAt
      );
    },
  });
}

export async function claimEvryCommunicationSystemTemplateUpdate(input: {
  effect: EvryEffectInput;
  identity: string;
  source: EvryCommunicationTemplateSnapshot;
  forkId: string;
  content: EvryCommunicationTemplateContent;
}): Promise<EvryEffectResult> {
  if (!exactTuple(input.effect, input.identity) || !input.source.isSystem) {
    return { status: "refused", excludedCount: 1 };
  }
  const churchId = input.effect.execution.plantId;
  return claimEvryCommunicationDatabaseEffect({
    execution: input.effect.execution,
    effectKey: input.effect.effectKey,
    mutation: sql`
      insert into message_templates (
        id, church_id, name, description, category, channel, subject, body,
        body_html, merge_fields, is_system, source_template_id, updated_at
      )
      select
        ${input.forkId}::uuid, e.church_id, ${input.content.name},
        ${input.content.description}, ${input.content.category},
        ${input.content.channel}, ${input.content.subject}, ${input.content.body},
        ${input.content.bodyHtml}, s.merge_fields, false, s.id,
        transaction_timestamp()
      from eligible e
      join message_templates s on s.id = ${input.source.id}::uuid
      where s.is_system = true
        and s.church_id is null
        and s.updated_at = ${input.source.updatedAt}::timestamptz
      on conflict (church_id, source_template_id)
        where source_template_id is not null
        do nothing
      returning 1::int affected_count, 0::int excluded_count
    `,
    async targetIsCurrent() {
      const [source, fork] = await Promise.all([
        getEvryCommunicationTemplateSnapshot({
          churchId,
          templateId: input.source.id,
        }),
        getEvryCommunicationTemplateFork({
          churchId,
          sourceTemplateId: input.source.id,
        }),
      ]);
      return Boolean(
        source?.isSystem &&
        source.updatedAt === input.source.updatedAt &&
        fork === null
      );
    },
  });
}

export async function claimEvryCommunicationTemplateDelete(input: {
  effect: EvryEffectInput;
  identity: string;
  templateId: string;
  expectedUpdatedAt: string;
}): Promise<EvryEffectResult> {
  if (!exactTuple(input.effect, input.identity)) {
    return { status: "refused", excludedCount: 1 };
  }
  const churchId = input.effect.execution.plantId;
  return claimEvryCommunicationDatabaseEffect({
    execution: input.effect.execution,
    effectKey: input.effect.effectKey,
    mutation: sql`
      delete from message_templates t
      using eligible e
      where t.id = ${input.templateId}::uuid
        and t.church_id = e.church_id
        and t.is_system = false
        and t.updated_at = ${input.expectedUpdatedAt}::timestamptz
      returning 1::int affected_count, 0::int excluded_count
    `,
    async targetIsCurrent() {
      const snapshot = await getEvryCommunicationTemplateSnapshot({
        churchId,
        templateId: input.templateId,
      });
      return Boolean(
        snapshot &&
        !snapshot.isSystem &&
        snapshot.updatedAt === input.expectedUpdatedAt
      );
    },
  });
}

export async function getEvryCommunicationTemplateFork(input: {
  churchId: string;
  sourceTemplateId: string;
}): Promise<EvryCommunicationTemplateSnapshot | null> {
  const [fork] = await db
    .select(templateSnapshotProjection)
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.churchId, input.churchId),
        eq(messageTemplates.sourceTemplateId, input.sourceTemplateId)
      )
    )
    .limit(1);
  if (!fork) return null;
  const { churchId: _churchId, ...snapshot } = fork;
  return snapshot;
}

export async function claimEvryCommunicationTemplateFork(input: {
  effect: EvryEffectInput;
  identity: string;
  source: EvryCommunicationTemplateSnapshot;
  forkId: string;
}): Promise<EvryEffectResult> {
  if (!exactTuple(input.effect, input.identity) || !input.source.isSystem) {
    return { status: "refused", excludedCount: 1 };
  }
  const churchId = input.effect.execution.plantId;
  return claimEvryCommunicationDatabaseEffect({
    execution: input.effect.execution,
    effectKey: input.effect.effectKey,
    mutation: sql`
      insert into message_templates (
        id, church_id, name, description, category, channel, subject, body,
        body_html, merge_fields, is_system, source_template_id
      )
      select
        ${input.forkId}::uuid, e.church_id, s.name, s.description, s.category,
        s.channel, s.subject, s.body, s.body_html, s.merge_fields, false, s.id
      from eligible e
      join message_templates s on s.id = ${input.source.id}::uuid
      where s.is_system = true
        and s.church_id is null
        and s.updated_at = ${input.source.updatedAt}::timestamptz
      on conflict (church_id, source_template_id)
        where source_template_id is not null
        do nothing
      returning 1::int affected_count, 0::int excluded_count
    `,
    async targetIsCurrent() {
      const [source, fork] = await Promise.all([
        getEvryCommunicationTemplateSnapshot({
          churchId,
          templateId: input.source.id,
        }),
        getEvryCommunicationTemplateFork({
          churchId,
          sourceTemplateId: input.source.id,
        }),
      ]);
      return Boolean(
        source?.isSystem &&
        source.updatedAt === input.source.updatedAt &&
        fork === null
      );
    },
  });
}
