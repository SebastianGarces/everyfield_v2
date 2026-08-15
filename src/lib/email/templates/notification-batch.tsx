import {
  Heading,
  Hr,
  Link,
  Section,
  Text,
  render,
} from "@react-email/components";
import { BaseLayout } from "../components/base-layout";

// ============================================================================
// The one template every dispatched notification renders through (N-007,
// N-012).
//
// Two things it is careful about.
//
// 1. IT NEVER WRITES THE CONTENT. `title` and `body` arrive already rendered by
//    the feature that enqueued them — F11 does not template feature copy (FRD
//    Workflow 1, step 2). This file decides layout, not words, so the subject
//    and body a caller wrote are what lands in the inbox verbatim.
//
// 2. IT ALWAYS CARRIES AN UNSUBSCRIBE LINK. The prop is required, not optional:
//    an email that could be composed without one is an email that eventually
//    is. Compliance (CAN-SPAM/GDPR) and N-007 both want this to be
//    unconditional, and a required prop is how you make "unconditional" a
//    compile-time fact rather than a review comment.
//
// A GROUP renders as one email with one <li> per notification — deliberately a
// list, not a concatenation, so twenty task notifications read as twenty
// things in one message rather than twenty messages glued together (N-012).
//
// 3. ONE ITEM IS NOT A SPECIAL CASE (#263 item 1). This file used to branch on
//    `items.length === 1` into a block that rendered byte-for-byte what the map
//    below renders for a one-entry list. A reader could not tell whether the
//    two were meant to diverge later or whether one of them was already dead,
//    and the map is the only shape either arm can produce — so the branch is
//    gone rather than left ambiguous. A single notification is a group of one.
// ============================================================================

export interface NotificationEmailItemProps {
  title: string;
  body: string;
}

export interface NotificationBatchEmailProps {
  /** Greeting name; null when the recipient has never set one. */
  recipientName: string | null;
  /** Plain-language category label, from the code registry. */
  categoryLabel: string;
  /** One entry per notification in the group. Never empty. */
  items: readonly NotificationEmailItemProps[];
  /** Absolute URL that disables this category's email channel. Required. */
  unsubscribeUrl: string;
  /** Absolute URL of the full preference screen. */
  preferencesUrl: string;
}

function NotificationBatchEmail({
  recipientName,
  categoryLabel,
  items,
  unsubscribeUrl,
  preferencesUrl,
}: NotificationBatchEmailProps) {
  return (
    <BaseLayout preview={items[0]?.title ?? categoryLabel}>
      <Heading style={heading}>{categoryLabel}</Heading>
      {recipientName ? <Text style={text}>Hi {recipientName},</Text> : null}

      {items.map((item, index) => (
        <Section key={`${item.title}-${index}`} style={itemBox}>
          <Text style={itemTitle}>{item.title}</Text>
          <Text style={itemBody}>{item.body}</Text>
        </Section>
      ))}

      <Hr style={rule} />

      <Text style={footerText}>
        You are receiving this because {categoryLabel.toLowerCase()}{" "}
        notifications are on for your EveryField account.{" "}
        <Link href={unsubscribeUrl} style={footerLink}>
          Unsubscribe from {categoryLabel.toLowerCase()} emails
        </Link>{" "}
        or{" "}
        <Link href={preferencesUrl} style={footerLink}>
          manage all notification preferences
        </Link>
        .
      </Text>
    </BaseLayout>
  );
}

/**
 * Render the email a dispatched group becomes.
 *
 * Returns `html` and `text` only — the SUBJECT is the dispatcher's, because it
 * has to agree with the grouping decision (`batchSubject` in
 * `src/lib/notifications/channels/email.ts`) and a template that invented its
 * own would let the two drift.
 */
export async function notificationBatchEmail(
  props: NotificationBatchEmailProps
): Promise<{ html: string; text: string }> {
  const html = await render(NotificationBatchEmail(props));
  const text = await render(NotificationBatchEmail(props), {
    plainText: true,
  });
  return { html, text };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const heading: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 600,
  color: "#111827",
  margin: "0 0 16px",
};

const text: React.CSSProperties = {
  fontSize: "16px",
  color: "#4b5563",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

const itemBox: React.CSSProperties = {
  backgroundColor: "#f3f4f6",
  borderRadius: "6px",
  padding: "16px 20px",
  margin: "0 0 12px",
};

const itemTitle: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: 600,
  color: "#111827",
  margin: "0 0 6px",
};

const itemBody: React.CSSProperties = {
  fontSize: "15px",
  color: "#4b5563",
  lineHeight: "1.6",
  margin: 0,
};

const rule: React.CSSProperties = {
  borderColor: "#e5e7eb",
  margin: "24px 0 16px",
};

const footerText: React.CSSProperties = {
  fontSize: "13px",
  color: "#6b7280",
  lineHeight: "1.6",
  margin: 0,
};

const footerLink: React.CSSProperties = {
  color: "#4b5563",
  textDecoration: "underline",
};
