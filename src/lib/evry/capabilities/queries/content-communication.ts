import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { defineEvryReadRegistration } from "@/lib/evry/reads/contract";
import { readEvryPlantTimeZone } from "@/lib/evry/reads/plant-time-zone";
import {
  COMMUNICATION_STATUS_LABELS,
  RECIPIENT_STATUS_LABELS,
} from "@/lib/communication/status-display";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import {
  evaluateResendEligibility,
  resendBlockedHint,
} from "@/lib/communication/resend-policy";
import { richTextToPlainText, toRichTextHtml } from "@/lib/rich-text/format";
import {
  communicationStatuses,
  recipientStatuses,
  templateCategories,
} from "@/db/schema/communication";
import { COMMUNICATION_READ_IDENTITIES } from "../communication/reads";
import {
  contentIds,
  contentWindow,
  contentPage,
  contentMode,
  contentText,
  contentRange,
  contentIn,
  contentItem,
  runContentQuery,
} from "./content-core";

export const communicationQuerySchema = z.strictObject({
  resource: z.enum([
    "messages",
    "recipients",
    "templates",
    "distinct_recipients",
  ]),
  mode: contentMode,
  ...contentPage,
  search: contentText.optional(),
  messageIds: contentIds.optional(),
  personIds: contentIds.optional(),
  meetingIds: contentIds.optional(),
  teamIds: contentIds.optional(),
  templateIds: contentIds.optional(),
  statuses: z.array(z.enum(communicationStatuses)).min(1).optional(),
  deliveryStatuses: z.array(z.enum(recipientStatuses)).min(1).optional(),
  category: z.enum(templateCategories).optional(),
  window: contentWindow.optional(),
  timeField: z.enum(["created", "sent"]).default("created"),
  groupBy: z
    .enum(["status", "channel", "template", "meeting", "category"])
    .optional(),
});
type Query = z.infer<typeof communicationQuerySchema>;

