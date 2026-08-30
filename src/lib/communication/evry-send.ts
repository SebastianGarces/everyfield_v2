import { render } from "@react-email/components";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { churches } from "@/db/schema/church";
import {
  communicationRecipients,
  communications,
  type CommunicationChannel,
} from "@/db/schema/communication";
import { churchMeetings } from "@/db/schema/meetings";
import { persons } from "@/db/schema/people";
import {
  CommunicationEmail,
  CommunicationEmailText,
  CONFIRM_PLACEHOLDER,
  DECLINE_PLACEHOLDER,
} from "@/lib/email/components/communication-email";
import { EMAIL_FROM, resend } from "@/lib/email/client";
import type {
  EvryClaimedEffectInput,
  EvryEffectInput,
  EvryEffectResult,
} from "@/lib/evry/executor";
import { findExactEvryDatabaseEffectClaim } from "@/lib/evry/executor/database-effect";
import {
  loadSuppressedAddresses,
  normalizeEmailAddress,
} from "@/lib/notifications/channels/suppression";

import { createConfirmationToken } from "./confirmation";
import {
  buildChurchMergeData,
  buildMeetingMergeData,
  buildPersonMergeData,
  renderEmailBodyHtml,
  renderEmailBodyText,
  renderSubject,
} from "./merge";
import {
  actorStillHoldsCommunicationSend,
  claimEvryCommunicationDatabaseEffect,
  communicationEvryEffectUuid,
} from "./evry-effect";
import { storedTemplateContent } from "./templates";

export const EVRY_COMMUNICATION_TRANSIENT_PREFIX = "evry-transient:";
export const EVRY_COMMUNICATION_PERMANENT_PREFIX = "evry-permanent:";
/**
 * One Evry confirmation is intentionally one provider-sized send batch. This
 * keeps the immutable plan, API response, and eagerly rendered confirmation
 * bounded while still matching Resend's documented batch cardinality.
 */
export const EVRY_COMMUNICATION_MAX_RECIPIENTS = 100;

export type EvryCommunicationMessageClass =
  | "transactional_meeting"
  | "relationship_message";

export type EvryCommunicationRecipientSnapshot = Readonly<{
  personId: string;
  label: string;
  email: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}>;

export type EvryCommunicationAudienceSnapshot = Readonly<{
  subject: string;
  body: string;
  bodyHtml: string;
  channel: CommunicationChannel;
  templateId: string | null;
  meetingId: string | null;
  messageClass: EvryCommunicationMessageClass;
  recipients: readonly EvryCommunicationRecipientSnapshot[];
  exclusions: readonly Readonly<{ reason: string; count: number }>[];
}>;

function personLabel(person: { firstName: string; lastName: string }) {
  return (
    [person.firstName, person.lastName].filter(Boolean).join(" ") || "Person"
  );
}

function dispatchableRecipient() {
  return or(
    eq(communicationRecipients.status, "pending"),
    and(
      eq(communicationRecipients.status, "failed"),
      like(
        communicationRecipients.errorMessage,
        `${EVRY_COMMUNICATION_TRANSIENT_PREFIX}%`
      )
    )
  );
}

/**
 * Resolve, deduplicate and freeze the exact audience before confirmation.
 * Foreign/missing ids are counted neutrally, and suppressed or missing
 * addresses are visible. Execution must re-resolve this exact snapshot; it may
 * neither add nor remove a recipient after the human approves it.
 */
