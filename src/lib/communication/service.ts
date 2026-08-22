// ============================================================================
// Communication Reads
// ============================================================================
//
// The church-scoped reads of the communication domain: history listings,
// per-message stats, per-meeting tracking, and the COM-019 church-wide
// delivery aggregate. The send pipeline (Resend, the email renderer) lives in
// `send.ts`; recipient-group resolution lives in `recipient-groups.ts`.
// ============================================================================

import { and, desc, eq, inArray, count } from "drizzle-orm";
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
import { persons } from "@/db/schema/people";
import { churches } from "@/db/schema/church";
import { churchMeetings } from "@/db/schema/meetings";
import {
  renderSubject,
  buildChurchMergeData,
  buildMeetingMergeData,
} from "./merge";
import {
  buildCommunicationsWhere,
  type CommunicationQueryFilters,
} from "./filters";
import {
  DELIVERED_STATUSES,
  OPENED_STATUSES,
  TRACKING_DISPLAY_PRECEDENCE,
  type DeliveryTotals,
  type MessageDeliveryStats,
  churchDeliveryScope,
  countAttempted,
  countOfStatus,
  countOfStatuses,
  meetingTrackingScope,
  messageRecipientScope,
  sentMessagesScope,
  sentSinceScope,
  summarizeRecipients,
} from "./queries";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommunicationWithStats extends Communication {
  stats: MessageDeliveryStats;
}

export interface RecipientWithPerson extends CommunicationRecipient {
  person: {
    firstName: string;
    lastName: string;
    email: string | null;
  };
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
      .where(
        and(
          inArray(churchMeetings.id, meetingIds),
          eq(churchMeetings.churchId, churchId)
        )
      );
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
    result.set(comm.id, renderSubject(comm.subject, mergeData));
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
    .where(messageRecipientScope(churchId, id));

  return { ...comm, stats: summarizeRecipients(recipients) };
}

/**
 * Get recipients for a communication with person details. Church-scoped in the
 * query itself — the isolation must not rest on a caller's `notFound()`
 * ordering (`memory/invariants.md` -> Multi-Tenancy).
 */
export async function getCommunicationRecipients(
  churchId: string,
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
    .where(messageRecipientScope(churchId, communicationId));

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

  return comms.map((comm) => ({
    ...comm,
    stats: summarizeRecipients(recipientsByComm.get(comm.id) ?? []),
  }));
}

/**
 * Get tracking data for a meeting's recipients.
 * Returns per-person tracking keyed by person_id. Church-scoped in the query
 * itself, on both joined tables.
 */
export async function getMeetingTrackingByPerson(
  churchId: string,
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
    .where(meetingTrackingScope(churchId, meetingId));

  const map = new Map<
    string,
    { status: RecipientStatus; deliveredAt: Date | null; openedAt: Date | null }
  >();
  for (const row of rows) {
    // Keep the BEST outcome per person, not the lifecycle rank: this folds
    // across several messages, where a later delivered/opened email outranks
    // an earlier bounce — see TRACKING_DISPLAY_PRECEDENCE for why the two
    // orderings differ.
    const existing = map.get(row.personId);
    if (
      !existing ||
      TRACKING_DISPLAY_PRECEDENCE[row.status] >
        TRACKING_DISPLAY_PRECEDENCE[existing.status]
    ) {
      map.set(row.personId, {
        status: row.status,
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