export function visibleCommunicationTemplates(plantId: string) {
  return sql`(mt.church_id = ${plantId} or (mt.church_id is null and mt.is_system = true and not exists (select 1 from message_templates fork where fork.church_id = ${plantId} and fork.source_template_id = mt.id)))`;
}
export function communicationFilteredQuery(plantId: string, input: Query) {
  const source = communicationSourceQuery(plantId, input);
  if (input.mode !== "group") return source;
  const grouping =
    input.groupBy ?? (input.resource === "templates" ? "category" : "status");
  const statusLabels =
    input.resource === "recipients"
      ? RECIPIENT_STATUS_LABELS
      : COMMUNICATION_STATUS_LABELS;
  const groupLabel =
    grouping === "template"
      ? sql`coalesce((select mt.name from message_templates mt where mt.id::text = f.group_key and (mt.church_id = ${plantId} or (mt.church_id is null and mt.is_system))), 'Template unavailable')`
      : grouping === "meeting"
        ? sql`coalesce((select m.title from church_meetings m where m.id::text = f.group_key and m.church_id = ${plantId}), 'Meeting unavailable')`
        : grouping === "status"
          ? sql`case f.group_key ${sql.join(
              Object.entries(statusLabels).map(
                ([value, label]) => sql`when ${value} then ${label}`
              ),
              sql` `
            )} else 'Status unavailable' end`
          : sql`upper(left(replace(f.group_key, '_', ' '), 1)) || substring(replace(f.group_key, '_', ' ') from 2)`;
  return sql`select f.*, ${groupLabel} as group_label from (${source}) f`;
}
function communicationSourceQuery(plantId: string, input: Query) {
  if (input.resource === "templates") {
    if (
      input.messageIds ||
      input.personIds ||
      input.meetingIds ||
      input.teamIds ||
      input.statuses ||
      input.deliveryStatuses ||
      (input.window && input.timeField === "sent") ||
      input.groupBy === "meeting"
    )
      throw new Error(
        "Message and recipient filters cannot be applied to templates"
      );
    return sql`select mt.id::text as id, mt.name as label, jsonb_build_object('Category', mt.category, 'Channel', mt.channel, 'Description', mt.description, 'Placeholders', mt.merge_fields) as facts, '/communication/templates/' || mt.id as href, ${input.groupBy === "channel" ? sql`mt.channel` : input.groupBy === "template" ? sql`mt.id::text` : sql`mt.category`}::text as group_key, mt.updated_at::text as sort_key from message_templates mt where ${visibleCommunicationTemplates(plantId)} and ${contentIn(sql`mt.id`, input.templateIds)} and ${input.category ? sql`mt.category = ${input.category}` : sql`true`} and ${input.search ? sql`(mt.name ilike ${`%${input.search}%`} or mt.description ilike ${`%${input.search}%`})` : sql`true`} and ${contentRange(sql`mt.created_at`, input.window)}`;
  }
  const recipientFilter = sql`${contentIn(sql`r.person_id`, input.personIds)} and ${contentIn(sql`r.status`, input.deliveryStatuses)} and ${input.teamIds ? sql`exists (select 1 from team_memberships tm where tm.church_id = ${plantId} and tm.person_id = r.person_id and tm.status = 'active' and ${contentIn(sql`tm.team_id`, input.teamIds)})` : sql`true`}`;
  const messageFilter = sql`c.church_id = ${plantId} and ${contentIn(sql`c.id`, input.messageIds)} and ${contentIn(sql`c.meeting_id`, input.meetingIds)} and ${contentIn(sql`c.template_id`, input.templateIds)} and ${contentIn(sql`c.status`, input.statuses)} and ${contentRange(input.timeField === "sent" ? sql`c.sent_at` : sql`c.created_at`, input.window)} and ${input.search ? sql`(c.subject ilike ${`%${input.search}%`} or c.body ilike ${`%${input.search}%`})` : sql`true`} and ${input.category ? sql`exists (select 1 from message_templates mt where mt.id = c.template_id and (mt.church_id = ${plantId} or (mt.church_id is null and mt.is_system = true)) and mt.category = ${input.category})` : sql`true`}`;
  if (input.resource === "messages") {
    const group = {
      status: sql`c.status`,
      channel: sql`c.channel`,
      template: sql`c.template_id::text`,
      meeting: sql`c.meeting_id::text`,
      category: sql`(select mt.category from message_templates mt where mt.id = c.template_id and (mt.church_id = ${plantId} or (mt.church_id is null and mt.is_system = true)))`,
    }[input.groupBy ?? "status"];
    return sql`select c.id::text as id, coalesce(c.subject, 'Recorded communication') as label, jsonb_build_object('Status', c.status, 'Sent at', c.sent_at, 'Created at', c.created_at, 'Meeting ID', c.meeting_id, 'Template ID', c.template_id) as facts, '/communication/' || c.id as href, ${group} as group_key, c.created_at::text as sort_key from communications c where ${messageFilter} and ${input.personIds || input.deliveryStatuses || input.teamIds ? sql`exists (select 1 from communication_recipients r where r.church_id = ${plantId} and r.communication_id = c.id and ${recipientFilter})` : sql`true`}`;
  }
  if (input.resource === "distinct_recipients")
    return sql`select p.id::text as id, p.first_name || ' ' || p.last_name as label, jsonb_build_object('Distinct messages', count(distinct c.id), 'Latest sent at', max(c.sent_at)) as facts, '/people/' || p.id as href, null::text as group_key, max(c.created_at)::text as sort_key from communications c join communication_recipients r on r.communication_id = c.id and r.church_id = ${plantId} join persons p on p.id = r.person_id and p.church_id = ${plantId} and p.deleted_at is null where ${messageFilter} and ${recipientFilter} group by p.id, p.first_name, p.last_name`;
  const group =
    input.groupBy === "channel"
      ? sql`r.channel`
      : input.groupBy === "meeting"
        ? sql`c.meeting_id::text`
        : input.groupBy === "template"
          ? sql`c.template_id::text`
          : sql`r.status`;
  return sql`select r.id::text as id, p.first_name || ' ' || p.last_name as label, jsonb_build_object('Person ID', p.id, 'Message ID', c.id, 'Subject', c.subject, 'Delivery status', r.status, 'Delivered at', r.delivered_at, 'Opened at', r.opened_at, 'Failure', r.error_message, 'Meeting ID', c.meeting_id) as facts, '/communication/' || c.id as href, ${group}::text as group_key, c.created_at::text as sort_key from communications c join communication_recipients r on r.communication_id = c.id and r.church_id = ${plantId} join persons p on p.id = r.person_id and p.church_id = ${plantId} and p.deleted_at is null where ${messageFilter} and ${recipientFilter}`;
}