export async function resolveEvryCommunicationAudience(input: {
  churchId: string;
  recipientIds: readonly string[];
  subject: string;
  body: string;
  channel?: CommunicationChannel;
  templateId?: string | null;
  meetingId?: string | null;
}): Promise<EvryCommunicationAudienceSnapshot | null> {
  const selected = [...new Set(input.recipientIds)].sort();
  const duplicateSelections = input.recipientIds.length - selected.length;
  if (
    selected.length === 0 ||
    selected.length > EVRY_COMMUNICATION_MAX_RECIPIENTS
  ) {
    return null;
  }

  const [[church], meeting, selectedPeople] = await Promise.all([
    db.select().from(churches).where(eq(churches.id, input.churchId)).limit(1),
    input.meetingId
      ? db
          .select()
          .from(churchMeetings)
          .where(
            and(
              eq(churchMeetings.id, input.meetingId),
              eq(churchMeetings.churchId, input.churchId)
            )
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    db
      .select()
      .from(persons)
      .where(
        and(
          eq(persons.churchId, input.churchId),
          inArray(persons.id, selected),
          sql`${persons.deletedAt} is null`
        )
      ),
  ]);
  if (!church || (input.meetingId && !meeting)) return null;

  const withAddress = selectedPeople.filter(
    (person): person is typeof person & { email: string } =>
      Boolean(person.email)
  );
  const suppressed = new Set(
    await loadSuppressedAddresses(withAddress.map(({ email }) => email))
  );
  const safe = storedTemplateContent(input.body);
  const churchMergeData = buildChurchMergeData(church);
  const meetingMergeData = meeting ? buildMeetingMergeData(meeting) : {};
  const seenAddresses = new Set<string>();
  const recipients: EvryCommunicationRecipientSnapshot[] = [];
  let duplicateAddresses = 0;
  let suppressedAddresses = 0;
  for (const person of withAddress.toSorted((left, right) =>
    left.id.localeCompare(right.id)
  )) {
    const email = normalizeEmailAddress(person.email);
    if (suppressed.has(email)) {
      suppressedAddresses += 1;
      continue;
    }
    if (seenAddresses.has(email)) {
      duplicateAddresses += 1;
      continue;
    }
    seenAddresses.add(email);
    const mergeData = {
      ...churchMergeData,
      ...meetingMergeData,
      ...buildPersonMergeData(person),
    };
    if (meeting) {
      mergeData.confirm_link = CONFIRM_PLACEHOLDER;
      mergeData.decline_link = DECLINE_PLACEHOLDER;
    }
    recipients.push({
      personId: person.id,
      label: personLabel(person),
      email,
      subject: renderSubject(input.subject, mergeData),
      bodyHtml: renderEmailBodyHtml(safe.bodyHtml, mergeData),
      bodyText: renderEmailBodyText(safe.body, mergeData),
    });
  }

  const exclusions = [
    { reason: "Duplicate selections", count: duplicateSelections },
    {
      reason: "Unavailable outside this plant or no longer active",
      count: selected.length - selectedPeople.length,
    },
    {
      reason: "Missing email address",
      count: selectedPeople.length - withAddress.length,
    },
    { reason: "Suppressed email address", count: suppressedAddresses },
    { reason: "Duplicate email address", count: duplicateAddresses },
  ].filter(({ count }) => count > 0);

  return {
    subject: input.subject,
    body: safe.body,
    bodyHtml: safe.bodyHtml,
    channel: input.channel ?? "email",
    templateId: input.templateId ?? null,
    meetingId: input.meetingId ?? null,
    messageClass: meeting ? "transactional_meeting" : "relationship_message",
    recipients,
    exclusions,
  };
}

export type EvryCommunicationMailResult =
  | Readonly<{ status: "accepted"; providerId: string }>
  | Readonly<{ status: "retryable"; reason: string }>
  | Readonly<{ status: "permanent"; reason: string }>;

export type EvryCommunicationMailer = Readonly<{
  send(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
    idempotencyKey: string;
  }): Promise<EvryCommunicationMailResult>;
}>;

export function classifyEvryCommunicationProviderError(
  error: unknown
):
  | Readonly<{ status: "retryable"; reason: string }>
  | Readonly<{ status: "permanent"; reason: string }> {
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const statusCode =
    typeof record.statusCode === "number"
      ? record.statusCode
      : typeof record.status === "number"
        ? record.status
        : null;
  const reason =
    typeof record.message === "string" && record.message.trim()
      ? record.message.slice(0, 500)
      : "Email provider request failed";
  return statusCode === null || statusCode === 429 || statusCode >= 500
    ? { status: "retryable", reason }
    : { status: "permanent", reason };
}

