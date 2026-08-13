// ============================================================================
// Communication Send Pipeline
// ============================================================================
//
// The write half of the communication domain: composing and dispatching a
// message through Resend (with per-recipient merge rendering and RSVP tokens),
// and the COM-018 resend to non-openers. This is the module that pulls in the
// email renderer and the Resend client — the church-scoped reads live in
// `service.ts`, and the types client components need live in
// `recipient-groups.ts`, so neither drags this dependency set with it.
// ============================================================================

import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  communications,
  communicationRecipients,
  type Communication,
  type RecipientStatus,
} from "@/db/schema/communication";
import { persons } from "@/db/schema/people";
import { churches } from "@/db/schema/church";
import { churchMeetings } from "@/db/schema/meetings";
import { render } from "@react-email/components";
import { resend, EMAIL_FROM } from "@/lib/email/client";
import {
  CommunicationEmail,
  CommunicationEmailText,
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
  DELIVERED_STATUSES,
  OPENED_STATUSES,
  countOfStatuses,
  messageRecipientScope,
  nonOpenerScope,
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
  // the two halves can never say different things. It is also what is STORED in
  // `communications.body` — see the insert below.
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

  // 4. Create communication record.
  //
  // TWO COLUMNS, TWO SHAPES, and the schema already said which is which:
  // `body` is the FLATTENED plain text and `body_html` is the sanitised markup.
  // `body` is what message search reads (`ilike` in `filters.ts`), so storing
  // markup there made a planter's search for "we are excited" miss a body that
  // bolded a word in the middle of it, and a search for "p" match every
  // formatted message in the church. No migration is needed for either column:
  // a row written before COM-017 has `body_html` NULL and plain text in `body`,
  // which is exactly what `bodyHtml ?? body` + `toRichTextHtml` already handle.
  const [comm] = await db
    .insert(communications)
    .values({
      churchId,
      subject: input.subject,
      body: safeBodyText,
      bodyHtml: safeBodyHtml,
      channel: input.channel,
      templateId: input.templateId,
      meetingId: input.meetingId,
      status: "sending",
      recipientCount: recipientPersons.length,
      createdById: userId,
    })
    .returning();

  // 5. Prepare one payload per reachable recipient. The recipient id is
  // minted HERE (the pattern log.ts uses), so provider results map back to
  // rows by walking these same objects — never by assuming INSERT ...
  // RETURNING preserves order and re-aligning arrays with index arithmetic.
  const payloads: Array<{
    recipientId: string;
    personId: string;
    email: string;
    subject: string;
    bodyHtml: string;
    bodyText: string;
    confirmUrl?: string;
    declineUrl?: string;
  }> = [];

  for (const person of recipientPersons) {
    if (!person.email) continue;

    const personMergeData = buildPersonMergeData(person);
    const mergeData = {
      ...churchMergeData,
      ...meetingMergeData,
      ...personMergeData,
    };

    // Generate confirmation tokens if this is meeting-linked. Sequential on
    // purpose: createConfirmationToken is a SELECT-then-INSERT, and running
    // them concurrently would widen its duplicate-token race.
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

    payloads.push({
      recipientId: crypto.randomUUID(),
      personId: person.id,
      email: person.email,
      subject: input.subject ? renderTemplate(input.subject, mergeData) : "",
      // Merge VALUES are escaped before they land in an HTML body — a person
      // called `Bobby <script>` is a name, not markup. The token substitution
      // itself is still `renderTemplate`, the one implementation of it.
      bodyHtml: renderTemplate(safeBodyHtml, escapeMergeValues(mergeData)),
      bodyText: renderTemplate(safeBodyText, mergeData),
      confirmUrl,
      declineUrl,
    });
  }

  // Render the email trees in parallel — they are pure and independent of one
  // another, and two sequential renders per recipient made a bulk send scale
  // its wall-clock time with the recipient count.
  const emails = await Promise.all(
    payloads.map(async (p) => ({
      ...p,
      html: await render(
        CommunicationEmail({
          bodyHtml: p.bodyHtml,
          confirmUrl: p.confirmUrl,
          declineUrl: p.declineUrl,
          churchName: church.name,
          previewText: p.subject,
        })
      ),
      text: await render(
        CommunicationEmailText({
          body: p.bodyText,
          churchName: church.name,
        }),
        { plainText: true }
      ),
    }))
  );

  // 6. Insert recipient records under the minted ids
  if (emails.length > 0) {
    await db.insert(communicationRecipients).values(
      emails.map((p) => ({
        id: p.recipientId,
        churchId,
        communicationId: comm.id,
        personId: p.personId,
        email: p.email,
        channel: "email" as const,
        status: "pending" as const,
      }))
    );
  }

  // 7. Send via Resend (batch if > 1, single otherwise), then mark the
  // message sent — one terminal update, whichever path dispatched it.
  try {
    if (emails.length === 1) {
      // Single send
      const [recipient] = emails;
      const { data, error } = await resend.emails.send({
        from: EMAIL_FROM,
        to: [recipient.email],
        subject: recipient.subject,
        html: recipient.html,
        text: recipient.text,
      });
      if (error) {
        console.error("[COMM] Single send failed:", error);
        await updateRecipientStatus(
          recipient.recipientId,
          "failed",
          error.message
        );
      } else if (data?.id) {
        await db
          .update(communicationRecipients)
          .set({ externalId: data.id, status: "sent" })
          .where(eq(communicationRecipients.id, recipient.recipientId));
      }
    } else if (emails.length > 1) {
      // Batch send (max 100 per batch)
      for (const chunk of chunkArray(emails, 100)) {
        const { data, error } = await resend.batch.send(
          chunk.map((p) => ({
            from: EMAIL_FROM,
            to: [p.email],
            subject: p.subject,
            html: p.html,
            text: p.text,
          }))
        );
        if (error) {
          console.error("[COMM] Batch send failed:", error);
          // Mark all recipients in this chunk as failed
          for (const recipient of chunk) {
            await updateRecipientStatus(
              recipient.recipientId,
              "failed",
              error.message
            );
          }
        } else if (data) {
          // Resend answers a batch in request order, one result per email
          const ids = Array.isArray(data) ? data : [data];
          for (let i = 0; i < ids.length; i++) {
            const resendItem = ids[i];
            const recipient = chunk[i];
            if (recipient && resendItem?.id) {
              await db
                .update(communicationRecipients)
                .set({ externalId: resendItem.id, status: "sent" })
                .where(eq(communicationRecipients.id, recipient.recipientId));
            }
          }
        }
      }
    }

    await db
      .update(communications)
      .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(communications.id, comm.id));
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
    // The ONE read expression for a stored body: the markup if the row has it,
    // the plain text if it predates `body_html`. `toRichTextHtml` inside
    // `sendCommunication` converts the second case; the first is idempotent.
    body: original.bodyHtml ?? original.body,
    channel: original.channel,
    templateId: original.templateId ?? undefined,
    meetingId: original.meetingId ?? undefined,
    recipientIds: personIds,
  });
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
