// ============================================================================
// Communication Service
// ============================================================================
//
// Core service for sending messages, tracking delivery, and querying
// communication history. Integrates with Resend for email delivery
// and the merge field engine for personalization.
// ============================================================================

import { and, desc, eq, inArray, isNull, sql, count } from "drizzle-orm";
import { db } from "@/db";
import {
  communications,
  communicationRecipients,
  type Communication,
  type CommunicationChannel,
  type CommunicationRecipient,
  type CommunicationStatus,
  type RecipientStatus,
} from "@/db/schema/communication";
import { persons, type PersonStatus } from "@/db/schema/people";
import { churches } from "@/db/schema/church";
import { churchMeetings } from "@/db/schema/meetings";
import { ministryTeams, teamMemberships } from "@/db/schema/ministry-teams";
import { render } from "@react-email/components";
import { resend, EMAIL_FROM } from "@/lib/email/client";
import {
  CommunicationEmail,
  CONFIRM_PLACEHOLDER,
  DECLINE_PLACEHOLDER,
} from "@/lib/email/components/communication-email";
import {
  renderTemplate,
  buildPersonMergeData,
  buildChurchMergeData,
  buildMeetingMergeData,
} from "./merge";
import { createConfirmationToken } from "./confirmation";
import {
  buildCommunicationsWhere,
  type CommunicationQueryFilters,
} from "./filters";
import {
  DELIVERED_STATUSES,
  OPENED_STATUSES,
  type DeliveryTotals,
  churchDeliveryScope,
  countAttempted,
  countOfStatus,
  countOfStatuses,
  isTeamGroup,
  messageRecipientScope,
  nonOpenerScope,
  parseTeamGroup,
  selectableTeamsOrder,
  selectableTeamsScope,
  sentMessagesScope,
  sentSinceScope,
  teamGroup,
  teamMemberScope,
} from "./queries";
import {
  evaluateResendEligibility,
  resendBlockedMessage,
} from "./resend-policy";
import {
  escapeMergeValues,
  richTextToPlainText,
  toRichTextHtml,
} from "@/lib/rich-text/format";
import type { ComposeMessageInput } from "@/lib/validations/communication";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommunicationWithStats extends Communication {
  stats: {
    total: number;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    failed: number;
  };
}

export interface RecipientWithPerson extends CommunicationRecipient {
  person: {
    firstName: string;
    lastName: string;
    email: string | null;
  };
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

/**
 * Send a communication to the specified recipients.
 * Creates the communication record, resolves merge data per recipient,
 * sends via Resend, and stores external IDs for tracking.
 */
export async function sendCommunication(
  churchId: string,
  userId: string,
  input: ComposeMessageInput
): Promise<Communication> {
  // 1. Load church for merge data
  const [church] = await db
    .select()
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);
  if (!church) throw new Error("Church not found");

  const churchMergeData = buildChurchMergeData(church);

  // COM-017. The body is rich text, and THIS is the gate — not the editor.
  // Every export of the compose action is a POSTable endpoint, so the markup
  // arriving here has never been anywhere near the toolbar. It is sanitised
  // once, before it is stored and before it is rendered, and the stored row is
  // the sanitised form: nothing downstream re-derives it and gets it wrong.
  // A legacy plain-text body (a system template, a resend of an older message)
  // is converted rather than escaped into gibberish — `toRichTextHtml` decides.
  const safeBodyHtml = toRichTextHtml(input.body);
  // The text/plain half of the email is flattened from the SAME safe HTML, so
  // the two halves can never say different things.
  const safeBodyText = richTextToPlainText(safeBodyHtml);

  // 2. Load meeting if provided
  let meetingMergeData: Record<string, string> = {};
  let meeting: typeof churchMeetings.$inferSelect | null = null;
  if (input.meetingId) {
    const [m] = await db
      .select()
      .from(churchMeetings)
      .where(
        and(
          eq(churchMeetings.id, input.meetingId),
          eq(churchMeetings.churchId, churchId)
        )
      )
      .limit(1);
    if (m) {
      meeting = m;
      meetingMergeData = buildMeetingMergeData(m);
    }
  }