const productionMailer: EvryCommunicationMailer = Object.freeze({
  async send(input) {
    try {
      const { data, error } = await resend.emails.send(
        {
          from: EMAIL_FROM,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
        },
        { idempotencyKey: input.idempotencyKey }
      );
      if (error) return classifyEvryCommunicationProviderError(error);
      return data?.id
        ? { status: "accepted", providerId: data.id }
        : {
            status: "retryable",
            reason: "Email provider returned no message id",
          };
    } catch (error) {
      return classifyEvryCommunicationProviderError(error);
    }
  },
});

async function exactCommunication(input: {
  churchId: string;
  communicationId: string;
  actorUserId: string;
  audience: EvryCommunicationAudienceSnapshot;
}) {
  const [message] = await db
    .select()
    .from(communications)
    .where(
      and(
        eq(communications.id, input.communicationId),
        eq(communications.churchId, input.churchId)
      )
    )
    .limit(1);
  return Boolean(
    message &&
    message.createdById === input.actorUserId &&
    message.subject === input.audience.subject &&
    message.body === input.audience.body &&
    message.bodyHtml === input.audience.bodyHtml &&
    message.channel === input.audience.channel &&
    message.templateId === input.audience.templateId &&
    message.meetingId === input.audience.meetingId &&
    message.recipientCount === input.audience.recipients.length
  );
}

async function exactFrozenCommunication(input: {
  effect: Pick<EvryClaimedEffectInput, "effectKey" | "execution">;
  communicationId: string;
  audience: EvryCommunicationAudienceSnapshot;
}) {
  if (
    !(await exactCommunication({
      churchId: input.effect.execution.plantId,
      communicationId: input.communicationId,
      actorUserId: input.effect.execution.actorUserId,
      audience: input.audience,
    }))
  ) {
    return false;
  }
  const rows = await db
    .select({
      id: communicationRecipients.id,
      personId: communicationRecipients.personId,
      email: communicationRecipients.email,
    })
    .from(communicationRecipients)
    .where(
      and(
        eq(communicationRecipients.churchId, input.effect.execution.plantId),
        eq(communicationRecipients.communicationId, input.communicationId)
      )
    );
  return (
    rows.length === input.audience.recipients.length &&
    input.audience.recipients.every((recipient) => {
      const expectedId = communicationEvryEffectUuid(
        input.effect.effectKey,
        `recipient:${recipient.personId}`
      );
      return rows.some(
        (row) =>
          row.id === expectedId &&
          row.personId === recipient.personId &&
          row.email === recipient.email
      );
    })
  );
}

export async function hasExactFrozenEvryCommunication(input: {
  effect: EvryClaimedEffectInput;
  communicationId: string;
  audience: EvryCommunicationAudienceSnapshot;
}): Promise<boolean> {
  return exactFrozenCommunication({
    effect: input.effect,
    communicationId: input.communicationId,
    audience: input.audience,
  });
}

/**
 * A prepared batch is already a lasting effect even before the final ledger
 * claim. Keep it retryable while authority is absent so a later authorized
 * replay can finish the exact reviewed recipients without resending completed
 * rows or durably refusing the plan.
 */
export async function reconcileFrozenEvryCommunication(input: {
  effect: EvryClaimedEffectInput;
  communicationId: string;
  audience: EvryCommunicationAudienceSnapshot;
}): Promise<EvryEffectResult | null> {
  const claimed = await findExactEvryDatabaseEffectClaim(input.effect);
  if (claimed) return claimed;
  if (!(await hasExactFrozenEvryCommunication(input))) return null;
  return (await actorStillHoldsCommunicationSend(input.effect.execution))
    ? null
    : { status: "retryable" };
}

