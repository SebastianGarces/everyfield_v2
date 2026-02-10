// ============================================================================
// Communication Service
// ============================================================================
//
// Core service for sending messages, tracking delivery, and querying
// communication history. Integrates with Resend for email delivery
// and the merge field engine for personalization.
// ============================================================================

import { and, desc, eq, inArray, sql, count } from "drizzle-orm";
import { db } from "@/db";
import {
  communications,
  communicationRecipients,
  type Communication,
  type CommunicationRecipient,
  type RecipientStatus,
} from "@/db/schema/communication";
import { persons, type PersonStatus } from "@/db/schema/people";
import { churches } from "@/db/schema/church";
import { churchMeetings } from "@/db/schema/meetings";
import { resend, EMAIL_FROM } from "@/lib/email/client";
import {
  renderTemplate,
  buildPersonMergeData,
  buildChurchMergeData,
  buildMeetingMergeData,
} from "./merge";
import { createConfirmationToken } from "./confirmation";
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
      body: input.body,
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
    let mergeData = {
      ...churchMergeData,
      ...meetingMergeData,
      ...personMergeData,
    };

    // Generate confirmation tokens if this is meeting-linked
    if (meeting) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const token = await createConfirmationToken(
        churchId,
        meeting.id,
        person.id
      );
      mergeData.confirm_link = `${appUrl}/rsvp/${token}`;
      mergeData.decline_link = `${appUrl}/rsvp/${token}?action=decline`;
    }

    const renderedSubject = input.subject
      ? renderTemplate(input.subject, mergeData)
      : "";
    const renderedBody = renderTemplate(input.body, mergeData);

    emailBatch.push({
      from: EMAIL_FROM,
      to: [person.email],
      subject: renderedSubject,
      html: wrapInEmailLayout(renderedBody),
      text: renderedBody,
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
        await updateRecipientStatus(insertedRecipients[0].id, "failed", error.message);
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

/**
 * List communications for a church with pagination.
 */
export async function getCommunications(
  churchId: string,
  options: { page?: number; limit?: number } = {}
): Promise<{ communications: Communication[]; total: number }> {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const offset = (page - 1) * limit;

  const [comms, [{ total }]] = await Promise.all([
    db
      .select()
      .from(communications)
      .where(eq(communications.churchId, churchId))
      .orderBy(desc(communications.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(communications)
      .where(eq(communications.churchId, churchId)),
  ]);

  return { communications: comms, total };
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
      ...(comm.meetingId ? meetingMap.get(comm.meetingId) ?? {} : {}),
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
      (r) => r.status === "delivered" || r.status === "opened" || r.status === "clicked"
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
// Recipient Group Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a quick-select group into person IDs.
 */
export async function getRecipientsByGroup(
  churchId: string,
  group: string
): Promise<string[]> {
  let statusFilter: PersonStatus[];

  switch (group) {
    case "core_group":
      statusFilter = ["core_group"];
      break;
    case "launch_team":
      statusFilter = ["launch_team"];
      break;
    case "leaders":
      statusFilter = ["leader"];
      break;
    case "prospects":
      statusFilter = ["prospect"];
      break;
    case "all":
      statusFilter = [];
      break;
    default:
      statusFilter = [];
  }

  const conditions = [
    eq(persons.churchId, churchId),
    isNull(persons.deletedAt),
  ];

  if (statusFilter.length > 0) {
    conditions.push(inArray(persons.status, statusFilter));
  }

  const people = await db
    .select({ id: persons.id })
    .from(persons)
    .where(and(...conditions));

  return people.map((p) => p.id);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNull(column: typeof persons.deletedAt) {
  return sql`${column} IS NULL`;
}

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

/**
 * Wrap plain-text body in a minimal HTML email layout.
 * Converts newlines to <br> tags.
 */
function wrapInEmailLayout(body: string): string {
  const htmlBody = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f9fafb;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: white; border-radius: 8px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <p style="font-size: 16px; color: #4b5563; line-height: 1.6; margin: 0;">${htmlBody}</p>
    </div>
  </div>
</body>
</html>`;
}