  // 3. Load recipients
  const recipientPersons = await db
    .select()
    .from(persons)
    .where(
      and(
        eq(persons.churchId, churchId),
        inArray(persons.id, input.recipientIds)
      )
    );

  if (recipientPersons.length === 0) {
    throw new Error("No valid recipients found");
  }

  // 4. Create communication record
  const [comm] = await db
    .insert(communications)
    .values({
      churchId,
      subject: input.subject,
      body: safeBodyHtml,
      channel: input.channel,
      templateId: input.templateId,
      meetingId: input.meetingId,
      status: "sending",
      recipientCount: recipientPersons.length,
      createdById: userId,
    })
    .returning();

  // 5. Create recipient records and prepare emails
  const emailBatch: Array<{
    from: string;
    to: string[];
    subject: string;
    html: string;
    text: string;
  }> = [];

  const recipientRecords: Array<{
    churchId: string;
    communicationId: string;
    personId: string;
    email: string;
    channel: "email";
    status: "pending";
  }> = [];

  for (const person of recipientPersons) {
    if (!person.email) continue;

    const personMergeData = buildPersonMergeData(person);
    const mergeData = {
      ...churchMergeData,
      ...meetingMergeData,
      ...personMergeData,
    };

    // Generate confirmation tokens if this is meeting-linked
    let confirmUrl: string | undefined;
    let declineUrl: string | undefined;
    if (meeting) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const token = await createConfirmationToken(
        churchId,
        meeting.id,
        person.id
      );
      confirmUrl = `${appUrl}/rsvp/${token}`;
      declineUrl = `${appUrl}/rsvp/${token}?action=decline`;
      // Use placeholders in merge data so CommunicationEmail can render buttons
      mergeData.confirm_link = CONFIRM_PLACEHOLDER;
      mergeData.decline_link = DECLINE_PLACEHOLDER;
    }

    const renderedSubject = input.subject
      ? renderTemplate(input.subject, mergeData)
      : "";
    // Merge VALUES are escaped before they land in an HTML body — a person
    // called `Bobby <script>` is a name, not markup. The token substitution
    // itself is still `renderTemplate`, the one implementation of it.
    const renderedBodyHtml = renderTemplate(
      safeBodyHtml,
      escapeMergeValues(mergeData)
    );
    const renderedBodyText = renderTemplate(safeBodyText, mergeData);

    const html = await render(
      CommunicationEmail({
        bodyHtml: renderedBodyHtml,
        confirmUrl,
        declineUrl,
        churchName: church.name,
        previewText: renderedSubject,
      })
    );

    const text = await render(
      CommunicationEmail({
        body: renderedBodyText,
        churchName: church.name,
      }),
      { plainText: true }
    );

    emailBatch.push({
      from: EMAIL_FROM,
      to: [person.email],
      subject: renderedSubject,
      html,
      text,
    });