async function prepareFrozenCommunication(input: {
  effect: EvryEffectInput;
  communicationId: string;
  audience: EvryCommunicationAudienceSnapshot;
}): Promise<boolean> {
  const churchId = input.effect.execution.plantId;
  const actorUserId = input.effect.execution.actorUserId;
  await db.execute(sql`
    insert into communications (
      id, church_id, subject, body, body_html, channel, template_id,
      meeting_id, status, recipient_count, created_by_id
    )
    select
      ${input.communicationId}::uuid, actor.church_id, ${input.audience.subject},
      ${input.audience.body}, ${input.audience.bodyHtml},
      ${input.audience.channel}, ${input.audience.templateId}::uuid,
      ${input.audience.meetingId}::uuid, 'sending',
      ${input.audience.recipients.length}::int, actor.id
    from users actor
    where actor.id = ${actorUserId}::uuid
      and actor.church_id = ${churchId}::uuid
      and actor.sending_church_id is null
      and actor.sending_network_id is null
      and actor.seat in ('owner', 'admin')
    on conflict (id) do nothing
  `);
  if (
    !(await exactCommunication({
      churchId,
      communicationId: input.communicationId,
      actorUserId,
      audience: input.audience,
    }))
  ) {
    return false;
  }
  const existingRecipients = await db
    .select({ id: communicationRecipients.id })
    .from(communicationRecipients)
    .where(
      and(
        eq(communicationRecipients.churchId, churchId),
        eq(communicationRecipients.communicationId, input.communicationId)
      )
    );
  if (existingRecipients.length > 0) {
    return exactFrozenCommunication({
      effect: input.effect,
      communicationId: input.communicationId,
      audience: input.audience,
    });
  }
  if (input.audience.recipients.length > 0) {
    const recipientsJson = JSON.stringify(
      input.audience.recipients.map((recipient) => ({
        id: communicationEvryEffectUuid(
          input.effect.effectKey,
          `recipient:${recipient.personId}`
        ),
        person_id: recipient.personId,
        email: recipient.email,
      }))
    );
    await db.execute(sql`
      insert into communication_recipients (
        id, church_id, communication_id, person_id, email, channel, status
      )
      select
        recipient.id::uuid, actor.church_id, message.id,
        recipient.person_id::uuid, recipient.email, 'email', 'pending'
      from users actor
      join communications message
        on message.id = ${input.communicationId}::uuid
        and message.church_id = actor.church_id
        and message.created_by_id = actor.id
        and message.subject is not distinct from ${input.audience.subject}
        and message.body = ${input.audience.body}
        and message.body_html is not distinct from ${input.audience.bodyHtml}
        and message.channel = ${input.audience.channel}
        and message.template_id is not distinct from ${input.audience.templateId}::uuid
        and message.meeting_id is not distinct from ${input.audience.meetingId}::uuid
        and message.recipient_count = ${input.audience.recipients.length}::int
      cross join jsonb_to_recordset(${recipientsJson}::jsonb)
        as recipient(id text, person_id text, email text)
      where actor.id = ${actorUserId}::uuid
        and actor.church_id = ${churchId}::uuid
        and actor.sending_church_id is null
        and actor.sending_network_id is null
        and actor.seat in ('owner', 'admin')
      on conflict (id) do nothing
    `);
  }
  return exactFrozenCommunication({
    effect: input.effect,
    communicationId: input.communicationId,
    audience: input.audience,
  });
}

async function currentRecipientIds(input: {
  churchId: string;
  recipients: readonly EvryCommunicationRecipientSnapshot[];
}) {
  if (input.recipients.length === 0) return new Set<string>();
  const rows = await db
    .select({ id: persons.id, email: persons.email })
    .from(persons)
    .where(
      and(
        eq(persons.churchId, input.churchId),
        inArray(
          persons.id,
          input.recipients.map(({ personId }) => personId)
        ),
        sql`${persons.deletedAt} is null`
      )
    );
  const suppressed = new Set(
    await loadSuppressedAddresses(
      rows.flatMap(({ email }) => (email ? [email] : []))
    )
  );
  return new Set(
    rows.flatMap((row) => {
      const planned = input.recipients.find(
        ({ personId }) => personId === row.id
      );
      if (!planned || !row.email) return [];
      const email = normalizeEmailAddress(row.email);
      return email === planned.email && !suppressed.has(email) ? [row.id] : [];
    })
  );
}

async function recipientIsStillDispatchable(input: {
  churchId: string;
  recipient: EvryCommunicationRecipientSnapshot;
}) {
  const current = await currentRecipientIds({
    churchId: input.churchId,
    recipients: [input.recipient],
  });
  return current.has(input.recipient.personId);
}

