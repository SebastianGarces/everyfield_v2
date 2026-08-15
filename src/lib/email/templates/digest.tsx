import {
  Button,
  Heading,
  Hr,
  Link,
  Section,
  Text,
  render,
} from "@react-email/components";
import { BaseLayout } from "../components/base-layout";

// ============================================================================
// The recurring planter digest email (N-013).
//
// The generic `./notification-batch.tsx` renders any group of notifications as
// titled blocks of prose. That is right for a task reminder and wrong for a
// digest, because a digest exists to be ACTED on: its whole job is to get a
// planter who has not opened the app in days back into it, so every line it
// carries needs somewhere to go.
//
// So this template is the same layout with one difference that matters — each
// summary line is paired with a link into the screen that line is about, and a
// single primary button covers the reader who just wants the dashboard.
//
// THREE THINGS IT IS CAREFUL ABOUT
//
// 1. IT NEVER WRITES THE CONTENT. `heading` and every `sections[].text` arrive
//    already composed by `src/lib/notifications/digest.ts` — F11 does not
//    template feature copy. This file decides layout, not words.
//
// 2. IT ALWAYS CARRIES AN UNSUBSCRIBE LINK. Required prop, not optional: an
//    email that could be composed without one is an email that eventually is.
//    A digest of the reader's own data is TRANSACTIONAL, and the link is here
//    anyway — F11 gives every dispatched email one, and this one is not special.
//
// 3. EVERY LINK IS ABSOLUTE. A relative href is meaningless in an inbox. The
//    caller builds them from `appBaseUrl()`; this file only renders what it is
//    given, and a section with no destination is simply not representable —
//    `href` is required.
//
// (`cursor-pointer`, the repo's clickable rule, is an app concern and not an
// email one: mail clients apply no stylesheet of ours and every element here is
// a real `<a>`/`<button>`. The digest's IN-APP appearance is the ordinary
// notification feed row, which already carries it.)
// ============================================================================

export interface DigestSectionProps {
  /** One summary line, e.g. `3 tasks are overdue`. Composed by the caller. */
  text: string;
  /** Absolute URL of the screen this line is about. Required. */
  href: string;
  /** The link's own words, e.g. `Open your tasks`. */
  linkLabel: string;
}

export interface DigestEmailProps {
  /** Greeting name; null when the recipient has never set one. */
  recipientName: string | null;
  /** The digest's title, which names the period it speaks for. */
  heading: string;
  /** One entry per non-empty summary line. May be empty in a degraded body. */
  sections: readonly DigestSectionProps[];
  /** Absolute URL of the dashboard — the primary call to action. */
  dashboardUrl: string;
  /** Absolute URL that disables the digest category's email channel. Required. */
  unsubscribeUrl: string;
  /** Absolute URL of the full preference screen. */
  preferencesUrl: string;
}

function DigestEmail({
  recipientName,
  heading,
  sections,
  dashboardUrl,
  unsubscribeUrl,
  preferencesUrl,
}: DigestEmailProps) {
  return (
    <BaseLayout preview={sections[0]?.text ?? heading}>
      <Heading style={headingStyle}>{heading}</Heading>
      {recipientName ? <Text style={text}>Hi {recipientName},</Text> : null}

      {sections.map((section, index) => (
        <Section key={`${section.text}-${index}`} style={itemBox}>
          <Text style={itemText}>{section.text}</Text>
          <Link href={section.href} style={itemLink}>
            {section.linkLabel}
          </Link>
        </Section>
      ))}

      <Section style={ctaBox}>
        <Button href={dashboardUrl} style={ctaButton}>
          Open EveryField
        </Button>
      </Section>

      <Hr style={rule} />

      <Text style={footerText}>
        You are receiving this because your EveryField digest is on.{" "}
        <Link href={unsubscribeUrl} style={footerLink}>
          Unsubscribe from digest emails
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
 * Render the digest email.
 *
 * Returns `html` and `text` only — the SUBJECT is the dispatcher's, because it
 * has to agree with the grouping decision (`batchSubject` in
 * `src/lib/notifications/channels/email.ts`) and a template that invented its
 * own would let the two drift.
 */
export async function digestEmail(
  props: DigestEmailProps
): Promise<{ html: string; text: string }> {
  const html = await render(DigestEmail(props));
  const text = await render(DigestEmail(props), { plainText: true });
  return { html, text };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const headingStyle: React.CSSProperties = {
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

const itemText: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: 600,
  color: "#111827",
  margin: "0 0 6px",
};

const itemLink: React.CSSProperties = {
  fontSize: "15px",
  color: "#4b5563",
  textDecoration: "underline",
};

const ctaBox: React.CSSProperties = {
  margin: "20px 0 0",
};

const ctaButton: React.CSSProperties = {
  backgroundColor: "#181d19",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600,
  padding: "12px 20px",
  textDecoration: "none",
  display: "inline-block",
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
