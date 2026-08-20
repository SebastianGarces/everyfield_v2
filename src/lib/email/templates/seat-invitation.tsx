import {
  Button,
  Heading,
  Hr,
  Link,
  Section,
  Text,
  render,
} from "@react-email/components";

import type { InvitableSeat } from "@/db/schema/user-invitation";
import {
  INVITED_SEAT_COPY,
  invitedSeatWithArticle,
} from "@/lib/invitations/seat-copy";

import { BaseLayout } from "../components/base-layout";

// ============================================================================
// The SEAT invitation email — AS-010 (#495).
//
// The sibling of `organization-invitation.tsx`, and the differences are the
// whole design:
//
//   * IT INVITES A PERSON, NOT AN ORGANIZATION. Nothing is associated and no
//     church is created — the reader joins a plant somebody else already runs,
//     with the seat the invitation names.
//   * IT IS REGISTER-ONLY, and it says so. An address that already holds an
//     EveryField account is refused at create time (AS-010), so every reader of
//     this message is signing up for the first time.
//   * IT IS THE CREDENTIAL CHANNEL. The link carries a random token that only
//     works for the address in the `To:` line, so forwarding it hands somebody a
//     link they cannot use — one plain sentence rather than a support
//     conversation a week later.
//   * EARLIER LINKS STOP WORKING. The token is stored HASHED, so a resend cannot
//     reproduce the one already sent and mints a fresh one instead. The reader is
//     told plainly to use the most recent email rather than discovering it as a
//     dead link.
//
// Layout rules are `.agents/skills/react-email/SKILL.md`: no flexbox/grid, no
// media queries, no `rem`, no images, one 600px column, inline pixel styles.
// ============================================================================

export interface SeatInvitationEmailProps {
  /** The plant's own name — never an id. */
  churchName: string;
  /** Who sent it, for the "were you expecting this?" question. May be null. */
  inviterName: string | null;
  /**
   * The seat the invitation grants. Never `owner` — see `invitableSeats`. The
   * WORDS for it come from `INVITED_SEAT_COPY`, so this template compares no
   * seat of its own.
   */
  seat: InvitableSeat;
  /**
   * The address the invitation was issued to. Rendered in the body on purpose:
   * it is the half of the credential the reader has to match.
   */
  inviteeEmail: string;
  /** Absolute, token-bound register URL. A relative href means nothing in an inbox. */
  inviteUrl: string;
  /** Already formatted against `APP_TIME_ZONE`. */
  expiresLabel: string | null;
}

/** Names the plant first — in a crowded inbox that is the only word guaranteed to be read. */
export function seatInvitationSubject(churchName: string): string {
  return `${churchName} invited you to join them on EveryField`;
}

/** The preheader. Under 90 characters, which is all any client shows. */
export function seatInvitationPreview(seat: InvitableSeat): string {
  return `Create your account as ${invitedSeatWithArticle(seat)} — this link only works for this address.`;
}

function SeatInvitationEmail({
  churchName,
  inviterName,
  seat,
  inviteeEmail,
  inviteUrl,
  expiresLabel,
}: SeatInvitationEmailProps) {
  const seatCopy = INVITED_SEAT_COPY[seat];

  return (
    <BaseLayout preview={seatInvitationPreview(seat)} footerText={churchName}>
      <Heading style={heading}>{churchName} invited you to EveryField</Heading>

      <Text style={text}>
        {inviterName ? `${inviterName} at ` : ""}
        <strong>{churchName}</strong> invited you to join their church plant on
        EveryField as {seatCopy.article} <strong>{seatCopy.label}</strong>.
      </Text>

      <Text style={text}>
        EveryField is where a church plant plans its launch, tracks the people
        it is reaching, and keeps its team on the same page.
      </Text>

      <Section style={buttonRow}>
        <Button href={inviteUrl} style={button}>
          Accept and create your account
        </Button>
      </Section>

      <Text style={fallback}>
        If the button does not work, paste this address into your browser:
        <br />
        <Link href={inviteUrl} style={fallbackLink}>
          {inviteUrl}
        </Link>
      </Text>

      <Hr style={rule} />

      <Text style={sectionHeading}>What accepting means</Text>
      <Text style={text}>
        {`You create your EveryField account and join ${churchName}. As ${invitedSeatWithArticle(seat)} ${seatCopy.accepting}.`}
      </Text>

      <Text style={sectionHeading}>This link belongs to this address</Text>
      <Text style={text}>
        The invitation is issued to <strong>{inviteeEmail}</strong>, and it only
        works for that address. Please do not forward this email — a link that
        reaches anybody else cannot be used to sign up. If the address is wrong,
        ask {churchName} to revoke this invitation and send a new one.
      </Text>

      <Text style={text}>
        If you receive this invitation more than once, use the most recent
        email. Each one carries a new link, and the earlier links stop working.
      </Text>

      {expiresLabel && (
        <Text style={text}>This invitation expires on {expiresLabel}.</Text>
      )}

      <Text style={quiet}>
        Were you not expecting this? You can ignore this email — no account is
        created until you accept.
      </Text>
    </BaseLayout>
  );
}

/**
 * Render it. Returns the plain-text part alongside the HTML: a text/plain
 * alternative is what a text-only client, an accessibility reader and a spam
 * filter each read.
 */
export async function seatInvitationEmail(
  props: SeatInvitationEmailProps
): Promise<{ subject: string; html: string; text: string }> {
  const subject = seatInvitationSubject(props.churchName);
  const html = await render(SeatInvitationEmail(props));
  const text = await render(SeatInvitationEmail(props), { plainText: true });
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Styles. Inline pixel values, matching the sibling templates.
// ---------------------------------------------------------------------------

const heading: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: 600,
  color: "#111827",
  lineHeight: "1.3",
  margin: "0 0 16px",
};

const sectionHeading: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: 600,
  color: "#111827",
  margin: "0 0 8px",
};

const text: React.CSSProperties = {
  fontSize: "16px",
  color: "#4b5563",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

const buttonRow: React.CSSProperties = {
  margin: "24px 0",
  textAlign: "center",
};

const button: React.CSSProperties = {
  backgroundColor: "#111827",
  border: "1px solid #111827",
  borderRadius: "6px",
  boxSizing: "border-box",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "16px",
  fontWeight: 600,
  lineHeight: "1.2",
  padding: "14px 28px",
  textAlign: "center",
  textDecoration: "none",
};

const fallback: React.CSSProperties = {
  fontSize: "13px",
  color: "#6b7280",
  lineHeight: "1.6",
  margin: "0 0 16px",
  wordBreak: "break-all",
};

const fallbackLink: React.CSSProperties = {
  color: "#4b5563",
  textDecoration: "underline",
};

const rule: React.CSSProperties = {
  borderColor: "#e5e7eb",
  margin: "24px 0",
};

const quiet: React.CSSProperties = {
  fontSize: "13px",
  color: "#6b7280",
  lineHeight: "1.6",
  margin: "16px 0 0",
};