const validatedCommunicationQuery = communicationQuerySchema.superRefine(
  (value, ctx) => {
    const incompatible =
      (value.resource === "templates" &&
        (value.messageIds ||
          value.personIds ||
          value.meetingIds ||
          value.teamIds ||
          value.statuses ||
          value.deliveryStatuses ||
          (value.window && value.timeField === "sent") ||
          value.groupBy === "meeting" ||
          value.groupBy === "status")) ||
      (value.resource === "recipients" &&
        value.mode === "group" &&
        value.groupBy === "category") ||
      (value.resource === "distinct_recipients" && value.mode === "group");
    if (incompatible)
      ctx.addIssue({
        code: "custom",
        message:
          "These filters or grouping do not apply to the selected resource",
      });
  }
);
export const COMMUNICATION_QUERY = defineEvryReadRegistration({
  id: "communication.query",
  capabilityIdentity: COMMUNICATION_READ_IDENTITIES.history,
  inputShape: { query: validatedCommunicationQuery },
  async run({ authorization, now }, { query: input }) {
    return runContentQuery({
      title: `Communication ${input.resource.replaceAll("_", " ")}`,
      href: "/communication",
      filtered: communicationFilteredQuery(authorization.actor.plantId, input),
      mode: input.mode,
      limit: input.limit,
      offset: input.offset,
      now: now ?? new Date(),
      timeZone: await readEvryPlantTimeZone(authorization.actor.plantId),
      notes: [
        "Sent/provider acceptance, delivery, opens, RSVP and personal follow-up are different evidence.",
      ],
    });
  },
});

export const COMMUNICATION_GET_MANY = defineEvryReadRegistration({
  id: "communication.get_many",
  capabilityIdentity: COMMUNICATION_READ_IDENTITIES.message,
  inputShape: { resource: z.enum(["messages", "templates"]), ids: contentIds },
  async run({ authorization, now }, input) {
    const plantId = authorization.actor.plantId;
    const timeZone = await readEvryPlantTimeZone(plantId);
    const rows =
      input.resource === "templates"
        ? await db.execute(
            sql`select mt.id::text as id, mt.name as label, mt.subject, mt.body, mt.body_html, mt.merge_fields, null::text as status, null::text as sent_at, 0::int as delivered, 0::int as non_openers from message_templates mt where ${visibleCommunicationTemplates(plantId)} and ${contentIn(sql`mt.id`, input.ids)}`
          )
        : await db.execute(
            sql`select c.id::text as id, coalesce(c.subject, 'Recorded communication') as label, c.subject, c.body, c.body_html, null::jsonb as merge_fields, c.status, c.sent_at::text as sent_at, (select count(*)::int from communication_recipients r where r.church_id = ${plantId} and r.communication_id = c.id and r.status in ('delivered', 'opened', 'clicked')) as delivered, (select count(distinct r.person_id)::int from communication_recipients r join persons p on p.id = r.person_id and p.church_id = ${plantId} and p.deleted_at is null and p.email is not null where r.church_id = ${plantId} and r.communication_id = c.id and r.status not in ('opened', 'clicked', 'bounced', 'failed') and r.opened_at is null) as non_openers from communications c where c.church_id = ${plantId} and ${contentIn(sql`c.id`, input.ids)}`
          );
    const parsed = z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          subject: z.string().nullable(),
          body: z.string(),
          body_html: z.string().nullable(),
          merge_fields: z.array(z.string()).nullable(),
          status: z.string().nullable(),
          sent_at: z.string().nullable(),
          delivered: z.coerce.number(),
          non_openers: z.coerce.number(),
        })
      )
      .parse(rows.rows);
    return buildEvryReadArtifact({
      title: input.resource === "templates" ? "Message templates" : "Messages",
      filters: [
        { label: "Scope", value: "Current plant and visible system templates" },
      ],
      exclusions:
        new Set(input.ids).size > parsed.length
          ? [
              {
                reason: "Requested records unavailable",
                count: new Set(input.ids).size - parsed.length,
              },
            ]
          : [],
      items: parsed.map((row) => {
        const eligibility = evaluateResendEligibility({
          status: row.status ?? "draft",
          sentAt: row.sent_at ? new Date(row.sent_at) : null,
          deliveredCount: row.delivered,
          nonOpenerCount: row.non_openers,
          now: now ?? new Date(),
        });
        return contentItem(
          {
            id: row.id,
            label: row.label,
            href:
              input.resource === "templates"
                ? `/communication/templates/${row.id}`
                : `/communication/${row.id}`,
            group_key: null,
            facts: {
              Subject: row.subject,
              "Message template": richTextToPlainText(
                toRichTextHtml(row.body_html ?? row.body)
              ),
              Placeholders: row.merge_fields,
              ...(input.resource === "messages"
                ? {
                    Status: row.status,
                    "Sent at": row.sent_at,
                    "Non-opener resend": eligibility.allowed
                      ? "Eligible for confirmed resend preparation"
                      : resendBlockedHint(eligibility.reason!),
                    "Eligible non-openers": row.non_openers,
                  }
                : {}),
            },
          },
          timeZone
        );
      }),
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open Communication",
          href: "/communication",
        }),
      ],
    });
  },
});