    recipientRecords.push({
      churchId,
      communicationId: comm.id,
      personId: person.id,
      email: person.email,
      channel: "email" as const,
      status: "pending" as const,
    });
  }

  // 6. Insert recipient records
  let insertedRecipients: CommunicationRecipient[] = [];
  if (recipientRecords.length > 0) {
    insertedRecipients = await db
      .insert(communicationRecipients)
      .values(recipientRecords)
      .returning();
  }

  // 7. Send via Resend (batch if > 1, single otherwise)
  try {
    if (emailBatch.length === 0) {
      // No valid email recipients
      await db
        .update(communications)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(communications.id, comm.id));
    } else if (emailBatch.length === 1) {
      // Single send
      const { data, error } = await resend.emails.send(emailBatch[0]);
      if (error) {
        console.error("[COMM] Single send failed:", error);
        await updateRecipientStatus(
          insertedRecipients[0].id,
          "failed",
          error.message
        );
      } else if (data?.id) {
        await db
          .update(communicationRecipients)
          .set({ externalId: data.id, status: "sent" })
          .where(eq(communicationRecipients.id, insertedRecipients[0].id));
      }
      await db
        .update(communications)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(communications.id, comm.id));
    } else {
      // Batch send (max 100 per batch)
      const chunks = chunkArray(emailBatch, 100);
      let recipientIdx = 0;

      for (const chunk of chunks) {
        const { data, error } = await resend.batch.send(chunk);
        if (error) {
          console.error("[COMM] Batch send failed:", error);
          // Mark all recipients in this chunk as failed
          for (let i = 0; i < chunk.length; i++) {
            if (insertedRecipients[recipientIdx + i]) {
              await updateRecipientStatus(
                insertedRecipients[recipientIdx + i].id,
                "failed",
                error.message
              );
            }
          }
        } else if (data) {
          // Map Resend IDs back to recipient records
          const ids = Array.isArray(data) ? data : [data];
          for (let i = 0; i < ids.length; i++) {
            const resendItem = ids[i];
            const recipient = insertedRecipients[recipientIdx + i];
            if (recipient && resendItem?.id) {
              await db
                .update(communicationRecipients)
                .set({ externalId: resendItem.id, status: "sent" })
                .where(eq(communicationRecipients.id, recipient.id));
            }
          }
        }
        recipientIdx += chunk.length;
      }

      await db
        .update(communications)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(communications.id, comm.id));
    }
  } catch (err) {
    console.error("[COMM] Send exception:", err);
    await db
      .update(communications)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(communications.id, comm.id));
  }

  // Return the updated communication
  const [result] = await db
    .select()
    .from(communications)
    .where(eq(communications.id, comm.id))
    .limit(1);
  return result;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface GetCommunicationsOptions {
  page?: number;
  limit?: number;
  /** Exact channel match. */
  channel?: CommunicationChannel;
  /** Exact send-status match. */
  status?: CommunicationStatus;
  /** Case-insensitive substring match against subject or body. */
  search?: string;
}

/**
 * List communications for a church with pagination and optional filters.
 * `total` reflects the same filters, so pagination stays consistent.
 */
export async function getCommunications(
  churchId: string,
  options: GetCommunicationsOptions = {}
): Promise<{ communications: Communication[]; total: number }> {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const offset = (page - 1) * limit;
  const where = buildCommunicationsWhere(churchId, options);

  const [comms, [{ total }]] = await Promise.all([
    db
      .select()
      .from(communications)
      .where(where)
      .orderBy(desc(communications.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(communications).where(where),
  ]);

  return { communications: comms, total };
}

/**
 * Count communications matching the same filters `getCommunications` honours,
 * without paying for the rows. Used by the hub's stat cards, which need a
 * church-wide number and not "however many of the last 10 qualified".
 */
export async function countCommunications(
  churchId: string,
  filters: CommunicationQueryFilters = {}
): Promise<number> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(communications)
    .where(buildCommunicationsWhere(churchId, filters));
  return total;
}

/**
 * How many messages this church actually SENT since `since`.
 *
 * The predicate lives in `queries.ts` (`sentSinceScope`) with the rest of the
 * aggregation scopes, where `queries.test.ts` compiles it and pins the church
 * bound parameter — the boundary is application-layer, so the clause IS the
 * boundary.
 */
export async function countSentSince(
  churchId: string,
  since: Date
): Promise<number> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(communications)
    .where(sentSinceScope(churchId, since));
  return total;
}

/**
 * Resolve merge field variables in communication subjects for display.
 * Loads church + linked meetings in bulk, then renders each subject.
 * Returns a Map of communicationId -> resolvedSubject.
 */