async function renderedOutbound(input: {
  churchName: string;
  churchId: string;
  meetingId: string | null;
  recipient: EvryCommunicationRecipientSnapshot;
}) {
  let confirmUrl: string | undefined;
  let declineUrl: string | undefined;
  if (input.meetingId) {
    const token = await createConfirmationToken(
      input.churchId,
      input.meetingId,
      input.recipient.personId
    );
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    confirmUrl = `${base}/rsvp/${token}`;
    declineUrl = `${base}/rsvp/${token}?action=decline`;
  }
  return {
    html: await render(
      CommunicationEmail({
        bodyHtml: input.recipient.bodyHtml,
        confirmUrl,
        declineUrl,
        churchName: input.churchName,
        previewText: input.recipient.subject,
      })
    ),
    text: await render(
      CommunicationEmailText({
        body: input.recipient.bodyText,
        churchName: input.churchName,
      }),
      { plainText: true }
    ),
  };
}

/**
 * Dispatch only the approved frozen recipients. Stable per-recipient provider
 * keys make concurrent calls and a lost response converge on one delivery.
 */
export async function sendFrozenEvryCommunication(input: {
  effect: EvryEffectInput;
  identity: string;
  communicationId: string;
  audience: EvryCommunicationAudienceSnapshot;
  /** Exact resend eligibility set resolved again immediately before writes. */
  eligiblePersonIds?: ReadonlySet<string>;
  mailer?: EvryCommunicationMailer;
}): Promise<EvryEffectResult> {
  const actor = input.effect.authorization.actor;
  if (
    input.effect.authorization.registration.identity !== input.identity ||
    input.effect.execution.capabilityIdentity !== input.identity ||
    input.effect.execution.actorUserId !== actor.userId ||
    input.effect.execution.plantId !== actor.plantId ||
    input.audience.channel !== "email" ||
    input.audience.recipients.length > EVRY_COMMUNICATION_MAX_RECIPIENTS
  ) {
    return { status: "refused", excludedCount: 1 };
  }
  if (!(await actorStillHoldsCommunicationSend(input.effect.execution))) {
    return { status: "refused", excludedCount: 1 };
  }
  // This gate deliberately precedes the communication row, recipient rows,
  // RSVP tokens, and provider calls. A stale confirmation must leave no trace.
  const [[church], current] = await Promise.all([
    db
      .select({ name: churches.name })
      .from(churches)
      .where(eq(churches.id, actor.plantId))
      .limit(1),
    currentRecipientIds({
      churchId: actor.plantId,
      recipients: input.audience.recipients,
    }),
  ]);
  const plannedPersonIds = new Set(
    input.audience.recipients.map(({ personId }) => personId)
  );
  const sameCurrentRecipients =
    current.size === plannedPersonIds.size &&
    [...plannedPersonIds].every((personId) => current.has(personId));
  const sameResendRecipients =
    !input.eligiblePersonIds ||
    (input.eligiblePersonIds.size === plannedPersonIds.size &&
      [...plannedPersonIds].every((personId) =>
        input.eligiblePersonIds?.has(personId)
      ));
  if (!church || !sameCurrentRecipients || !sameResendRecipients) {
    return { status: "refused", excludedCount: 1 };
  }
  if (!(await prepareFrozenCommunication(input))) {
    return (await exactFrozenCommunication({
      effect: input.effect,
      communicationId: input.communicationId,
      audience: input.audience,
    }))
      ? { status: "retryable" }
      : { status: "refused", excludedCount: 1 };
  }
  const storedRows = await db
    .select()
    .from(communicationRecipients)
    .where(
      and(
        eq(communicationRecipients.churchId, actor.plantId),
        eq(communicationRecipients.communicationId, input.communicationId)
      )
    );

  const byPerson = new Map(storedRows.map((row) => [row.personId, row]));
  let affectedCount = 0;
  let excludedCount = input.audience.exclusions.reduce(
    (sum, exclusion) => sum + exclusion.count,
    0
  );
  let retryable = false;
  let permanentProviderFailures = 0;
  const mailer = input.mailer ?? productionMailer;
  for (const recipient of input.audience.recipients) {
    const row = byPerson.get(recipient.personId);
    if (!row) return { status: "retryable" };
    if (["sent", "delivered", "opened", "clicked"].includes(row.status)) {
      affectedCount += 1;
      continue;
    }
    if (
      row.status === "bounced" ||
      row.errorMessage?.startsWith(EVRY_COMMUNICATION_PERMANENT_PREFIX)
    ) {
      permanentProviderFailures += 1;
      excludedCount += 1;
      continue;
    }
    // A complaint or hard-bounce webhook can arrive after the whole-audience
    // stale-plan gate above. Recheck this exact address after composition and
    // immediately before the provider boundary so a later recipient is never
    // mailed from a now-stale batch. The terminal row makes the skip visible
    // and prevents a retry from attempting it again.
    if (!(await actorStillHoldsCommunicationSend(input.effect.execution))) {
      return { status: "retryable" };
    }
    if (
      !(await recipientIsStillDispatchable({
        churchId: actor.plantId,
        recipient,
      }))
    ) {
      await db
        .update(communicationRecipients)
        .set({
          status: "failed",
          errorMessage: `${EVRY_COMMUNICATION_PERMANENT_PREFIX}recipient or suppression changed immediately before provider send`,
        })
        .where(
          and(eq(communicationRecipients.id, row.id), dispatchableRecipient())
        );
      permanentProviderFailures += 1;
      excludedCount += 1;
      continue;
    }
    const outbound = await renderedOutbound({
      churchName: church.name,
      churchId: actor.plantId,
      meetingId: input.audience.meetingId,
      recipient,
    });
    if (!(await actorStillHoldsCommunicationSend(input.effect.execution))) {
      return { status: "retryable" };
    }
    const result = await mailer.send({
      to: recipient.email,
      subject: recipient.subject,
      html: outbound.html,
      text: outbound.text,
      idempotencyKey: `evry-${input.effect.effectKey}-${row.id}`,
    });
    if (result.status === "accepted") {
      await db
        .update(communicationRecipients)
        .set({
          status: "sent",
          externalId: result.providerId,
          errorMessage: null,
        })
        .where(
          and(eq(communicationRecipients.id, row.id), dispatchableRecipient())
        );
      affectedCount += 1;
    } else if (result.status === "retryable") {
      await db
        .update(communicationRecipients)
        .set({
          status: "failed",
          errorMessage: `${EVRY_COMMUNICATION_TRANSIENT_PREFIX}${result.reason}`,
        })
        .where(
          and(eq(communicationRecipients.id, row.id), dispatchableRecipient())
        );
      retryable = true;
    } else {
      await db
        .update(communicationRecipients)
        .set({
          status: "failed",
          errorMessage: `${EVRY_COMMUNICATION_PERMANENT_PREFIX}${result.reason}`,
        })
        .where(
          and(eq(communicationRecipients.id, row.id), dispatchableRecipient())
        );
      permanentProviderFailures += 1;
      excludedCount += 1;
    }
  }
  if (retryable) return { status: "retryable" };

  if (affectedCount === 0 && permanentProviderFailures > 0) {
    await db
      .update(communications)
      .set({ status: "failed", updatedAt: new Date() })
      .where(
        and(
          eq(communications.id, input.communicationId),
          eq(communications.churchId, actor.plantId)
        )
      );
    return { status: "failed", excludedCount };
  }

  const completion = await claimEvryCommunicationDatabaseEffect({
    execution: input.effect.execution,
    effectKey: input.effect.effectKey,
    mutation: sql`
      update communications c
      set status = 'sent', sent_at = coalesce(c.sent_at, transaction_timestamp()),
          updated_at = transaction_timestamp()
      from eligible e
      where c.id = ${input.communicationId}::uuid
        and c.church_id = e.church_id
        and c.created_by_id = e.actor_user_id
      returning ${affectedCount}::int affected_count,
                ${excludedCount}::int excluded_count
    `,
    async targetIsCurrent() {
      return exactCommunication({
        churchId: actor.plantId,
        communicationId: input.communicationId,
        actorUserId: actor.userId,
        audience: input.audience,
      });
    },
  });
  return completion.status === "refused" ? { status: "retryable" } : completion;
}
