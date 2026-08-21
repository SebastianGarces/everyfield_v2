import {
  Button,
  Heading,
  Hr,
  Link,
  Section,
  Text,
  render,
} from "@react-email/components";

import type { SeatTenancyType } from "@/lib/auth/tenancy";
import {
  INVITED_AS_COPY,
  invitedAsKey,
  invitedAsWithArticle,
  TENANCY_NOUN,
  type InvitedAs,
} from "@/lib/invitations/seat-copy";

import { BaseLayout } from "../components/base-layout";

// ============================================================================
// The USER invitation email — AS-008 / AS-010 (#495, widened by #496).
//
// The sibling of `organization-invitation.tsx`, and the differences are the
// whole design:
//
//   * IT INVITES A PERSON, NOT AN ORGANIZATION. Nothing is associated and no
//     church is created — the reader joins a plant somebody else already runs,
//     with the seat the invitation names.
//   * A SEAT INVITATION IS REGISTER-ONLY, and it says so. An address that
//     already holds an EveryField account is refused at create time (AS-010),
//     so every reader of a seat message is signing up for the first time. A
//     COACH invitation is the deliberate exception (AS-009): it adds an
//     assignment and moves nothing, so any account can answer one and the link
//     lands on a page that asks rather than on the sign-up form. The words for
//     both come from `INVITED_AS_COPY`; this template picks none of them.
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
  /** The inviting tenancy's own name — never an id. */
  orgName: string;
  /**
   * WHICH KIND OF THING THAT NAME IS — a church plant, a sending church or a
   * network (#500). The template renders it as a noun ("join their sending
   * church") and passes it to `invitedAsKey`, which is what makes the "what
   * accepting means" paragraph describe an org seat's reach rather than a
   * plant's.
   */
  orgType: SeatTenancyType;
  /** Who sent it, for the "were you expecting this?" question. May be null. */
  inviterName: string | null;
  /**
   * What the invitation makes them: a seat (never `owner` — see
   * `invitableSeats`) or a coaching assignment. The WORDS for it come from
   * `INVITED_AS_COPY`, so this template compares no seat of its own.
   */
  invitedAs: InvitedAs;
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

/** Names the org first — in a crowded inbox that is the only word guaranteed to be read. */
export function seatInvitationSubject(
  orgName: string,
  invitedAs: InvitedAs,
  orgType: SeatTenancyType
): string {
  return `${orgName} invited you to ${INVITED_AS_COPY[invitedAsKey(invitedAs, orgType)].subjectTail}`;
}

/** The preheader. Under 90 characters, which is all any client shows. */
export function seatInvitationPreview(
  invitedAs: InvitedAs,
  orgType: SeatTenancyType
): string {
  return `You are invited as ${invitedAsWithArticle(invitedAs, orgType)} — this link only works for this address.`;
}

function SeatInvitationEmail({
  orgName,
  orgType,
  inviterName,
  invitedAs,
  inviteeEmail,
  inviteUrl,
  expiresLabel,
}: SeatInvitationEmailProps) {
  const invitedAsCopy = INVITED_AS_COPY[invitedAsKey(invitedAs, orgType)];
  const orgNoun = TENANCY_NOUN[orgType];

  return (
    <BaseLayout
      preview={seatInvitationPreview(invitedAs, orgType)}
      footerText={orgName}
    >
      <Heading style={heading}>{orgName} invited you to EveryField</Heading>

      <Text style={text}>
        {inviterName ? `${inviterName} at ` : ""}
        <strong>{orgName}</strong> invited you to join their {orgNoun} on
        EveryField as {invitedAsCopy.article}{" "}
        <strong>{invitedAsCopy.label}</strong>.
      </Text>

      {/*
        WHAT EVERYFIELD IS, SAID FROM THE READER'S OWN SEAT. The plant sentence
        describes the work a plant does; somebody joining a sending church or a
        network is not doing that work, they are watching a portfolio of it, and
        a paragraph that told them otherwise would misdescribe the product on
        first contact.
      */}
      <Text style={text}>
        {orgType === "church"
          ? "EveryField is where a church plant plans its launch, tracks the people it is reaching, and keeps its team on the same page."
          : "EveryField is where a church plant plans its launch and tracks the people it is reaching — and where the churches and networks behind them see how every plant is doing."}
      </Text>

      <Section style={buttonRow}>
        <Button href={inviteUrl} style={button}>
          {invitedAsCopy.cta}
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
        {`As ${invitedAsWithArticle(invitedAs, orgType)} at ${orgName}, ${invitedAsCopy.accepting}.`}
      </Text>

      <Text style={sectionHeading}>This link belongs to this address</Text>
      <Text style={text}>
        The invitation is issued to <strong>{inviteeEmail}</strong>, and it only
        works for that address. Please do not forward this email — a link that
        reaches anybody else cannot be used to sign up. If the address is wrong,
        ask {orgName} to revoke this invitation and send a new one.
      </Text>

      <Text style={text}>
        If you receive this invitation more than once, use the most recent
        email. Each one carries a new link, and the earlier links stop working.
      </Text>

      {expiresLabel && (
        <Text style={text}>This invitation expires on {expiresLabel}.</Text>
      )}

      <Text style={quiet}>
        Were you not expecting this? You can ignore this email — nothing is
        created and nothing is shared until you accept.
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
  const subject = seatInvitationSubject(
    props.orgName,
    props.invitedAs,
    props.orgType
  );
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