export async function resolveSubjects(
  churchId: string,
  comms: Communication[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (comms.length === 0) return result;

  // Load church
  const [church] = await db
    .select()
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);

  const churchData = church ? buildChurchMergeData(church) : {};

  // Batch-load all linked meetings
  const meetingIds = [
    ...new Set(comms.map((c) => c.meetingId).filter(Boolean) as string[]),
  ];
  const meetingMap = new Map<string, Record<string, string>>();
  if (meetingIds.length > 0) {
    const meetings = await db
      .select()
      .from(churchMeetings)
      .where(inArray(churchMeetings.id, meetingIds));
    for (const m of meetings) {
      meetingMap.set(m.id, buildMeetingMergeData(m));
    }
  }

  for (const comm of comms) {
    if (!comm.subject) {
      result.set(comm.id, "(No subject)");
      continue;
    }
    const mergeData: Record<string, string> = {
      ...churchData,
      ...(comm.meetingId ? (meetingMap.get(comm.meetingId) ?? {}) : {}),
    };
    result.set(comm.id, renderTemplate(comm.subject, mergeData));
  }

  return result;
}

/**
 * Get a single communication with recipient stats.
 */
export async function getCommunication(
  churchId: string,
  id: string
): Promise<CommunicationWithStats | null> {
  const [comm] = await db
    .select()
    .from(communications)
    .where(
      and(eq(communications.id, id), eq(communications.churchId, churchId))
    )
    .limit(1);

  if (!comm) return null;

  const recipients = await db
    .select()
    .from(communicationRecipients)
    .where(eq(communicationRecipients.communicationId, id));

  const stats = {
    total: recipients.length,
    sent: recipients.filter((r) => r.status !== "pending").length,
    delivered: recipients.filter(
      (r) =>
        r.status === "delivered" ||
        r.status === "opened" ||
        r.status === "clicked"
    ).length,
    opened: recipients.filter(
      (r) => r.status === "opened" || r.status === "clicked"
    ).length,
    clicked: recipients.filter((r) => r.status === "clicked").length,
    bounced: recipients.filter((r) => r.status === "bounced").length,
    failed: recipients.filter((r) => r.status === "failed").length,
  };

  return { ...comm, stats };
}

/**
 * Get recipients for a communication with person details.
 */
export async function getCommunicationRecipients(
  communicationId: string
): Promise<RecipientWithPerson[]> {
  const rows = await db
    .select({
      recipient: communicationRecipients,
      person: {
        firstName: persons.firstName,
        lastName: persons.lastName,
        email: persons.email,
      },
    })
    .from(communicationRecipients)
    .innerJoin(persons, eq(communicationRecipients.personId, persons.id))
    .where(eq(communicationRecipients.communicationId, communicationId));

  return rows.map((row) => ({
    ...row.recipient,
    person: row.person,
  }));
}

/**
 * Get communication history for a specific person.
 */
export async function getPersonCommunications(
  churchId: string,
  personId: string
): Promise<
  Array<{
    communication: Communication;
    recipient: CommunicationRecipient;
  }>
> {
  const rows = await db
    .select({
      communication: communications,
      recipient: communicationRecipients,
    })
    .from(communicationRecipients)
    .innerJoin(
      communications,
      eq(communicationRecipients.communicationId, communications.id)
    )
    .where(
      and(
        eq(communicationRecipients.personId, personId),
        eq(communications.churchId, churchId)
      )
    )
    .orderBy(desc(communications.createdAt));

  return rows;
}

/**
 * Get communications sent for a specific meeting with tracking stats.
 */
export async function getMeetingCommunications(
  churchId: string,
  meetingId: string
): Promise<CommunicationWithStats[]> {
  const comms = await db
    .select()
    .from(communications)
    .where(
      and(
        eq(communications.churchId, churchId),
        eq(communications.meetingId, meetingId)
      )
    )
    .orderBy(desc(communications.createdAt));

  if (comms.length === 0) return [];

  // Batch-fetch all recipients for these communications
  const commIds = comms.map((c) => c.id);
  const allRecipients = await db
    .select()
    .from(communicationRecipients)
    .where(inArray(communicationRecipients.communicationId, commIds));

  // Group by communication
  const recipientsByComm = new Map<string, typeof allRecipients>();
  for (const r of allRecipients) {
    const existing = recipientsByComm.get(r.communicationId) ?? [];
    existing.push(r);
    recipientsByComm.set(r.communicationId, existing);
  }

  return comms.map((comm) => {
    const recipients = recipientsByComm.get(comm.id) ?? [];
    return {
      ...comm,
      stats: {
        total: recipients.length,
        sent: recipients.filter((r) => r.status !== "pending").length,
        delivered: recipients.filter(
          (r) =>
            r.status === "delivered" ||
            r.status === "opened" ||
            r.status === "clicked"
        ).length,
        opened: recipients.filter(
          (r) => r.status === "opened" || r.status === "clicked"
        ).length,
        clicked: recipients.filter((r) => r.status === "clicked").length,
        bounced: recipients.filter((r) => r.status === "bounced").length,
        failed: recipients.filter((r) => r.status === "failed").length,
      },
    };
  });
}

/**
 * Get tracking data for a meeting's recipients.
 * Returns per-person tracking keyed by person_id.
 */
export async function getMeetingTrackingByPerson(
  meetingId: string
): Promise<
  Map<
    string,
    { status: RecipientStatus; deliveredAt: Date | null; openedAt: Date | null }
  >
> {
  const rows = await db
    .select({
      personId: communicationRecipients.personId,
      status: communicationRecipients.status,
      deliveredAt: communicationRecipients.deliveredAt,
      openedAt: communicationRecipients.openedAt,
    })
    .from(communicationRecipients)
    .innerJoin(
      communications,
      eq(communicationRecipients.communicationId, communications.id)
    )
    .where(eq(communications.meetingId, meetingId));

  const map = new Map<
    string,
    { status: RecipientStatus; deliveredAt: Date | null; openedAt: Date | null }
  >();
  for (const row of rows) {
    // Keep the most advanced status per person
    const existing = map.get(row.personId);
    const statusOrder: RecipientStatus[] = [
      "pending",
      "failed",
      "bounced",
      "sent",
      "delivered",
      "opened",
      "clicked",
    ];
    if (
      !existing ||
      statusOrder.indexOf(row.status as RecipientStatus) >
        statusOrder.indexOf(existing.status)
    ) {
      map.set(row.personId, {
        status: row.status as RecipientStatus,
        deliveredAt: row.deliveredAt,
        openedAt: row.openedAt,
      });
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Delivery Statistics — church-wide overview (COM-019)
// ---------------------------------------------------------------------------

/**
 * Aggregate delivery, open and click telemetry across every message the church
 * has sent. One grouped scan of `communication_recipients` joined to its
 * `communications` row, plus a count of the sent messages themselves for
 * context — never a per-message fan-out.
 *
 * Rates are NOT computed here. The counts are the facts; turning them into
 * percentages (and refusing to divide by zero) is `summarizeDelivery` in
 * `@/components/communication/delivery-stats-presentation`.
 */
export async function getChurchDeliveryTotals(
  churchId: string
): Promise<DeliveryTotals> {
  const [[telemetry], [messages]] = await Promise.all([
    db
      .select({
        recipients: count(),
        attempted: countAttempted(),
        delivered: countOfStatuses(DELIVERED_STATUSES),
        opened: countOfStatuses(OPENED_STATUSES),
        clicked: countOfStatus("clicked"),
        bounced: countOfStatus("bounced"),
        failed: countOfStatus("failed"),
      })
      .from(communicationRecipients)
      .innerJoin(
        communications,
        eq(communicationRecipients.communicationId, communications.id)
      )
      .where(churchDeliveryScope(churchId)),
    db
      .select({ total: count() })
      .from(communications)
      .where(sentMessagesScope(churchId)),
  ]);

  return {
    messagesSent: messages?.total ?? 0,
    recipients: telemetry?.recipients ?? 0,
    attempted: telemetry?.attempted ?? 0,
    delivered: telemetry?.delivered ?? 0,
    opened: telemetry?.opened ?? 0,
    clicked: telemetry?.clicked ?? 0,
    bounced: telemetry?.bounced ?? 0,
    failed: telemetry?.failed ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Resend to non-openers (COM-018)
// ---------------------------------------------------------------------------

export interface NonOpenerSummary {
  /** Recipient rows on the original message. */
  total: number;
  /** Of those, the ones the provider confirmed as delivered. */
  delivered: number;
  /** Of those, the ones that recorded an open (a click implies an open). */
  opened: number;
  /** People a resend would actually reach — the count shown before confirming. */
  personIds: string[];
}

/**
 * Who a resend of this message would go to, and who it would skip.
 *
 * The resolved list is the contract: `resendToNonOpeners` sends to exactly
 * these ids, so the number the user confirms is the number that is sent.
 */
export async function getNonOpenerSummary(
  churchId: string,
  communicationId: string
): Promise<NonOpenerSummary> {
  const [nonOpeners, [totals]] = await Promise.all([
    db
      .selectDistinct({ personId: communicationRecipients.personId })
      .from(communicationRecipients)
      .innerJoin(
        communications,
        eq(communicationRecipients.communicationId, communications.id)
      )
      .innerJoin(persons, eq(communicationRecipients.personId, persons.id))
      .where(nonOpenerScope(churchId, communicationId)),
    db
      .select({
        total: count(),
        delivered: countOfStatuses(DELIVERED_STATUSES),
        opened: countOfStatuses(OPENED_STATUSES),
      })
      .from(communicationRecipients)
      .where(messageRecipientScope(churchId, communicationId)),
  ]);

  return {
    total: totals?.total ?? 0,
    delivered: totals?.delivered ?? 0,
    opened: totals?.opened ?? 0,
    personIds: nonOpeners.map((row) => row.personId),
  };
}

/** Thrown when a resend has nobody left to reach. */
export const NO_NON_OPENERS_MESSAGE = resendBlockedMessage("noNonOpeners");

/**
 * Send the original message again, to the recipients who recorded no open.
 *
 * This creates a NEW communication. The original is never touched: its
 * recipient rows and its tracking stay exactly as they were, and history shows
 * two messages, which is what the delivery figures depend on.
 *
 * The eligibility gate is enforced HERE, not only on the button. The button
 * can be stale, and the action is callable directly — a resend inside the
 * cooldown, or before anything is confirmed delivered, is refused either way.
 */
export async function resendToNonOpeners(
  churchId: string,
  userId: string,
  communicationId: string
): Promise<Communication> {
  const [original] = await db
    .select()
    .from(communications)
    .where(
      and(
        eq(communications.id, communicationId),
        eq(communications.churchId, churchId)
      )
    )
    .limit(1);

  if (!original) throw new Error("Message not found");

  const { delivered, personIds } = await getNonOpenerSummary(
    churchId,
    communicationId
  );

  const { allowed, reason } = evaluateResendEligibility({
    status: original.status,
    sentAt: original.sentAt,
    deliveredCount: delivered,
    nonOpenerCount: personIds.length,
  });
  if (!allowed && reason) throw new Error(resendBlockedMessage(reason));

  return sendCommunication(churchId, userId, {
    subject: original.subject ?? "",
    body: original.body,
    channel: original.channel,
    templateId: original.templateId ?? undefined,
    meetingId: original.meetingId ?? undefined,
    recipientIds: personIds,
  });
}

// ---------------------------------------------------------------------------
// Recipient Group Resolution
// ---------------------------------------------------------------------------

/** A person as the recipient picker needs them. */
export interface GroupRecipient {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

/** The ministry teams offered as recipient quick-selects (MT-015). */
export interface RecipientTeamOption {
  id: string;
  name: string;
  /**
   * The group selector to hand back to `getGroupRecipients` — built here so
   * the client component never has to import the query module (and drizzle
   * with it) just to spell `team:<id>`.
   */
  selector: string;
  /** Active members — a team with none is offered, and resolves to zero. */
  memberCount: number;
}

const personColumns = {
  id: persons.id,
  firstName: persons.firstName,
  lastName: persons.lastName,
  email: persons.email,
};

/** Status groups, by their quick-select id. */
const STATUS_GROUPS: Record<string, PersonStatus[]> = {
  core_group: ["core_group"],
  launch_team: ["launch_team"],
  leaders: ["leader"],
  prospects: ["prospect"],
  all: [],
};

/**
 * Resolve a quick-select group into the people it names.
 *
 * Two kinds of selector:
 *  - a status group (`core_group`, `leaders`, `all`, …);
 *  - `team:<teamId>`, the active members of one ministry team (MT-015).
 *
 * An unknown selector resolves to every active person, matching the previous
 * behaviour of the status switch. A team with no active members resolves to
 * an empty list — the caller shows that as "0 recipients", not as an error.
 */
export async function getGroupRecipients(
  churchId: string,
  group: string
): Promise<GroupRecipient[]> {
  if (isTeamGroup(group)) {
    const teamId = parseTeamGroup(group);
    // A malformed team selector names nobody. It must NOT fall through to the
    // status branch, where an unrecognised group means every active person.
    if (!teamId) return [];

    // A person holding two roles on one team has two membership rows, so the
    // select must be distinct or they would be added to the picker twice.
    return db
      .selectDistinct(personColumns)
      .from(teamMemberships)
      .innerJoin(persons, eq(teamMemberships.personId, persons.id))
      .where(teamMemberScope(churchId, teamId));
  }

  const statusFilter = STATUS_GROUPS[group] ?? [];
  const conditions = [
    eq(persons.churchId, churchId),
    isNull(persons.deletedAt),
  ];
  if (statusFilter.length > 0) {
    conditions.push(inArray(persons.status, statusFilter));
  }

  return db
    .select(personColumns)
    .from(persons)
    .where(and(...conditions));
}

/**
 * Resolve a quick-select group into person IDs. Same resolution as
 * `getGroupRecipients` — including `team:<teamId>` — narrowed to ids.
 */
export async function getRecipientsByGroup(
  churchId: string,
  group: string
): Promise<string[]> {
  const people = await getGroupRecipients(churchId, group);
  return people.map((p) => p.id);
}

/**
 * The church's ministry teams, as recipient quick-selects with their active
 * member counts. Paused teams are left out; a `forming` team is one a planter
 * is actively staffing and very much wants to email.
 */
export async function listRecipientTeams(
  churchId: string
): Promise<RecipientTeamOption[]> {
  const rows = await db
    .select({
      id: ministryTeams.id,
      name: ministryTeams.name,
      sortOrder: ministryTeams.sortOrder,
      memberCount: sql<number>`count(distinct ${persons.id})::int`,
    })
    .from(ministryTeams)
    .leftJoin(
      teamMemberships,
      and(
        eq(teamMemberships.teamId, ministryTeams.id),
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.status, "active")
      )
    )
    .leftJoin(
      persons,
      and(
        eq(persons.id, teamMemberships.personId),
        isNull(persons.deletedAt),
        eq(persons.churchId, churchId)
      )
    )
    .where(selectableTeamsScope(churchId))
    .groupBy(ministryTeams.id, ministryTeams.name, ministryTeams.sortOrder)
    .orderBy(...selectableTeamsOrder);

  return rows.map(({ id, name, memberCount }) => ({
    id,
    name,
    selector: teamGroup(id),
    memberCount,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function updateRecipientStatus(
  recipientId: string,
  status: RecipientStatus,
  errorMessage?: string
) {
  await db
    .update(communicationRecipients)
    .set({ status, errorMessage })
    .where(eq(communicationRecipients.id, recipientId));
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
